#!/usr/bin/env python3
"""Companion LAN server for echo-dashboard-solo.

Provides four opt-in endpoints backing features the dashboard can't do
fully offline/on-device:

  GET  /health          - liveness check, no auth
  POST /tts              body: {"text": "..."}          -> audio/wav
  POST /insight           body: {weather, sleep, habits, calendar} -> {"text": "..."}
  GET  /iss-passes?lat=&lon=&hours=  -> {"passes": [...]}
  POST /backup            body: arbitrary JSON snapshot  -> {"ok": true}
  GET  /backup/latest    -> most recent snapshot JSON, or 404

Everything is stdlib-only except skyfield (for ISS pass prediction) and the
Piper TTS binary (piper/piper/piper) + a voice model under piper/voices/,
downloaded separately - see the deploy notes in this repo's server/README.md.
No accounts, no TLS - this is meant to sit on a trusted home LAN behind the
router, with an optional shared-secret header (DASHBOARD_SERVER_KEY) as
cheap insurance.
"""
import json
import math
import os
import subprocess
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

PIPER_BIN = BASE / "piper" / "piper" / "piper"
PIPER_MODEL = Path(
    os.environ.get("DASHBOARD_PIPER_MODEL", str(BASE / "piper" / "voices" / "en_US-lessac-high.onnx"))
)

TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
TLE_CACHE_FILE = DATA_DIR / "iss_tle.txt"
TLE_MAX_AGE_SECONDS = 6 * 3600

BACKUP_MAX_AGE_DAYS = 90

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
# Dynamic insight (local Ollama)
# ---------------------------------------------------------------------------

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
    facts = "; ".join(parts) if parts else "no data available"

    prompt = (
        "You write exactly ONE short, warm sentence (max 22 words) for a bedside "
        "dashboard, summarizing today's facts below. No markdown, no quotes, no "
        "greeting, no preamble like \"Here is\" - respond with ONLY the sentence "
        f"itself.\n\nFacts: {facts}\n\nSentence:"
    )

    body = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.6, "num_predict": 60},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    text = result.get("response", "").strip()
    text = text.strip("\"'").split("\n")[0].strip()
    if len(text) > 220:
        cut = text[:220].rsplit(" ", 1)[0]
        text = cut + "..."
    return text


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
        self._send_json(404, {"error": "not found"})


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"dashboard-server listening on :{PORT} (auth={'on' if AUTH_KEY else 'off'})")
    server.serve_forever()


if __name__ == "__main__":
    main()
