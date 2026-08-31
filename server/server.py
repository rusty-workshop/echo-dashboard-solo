#!/usr/bin/env python3
"""Companion LAN server for echo-dashboard-solo.

Provides opt-in endpoints backing features the dashboard can't do fully
offline/on-device:

  GET  /health            - liveness check, no auth
  POST /tts                 body: {"text": "..."}          -> audio/wav
  POST /insight              body: {weather, sleep, habits, calendar,
                                     sleepHistory?, habitCompletionByDate?}
                             -> {"text": "..."}
  GET  /iss-passes?lat=&lon=&hours=  -> {"passes": [...]}
  POST /backup               body: arbitrary JSON snapshot  -> {"ok": true}
  GET  /backup/latest       -> most recent snapshot JSON, or 404
  POST /trivia               body: {} -> {"q": "...", "a": "..."}
  POST /puzzle                body: {} -> {"options": [...4], "oddIndex": N,
                                            "reason": "..."}
  POST /journal-reflection   body: {"entries": [{"date","text"}, ...]}
                             -> {"text": "..."}
  POST /heartbeat            body: {} -> {"ok": true} - records a liveness
                             timestamp; see heartbeat_check.py for the
                             separate systemd-timer job that alerts on a
                             missed check-in
  GET  /wallpaper/random    -> image/jpeg, a random processed photo from
                               wallpapers/processed/ (fed by dropping files
                               into wallpapers/inbox/ - see server/README.md)
  POST /meal-idea             body: {"items": [...shopping list labels]}
                             -> {"text": "..."}
  GET  /discord-inbox       -> {"items": [{"type","text","receivedAt"}, ...]}
                               - fed by discord_bot.py (see server/README.md);
                               consumes (clears) the queue on each read, so
                               only ever returns what arrived since the last
                               poll
  POST /ask                   body: {"question": "..."} -> {"text": "..."}
  POST /soundscape-mood      body: {"mood": "..."}
                             -> {"layers": [{"soundId","volumePercent"}, ...]}
  POST /week-in-review        body: {sleepHistory?, habitCompletionByDate?}
                             -> {"text": "..."}
  POST /wallpaper-upscale     body: raw image bytes  -> image/jpeg, the same
                             photo run through waifu2x-ncnn-vulkan's photo
                             model when it's smaller than the dashboard
                             actually displays at (already-large photos are
                             returned through the same resize/encode path
                             untouched, no GPU work)
  GET  /homelab-status      -> {"generated","local_tools":[...],"services":[...]}
                               - services are checked live, right here;
                               local_tools is whatever the main PC last
                               POSTed to /homelab-local-status (see below),
                               flagged stale past 3h since that machine
                               isn't a 24/7 server
  POST /homelab-local-status  body: {"local_tools":[...]} -> {"ok": true} -
                             fed by ~/Projects/homelab-dashboard/push_status.py
                             on the main PC, see that repo's README

Everything is stdlib-only except skyfield (ISS passes), Pillow (wallpaper
processing), the Piper TTS binary (piper/piper/piper) + a voice model
under piper/voices/, discord.py (discord_bot.py, a separate always-on
process - see server/README.md), and waifu2x-ncnn-vulkan (system package,
see server/README.md) for /wallpaper-upscale. No accounts, no TLS - this
is meant to sit on a trusted home LAN behind the router, with an optional
shared-secret header (DASHBOARD_SERVER_KEY) as cheap insurance.

The Ollama-backed endpoints (/insight, /trivia, /journal-reflection) run
on a small local model (llama3.2:1b by default - see server/README.md for
why). That model is fine for warm, subjective text like a daily insight
sentence, but /trivia asks it to produce actual facts, which a 1B model
can and sometimes will get wrong. Its output is validated for shape (both
fields present) before being returned, never for factual correctness -
treat it as a fun supplement, not an authoritative source.

/puzzle ("odd one out" generation) and /soundscape-mood (picking sounds
that actually fit a described scene, not just structurally valid ones)
both need more actual judgment than the 1B model reliably gives - puzzle's
named "odd" word frequently didn't even match one of the 4 it had just
generated, and soundscape-mood kept picking poorly-matched sounds (a loud
"chime" for a cozy rainy evening, nothing for "camping" beyond generic
noise). Both run on qwen2.5:3b-instruct instead (OLLAMA_STRONG_MODEL),
which did noticeably better in testing; slower per call (a few seconds to
~15s including a model-swap reload) but that's fine for something
generated once per day/request and not blocking anything tap-and-wait
like TTS or the daily insight, which stay on the fast 1B model.
"""
import hashlib
import io
import json
import math
import os
import random
import re
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
BACKUP_DIR = BASE / "backups"
DATA_DIR.mkdir(exist_ok=True)
BACKUP_DIR.mkdir(exist_ok=True)

AUTH_KEY = os.environ.get("DASHBOARD_SERVER_KEY", "")
PORT = int(os.environ.get("DASHBOARD_SERVER_PORT", "8420"))

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = os.environ.get("DASHBOARD_OLLAMA_MODEL", "llama3.2:1b")
# Used for tasks that need real judgment, not just valid structure - see
# the module docstring above. Env var name kept as DASHBOARD_PUZZLE_MODEL
# (predates soundscape-mood using it too) rather than renamed and requiring
# an env file update on the server for no functional difference.
OLLAMA_STRONG_MODEL = os.environ.get("DASHBOARD_PUZZLE_MODEL", "qwen2.5:3b-instruct")

PIPER_BIN = BASE / "piper" / "piper" / "piper"
PIPER_MODEL = Path(
    os.environ.get("DASHBOARD_PIPER_MODEL", str(BASE / "piper" / "voices" / "en_US-lessac-high.onnx"))
)

TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
TLE_CACHE_FILE = DATA_DIR / "iss_tle.txt"
TLE_MAX_AGE_SECONDS = 6 * 3600

BACKUP_MAX_AGE_DAYS = 90

HEARTBEAT_FILE = DATA_DIR / "last_heartbeat"

HISTORICAL_WEATHER_CACHE_FILE = DATA_DIR / "historical_weather_cache.json"
HISTORICAL_WEATHER_YEARS_BACK = 5

DISCORD_INBOX_FILE = DATA_DIR / "discord_inbox.json"

HOMELAB_LOCAL_STATUS_FILE = DATA_DIR / "homelab_local_status.json"
HOMELAB_LOCAL_STATUS_MAX_AGE_SECONDS = 3 * 3600  # flagged stale past this - see gather_homelab_status()
# This box's own LAN address - checks in gather_latitude_services() hit
# localhost regardless (cheaper, and this server IS that machine), but the
# URL handed back to the dashboard has to be something the Echo Show can
# actually reach/display, not this process's own loopback.
LATITUDE_LAN_IP = os.environ.get("DASHBOARD_LATITUDE_LAN_IP", "192.168.1.158")

WALLPAPER_DIR = BASE / "wallpapers"
WALLPAPER_INBOX_DIR = WALLPAPER_DIR / "inbox"
WALLPAPER_PROCESSED_DIR = WALLPAPER_DIR / "processed"
WALLPAPER_MANIFEST_FILE = WALLPAPER_DIR / "processed_hashes.json"
WALLPAPER_MAX_DIMENSION = 1600  # matches the dashboard's own WALLPAPER_MAX_DIMENSION in script.js
WALLPAPER_JPEG_QUALITY = 82
for _d in (WALLPAPER_DIR, WALLPAPER_INBOX_DIR, WALLPAPER_PROCESSED_DIR):
    _d.mkdir(exist_ok=True)

# waifu2x-ncnn-vulkan only supports these exact scale factors - see
# upscale_wallpaper_image() for how one gets picked per image.
WAIFU2X_BIN = "waifu2x-ncnn-vulkan"
WAIFU2X_PHOTO_MODEL = Path("/usr/share/waifu2x-ncnn-vulkan/models-upconv_7_photo")
WAIFU2X_SUPPORTED_SCALES = (1, 2, 4, 8, 16, 32)

# ---------------------------------------------------------------------------
# ISS pass prediction (skyfield, no planetary ephemeris needed - only a
# NOAA-formula sun-altitude approximation to filter for nighttime passes)
# ---------------------------------------------------------------------------

def fetch_tle():
    req = urllib.request.Request(TLE_URL, headers={"User-Agent": "echo-dashboard-solo"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        text = resp.read().decode("utf-8").strip()
    lines = text.splitlines()
    if len(lines) < 3:
        raise ValueError("unexpected TLE response shape")
    TLE_CACHE_FILE.write_text(text + "\n")
    return lines[:3]


def load_tle():
    if TLE_CACHE_FILE.exists():
        age = time.time() - TLE_CACHE_FILE.stat().st_mtime
        if age < TLE_MAX_AGE_SECONDS:
            lines = TLE_CACHE_FILE.read_text().strip().splitlines()
            if len(lines) >= 3:
                return lines[:3]
    try:
        return fetch_tle()
    except Exception:
        if TLE_CACHE_FILE.exists():
            lines = TLE_CACHE_FILE.read_text().strip().splitlines()
            if len(lines) >= 3:
                return lines[:3]
        raise


def sun_altitude_deg(lat, lon, dt):
    """Approximate solar altitude (NOAA solar position formulas, no ephemeris file)."""
    n = dt.timetuple().tm_yday
    hour = dt.hour + dt.minute / 60 + dt.second / 3600
    gamma = 2 * math.pi / 365 * (n - 1 + (hour - 12) / 24)
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    time_offset = eqtime + 4 * lon
    tst = hour * 60 + time_offset
    ha_deg = (tst / 4) - 180
    lat_r = math.radians(lat)
    ha_r = math.radians(ha_deg)
    alt = math.asin(
        math.sin(lat_r) * math.sin(decl) + math.cos(lat_r) * math.cos(decl) * math.cos(ha_r)
    )
    return math.degrees(alt)


def find_iss_passes(lat, lon, hours):
    from skyfield.api import load, wgs84, EarthSatellite

    name, l1, l2 = load_tle()
    ts = load.timescale()
    sat = EarthSatellite(l1, l2, name, ts)
    observer = wgs84.latlon(lat, lon)
    t0 = ts.now()
    t1 = ts.tt_jd(t0.tt + hours / 24)
    times, events = sat.find_events(observer, t0, t1, altitude_degrees=15.0)

    passes = []
    current = {}
    for t, e in zip(times, events):
        dt = t.utc_datetime()
        if e == 0:
            current = {"rise": dt}
        elif e == 1:
            current["peak"] = dt
            alt, az, _ = (sat - observer).at(t).altaz()
            current["max_elevation"] = round(alt.degrees, 1)
        elif e == 2:
            current["set"] = dt
            if "rise" in current and "peak" in current:
                peak = current["peak"]
                sun_alt = sun_altitude_deg(lat, lon, peak)
                if sun_alt <= -6:
                    passes.append(
                        {
                            "rise": current["rise"].isoformat(),
                            "peak": peak.isoformat(),
                            "set": current["set"].isoformat(),
                            "max_elevation": current["max_elevation"],
                            "duration_seconds": int((current["set"] - current["rise"]).total_seconds()),
                        }
                    )
            current = {}
    return passes


# ---------------------------------------------------------------------------
# Ollama - shared call helper, used by /insight, /trivia, /puzzle, and
# /journal-reflection below.
# ---------------------------------------------------------------------------

def call_ollama(prompt, num_predict=60, temperature=0.6, timeout=45, model=None):
    body = json.dumps(
        {
            "model": model or OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA_URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return result.get("response", "").strip()


def parse_field(text, label):
    """Small models are far more reliable at following a simple 'LABEL:
    value' line format (extremely common in their training data) than
    producing well-formed nested JSON - see generate_trivia()/
    generate_puzzle() below, which both hit real malformed-JSON output
    (a stray extra '{', a wrong nesting depth) before switching to this."""
    match = re.search(rf"^{label}:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
    return match.group(1).strip() if match else None


# ---------------------------------------------------------------------------
# Dynamic insight - one generated sentence from today's facts, optionally
# enriched with a real statistical trend computed here (not by the model -
# small local models are unreliable at arithmetic/correlation, so this is
# plain Python statistics.mean over data the client sends, folded into the
# prompt as one more fact for the model to write a sentence about).
# ---------------------------------------------------------------------------

def compute_trend_fact(sleep_history, habit_completion_by_date):
    """sleep_history: [{"date": "YYYY-MM-DD", "minutes": N}, ...]
    habit_completion_by_date: [{"date": "YYYY-MM-DD", "completed": bool}, ...]
    Compares average sleep duration on nights that followed a day with at
    least one habit completed vs. nights that didn't - only returned if
    both groups have a decent sample size, so a handful of data points
    can't produce a misleading "trend"."""
    if not sleep_history or not habit_completion_by_date:
        return None

    completed_dates = {h["date"] for h in habit_completion_by_date if h.get("completed")}
    incomplete_dates = {h["date"] for h in habit_completion_by_date if not h.get("completed")}

    def prior_date(date_str):
        from datetime import date, timedelta

        y, m, d = (int(x) for x in date_str.split("-"))
        return (date(y, m, d) - timedelta(days=1)).isoformat()

    after_completed = [s["minutes"] for s in sleep_history if prior_date(s["date"]) in completed_dates]
    after_incomplete = [s["minutes"] for s in sleep_history if prior_date(s["date"]) in incomplete_dates]

    if len(after_completed) < 5 or len(after_incomplete) < 5:
        return None

    import statistics

    avg_completed = statistics.mean(after_completed)
    avg_incomplete = statistics.mean(after_incomplete)
    diff_minutes = round(avg_completed - avg_incomplete)
    if abs(diff_minutes) < 10:
        return None  # not a meaningfully different amount either way

    direction = "more" if diff_minutes > 0 else "less"
    return f"across recent history, sleeps {abs(diff_minutes)} minutes {direction} on nights following a day with a habit completed"


def load_historical_weather_cache():
    if HISTORICAL_WEATHER_CACHE_FILE.exists():
        try:
            return json.loads(HISTORICAL_WEATHER_CACHE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def historical_high_average(lat, lon):
    """Average high temperature (Fahrenheit) for this exact calendar date
    across the past HISTORICAL_WEATHER_YEARS_BACK years, via Open-Meteo's
    free archive API (same provider the dashboard already uses for live
    weather, keyless). Cached to disk once per day per rounded lat/lon,
    since it's HISTORICAL_WEATHER_YEARS_BACK separate HTTP calls - not
    something to redo on every /insight request."""
    today = datetime.now()
    cache_key = f"{round(lat, 1)},{round(lon, 1)},{today.month:02d}-{today.day:02d}"
    cache = load_historical_weather_cache()
    entry = cache.get(cache_key)
    if entry and entry.get("cachedDate") == today.date().isoformat():
        return entry.get("average")

    highs = []
    for years_ago in range(1, HISTORICAL_WEATHER_YEARS_BACK + 1):
        year = today.year - years_ago
        date_str = f"{year}-{today.month:02d}-{today.day:02d}"
        url = (
            "https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={lat}&longitude={lon}&start_date={date_str}&end_date={date_str}"
            "&daily=temperature_2m_max&temperature_unit=fahrenheit&timezone=auto"
        )
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "echo-dashboard-solo"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            values = data.get("daily", {}).get("temperature_2m_max", [])
            if values and values[0] is not None:
                highs.append(values[0])
        except Exception:
            continue  # one missing year doesn't sink the whole average

    if len(highs) < 3:  # too few years fetched successfully to trust an average
        return None

    import statistics

    average = round(statistics.mean(highs), 1)
    cache[cache_key] = {"cachedDate": today.date().isoformat(), "average": average}
    # Keep the cache from growing forever - only today's key (across
    # whatever lat/lon rounds to) is ever relevant again.
    cache = {k: v for k, v in cache.items() if v.get("cachedDate") == today.date().isoformat()}
    HISTORICAL_WEATHER_CACHE_FILE.write_text(json.dumps(cache))
    return average


def generate_insight(payload):
    parts = []
    weather = payload.get("weather")
    if weather:
        parts.append(f"weather: {weather}")
    sleep = payload.get("sleep")
    if sleep:
        parts.append(f"sleep: {sleep}")
    habits = payload.get("habits")
    if habits:
        parts.append(f"habits: {habits}")
    calendar = payload.get("calendar")
    if calendar:
        parts.append(f"next event: {calendar}")

    trend = compute_trend_fact(payload.get("sleepHistory") or [], payload.get("habitCompletionByDate") or [])
    if trend:
        parts.append(f"longer-term trend: {trend}")

    lat, lon, today_high = payload.get("lat"), payload.get("lon"), payload.get("todayHigh")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and isinstance(today_high, (int, float)):
        try:
            avg = historical_high_average(lat, lon)
        except Exception:
            avg = None
        if avg is not None:
            diff = round(today_high - avg)
            if abs(diff) >= 5:  # a few degrees off "normal" isn't interesting enough to mention
                direction = "above" if diff > 0 else "below"
                parts.append(
                    f"today's high is {abs(diff)}°F {direction} the {HISTORICAL_WEATHER_YEARS_BACK}-year average for this date"
                )

    facts = "; ".join(parts) if parts else "no data available"

    prompt = (
        "You write exactly ONE short, warm sentence (max 22 words) for a bedside "
        "dashboard, summarizing today's facts below. No markdown, no quotes, no "
        "greeting, no preamble like \"Here is\" - respond with ONLY the sentence "
        f"itself.\n\nFacts: {facts}\n\nSentence:"
    )

    text = call_ollama(prompt, num_predict=60, temperature=0.6)
    text = text.strip("\"'").split("\n")[0].strip()
    if len(text) > 220:
        cut = text[:220].rsplit(" ", 1)[0]
        text = cut + "..."
    return text


# ---------------------------------------------------------------------------
# Fresh trivia/puzzle content - the dashboard's own TRIVIA_QUESTIONS/
# PUZZLE_ROUNDS lists are static and cycle by day-of-year, so they repeat
# every 365 days. This generates new ones instead. See the module docstring
# above re: factual-accuracy risk with a 1B model - shape is validated,
# correctness is not.
# ---------------------------------------------------------------------------

# A topic hint per request, not just a bare instruction - without one,
# llama3.2:1b collapses to near-identical output request after request
# (repeatedly "what's the Red Planet? Mars." even at temperature 0.9).
# Rotating a random topic into the prompt fixes that; a higher temperature
# alone didn't.
TRIVIA_TOPICS = [
    "space exploration", "world history", "animals", "geography", "movies",
    "music", "sports", "food and cooking", "inventions", "ocean life",
    "mythology", "world capitals", "art", "technology", "human anatomy",
]


def generate_trivia():
    topic = random.choice(TRIVIA_TOPICS)
    prompt = (
        f"Write one general-knowledge trivia question about {topic} and its "
        "correct answer, suitable for a casual bedside trivia game.\n"
        "Respond in EXACTLY this format and nothing else:\n"
        "Q: <question>\n"
        "A: <answer>\n\n"
        "Example:\n"
        "Q: What is the capital of France?\n"
        "A: Paris.\n\n"
        "Now write a new, different trivia question:"
    )
    text = call_ollama(prompt, num_predict=150, temperature=1.0)
    q, a = parse_field(text, "Q"), parse_field(text, "A")
    if not q or not a:
        raise ValueError("malformed trivia response")
    return {"q": q, "a": a}


def generate_puzzle():
    prompt = (
        "Create an 'odd one out' word puzzle: four short words or names where "
        "three share a category and one doesn't belong.\n"
        "Respond in EXACTLY this format and nothing else:\n"
        "OPTIONS: word, word, word, word\n"
        "ODD: word\n"
        "REASON: one sentence explaining why\n\n"
        "Example:\n"
        "OPTIONS: Salmon, Trout, Dolphin, Tuna\n"
        "ODD: Dolphin\n"
        "REASON: A dolphin is a mammal - the rest are fish.\n\n"
        "Now create a new, different puzzle:"
    )
    text = call_ollama(prompt, num_predict=200, temperature=0.9, model=OLLAMA_STRONG_MODEL, timeout=60)
    options_line, odd_word, reason = parse_field(text, "OPTIONS"), parse_field(text, "ODD"), parse_field(text, "REASON")
    if not options_line or not odd_word or not reason:
        raise ValueError("malformed puzzle response")
    options = [o.strip() for o in options_line.split(",") if o.strip()]
    if len(options) != 4:
        raise ValueError(f"expected exactly 4 options, got {len(options)}")
    if len({o.lower() for o in options}) != 4:
        # Seen in testing: the model repeating one word twice instead of
        # generating 4 distinct ones (e.g. "Penguin, Moose, Bear, Penguin") -
        # shape-valid but would show two identical buttons on the puzzle UI.
        raise ValueError("options aren't all distinct")
    # Model names the odd word directly rather than computing a 0-based
    # index itself - matched case-insensitively since it doesn't always
    # echo the exact casing back.
    odd_index = next((i for i, o in enumerate(options) if o.lower() == odd_word.lower()), None)
    if odd_index is None:
        raise ValueError("ODD word doesn't match any of the OPTIONS")
    return {"options": options, "oddIndex": odd_index, "reason": reason}


# ---------------------------------------------------------------------------
# Weekly journal reflection - only ever called with content the dashboard
# already unlocked with its own password (see script.js's isJournalLocked())
# and only on an explicit tap, never automatically - see server/README.md's
# privacy note. Stays on this LAN either way; this function is the only
# place journal text is ever sent anywhere.
# ---------------------------------------------------------------------------

def generate_journal_reflection(entries):
    if not entries:
        raise ValueError("no entries provided")
    joined = "\n".join(f"- {e.get('date', '')}: {e.get('text', '')}" for e in entries if e.get("text"))
    if not joined.strip():
        raise ValueError("entries had no text")

    prompt = (
        "Below are someone's private journal entries from the past week. Write a "
        "short (3-4 sentence), warm, non-clinical reflection noticing any patterns "
        "or themes - not a summary of events, more like a gentle observation a "
        "thoughtful friend might make. No markdown, no bullet points, no "
        "preamble - respond with ONLY the reflection itself.\n\n"
        f"Entries:\n{joined}\n\nReflection:"
    )
    text = call_ollama(prompt, num_predict=200, temperature=0.7, timeout=60)
    text = text.strip().strip("\"")
    if not text:
        raise ValueError("empty reflection")
    return text


# ---------------------------------------------------------------------------
# Meal idea - a small, low-stakes generative task (unlike /trivia or
# /puzzle, nothing here needs to be factually or logically "correct"), so
# it stays on the fast 1B model rather than the puzzle model.
# ---------------------------------------------------------------------------

def generate_meal_idea(items):
    if not items:
        raise ValueError("no shopping list items provided")
    item_list = ", ".join(str(i) for i in items[:25])  # cap - an enormous list doesn't need to all be quoted back
    prompt = (
        "Here are items on someone's shopping list: "
        f"{item_list}.\n"
        "Suggest one simple meal they could make using some of these (doesn't need to use "
        "all of them, and a few common pantry staples like oil/salt/spices are fine to "
        "assume). Respond with ONLY 2-3 sentences: the meal name and a one-line idea of "
        "how to make it. No markdown, no preamble."
    )
    text = call_ollama(prompt, num_predict=150, temperature=0.8, timeout=30)
    text = text.strip().strip("\"")
    if not text:
        raise ValueError("empty meal idea")
    return text


# ---------------------------------------------------------------------------
# Ask the Dashboard - general free-text Q&A, the one open-ended feature
# here rather than a specific generated content type. Same factual-
# accuracy caveat as /trivia (small local model, can be confidently wrong)
# - the prompt asks it to hedge rather than guess, but treat answers as a
# starting point, not gospel.
# ---------------------------------------------------------------------------

def generate_answer(question):
    if not question or not question.strip():
        raise ValueError("no question provided")
    prompt = (
        "Answer this question concisely (2-4 sentences), in plain text with no "
        "markdown formatting. Answer plainly and directly when you actually know "
        "the answer - don't hedge on things you're sure of (arithmetic, well-known "
        "facts). Only flag uncertainty when you're genuinely not sure.\n\n"
        f"Question: {question.strip()}\n\nAnswer:"
    )
    # The fast 1B model used elsewhere (TTS text, the daily insight) was
    # noticeably weak here - both less accurate on anything past trivial
    # questions and prone to reflexive hedging even on things it clearly
    # knew (e.g. "1+1", answered correctly but wrapped in unnecessary
    # uncertainty). Ask is the one place someone's directly judging the
    # model's competence in the moment, unlike the more ambient generated
    # text elsewhere, so it's worth the extra latency of the larger model
    # already used for Puzzle/soundscape-mood.
    text = call_ollama(prompt, num_predict=200, temperature=0.3, model=OLLAMA_STRONG_MODEL, timeout=45)
    text = text.strip()
    if not text:
        raise ValueError("empty answer")
    return text


# ---------------------------------------------------------------------------
# Mood-to-soundscape - picks Soundscape Mixer layers/volumes from a typed
# description, instead of manually tuning four sliders. The model is only
# ever allowed to pick from SOUND_LIBRARY_IDS (the exact ids the dashboard's
# own SOUND_LIBRARY in script.js already knows how to play) and a plain
# "id: volume" line format, same "small models are unreliable at strict
# JSON, line-based is far more reliable" lesson as /trivia and /puzzle.
# ---------------------------------------------------------------------------

SOUND_LIBRARY_IDS = [
    "whitenoise", "pinknoise", "brownnoise", "rain", "ocean",
    "thunderstorm", "fireplace", "fan", "chime",
]


def generate_soundscape(mood):
    if not mood or not mood.strip():
        raise ValueError("no mood provided")
    ids_list = ", ".join(SOUND_LIBRARY_IDS)
    prompt = (
        f"Available ambient sounds: {ids_list}.\n"
        f'Someone wants a soundscape for this mood/scene: "{mood.strip()}"\n'
        "Pick up to 4 of the available sounds (fewer is fine if that suits it better) "
        "and a volume from 0-100 for each. Respond with one sound per line, in this "
        "exact style and nothing else - a sound id, a colon, then the number:\n\n"
        'Example, for "cozy rainy evening":\n'
        "rain: 70\n"
        "fireplace: 40\n\n"
        "Now do it for the mood above:"
    )
    text = call_ollama(prompt, num_predict=100, temperature=0.7, model=OLLAMA_STRONG_MODEL, timeout=30)

    layers = []
    for line in text.splitlines():
        # Tolerates stray wrapping punctuation (e.g. "<rain>: 70") - an
        # earlier version of the prompt above used <id>/<volume> as
        # placeholder notation in a format line, and the model echoed the
        # angle brackets back literally instead of treating them as "fill
        # this in" notation. Prompt no longer does that, but parsing stays
        # lenient as a second line of defense.
        match = re.match(r"^\s*[<\[({]*\s*([a-zA-Z]+)\s*[>\])}]*\s*:\s*(\d+)", line)
        if not match:
            continue
        sound_id, volume = match.group(1).strip(), int(match.group(2))
        if sound_id not in SOUND_LIBRARY_IDS:
            continue  # not a real sound id - model hallucinated or misread the list
        layers.append({"soundId": sound_id, "volumePercent": max(0, min(100, volume))})
        if len(layers) >= 4:  # matches MIXER_LAYER_COUNT in script.js
            break

    if not layers:
        raise ValueError("no valid sounds parsed from model response")
    return layers


# ---------------------------------------------------------------------------
# Week in Review - a bigger-picture, once-a-week cousin of the daily
# insight. The actual week-over-week comparison is computed here in plain
# Python (not by the model, for the same arithmetic-reliability reason as
# compute_trend_fact()); the model only ever writes the paragraph from
# facts already computed.
# ---------------------------------------------------------------------------

def compute_week_in_review_facts(sleep_history, habit_completion_by_date):
    from datetime import date, timedelta
    import statistics

    today = date.today()

    def week_range(weeks_ago):
        this_monday = today - timedelta(days=today.weekday())
        start = this_monday - timedelta(weeks=weeks_ago)
        return start, start + timedelta(days=6)

    this_start, this_end = week_range(0)
    last_start, last_end = week_range(1)

    def minutes_in_range(start, end):
        values = []
        for s in sleep_history:
            try:
                d = date.fromisoformat(s["date"])
            except (KeyError, ValueError):
                continue
            if start <= d <= end and s.get("minutes"):
                values.append(s["minutes"])
        return values

    this_week_sleep = minutes_in_range(this_start, this_end)
    last_week_sleep = minutes_in_range(last_start, last_end)

    facts = {}
    if this_week_sleep:
        facts["avg_sleep_this_week_hours"] = round(statistics.mean(this_week_sleep) / 60, 1)
        facts["nights_tracked_this_week"] = len(this_week_sleep)
    if last_week_sleep:
        facts["avg_sleep_last_week_hours"] = round(statistics.mean(last_week_sleep) / 60, 1)

    habit_completions_this_week = 0
    for h in habit_completion_by_date:
        try:
            d = date.fromisoformat(h.get("date", ""))
        except ValueError:
            continue
        if h.get("completed") and this_start <= d <= this_end:
            habit_completions_this_week += 1
    if habit_completion_by_date:
        facts["habit_completions_this_week"] = habit_completions_this_week

    return facts


def generate_week_in_review(sleep_history, habit_completion_by_date):
    facts = compute_week_in_review_facts(sleep_history or [], habit_completion_by_date or [])
    if not facts:
        raise ValueError("not enough data yet for a week in review")

    facts_text = "; ".join(f"{k}: {v}" for k, v in facts.items())
    prompt = (
        "You write a short (4-5 sentence), warm week-in-review for a bedside dashboard, "
        "from the facts below - a bigger-picture look back than a daily summary. "
        "Mention the week-over-week sleep comparison if both weeks' data is present. "
        "No markdown, no preamble like \"Here is\" - respond with ONLY the review "
        f"itself.\n\nFacts: {facts_text}\n\nReview:"
    )
    text = call_ollama(prompt, num_predict=220, temperature=0.6, timeout=45)
    text = text.strip().strip("\"")
    if not text:
        raise ValueError("empty week in review")
    return text


# ---------------------------------------------------------------------------
# Heartbeat - just records "the dashboard checked in at time T" here. The
# actual staleness check + alert lives in heartbeat_check.py, run on its own
# systemd timer (see server/README.md) rather than inside this always-on
# process, so a bug in this server doesn't also take out its own monitor.
# ---------------------------------------------------------------------------

def record_heartbeat():
    HEARTBEAT_FILE.write_text(str(time.time()))


# ---------------------------------------------------------------------------
# Discord inbox - discord_bot.py (a separate always-on process, see
# server/README.md) appends here when it recognizes a "note: ..." or
# "shop: ..." DM; this server never talks to Discord directly, it only
# reads/clears the same file. Mailbox pattern: each read consumes
# (clears) whatever's queued, so the dashboard's periodic poll only ever
# gets what's new since last time, not the same items over and over.
# ---------------------------------------------------------------------------

def consume_discord_inbox():
    if not DISCORD_INBOX_FILE.exists():
        return []
    try:
        items = json.loads(DISCORD_INBOX_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        items = []
    DISCORD_INBOX_FILE.write_text("[]")
    return items if isinstance(items, list) else []


# ---------------------------------------------------------------------------
# Homelab status - powers echo-dashboard-solo's Homelab Status page. Split
# in two halves for the same reason homelab-dashboard (the main-PC app this
# was folded in from) was split: "local tools" (ii-snap, wallpaper-sync,
# ii-update-check) only run on the main PC, so it POSTs its own status here
# periodically (see ~/Projects/homelab-dashboard/push_status.py on that
# machine) and this just serves back whatever it last received, with a
# staleness note once it's been too long - the main PC isn't a 24/7 server,
# unlike this one. Everything in "services" below runs right here, so it's
# checked live on every request instead of needing anything pushed to it.
# Every item is the same {title, status_line, detail, ok} shape the
# dashboard already renders for both sections - see homelabCardHtml() in
# script.js.
# ---------------------------------------------------------------------------

def load_homelab_local_status():
    if not HOMELAB_LOCAL_STATUS_FILE.exists():
        return None
    try:
        return json.loads(HOMELAB_LOCAL_STATUS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def save_homelab_local_status(payload):
    payload = dict(payload)
    payload["receivedAt"] = datetime.now(timezone.utc).isoformat()
    HOMELAB_LOCAL_STATUS_FILE.write_text(json.dumps(payload))


def check_http_reachable(url, timeout=2.0):
    """True on any real HTTP response, even an error status - that still
    proves the process is alive and serving, which is what these cards are
    actually trying to show (not that every route returns 200)."""
    try:
        urllib.request.urlopen(urllib.request.Request(url), timeout=timeout)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def check_systemd_active(unit):
    try:
        proc = subprocess.run(["systemctl", "--user", "is-active", unit], capture_output=True, text=True, timeout=5)
        return proc.stdout.strip() == "active"
    except Exception:
        return False


def docker_container_status(name):
    """Returns (running, health) - health is None when the image defines no
    healthcheck at all (most of these don't), in which case "running" is
    the whole signal."""
    try:
        proc = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", name],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode != 0:
            return None, None
        running, health = proc.stdout.strip().split("|")
        return running == "true", (None if health == "none" else health)
    except Exception:
        return None, None


def gather_latitude_services():
    items = []

    def add_http(title, port):
        # Checked via localhost (cheap, no network hop - this server IS
        # that machine) but shown/linked via the real LAN address, which is
        # the only one the Echo Show viewing this can actually do anything
        # useful with.
        ok = check_http_reachable(f"http://localhost:{port}/")
        display_url = f"http://{LATITUDE_LAN_IP}:{port}/"
        items.append({"title": title, "status_line": "reachable" if ok else "unreachable", "detail": display_url, "ok": ok, "url": display_url})

    def add_systemd(title, unit):
        ok = check_systemd_active(unit)
        items.append({"title": title, "status_line": "running" if ok else "not running", "detail": unit, "ok": ok})

    def add_docker(title, name):
        running, health = docker_container_status(name)
        if running is None:
            items.append({"title": title, "status_line": "not found", "detail": name, "ok": None})
            return
        items.append({
            "title": title,
            "status_line": health or ("running" if running else "stopped"),
            "detail": name,
            "ok": running and health in (None, "healthy"),
        })

    def add_tailnet_only(title, port):
        # Deliberately not exposed on the plain LAN (see server/README.md) -
        # reachable only over Tailscale, which this kiosk isn't on. Checked
        # the same way as everything else (loopback, from right here), but
        # given no "url" - a link the Echo Show can't actually open would
        # just be a broken tap target, worse than no link at all.
        ok = check_http_reachable(f"http://localhost:{port}/")
        items.append({"title": title, "status_line": "running (Tailscale-only, not LAN-reachable)" if ok else "not reachable", "detail": "", "ok": ok})

    # Discord bots have no meaningful web UI to check - their own systemd
    # active-state is the honest signal here, not an HTTP probe.
    add_systemd("Discord Bot (dashboard)", "dashboard-discord-bot.service")
    add_systemd("Judgment Bot", "judgment-bot.service")
    add_http("Judgment Dashboard", 8090)
    add_http("KaiOS Alerts", 8095)
    add_http("Uptime Kuma", 3001)
    add_http("AdGuard Home", 8091)
    add_tailnet_only("Vaultwarden", 8222)
    add_tailnet_only("Syncthing", 8384)
    add_http("changedetection.io", 5000)
    add_http("PrivateBin", 8085)
    add_docker("Watchtower", "watchtower")  # background-only, no web UI at all
    return items


def gather_homelab_status():
    local = load_homelab_local_status()
    if local is None:
        local_tools = [{"title": "Local Tools", "status_line": "waiting for the main PC's first check-in", "detail": "", "ok": None}]
    else:
        received = datetime.fromisoformat(local["receivedAt"])
        stale = (datetime.now(timezone.utc) - received).total_seconds() > HOMELAB_LOCAL_STATUS_MAX_AGE_SECONDS
        local_tools = []
        for item in local.get("local_tools", []):
            item = dict(item)
            if stale:
                item["status_line"] = f"{item.get('status_line', '')} - stale, main PC may be off".strip(" -")
            local_tools.append(item)

    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "local_tools": local_tools,
        "services": gather_latitude_services(),
    }


# ---------------------------------------------------------------------------
# Wallpaper rotation - drop photos into wallpapers/inbox/ (scp, see
# server/README.md), this processes any not-yet-seen file into
# wallpapers/processed/ (resized, JPEG, deduped by content hash) and serves
# a random one. Processing runs lazily on request rather than via its own
# timer/watcher, since new photos showing up is rare and this is cheap when
# there's nothing new to do.
# ---------------------------------------------------------------------------

def load_wallpaper_manifest():
    if WALLPAPER_MANIFEST_FILE.exists():
        try:
            return json.loads(WALLPAPER_MANIFEST_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_wallpaper_manifest(manifest):
    WALLPAPER_MANIFEST_FILE.write_text(json.dumps(manifest))


def process_wallpaper_inbox():
    from PIL import Image, ImageOps

    manifest = load_wallpaper_manifest()  # source filename -> content hash already processed
    for src in sorted(WALLPAPER_INBOX_DIR.iterdir()):
        if not src.is_file():
            continue
        content = src.read_bytes()
        content_hash = hashlib.sha256(content).hexdigest()[:16]
        if manifest.get(src.name) == content_hash:
            continue  # already processed, unchanged since
        out_path = WALLPAPER_PROCESSED_DIR / f"{content_hash}.jpg"
        if not out_path.exists():
            try:
                with Image.open(src) as img:
                    img = ImageOps.exif_transpose(img)  # respect phone-camera rotation metadata
                    img = img.convert("RGB")
                    scale = min(1.0, WALLPAPER_MAX_DIMENSION / max(img.width, img.height))
                    if scale < 1.0:
                        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
                    img.save(out_path, "JPEG", quality=WALLPAPER_JPEG_QUALITY)
            except Exception:
                continue  # not a readable image - skip rather than crash the whole scan
        manifest[src.name] = content_hash
    save_wallpaper_manifest(manifest)


def pick_random_wallpaper():
    process_wallpaper_inbox()
    files = list(WALLPAPER_PROCESSED_DIR.glob("*.jpg"))
    if not files:
        return None
    return random.choice(files).read_bytes()


def upscale_wallpaper_image(raw_bytes):
    """Runs [raw_bytes] through waifu2x-ncnn-vulkan's photo model when it's
    smaller than the dashboard actually displays at, then applies the exact
    same cap/JPEG-encode tail as process_wallpaper_inbox() so the result is
    indistinguishable in storage terms from a normal wallpaper import.
    Already-large photos skip the GPU step entirely - upscaling something
    that's about to be downscaled right back down would just burn time for
    no visible difference."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(raw_bytes)) as img:
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        needed = WALLPAPER_MAX_DIMENSION / max(img.width, img.height)
        scale = next((s for s in WAIFU2X_SUPPORTED_SCALES if s >= needed), WAIFU2X_SUPPORTED_SCALES[-1])

        if scale <= 1:
            out = img
        else:
            with tempfile.TemporaryDirectory() as tmp:
                in_path = Path(tmp) / "in.png"
                out_path = Path(tmp) / "out.png"
                img.save(in_path, "PNG")  # a fresh PNG so waifu2x isn't enhancing on top of extra JPEG artifacts
                proc = subprocess.run(
                    [WAIFU2X_BIN, "-i", str(in_path), "-o", str(out_path), "-s", str(scale), "-m", str(WAIFU2X_PHOTO_MODEL)],
                    capture_output=True,
                    timeout=120,
                )
                if proc.returncode != 0:
                    raise RuntimeError(proc.stderr.decode("utf-8", "replace"))
                out = Image.open(out_path)
                out.load()  # decode now - the temp dir (and out_path) is gone once this block exits

        final_scale = min(1.0, WALLPAPER_MAX_DIMENSION / max(out.width, out.height))
        if final_scale < 1.0:
            out = out.resize((round(out.width * final_scale), round(out.height * final_scale)), Image.LANCZOS)
        buf = io.BytesIO()
        out.save(buf, "JPEG", quality=WALLPAPER_JPEG_QUALITY)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# TTS (Piper - offline neural TTS, far better quality than espeak-ng's
# formant synthesis; still fully local, no cloud call)
# ---------------------------------------------------------------------------

def synthesize_speech(text):
    proc = subprocess.run(
        [str(PIPER_BIN), "-m", str(PIPER_MODEL), "-f", "-", "-q"],
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace"))
    return proc.stdout


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

def save_backup(payload):
    now = datetime.now(timezone.utc)
    fname = BACKUP_DIR / f"{now.strftime('%Y-%m-%dT%H-%M-%S')}.json"
    fname.write_text(json.dumps(payload))
    cutoff = time.time() - BACKUP_MAX_AGE_DAYS * 86400
    for f in BACKUP_DIR.glob("*.json"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


def latest_backup():
    files = sorted(BACKUP_DIR.glob("*.json"))
    if not files:
        return None
    return json.loads(files[-1].read_text())


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "DashboardServer/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def _authed(self):
        if not AUTH_KEY:
            return True
        return self.headers.get("X-Dashboard-Key", "") == AUTH_KEY

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status, content_type, data):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Dashboard-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _read_raw_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        if not self._authed():
            self._send_json(401, {"error": "unauthorized"})
            return
        if parsed.path == "/iss-passes":
            q = parse_qs(parsed.query)
            try:
                lat = float(q["lat"][0])
                lon = float(q["lon"][0])
            except (KeyError, ValueError):
                self._send_json(400, {"error": "lat and lon query params required"})
                return
            hours = float(q.get("hours", ["72"])[0])
            try:
                passes = find_iss_passes(lat, lon, hours)
                self._send_json(200, {"passes": passes})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/backup/latest":
            data = latest_backup()
            if data is None:
                self._send_json(404, {"error": "no backups yet"})
            else:
                self._send_json(200, data)
            return
        if parsed.path == "/wallpaper/random":
            try:
                data = pick_random_wallpaper()
            except Exception as e:
                self._send_json(500, {"error": str(e)})
                return
            if data is None:
                self._send_json(404, {"error": "no wallpapers processed yet - drop some into wallpapers/inbox/"})
            else:
                self._send_bytes(200, "image/jpeg", data)
            return
        if parsed.path == "/discord-inbox":
            try:
                self._send_json(200, {"items": consume_discord_inbox()})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        if parsed.path == "/homelab-status":
            try:
                self._send_json(200, gather_homelab_status())
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self._authed():
            self._send_json(401, {"error": "unauthorized"})
            return
        if parsed.path == "/tts":
            try:
                payload = self._read_json_body()
                text = (payload.get("text") or "").strip()
                if not text:
                    self._send_json(400, {"error": "text required"})
                    return
                audio = synthesize_speech(text[:2000])
                self._send_bytes(200, "audio/wav", audio)
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        if parsed.path == "/insight":
            try:
                payload = self._read_json_body()
                text = generate_insight(payload)
                self._send_json(200, {"text": text})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/backup":
            try:
                payload = self._read_json_body()
                save_backup(payload)
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        if parsed.path == "/trivia":
            try:
                self._send_json(200, generate_trivia())
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/puzzle":
            try:
                self._send_json(200, generate_puzzle())
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/journal-reflection":
            try:
                payload = self._read_json_body()
                text = generate_journal_reflection(payload.get("entries") or [])
                self._send_json(200, {"text": text})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/heartbeat":
            try:
                record_heartbeat()
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        if parsed.path == "/meal-idea":
            try:
                payload = self._read_json_body()
                text = generate_meal_idea(payload.get("items") or [])
                self._send_json(200, {"text": text})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/ask":
            try:
                payload = self._read_json_body()
                text = generate_answer(payload.get("question") or "")
                self._send_json(200, {"text": text})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/soundscape-mood":
            try:
                payload = self._read_json_body()
                layers = generate_soundscape(payload.get("mood") or "")
                self._send_json(200, {"layers": layers})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/week-in-review":
            try:
                payload = self._read_json_body()
                text = generate_week_in_review(payload.get("sleepHistory"), payload.get("habitCompletionByDate"))
                self._send_json(200, {"text": text})
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        if parsed.path == "/homelab-local-status":
            try:
                payload = self._read_json_body()
                save_homelab_local_status(payload)
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
            return
        if parsed.path == "/wallpaper-upscale":
            try:
                raw = self._read_raw_body()
                if not raw:
                    self._send_json(400, {"error": "image body required"})
                    return
                data = upscale_wallpaper_image(raw)
                self._send_bytes(200, "image/jpeg", data)
            except Exception as e:
                self._send_json(502, {"error": str(e)})
            return
        self._send_json(404, {"error": "not found"})


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"dashboard-server listening on :{PORT} (auth={'on' if AUTH_KEY else 'off'})")
    server.serve_forever()


if __name__ == "__main__":
    main()
