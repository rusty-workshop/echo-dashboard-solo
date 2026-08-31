/**
 * Aurora Dashboard - Solo
 *
 * A fork of echo-dashboard with every phone-dependent feature removed:
 * this build talks to no companion app at all. It's entirely self-
 * contained - vanilla JS, no build step, no framework, no backend of its
 * own either. Two independent update loops:
 *  - the clock ticks every second, driven by the device's own local time
 *    (also drives day/night dimming, auto-Bedside-Mode, and the wake-alarm
 *    scheduler on the same tick)
 *  - weather (+ severe alerts + radar station) refreshes on a timer against
 *    two free, unauthenticated, CORS-enabled public APIs - Open-Meteo and
 *    the National Weather Service - fetched directly from this page, the
 *    same way Aurora itself used to
 *
 * Everything that genuinely needs a phone (notifications, its battery, Do
 * Not Disturb, imported photos, its calendar) is gone rather than faked.
 * What replaces it is either a from-scratch local reimplementation (Wake
 * Alarms and the Sound Machine are both now fully self-contained, using
 * Web Audio to synthesize their own ambient loops instead of streaming
 * files from a phone) or new, dashboard-only features that don't need one
 * (a manually-kept Agenda instead of synced events, a World Clock, a
 * guided Breathing exercise, "Today in History", a daily quote).
 *
 * FUTURE EXPANSION: to add a new data-driven card:
 *   1. Add a <section class="card"> to index.html with its own ids.
 *   2. Add one renderX(...) function below, next to the others.
 *   3. Call it from wherever its underlying state changes (weather refresh,
 *      a settings change, a clock tick - whichever fits).
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Home coordinate, used for weather/alerts/radar/ISS passes - there's no
// phone location to follow anymore, so unlike Aurora's own fallback this is
// the only coordinate this build ever uses. Set by the first-run Setup
// Wizard (see HOME_LOCATION_KEY/saveHomeLocation() below), not a baked-in
// city - the geographic center of the contiguous US is just a neutral
// placeholder for the brief window before that wizard's location step is
// completed, not a real assumed home.
const HOME_LOCATION_KEY = "aurora-dashboard:home-location"; // {lat, lon, label}
const HOME_LOCATION_FALLBACK = { lat: 39.8283, lon: -98.5795, label: null };

function loadHomeLocation() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOME_LOCATION_KEY) || "null");
    if (parsed && typeof parsed.lat === "number" && typeof parsed.lon === "number") return parsed;
  } catch (err) {
    // fall through to the fallback below
  }
  return HOME_LOCATION_FALLBACK;
}

let homeLocation = loadHomeLocation();
let HOME_LATITUDE = homeLocation.lat;
let HOME_LONGITUDE = homeLocation.lon;

function saveHomeLocation(lat, lon, label) {
  homeLocation = { lat, lon, label };
  localStorage.setItem(HOME_LOCATION_KEY, JSON.stringify(homeLocation));
  HOME_LATITUDE = lat;
  HOME_LONGITUDE = lon;
}

const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const ALERT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const VOLUME_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// Morning Overview tile layout - purely a local display preference now
// (used to be customizable from the Aurora phone app; there's no phone
// app anymore, so this is just localStorage - see setupLayoutSettings()).
// ---------------------------------------------------------------------------

const TILE_DOM_ID = {
  weather: "card-weather",
  schedule: "card-schedule",
  alarm: "card-alarm",
  sound: "card-sound",
  worldclock: "card-worldclock",
  countdown: "card-countdown",
  nightroutine: "card-nightroutine",
  habits: "card-habits",
  reminders: "card-reminders",
  shoppinglist: "card-shoppinglist",
};

const TILE_SIZE_WEIGHT = { small: 0.7, medium: 1, large: 1.5 };

const DEFAULT_TILE_LAYOUT = [
  { id: "weather", visible: true, size: "medium" },
  { id: "schedule", visible: true, size: "large" },
  { id: "alarm", visible: true, size: "small" },
  { id: "sound", visible: true, size: "large" },
  { id: "worldclock", visible: false, size: "small" },
  { id: "countdown", visible: false, size: "small" },
  { id: "nightroutine", visible: false, size: "small" },
  { id: "habits", visible: false, size: "small" },
  { id: "reminders", visible: false, size: "small" },
  { id: "shoppinglist", visible: false, size: "small" },
];

const LAYOUT_KEY = "aurora-dashboard:layout";

// ---------------------------------------------------------------------------
// Icons - inline Material-style SVGs (currentColor, so they inherit the
// dynamic accent color), no icon font/CDN dependency.
// ---------------------------------------------------------------------------

const ICONS = {
  sunny:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  cloud:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 19a4.5 4.5 0 0 1-.5-8.98A6 6 0 0 1 17.6 8.03 4.5 4.5 0 0 1 17 19H6.5z"/></svg>',
  partlyCloudy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="7" r="3.2"/><path d="M16 2.3v1.2M20.7 7h-1.2M12.9 3.9l.85.85M20.05 3.9l-.85.85" stroke-width="1.6"/><path d="M5.5 20a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 15.5 10.5 4 4 0 0 1 15 20H5.5z"/></svg>',
  rain:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 15a4.5 4.5 0 0 1-.5-8.98A6 6 0 0 1 17.6 4.03 4.5 4.5 0 0 1 17 15H6.5z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  storm:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 15a4.5 4.5 0 0 1-.5-8.98A6 6 0 0 1 17.6 4.03 4.5 4.5 0 0 1 17 15H6.5z"/><path d="M13 15l-2.5 4h2.5l-1.5 3"/></svg>',
  snow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 14a4.5 4.5 0 0 1-.5-8.98A6 6 0 0 1 17.6 3.03 4.5 4.5 0 0 1 17 14H6.5z"/><path d="M8 18v4M8 18l-1.5 1.5M8 18l1.5 1.5M12 18v4M12 18l-1.5 1.5M12 18l1.5 1.5M16 18v4M16 18l-1.5 1.5M16 18l1.5 1.5"/></svg>',
  fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 8h13M3 12h18M3 16h13M8 20h8"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  alarm:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M5 3L3 5M19 3l2 2"/></svg>',
  speaker:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 5V4l-5 5H4z"/><path d="M17 8a5 5 0 0 1 0 8M19.5 5.5a9 9 0 0 1 0 13"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 5V4l-5 5H4z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>',
  volumeMuted:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 5V4l-5 5H4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.1A11 11 0 0 1 12 5c7 0 11 7 11 7a13.2 13.2 0 0 1-3.05 3.9M6.5 6.5A13.2 13.2 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 4.24-.87"/><path d="M9.5 9.5a3 3 0 0 0 4.24 4.24"/><path d="M2 2l20 20"/></svg>',
  radar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" stroke-width="1.4"/><path d="M12 12L12 4A8 8 0 0 1 18.5 16.8z" fill="currentColor" stroke="none" opacity="0.35"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  alertTriangle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01" stroke-width="2.4"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 4 13c0-5 4.5-9 11-10 1 6.5-3 11-11 11"/><path d="M4 20c3-2 5.5-4.5 7-8"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5z"/><circle cx="12" cy="7" r="2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 7H6"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h9a2.5 2.5 0 1 0-2.5-2.5"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
  scroll:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21a2 2 0 0 1-2-2V5a2 2 0 0 1 4 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2H10"/><path d="M6 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10h-4"/></svg>',
  checklist:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l1.5 1.5L7 5"/><path d="M3 12l1.5 1.5L7 11"/><path d="M3 18l1.5 1.5L7 17"/><path d="M11 6h10M11 12h10M11 18h10"/></svg>',
  flame:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.36 5.21A8.25 8.25 0 0 1 12 21a8.25 8.25 0 0 1-5.96-13.95A8.29 8.29 0 0 0 9 9.6a9 9 0 0 1 3.36-6.87 8.2 8.2 0 0 0 3 2.48z"/><path d="M12 18a3.75 3.75 0 0 0 .5-7.47 6 6 0 0 0-1.93 3.55 6 6 0 0 1-2.13-1A3.75 3.75 0 0 0 12 18z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function byId(id) {
  return document.getElementById(id);
}

/**
 * Sets an element's text content, and - only when the value actually
 * changed - briefly replays the value-pulse animation, so updates read as
 * a subtle "beat" instead of silently changing between polls.
 */
function setText(id, value) {
  const el = byId(id);
  if (!el) return;

  const next = value == null ? "" : String(value);
  if (el.textContent === next) return;

  el.textContent = next;
  el.classList.remove("value-pulse");
  void el.offsetWidth; // force reflow so the animation restarts cleanly
  el.classList.add("value-pulse");
}

/** Swaps an icon-slot's SVG only when the icon actually changes. */
function setIcon(id, iconName) {
  const el = byId(id);
  if (!el || el.dataset.icon === iconName) return;
  el.dataset.icon = iconName;
  el.innerHTML = ICONS[iconName] || "";
}

/** Same as setIcon, but plays a brief scale+fade "pop" on change - used
 *  just for the weather icon, since a real shape morph between conditions
 *  (sun -> cloud -> rain, ...) isn't practical for a handful of unrelated
 *  SVGs, but an instant swap reads as a jump-cut next to everything else
 *  on this dashboard that eases into its changes. */
function setWeatherIcon(id, iconName) {
  const el = byId(id);
  if (!el || el.dataset.icon === iconName) return;
  el.dataset.icon = iconName;
  el.innerHTML = ICONS[iconName] || "";
  el.classList.remove("icon-pop");
  void el.offsetWidth; // force reflow so the animation restarts cleanly
  el.classList.add("icon-pop");
}

// ---------------------------------------------------------------------------
// Rolling number animation - ties a numeric value's text to a smooth
// count-up/down tween instead of an instant jump-cut (weather temperatures,
// battery %). Reads the element's own currently-*displayed* value as the
// tween's start point, not whatever this function last set it to, so a
// stale/interrupted animation never causes a visible skip.
// ---------------------------------------------------------------------------

const NUMBER_ROLL_DURATION_MS = 650;
const numberRollHandles = new Map(); // elementId -> rAF id, so a re-trigger cancels the prior tween

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Animates [id]'s text between whatever number it currently shows and
 *  [targetValue], appending [suffix] (e.g. "°" or "%") - a plain
 *  instant-set (no tween) the first time, when there's no prior numeric
 *  value to animate from. */
function setRollingNumber(id, targetValue, suffix = "") {
  const el = byId(id);
  if (!el || targetValue == null || Number.isNaN(targetValue)) return;

  const startValue = parseInt(el.textContent, 10);
  if (Number.isNaN(startValue)) {
    el.textContent = `${targetValue}${suffix}`;
    return;
  }
  if (startValue === targetValue) return;

  const existingHandle = numberRollHandles.get(id);
  if (existingHandle) cancelAnimationFrame(existingHandle);

  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / NUMBER_ROLL_DURATION_MS, 1);
    const value = Math.round(startValue + (targetValue - startValue) * easeOutCubic(progress));
    el.textContent = `${value}${suffix}`;
    if (progress < 1) {
      numberRollHandles.set(id, requestAnimationFrame(step));
    } else {
      numberRollHandles.delete(id);
    }
  };
  numberRollHandles.set(id, requestAnimationFrame(step));
}

/** Agenda titles, journal entries, imported sound/photo names, and every
 *  other free-text field on this dashboard are user-entered - escape
 *  before dropping any of it into innerHTML. */
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Aurora returns 24-hour "HH:mm" strings; the display uses whichever
 *  format the Settings page's clock-format toggle currently picks (see
 *  clock24h) - kept in sync with the big clock rather than a separate
 *  per-feature choice, so sunrise/sunset/alarm times never disagree with
 *  the clock about which format is "on" right now. */
function formatTimeOfDay(hhmm) {
  if (!hhmm) return null;
  const [hourStr, minuteStr] = hhmm.split(":");
  let hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return hhmm;

  if (clock24h) return `${hourStr.padStart(2, "0")}:${minuteStr}`;

  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minuteStr} ${period}`;
}

// Matches the exact condition strings Aurora's WeatherConditionMapper emits.
const WEATHER_ICON_BY_CONDITION = {
  Clear: "sunny",
  "Partly Cloudy": "partlyCloudy",
  Overcast: "cloud",
  Fog: "fog",
  Drizzle: "rain",
  Rain: "rain",
  "Rain Showers": "rain",
  Snow: "snow",
  "Snow Showers": "snow",
  Thunderstorm: "storm",
};

// v1.1: dynamic accent color by weather - warm for clear, gray for cloud,
// blue for anything wet. Applied as a CSS custom property so every element
// using var(--accent) (icons, highlighted numbers, the volume slider, ...)
// transitions together.
const ACCENT_BY_CONDITION = {
  Clear: "#ffb74d",
  "Partly Cloudy": "#9aa5b1",
  Overcast: "#9aa5b1",
  Fog: "#9aa5b1",
  Drizzle: "#5b9bf0",
  Rain: "#5b9bf0",
  "Rain Showers": "#5b9bf0",
  Snow: "#5b9bf0",
  "Snow Showers": "#5b9bf0",
  Thunderstorm: "#5b9bf0",
};

function applyAccentColor(condition) {
  document.documentElement.style.setProperty("--accent", ACCENT_BY_CONDITION[condition] || "#9aa5b1");
}

// ---------------------------------------------------------------------------
// Wallpaper accent-color extraction - averages a downsampled draw of a
// wallpaper photo and boosts saturation/lightness to a comfortable UI
// range (a plain pixel average from a real photo reads as muddy gray, not
// a usable accent). Kept here with the rest of the accent logic even
// though the wallpaper photos themselves live further down, next to their
// own IndexedDB storage.
// ---------------------------------------------------------------------------

let wallpaperAccentColor = null; // null = no wallpaper photo showing, weather drives the accent as usual

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function extractWallpaperAccentColor(imageEl) {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageEl, 0, 0, size, size);

  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch (err) {
    return null; // Shouldn't happen for a blob: URL - same-origin by definition, never taints the canvas.
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip mostly-transparent pixels
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (count === 0) return null;
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);

  const [h, s] = rgbToHsl(r, g, b);
  const [ar, ag, ab] = hslToRgb(h, Math.max(s, 0.5), 0.62);
  return `rgb(${ar}, ${ag}, ${ab})`;
}

// One of 8 ambient background treatments - each condition gets its own
// look (see style.css's "Ambient weather backgrounds" section). Night
// wins over a clear sky (stars, not a sun glow) but rain/snow/storm keep
// their own look even after dark - rain is still rain at 2am.
const WEATHER_BG_BY_CONDITION = {
  Clear: "sunny",
  "Partly Cloudy": "partlycloudy",
  Overcast: "clouds",
  Fog: "fog",
  Drizzle: "rain",
  Rain: "rain",
  "Rain Showers": "rain",
  Snow: "snow",
  "Snow Showers": "snow",
  Thunderstorm: "storm",
};

function setWeatherBackground(condition, nightOverride) {
  const el = byId("weather-bg");
  if (!el) return;
  const overrideEffect = computeActiveWeatherBgEffect();
  const name = overrideEffect || (nightOverride ? "night" : WEATHER_BG_BY_CONDITION[condition] || "clouds");
  if (el.dataset.bg === name) return;
  el.dataset.bg = name;
  el.className = `weather-bg weather-bg--${name}`;
}

// ---------------------------------------------------------------------------
// Weather Background override (Settings page) - forces one of the 8
// effects above regardless of the real weather condition, either
// immediately ("on demand") or on a recurring daily schedule. Pure
// localStorage, no Aurora involvement, same reasoning as the theme picker:
// this is a display conceit, not real weather data.
// ---------------------------------------------------------------------------

const WEATHER_BG_EFFECT_LABELS = {
  sunny: "Sunny",
  partlycloudy: "Partly Cloudy",
  clouds: "Overcast",
  fog: "Fog",
  rain: "Rain",
  snow: "Snow",
  storm: "Storm",
  night: "Night",
};

const WEATHER_BG_MANUAL_KEY = "aurora-dashboard:weatherbg-manual";
const WEATHER_BG_SCHEDULE_KEY = "aurora-dashboard:weatherbg-schedule";

/** {effect, expiresAt} | null. expiresAt is an epoch-ms number, or null for
 *  an indefinite override - computed once at activation time (see
 *  computeWeatherBgExpiresAt()) rather than re-derived from a stored
 *  duration on every check, so "rest of day" only has to resolve what
 *  "today" means once. */
let weatherBgManualOverride = null;
try {
  weatherBgManualOverride = JSON.parse(localStorage.getItem(WEATHER_BG_MANUAL_KEY) || "null");
} catch (err) {
  weatherBgManualOverride = null;
}

/** [{id, effect, time: "HH:MM", duration}]. duration is "15"/"30"/"60"/
 *  "120"/"240" (minutes), "restofday" (until local midnight), or
 *  "indefinite" (treated as a full 24h window - see
 *  activeScheduledWeatherBgEffect() - so it's always superseded by the
 *  next real entry rather than genuinely never-ending). */
let weatherBgSchedule = [];
try {
  weatherBgSchedule = JSON.parse(localStorage.getItem(WEATHER_BG_SCHEDULE_KEY) || "[]");
} catch (err) {
  weatherBgSchedule = [];
}

function saveWeatherBgManualOverride() {
  if (weatherBgManualOverride) {
    localStorage.setItem(WEATHER_BG_MANUAL_KEY, JSON.stringify(weatherBgManualOverride));
  } else {
    localStorage.removeItem(WEATHER_BG_MANUAL_KEY);
  }
}

function saveWeatherBgSchedule() {
  localStorage.setItem(WEATHER_BG_SCHEDULE_KEY, JSON.stringify(weatherBgSchedule));
}

/** Resolved once at activation time against "now", rather than stored as a
 *  raw duration - see weatherBgManualOverride's doc comment. */
function computeWeatherBgExpiresAt(duration) {
  if (duration === "indefinite") return null;
  if (duration === "restofday") {
    const nowMinutes = currentMinutesInTimezone(currentTimezone || undefined);
    return Date.now() + (1440 - nowMinutes) * 60 * 1000;
  }
  const minutes = parseInt(duration, 10) || 60;
  return Date.now() + minutes * 60 * 1000;
}

function activateWeatherBgOverride(effect, duration) {
  weatherBgManualOverride = { effect, expiresAt: computeWeatherBgExpiresAt(duration) };
  saveWeatherBgManualOverride();
  if (lastWeatherData) renderWeather(lastWeatherData);
}

function stopWeatherBgOverride() {
  weatherBgManualOverride = null;
  saveWeatherBgManualOverride();
  if (lastWeatherData) renderWeather(lastWeatherData);
}

/** [entries] sorted by time ascending. Each entry is "live" for its own
 *  duration window starting at its time-of-day; on overlap, whichever
 *  entry started most recently wins - same "most recently passed" rule
 *  activeScheduledPhotoId() uses for the wallpaper schedule. Returns null
 *  (meaning "Auto") when no entry's window currently contains "now". */
function activeScheduledWeatherBgEffect() {
  if (weatherBgSchedule.length === 0) return null;
  const nowMinutes = currentMinutesInTimezone(currentTimezone || undefined);
  const sorted = [...weatherBgSchedule].sort((a, b) => minutesFromHHMM(a.time) - minutesFromHHMM(b.time));
  let active = null;
  for (const entry of sorted) {
    const start = minutesFromHHMM(entry.time);
    const windowMinutes =
      entry.duration === "restofday" ? 1440 - start : entry.duration === "indefinite" ? 1440 : parseInt(entry.duration, 10) || 60;
    const end = start + windowMinutes;
    const inWindow = nowMinutes >= start && nowMinutes < end;
    const wrapped = end > 1440 && nowMinutes < end - 1440;
    if (inWindow || wrapped) active = entry;
  }
  return active ? active.effect : null;
}

/** The single source of truth setWeatherBackground() defers to: a live
 *  manual override wins outright (clearing itself here once expired), then
 *  the schedule, then null ("Auto" - follow the real weather as before). */
function computeActiveWeatherBgEffect() {
  if (weatherBgManualOverride) {
    if (weatherBgManualOverride.expiresAt != null && Date.now() >= weatherBgManualOverride.expiresAt) {
      weatherBgManualOverride = null;
      saveWeatherBgManualOverride();
    } else {
      return weatherBgManualOverride.effect;
    }
  }
  return activeScheduledWeatherBgEffect();
}

// ---------------------------------------------------------------------------
// Dashboard wallpaper's accent-color extraction. The rotation itself lives
// further down, next to Ambient Mode's photo-cycling code, since both now
// share the same Aurora photo library - these two helpers (color math) are
// general-purpose enough to stay up here with the rest of the weather/
// accent logic they feed into.
// ---------------------------------------------------------------------------

// Past this hour (and before NIGHT_WEATHER_OVERRIDE_END_HOUR the next
// morning), the Weather card shows a moon and switches to silver
// regardless of the actual condition - even a clear, 90°+ night shouldn't
// show a bright sun icon. A fixed clock-hour override, not tied to actual
// sunset/sunrise like applyDayNightMode()'s dimming - those are two
// different concerns that just happen to both be about nighttime.
const NIGHT_WEATHER_OVERRIDE_START_HOUR = 20; // 8:00 PM
const NIGHT_WEATHER_OVERRIDE_END_HOUR = 6; // 6:00 AM
const NIGHT_WEATHER_ACCENT = "#c7ccd6"; // silver

function isPastNightWeatherThreshold(timeZone) {
  const hour = currentHourInTimezone(timeZone);
  return hour >= NIGHT_WEATHER_OVERRIDE_START_HOUR || hour < NIGHT_WEATHER_OVERRIDE_END_HOUR;
}

function greetingForHour(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

/** Same timezone the clock uses (see currentTimezone below, set from the
 *  weather API's response for HOME_LATITUDE/HOME_LONGITUDE) - so "9pm" in
 *  the greeting means 9pm at that fixed location, not wherever this
 *  display's own system clock happens to be set. */
function currentHourInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(
    new Date()
  );
  const raw = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  return Number.isNaN(raw) ? new Date().getHours() : raw;
}

/** Same idea as currentHourInTimezone, but minute-precise - needed to dim/
 *  brighten at the actual sunrise/sunset minute rather than only on the hour. */
function currentMinutesInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
  return hour * 60 + minute;
}

function minutesFromHHMM(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

// ---------------------------------------------------------------------------
// Clock - independent of the Aurora poll loop, ticks every second. Also
// refreshes the status line's relative "Updated Xs ago" text on the same
// tick, since that needs to advance even between polls.
//
// Follows wherever Aurora's phone actually is, not just whatever system
// timezone this display happens to be set to: Open-Meteo resolves an IANA
// timezone (e.g. "America/New_York") for whatever coordinate the weather
// request used, Aurora passes it through on WeatherSnapshot, and
// renderWeather() below stores it in currentTimezone. Until the first
// successful weather fetch, currentTimezone is null and Intl.DateTimeFormat
// falls back to this device's own system timezone - the same behavior the
// clock always had before this existed.
// ---------------------------------------------------------------------------

let currentTimezone = null;

// Fallback dim/brighten window, used only until the first successful
// weather fetch provides real sunrise/sunset - same "known data beats a
// guess, but a guess beats nothing" pattern as currentTimezone above.
const NIGHT_MODE_FALLBACK_START_MIN = 21 * 60; // 9:00 PM
const NIGHT_MODE_FALLBACK_END_MIN = 7 * 60; // 7:00 AM

// If Fully Kiosk's JS interface is enabled, these also dim/restore the
// actual hardware backlight, not just this page's own contents - purely
// cosmetic (CSS-only) if it isn't, see applyDayNightMode() below.
const NIGHT_SCREEN_BRIGHTNESS = 20;
const DAY_SCREEN_BRIGHTNESS = 100;

let latestSunrise = null; // "HH:mm", set by renderWeather()
let latestSunset = null;
let isNightMode = null; // null = not yet determined

// Manual nudge on top of the sunrise/sunset schedule (see the Settings
// page's Display section) - shifts both edges of the dim window by the
// same amount, since "darker earlier tonight" naturally also means
// "stay dark later in the morning" for a bedside display, not two
// independently-tuned thresholds.
const DIM_OFFSET_KEY = "aurora-dashboard:dim-offset-minutes";
let dimOffsetMinutes = parseInt(localStorage.getItem(DIM_OFFSET_KEY), 10) || 0;

// Aurora always reports temperature in °F (see WeatherSnapshot on that
// side) - this is purely a display-time conversion, nothing round-trips to
// Aurora in Celsius. Kept as a bare "°" everywhere except the Morning
// Briefing sentence (the one spot that already spelled out a literal "F"),
// matching the dashboard's existing minimalist temperature style.
const TEMP_UNIT_KEY = "aurora-dashboard:temp-unit";
let tempUnit = localStorage.getItem(TEMP_UNIT_KEY) === "C" ? "C" : "F";

function displayTemp(fahrenheit) {
  if (fahrenheit == null) return null;
  return tempUnit === "C" ? Math.round(((fahrenheit - 32) * 5) / 9) : Math.round(fahrenheit);
}

// 24h format skips the AM/PM suffix entirely rather than just switching
// hour12 - see clockTimeParts()/updateClock().
const CLOCK_FORMAT_KEY = "aurora-dashboard:clock-format";
let clock24h = localStorage.getItem(CLOCK_FORMAT_KEY) === "24h";

/**
 * Dims the whole display at night for bedside comfort, brightens it back
 * for the morning - prefers actual sunrise/sunset (accounts for season and
 * latitude) once weather data is in, falls back to a fixed 9pm-7pm window
 * until then. Only touches the DOM/JS bridge on an actual day/night
 * transition, not every tick, so this is cheap to call from updateClock().
 */
function applyDayNightMode() {
  const nowMinutes = currentMinutesInTimezone(currentTimezone || undefined);
  const sunriseMinutes =
    (latestSunrise ? minutesFromHHMM(latestSunrise) : NIGHT_MODE_FALLBACK_END_MIN) + dimOffsetMinutes;
  const sunsetMinutes =
    (latestSunset ? minutesFromHHMM(latestSunset) : NIGHT_MODE_FALLBACK_START_MIN) + dimOffsetMinutes;

  const night = nowMinutes >= sunsetMinutes || nowMinutes < sunriseMinutes;
  if (night === isNightMode) return;
  isNightMode = night;

  document.body.classList.toggle("dimmed", night);

  if (window.fully && typeof window.fully.setScreenBrightness === "function") {
    window.fully.setScreenBrightness(night ? NIGHT_SCREEN_BRIGHTNESS : DAY_SCREEN_BRIGHTNESS);
  }
}

function formatDimOffsetLabel(minutes) {
  if (minutes === 0) return "On time";
  return minutes < 0 ? `${-minutes}m earlier` : `${minutes}m later`;
}

function setupDimOffsetSlider() {
  const slider = byId("dim-offset-slider");
  const label = byId("dim-offset-value");
  if (!slider || !label) return;

  slider.value = String(dimOffsetMinutes);
  label.textContent = formatDimOffsetLabel(dimOffsetMinutes);

  slider.addEventListener("input", () => {
    dimOffsetMinutes = parseInt(slider.value, 10) || 0;
    label.textContent = formatDimOffsetLabel(dimOffsetMinutes);
    localStorage.setItem(DIM_OFFSET_KEY, String(dimOffsetMinutes));
    // applyDayNightMode() normally only acts on an actual night/day
    // transition, not every call - forcing isNightMode back to
    // "undetermined" makes a slider drag take visible effect immediately
    // instead of waiting for the next real sunrise/sunset crossing.
    isNightMode = null;
    applyDayNightMode();
  });
}

// How dark "dimmed" actually gets, as a percentage - separate from
// dimOffsetMinutes above (which controls *when* dimming starts/ends, not
// how dark it goes). 45% matches the value this was hardcoded to before
// this setting existed, so anyone who's never touched the slider sees no
// change (see body.dimmed's var() fallback in style.css).
const DIM_INTENSITY_KEY = "aurora-dashboard:dim-intensity-percent";
let dimIntensityPercent = parseInt(localStorage.getItem(DIM_INTENSITY_KEY), 10) || 45;

function applyDimIntensity() {
  document.documentElement.style.setProperty("--dim-intensity", String(dimIntensityPercent / 100));
}

function setupDimIntensitySlider() {
  const slider = byId("dim-intensity-slider");
  const label = byId("dim-intensity-value");
  if (!slider || !label) return;

  slider.value = String(dimIntensityPercent);
  label.textContent = `${dimIntensityPercent}%`;
  applyDimIntensity();

  slider.addEventListener("input", () => {
    dimIntensityPercent = parseInt(slider.value, 10) || 45;
    label.textContent = `${dimIntensityPercent}%`;
    localStorage.setItem(DIM_INTENSITY_KEY, String(dimIntensityPercent));
    applyDimIntensity();
  });
}

function setupClockFormatSetting() {
  const segmented = byId("clock-format-segmented");
  if (!segmented) return;

  const sync = () => {
    segmented.querySelectorAll(".settings-segment").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.format === (clock24h ? "24h" : "12h"));
    });
  };
  sync();

  segmented.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    clock24h = btn.dataset.format === "24h";
    localStorage.setItem(CLOCK_FORMAT_KEY, clock24h ? "24h" : "12h");
    sync();
    updateClock();
  });
}

function setupTempUnitSetting() {
  const segmented = byId("temp-unit-segmented");
  if (!segmented) return;

  const sync = () => {
    segmented.querySelectorAll(".settings-segment").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.unit === tempUnit);
    });
  };
  sync();

  segmented.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    tempUnit = btn.dataset.unit;
    localStorage.setItem(TEMP_UNIT_KEY, tempUnit);
    sync();
    // Re-render from the last-known weather rather than waiting up to 30s
    // for the next poll - same "instant feedback" reasoning as every other
    // Settings control on this page.
    if (lastWeatherData) renderWeather(lastWeatherData);
  });
}

const USER_NAME_KEY = "aurora-dashboard:user-name";
let userName = localStorage.getItem(USER_NAME_KEY) || "";

/** Commits on blur, not per keystroke. Pure localStorage - there's no
 *  phone app to keep this in sync with anymore. */
function setupProfileSettings() {
  const input = byId("settings-name-input");
  if (!input) return;
  input.value = userName;

  input.addEventListener("blur", () => {
    userName = input.value.trim();
    localStorage.setItem(USER_NAME_KEY, userName);
    renderMorningBriefing();
  });
}

// ---------------------------------------------------------------------------
// First-run Setup Wizard - shown exactly once (gated by SETUP_COMPLETE_KEY),
// above literally everything else (z-index: 200 in style.css). Collects the
// handful of things that used to have no good default (name, and
// especially location - see HOME_LOCATION_KEY near the top of this file)
// or that are easy to miss buried in Settings on a device you just set up
// (Companion Server). The normal dashboard still loads underneath it using
// whatever placeholder location is active until Finish is tapped - harmless
// since nothing behind the overlay is visible before then.
// ---------------------------------------------------------------------------
const SETUP_COMPLETE_KEY = "aurora-dashboard:setup-complete";

let setupSelectedLocation = null; // {lat, lon, label} once a search result is tapped

/** Open-Meteo's geocoding API - same free, keyless, CORS-enabled provider
 *  already used for weather, so this doesn't introduce a new dependency. */
async function searchLocations(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Search failed.");
  const data = await resp.json();
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
  }));
}

function renderSetupLocationResults(results) {
  const container = byId("setup-location-results");
  if (!container) return;
  container.innerHTML = "";
  results.forEach((loc) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "setup-location-result-btn";
    btn.textContent = loc.label;
    btn.addEventListener("click", () => {
      setupSelectedLocation = loc;
      container.querySelectorAll(".setup-location-result-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      const hint = byId("setup-location-hint");
      if (hint) {
        hint.textContent = "";
        hint.classList.add("hidden");
      }
    });
    container.appendChild(btn);
  });
}

function setupSetupWizardLocationSearch() {
  const input = byId("setup-location-input");
  const searchBtn = byId("setup-location-search-btn");
  const hint = byId("setup-location-hint");

  const showHint = (text) => {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  };

  const runSearch = async () => {
    const query = (input?.value || "").trim();
    if (!query) return;
    showHint("Searching...");
    try {
      const results = await searchLocations(query);
      if (results.length === 0) {
        showHint("No matches - try a different spelling.");
        renderSetupLocationResults([]);
        return;
      }
      showHint("");
      renderSetupLocationResults(results);
    } catch (err) {
      showHint("Couldn't search right now - check the connection and try again.");
    }
  };

  searchBtn?.addEventListener("click", runSearch);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
}

/** Small helper for the wizard's own clock-format/temp-unit segmented
 *  controls - deliberately separate from setupClockFormatSetting()/
 *  setupTempUnitSetting() in Settings, since those write straight to
 *  localStorage and this needs to hold the choice until Finish is tapped. */
function setupSetupWizardSegmented(id, attr, defaultValue) {
  const segmented = byId(id);
  if (!segmented) return { get: () => defaultValue };
  let value = defaultValue;
  const sync = () => {
    segmented.querySelectorAll(".settings-segment").forEach((b) => {
      b.classList.toggle("active", b.dataset[attr] === value);
    });
  };
  sync();
  segmented.addEventListener("click", (event) => {
    const b = event.target.closest(".settings-segment");
    if (!b) return;
    value = b.dataset[attr];
    sync();
  });
  return { get: () => value };
}

function setupSetupWizard() {
  const overlay = byId("setup-wizard-overlay");
  if (!overlay || localStorage.getItem(SETUP_COMPLETE_KEY) === "true") return;

  overlay.classList.remove("hidden");
  setupSetupWizardLocationSearch();

  const clockFormatControl = setupSetupWizardSegmented("setup-clock-format-segmented", "format", "12h");
  const tempUnitControl = setupSetupWizardSegmented("setup-temp-unit-segmented", "unit", "F");

  const popup = byId("setup-companion-popup");
  byId("setup-companion-yes-btn")?.addEventListener("click", () => popup?.classList.remove("hidden"));
  byId("setup-companion-popup-close-btn")?.addEventListener("click", () => popup?.classList.add("hidden"));

  byId("setup-finish-btn")?.addEventListener("click", () => {
    if (!setupSelectedLocation) {
      const hint = byId("setup-location-hint");
      if (hint) {
        hint.textContent = "Pick a location from the search results first - weather needs it.";
        hint.classList.remove("hidden");
      }
      byId("setup-location-input")?.focus();
      return;
    }

    localStorage.setItem(USER_NAME_KEY, (byId("setup-name-input")?.value || "").trim());
    saveHomeLocation(setupSelectedLocation.lat, setupSelectedLocation.lon, setupSelectedLocation.label);
    localStorage.setItem(CLOCK_FORMAT_KEY, clockFormatControl.get());
    localStorage.setItem(TEMP_UNIT_KEY, tempUnitControl.get());
    localStorage.setItem(SETUP_COMPLETE_KEY, "true");

    // Reload rather than hot-applying every value - tempUnit/clock24h/
    // userName/HOME_LATITUDE/HOME_LONGITUDE all only read their storage key
    // once at load time, same reasoning as the Backup restore flow's reload.
    location.reload();
  });
}

// ---------------------------------------------------------------------------
// Auto-enter Bedside Mode on a schedule - pure localStorage, checked on
// every clock tick (see updateClock()) rather than a separate timer, since
// the clock already ticks every second regardless. Fires at most once per
// calendar day so the matching minute's ~60 ticks don't re-trigger it
// repeatedly, and won't fire again the same night after a manual exit.
// ---------------------------------------------------------------------------

const AUTO_BEDSIDE_ENABLED_KEY = "aurora-dashboard:auto-bedside-enabled";
const AUTO_BEDSIDE_TIME_KEY = "aurora-dashboard:auto-bedside-time";
let autoBedsideEnabled = localStorage.getItem(AUTO_BEDSIDE_ENABLED_KEY) === "true";
let autoBedsideTime = localStorage.getItem(AUTO_BEDSIDE_TIME_KEY) || "22:00";
let autoBedsideLastFiredDateKey = null;

// Whether entering Bedside Mode (manually or automatically) should start
// the rain sound the way it always has - a plain on/off since some people
// want the dimming/DND/brightness-ramp side of Bedside Mode without any
// sound. Defaults on (the original, only) behavior.
const BEDSIDE_AUTO_SOUND_KEY = "aurora-dashboard:bedside-auto-sound";
let bedsideAutoSoundEnabled = localStorage.getItem(BEDSIDE_AUTO_SOUND_KEY) !== "false";

function setupBedsideAutoSoundSetting() {
  const toggle = byId("bedside-auto-sound-toggle");
  if (!toggle) return;

  toggle.setAttribute("aria-checked", String(bedsideAutoSoundEnabled));
  toggle.addEventListener("click", () => {
    bedsideAutoSoundEnabled = !bedsideAutoSoundEnabled;
    toggle.setAttribute("aria-checked", String(bedsideAutoSoundEnabled));
    localStorage.setItem(BEDSIDE_AUTO_SOUND_KEY, String(bedsideAutoSoundEnabled));
  });
}

function maybeAutoEnterBedside() {
  if (!autoBedsideEnabled) return;
  if (document.body.classList.contains("bedside-active")) return;
  if (isAlarmRinging) return;

  const timeZone = currentTimezone || undefined;
  const nowMinutes = currentMinutesInTimezone(timeZone);
  if (nowMinutes !== minutesFromHHMM(autoBedsideTime)) return;

  const dateKey = new Date().toLocaleDateString("en-US", { timeZone });
  if (autoBedsideLastFiredDateKey === dateKey) return;
  autoBedsideLastFiredDateKey = dateKey;
  enterBedsideMode();
}

function setupAutoBedsideSetting() {
  const toggle = byId("auto-bedside-toggle");
  const timeInput = byId("auto-bedside-time");
  if (!toggle || !timeInput) return;

  toggle.setAttribute("aria-checked", String(autoBedsideEnabled));
  timeInput.value = autoBedsideTime;
  timeInput.disabled = !autoBedsideEnabled;

  toggle.addEventListener("click", () => {
    autoBedsideEnabled = !autoBedsideEnabled;
    toggle.setAttribute("aria-checked", String(autoBedsideEnabled));
    timeInput.disabled = !autoBedsideEnabled;
    localStorage.setItem(AUTO_BEDSIDE_ENABLED_KEY, String(autoBedsideEnabled));
  });

  timeInput.addEventListener("change", () => {
    if (!timeInput.value) return;
    autoBedsideTime = timeInput.value;
    localStorage.setItem(AUTO_BEDSIDE_TIME_KEY, autoBedsideTime);
  });
}

// ---------------------------------------------------------------------------
// Sticky notes - short dashboard-only reminders shown on the Overview page,
// one at a time (cycling if there's more than one), until dismissed. Pure
// localStorage, no Aurora involved. Managed from a popover opened via the
// pin icon next to Bedside Mode's trigger (see .hero-panel-actions) rather
// than Settings, since these are meant to be jotted down and cleared in a
// couple of taps, not buried a few screens deep.
// ---------------------------------------------------------------------------

const STICKY_NOTES_KEY = "aurora-dashboard:sticky-notes";
const STICKY_NOTES_DISMISSED_KEY = "aurora-dashboard:sticky-notes-dismissed";
const STICKY_NOTES_MAX = 5;
const STICKY_NOTE_CYCLE_MS = 6000;

let stickyNotes = [];
try {
  stickyNotes = JSON.parse(localStorage.getItem(STICKY_NOTES_KEY) || "[]");
} catch (err) {
  stickyNotes = [];
}

// One-time migration from the old single-note format (a plain string under
// "aurora-dashboard:sticky-note") - only runs if the new list is still
// empty, so it can never clobber notes already added under the new format.
if (stickyNotes.length === 0) {
  const legacyText = (localStorage.getItem("aurora-dashboard:sticky-note") || "").trim();
  if (legacyText) {
    stickyNotes = [{ id: `${Date.now()}`, text: legacyText, addedAt: Date.now() }];
    localStorage.setItem(STICKY_NOTES_KEY, JSON.stringify(stickyNotes));
  }
  localStorage.removeItem("aurora-dashboard:sticky-note");
  localStorage.removeItem("aurora-dashboard:sticky-note-dismissed");
}

let stickyNotesDismissed = localStorage.getItem(STICKY_NOTES_DISMISSED_KEY) === "true";
let stickyNoteCycleIndex = 0;
let stickyNoteCycleHandle = null;

function saveStickyNotes() {
  localStorage.setItem(STICKY_NOTES_KEY, JSON.stringify(stickyNotes));
}

function renderStickyNote() {
  const banner = byId("sticky-note-banner");
  if (!banner) return;
  if (privacyModeActive) {
    banner.classList.add("hidden");
    return;
  }
  const show = stickyNotes.length > 0 && !stickyNotesDismissed;
  banner.classList.toggle("hidden", !show);
  if (!show) return;

  if (stickyNoteCycleIndex >= stickyNotes.length) stickyNoteCycleIndex = 0;
  setText("sticky-note-text", stickyNotes[stickyNoteCycleIndex].text);

  const count = byId("sticky-note-count");
  if (count) {
    count.classList.toggle("hidden", stickyNotes.length <= 1);
    count.textContent = `${stickyNoteCycleIndex + 1}/${stickyNotes.length}`;
  }
}

/** Runs continuously (harmless no-op while there's 0-1 notes) rather than
 *  being started/stopped as notes come and go - one fewer piece of state
 *  to keep in sync with stickyNotes.length. */
function startStickyNoteCycle() {
  stickyNoteCycleHandle = setInterval(() => {
    if (stickyNotes.length <= 1) return;
    stickyNoteCycleIndex = (stickyNoteCycleIndex + 1) % stickyNotes.length;
    renderStickyNote();
  }, STICKY_NOTE_CYCLE_MS);
}

function timeAgoLabel(ms) {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderStickyNoteList() {
  const list = byId("sticky-note-list");
  if (!list) return;
  if (stickyNotes.length === 0) {
    list.innerHTML = '<div class="sticky-note-empty">No notes yet</div>';
    return;
  }
  list.innerHTML = stickyNotes
    .map(
      (note) => `<div class="sticky-note-item" data-id="${escapeHtml(note.id)}">
        <span class="sticky-note-item-text">${escapeHtml(note.text)}</span>
        <span class="sticky-note-item-time">${escapeHtml(timeAgoLabel(note.addedAt))}</span>
        <button class="sticky-note-item-remove" type="button" aria-label="Delete note">&times;</button>
      </div>`
    )
    .join("");
}

function openStickyNoteEditor() {
  byId("sticky-note-editor")?.classList.remove("hidden");
  byId("sticky-note-editor-backdrop")?.classList.remove("hidden");
  renderStickyNoteList();
  byId("sticky-note-add-input")?.focus();
}

function closeStickyNoteEditor() {
  byId("sticky-note-editor")?.classList.add("hidden");
  byId("sticky-note-editor-backdrop")?.classList.add("hidden");
}

/** Adding a note always un-dismisses the banner (same "any edit clears a
 *  dismissal" rule the single-note version had) and jumps the cycle to
 *  show the note you just wrote, not whatever it happened to be showing. */
function addStickyNote(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  stickyNotes = [...stickyNotes, { id: `${Date.now()}`, text: trimmed, addedAt: Date.now() }].slice(-STICKY_NOTES_MAX);
  saveStickyNotes();
  stickyNotesDismissed = false;
  localStorage.setItem(STICKY_NOTES_DISMISSED_KEY, "false");
  stickyNoteCycleIndex = stickyNotes.length - 1;
  renderStickyNote();
  renderStickyNoteList();
}

function removeStickyNote(id) {
  stickyNotes = stickyNotes.filter((note) => note.id !== id);
  saveStickyNotes();
  if (stickyNoteCycleIndex >= stickyNotes.length) stickyNoteCycleIndex = 0;
  renderStickyNote();
  renderStickyNoteList();
}

function setupStickyNote() {
  setIcon("sticky-note-icon", "pin");
  setIcon("sticky-note-trigger-icon", "pin");
  renderStickyNote();
  startStickyNoteCycle();

  byId("sticky-note-trigger-btn")?.addEventListener("click", openStickyNoteEditor);
  byId("sticky-note-editor-close")?.addEventListener("click", closeStickyNoteEditor);
  byId("sticky-note-editor-backdrop")?.addEventListener("click", closeStickyNoteEditor);

  // Tapping the banner itself also opens the editor - the dedicated pin
  // icon is what makes this discoverable with zero notes, but once a note
  // is showing, tapping straight on it to manage it is the more obvious
  // gesture.
  byId("sticky-note-banner")?.addEventListener("click", (event) => {
    if (event.target.closest(".sticky-note-dismiss")) return;
    openStickyNoteEditor();
  });

  const addInput = byId("sticky-note-add-input");
  const submitNewNote = () => {
    if (!addInput) return;
    addStickyNote(addInput.value);
    addInput.value = "";
    addInput.focus();
  };
  byId("sticky-note-add-btn")?.addEventListener("click", submitNewNote);
  addInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitNewNote();
  });

  byId("sticky-note-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".sticky-note-item-remove");
    if (!removeBtn) return;
    const id = removeBtn.closest(".sticky-note-item")?.dataset.id;
    if (id) removeStickyNote(id);
  });

  byId("sticky-note-dismiss")?.addEventListener("click", (event) => {
    event.stopPropagation();
    stickyNotesDismissed = true;
    localStorage.setItem(STICKY_NOTES_DISMISSED_KEY, "true");
    renderStickyNote();
  });
}

// ---------------------------------------------------------------------------
// Privacy Mode - a quick toggle for when someone else is in the room. Hides
// the sticky-note banner and blanks the Habits/Night Routine tiles with a
// generic placeholder instead of their real content, rather than trying to
// log anyone out or lock anything - it's a glance-deterrent for a display
// sitting out in the open, not a real access control. Journal has its own,
// separate password gate for that (see the Journal section) since password
// protection makes sense as an always-on property of that one page, not
// something that comes and goes with whether a guest happens to be around
// right now.
// ---------------------------------------------------------------------------

const PRIVACY_MODE_KEY = "aurora-dashboard:privacy-mode";
let privacyModeActive = localStorage.getItem(PRIVACY_MODE_KEY) === "true";

function renderPrivacyMode() {
  byId("privacy-mode-trigger-btn")?.setAttribute("aria-pressed", String(privacyModeActive));
  setIcon("privacy-mode-trigger-icon", privacyModeActive ? "eyeOff" : "eye");
  renderStickyNote();
  renderHabits();
  renderNightRoutine();
}

function setupPrivacyMode() {
  renderPrivacyMode();
  byId("privacy-mode-trigger-btn")?.addEventListener("click", () => {
    privacyModeActive = !privacyModeActive;
    localStorage.setItem(PRIVACY_MODE_KEY, String(privacyModeActive));
    renderPrivacyMode();
  });
}

// ---------------------------------------------------------------------------
// Reading Mode - dims and warms whichever page is showing without taking
// it over, unlike Bedside/Ambient Mode (no photo cycling, no clock
// takeover, cards stay fully visible). Pure localStorage/CSS, no Aurora
// involved. Entering Bedside or Ambient Mode exits this automatically
// (see enterBedsideMode()/enterAmbientMode()) rather than trying to make
// the three stack sensibly together.
// ---------------------------------------------------------------------------

const READING_MODE_KEY = "aurora-dashboard:reading-mode";
let readingModeActive = localStorage.getItem(READING_MODE_KEY) === "true";

function renderReadingMode() {
  document.body.classList.toggle("reading-mode-active", readingModeActive);
  byId("reading-mode-trigger-btn")?.setAttribute("aria-pressed", String(readingModeActive));
}

function exitReadingMode() {
  if (!readingModeActive) return;
  readingModeActive = false;
  localStorage.setItem(READING_MODE_KEY, "false");
  renderReadingMode();
}

function setupReadingMode() {
  setIcon("reading-mode-trigger-icon", "book");
  renderReadingMode();
  byId("reading-mode-trigger-btn")?.addEventListener("click", () => {
    readingModeActive = !readingModeActive;
    localStorage.setItem(READING_MODE_KEY, String(readingModeActive));
    renderReadingMode();
  });
}

// ---------------------------------------------------------------------------
// Sleep time tracking - logs how long each Bedside Mode session ran, shown
// as a small 7-day chart in Settings. Pure localStorage, no Aurora
// involved - this is purely "how long was Bedside Mode active," not real
// sleep-stage tracking (no sensor to base that on anyway). The session
// start is persisted too, not just held in memory, so a kiosk reload
// mid-session doesn't silently lose that night's data - endSleepSession()
// still needs a real exitBedsideMode() call to actually log it, a reload
// alone just preserves the start time until one happens.
// ---------------------------------------------------------------------------

const SLEEP_SESSIONS_KEY = "aurora-dashboard:sleep-sessions";
const SLEEP_SESSION_START_KEY = "aurora-dashboard:sleep-session-start";
const SLEEP_SESSIONS_MAX = 30;

let sleepSessions = [];
try {
  sleepSessions = JSON.parse(localStorage.getItem(SLEEP_SESSIONS_KEY) || "[]");
} catch (err) {
  sleepSessions = [];
}
let sleepSessionStartAt = Number(localStorage.getItem(SLEEP_SESSION_START_KEY)) || null;

function startSleepSession() {
  sleepSessionStartAt = Date.now();
  localStorage.setItem(SLEEP_SESSION_START_KEY, String(sleepSessionStartAt));
}

function endSleepSession() {
  if (!sleepSessionStartAt) return;
  const durationMinutes = Math.round((Date.now() - sleepSessionStartAt) / 60000);
  if (durationMinutes >= 1) {
    const timeZone = currentTimezone || undefined;
    const startDate = new Date(sleepSessionStartAt);
    const dateKey = startDate.toLocaleDateString("en-CA", { timeZone });
    // "HH:mm" clock time the session started - only used by
    // bedtimeConsistencyStat() below; older sessions recorded before this
    // field existed just won't have one, which that function already skips.
    const startTime = startDate.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    sleepSessions = [...sleepSessions, { date: dateKey, durationMinutes, startTime }].slice(-SLEEP_SESSIONS_MAX);
    localStorage.setItem(SLEEP_SESSIONS_KEY, JSON.stringify(sleepSessions));
  }
  sleepSessionStartAt = null;
  localStorage.removeItem(SLEEP_SESSION_START_KEY);
  renderSleepHistory();
}

const SNOOZE_EVENTS_KEY = "aurora-dashboard:snooze-events";
const SNOOZE_EVENTS_MAX = 200; // generous - only the last-7-days slice ever gets read

let snoozeEvents = [];
try {
  snoozeEvents = JSON.parse(localStorage.getItem(SNOOZE_EVENTS_KEY) || "[]");
} catch (err) {
  snoozeEvents = [];
}

function recordSnoozeEvent() {
  snoozeEvents = [...snoozeEvents, Date.now()].slice(-SNOOZE_EVENTS_MAX);
  localStorage.setItem(SNOOZE_EVENTS_KEY, JSON.stringify(snoozeEvents));
}

function snoozeCountThisWeek() {
  const weekAgo = Date.now() - 7 * 86400000;
  return snoozeEvents.filter((t) => t > weekAgo).length;
}

/** Same-night sessions summed together (e.g. exited and re-entered Bedside
 *  Mode) - shared by the 7-day chart, the 30-day trend, and the streak
 *  count below, so all three agree on what "a night" adds up to. */
function sleepMinutesByDate() {
  const byDate = new Map();
  sleepSessions.forEach((session) => {
    byDate.set(session.date, (byDate.get(session.date) || 0) + session.durationMinutes);
  });
  return byDate;
}

/** Consecutive nights with any recorded session, walking backward from
 *  today. If today has no session yet (an in-progress night, or just
 *  hasn't gone to bed), that alone doesn't break an otherwise real streak -
 *  counting starts from yesterday instead in that case. */
function computeSleepStreak(byDate) {
  const timeZone = currentTimezone || undefined;
  const dateKeyForOffset = (i) => new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone });

  let streak = 0;
  let offset = byDate.has(dateKeyForOffset(0)) ? 0 : 1;
  while (byDate.has(dateKeyForOffset(offset))) {
    streak++;
    offset++;
  }
  return streak;
}

const SLEEP_GOAL_HOURS_KEY = "aurora-dashboard:sleep-goal-hours";
const SLEEP_GOAL_HOURS_DEFAULT = 8;

function loadSleepGoalHours() {
  const stored = Number(localStorage.getItem(SLEEP_GOAL_HOURS_KEY));
  return stored > 0 ? stored : SLEEP_GOAL_HOURS_DEFAULT;
}

function renderSleepGoalInsight(days) {
  const el = byId("sleep-goal-insight");
  if (!el) return;

  const goalMinutes = loadSleepGoalHours() * 60;
  const nightsWithData = days.filter((d) => d.minutes > 0);
  if (nightsWithData.length === 0) {
    el.classList.add("hidden");
    return;
  }
  const metCount = nightsWithData.filter((d) => d.minutes >= goalMinutes).length;
  el.textContent = `${metCount}/${nightsWithData.length} nights met your ${loadSleepGoalHours()}hr goal this week`;
  el.classList.remove("hidden");
}

// Bedtimes cluster in the evening/night, but can land on either side of
// midnight - shifting anything before noon a day forward keeps them on
// one continuous number line for averaging, rather than midnight
// wraparound corrupting the median (e.g. 11:50pm and 12:10am should
// average to ~midnight, not noon).
function bedtimeMinutesSinceReference(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  let minutes = hour * 60 + minute;
  if (minutes < 12 * 60) minutes += 24 * 60;
  return minutes;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const BEDTIME_CONSISTENCY_WINDOW_MINUTES = 30;
// Fewer than this many recorded bedtimes this week and "your usual
// bedtime" isn't a meaningful concept yet - older sessions logged before
// startTime existed don't count toward this either.
const BEDTIME_CONSISTENCY_MIN_SESSIONS = 3;

function bedtimeConsistencyStat() {
  const timeZone = currentTimezone || undefined;
  const weekAgoKey = new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA", { timeZone });
  const recentWithStartTime = sleepSessions.filter((s) => s.startTime && s.date >= weekAgoKey);
  if (recentWithStartTime.length < BEDTIME_CONSISTENCY_MIN_SESSIONS) return null;

  const minutesList = recentWithStartTime.map((s) => bedtimeMinutesSinceReference(s.startTime));
  const usual = median(minutesList);
  const withinWindow = minutesList.filter((m) => Math.abs(m - usual) <= BEDTIME_CONSISTENCY_WINDOW_MINUTES).length;
  return { withinWindow, total: recentWithStartTime.length };
}

function renderBedtimeConsistencyInsight() {
  const el = byId("sleep-bedtime-insight");
  if (!el) return;
  const stat = bedtimeConsistencyStat();
  if (!stat) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = `${stat.withinWindow}/${stat.total} nights within 30 min of your usual bedtime`;
  el.classList.remove("hidden");
}

/** Last 7 calendar days, oldest to newest. */
function renderSleepHistory() {
  const chart = byId("sleep-history-chart");
  if (!chart) return;

  const byDate = sleepMinutesByDate();
  const timeZone = currentTimezone || undefined;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateKey = d.toLocaleDateString("en-CA", { timeZone });
    const label = d.toLocaleDateString("en-US", { timeZone, weekday: "narrow" });
    days.push({ label, minutes: byDate.get(dateKey) || 0 });
  }

  const maxMinutes = Math.max(600, ...days.map((d) => d.minutes)); // scale to at least 10h
  chart.innerHTML = days
    .map((d) => {
      const heightPct = Math.round((d.minutes / maxMinutes) * 100);
      const hours = Math.floor(d.minutes / 60);
      const mins = d.minutes % 60;
      const title = d.minutes ? `${hours}h ${mins}m` : "No data";
      return `<div class="sleep-bar-col">
          <div class="sleep-bar" style="height:${heightPct}%" title="${escapeHtml(title)}"></div>
          <span class="sleep-bar-label">${escapeHtml(d.label)}</span>
        </div>`;
    })
    .join("");

  const nightsWithData = days.filter((d) => d.minutes > 0);
  const avgMinutes = nightsWithData.length
    ? Math.round(nightsWithData.reduce((sum, d) => sum + d.minutes, 0) / nightsWithData.length)
    : 0;
  setText("sleep-stat-avg", avgMinutes ? `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m` : "–");
  setText("sleep-stat-streak", String(computeSleepStreak(byDate)));
  setText("sleep-stat-snooze", String(snoozeCountThisWeek()));
  renderSleepGoalInsight(days);
  renderBedtimeConsistencyInsight();

  renderSleepTrend(byDate);
}

/** Last 30 calendar days, oldest to newest - same data as the 7-day chart
 *  above (SLEEP_SESSIONS_MAX = 30 is the entire available history, so this
 *  is everything there is to show), just a plain sparkline with no
 *  per-bar labels - 30 of those would be unreadable at this width. */
function renderSleepTrend(byDate) {
  const chart = byId("sleep-trend-chart");
  if (!chart) return;

  const timeZone = currentTimezone || undefined;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateKey = d.toLocaleDateString("en-CA", { timeZone });
    days.push({ dateKey, minutes: byDate.get(dateKey) || 0 });
  }

  const maxMinutes = Math.max(600, ...days.map((d) => d.minutes));
  chart.innerHTML = days
    .map((d) => {
      const heightPct = Math.round((d.minutes / maxMinutes) * 100);
      const hours = Math.floor(d.minutes / 60);
      const mins = d.minutes % 60;
      const title = d.minutes ? `${d.dateKey}: ${hours}h ${mins}m` : `${d.dateKey}: No data`;
      return `<div class="sleep-trend-bar" style="height:${heightPct}%" title="${escapeHtml(title)}"></div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Week in Review - a bigger-picture, once-a-week cousin of the daily
// insight (see generate_week_in_review() in server.py, which computes the
// actual week-over-week comparison in Python before ever asking the model
// to write about it). Cached per ISO week, same "generate once, not every
// visit" idea as Weekly Reflection - reuses that same currentIsoWeekKey().
// ---------------------------------------------------------------------------
const WEEK_IN_REVIEW_KEY = "aurora-dashboard:week-in-review";

function openWeekReview() {
  byId("week-review-popover")?.classList.remove("hidden");
  byId("week-review-backdrop")?.classList.remove("hidden");
}

function closeWeekReview() {
  byId("week-review-popover")?.classList.add("hidden");
  byId("week-review-backdrop")?.classList.add("hidden");
}

/** Shows the cached review instantly (opens straight to the popover) if
 *  one already exists for this ISO week; only actually hits the server -
 *  and only then shows the popover - when there isn't one yet. */
async function generateWeekInReview() {
  if (!companionServerConfig()) return;
  const textEl = byId("week-review-popover-text");
  const thisWeek = currentIsoWeekKey(new Date());
  const cached = JSON.parse(localStorage.getItem(WEEK_IN_REVIEW_KEY) || "null");
  if (cached && cached.week === thisWeek) {
    if (textEl) textEl.textContent = cached.text;
    openWeekReview();
    return;
  }

  const btn = byId("week-in-review-btn");
  const originalLabel = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Reviewing...";
  }
  const resp = await companionFetch("/week-in-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sleepHistory: recentSleepHistoryForServer(),
      habitCompletionByDate: recentHabitCompletionByDateForServer(),
    }),
    timeoutMs: 30000,
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
  if (!resp) return;
  const data = await resp.json();
  if (!data.text) return;
  localStorage.setItem(WEEK_IN_REVIEW_KEY, JSON.stringify({ week: thisWeek, text: data.text }));
  if (textEl) textEl.textContent = data.text;
  openWeekReview();
}

function setupWeekInReview() {
  byId("week-in-review-btn")?.classList.toggle("hidden", !companionServerConfig());
  byId("week-in-review-btn")?.addEventListener("click", generateWeekInReview);
  byId("week-review-close")?.addEventListener("click", closeWeekReview);
  byId("week-review-backdrop")?.addEventListener("click", closeWeekReview);
}

function setupSleepInsightsPage() {
  setIcon("sleep-page-title-icon", "moon");
  setupWeekInReview();
  byId("see-sleep-insights-btn")?.addEventListener("click", () => {
    byId("page-sleep")?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  });

  const goalInput = byId("sleep-goal-hours-input");
  if (goalInput) {
    goalInput.value = String(loadSleepGoalHours());
    goalInput.addEventListener("change", () => {
      const hours = Number(goalInput.value);
      if (hours > 0) {
        localStorage.setItem(SLEEP_GOAL_HOURS_KEY, String(hours));
      } else {
        goalInput.value = String(loadSleepGoalHours());
      }
      renderSleepHistory();
    });
  }
}


function clockTimeParts(now, timeZone) {
  // hourCycle: "h23" (not just hour12: false) - some engines default
  // hour12:false to hourCycle "h24" (1-24), which would show "24:15"
  // instead of "00:15" right after midnight on a bedside clock.
  const options = clock24h
    ? { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }
    : { timeZone, hour: "numeric", minute: "2-digit", hour12: true };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { hour: get("hour"), minute: get("minute"), period: get("dayPeriod") };
}

function clockDateParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), month: get("month"), day: get("day") };
}

function updateClock() {
  const now = new Date();
  const timeZone = currentTimezone || undefined; // undefined = Intl's own "use system default"

  const { hour, minute, period } = clockTimeParts(now, timeZone);
  const { weekday, month, day } = clockDateParts(now, timeZone);
  const timeText = clock24h ? `${hour}:${minute}` : `${hour}:${minute} ${period}`;
  const monthdayText = `${month} ${day}`;

  // The clock appears four times - compact on the Morning Overview page,
  // huge on the dedicated Clock/Sound page, huge again in Bedside Mode,
  // and huge (time only, no date) in Ambient Mode - so all four get
  // every tick.
  setText("clock-time", timeText);
  setText("clock-weekday", weekday);
  setText("clock-monthday", monthdayText);
  setText("clock-time-lg", timeText);
  setText("clock-weekday-lg", weekday);
  setText("clock-monthday-lg", monthdayText);
  setText("clock-time-bedside", timeText);
  setText("clock-weekday-bedside", weekday);
  setText("clock-monthday-bedside", monthdayText);
  setText("clock-time-ambient", timeText);
  if (isAlarmRinging) setText("alarm-ringing-time", timeText);

  updateStatusLine();
  applyDayNightMode();
  maybeAutoEnterBedside();

  // Catches a manual override expiring or a schedule window opening/
  // closing between weather refreshes - setWeatherBackground() itself is a
  // cheap no-op when the resolved effect hasn't changed, so this is fine
  // to re-check every tick rather than adding a second timer.
  // renderWeatherBgActiveHint() keeps the Settings page's "Forcing X
  // until..." line in sync with the same expiry, not just the background
  // layer itself - both a no-op when the Settings page isn't visible.
  if (lastWeatherData) {
    setWeatherBackground(lastWeatherData.condition, isPastNightWeatherThreshold(timeZone));
  }
  renderWeatherBgActiveHint();
  checkWakeAlarms();
  checkSunriseAlarms();
  renderWorldClocks();

  // Cheap and idempotent (showWallpaperPhoto() no-ops once the right
  // photo is already showing) - this is what lets Scheduled mode notice a
  // time-of-day boundary passing without a dedicated timer of its own.
  applyWallpaperMode();

  // "Days until" only ever changes at midnight - no need to recompute it
  // every second like the clock itself, just once per actual calendar-day
  // change (localDateKey(now) has already been computed indirectly by
  // checkWakeAlarms() above, but recomputing here keeps this self-
  // contained rather than reaching into that function's internals).
  const todayKeyForCountdown = localDateKey(now);
  if (todayKeyForCountdown !== lastCountdownRenderDateKey) {
    lastCountdownRenderDateKey = todayKeyForCountdown;
    renderCountdowns();
    // Night Routine's checked boxes and the Word Scramble's solved state
    // both need to reset at the same midnight boundary, or an overnight
    // kiosk display would keep showing yesterday's checkmarks/solved word
    // until something else happened to trigger a re-render. Habits doesn't
    // reset any state (the log is additive), but "checked today" and every
    // streak count still shift at midnight, so it needs the same nudge.
    renderNightRoutine();
    renderHabits();
    renderWordPuzzle();
    // Same reasoning as Countdown - "days until due" only changes at
    // midnight, so this is the one place it needs recomputing.
    renderRecurringReminders();
  }

  // Last line on purpose (see the watchdog below) - only reached once
  // every render call above has actually run to completion, so it's a
  // real "the clock is genuinely still working" signal, not just "the
  // interval fired."
  lastClockTickAt = Date.now();
}

// ---------------------------------------------------------------------------
// Stale-clock watchdog - this is meant to run 24/7 on a kiosk device that
// nobody's going to notice froze until they're trying to use it. A plain
// setInterval keeps firing on schedule even if one call throws, so this
// isn't guarding against an ordinary one-off exception - it's guarding
// against updateClock() hitting a PERSISTENT broken state (an exception on
// every single call, so nothing after the failure point - including this
// function's own last line - ever runs again) or the WebView/renderer
// itself degrading badly enough that ticks stop landing on schedule. A
// genuinely deadlocked main thread can't run its own watchdog either way
// (this code wouldn't fire), so this is a defense-in-depth layer against
// the survivable failure modes, not a guarantee against every one.
// ---------------------------------------------------------------------------

let lastClockTickAt = Date.now();
const CLOCK_WATCHDOG_STALE_MS = 5 * 60 * 1000;
const CLOCK_WATCHDOG_CHECK_MS = 30 * 1000;

function checkClockWatchdog() {
  if (Date.now() - lastClockTickAt > CLOCK_WATCHDOG_STALE_MS) {
    location.reload();
  }
}

function startClock() {
  updateClock();
  setInterval(checkClockWatchdog, CLOCK_WATCHDOG_CHECK_MS);
  setInterval(updateClock, 1000);
}

// ---------------------------------------------------------------------------
// Moon phase - pure date math, no Aurora involvement (unlike sunrise/sunset,
// which come from Open-Meteo since they depend on location; the lunar cycle
// doesn't). Standard synodic-month approximation against a known new moon,
// good to within about a day either side of an exact phase boundary - fine
// for a glanceable bedside label, not an almanac.
// ---------------------------------------------------------------------------

const MOON_SYNODIC_MONTH_DAYS = 29.530588853;
const MOON_KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);
const MOON_PHASE_EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const MOON_PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
];

function moonPhaseIndex(date) {
  const daysSinceNew = (date.getTime() - MOON_KNOWN_NEW_MOON_UTC) / 86400000;
  let age = daysSinceNew % MOON_SYNODIC_MONTH_DAYS;
  if (age < 0) age += MOON_SYNODIC_MONTH_DAYS;
  return Math.round((age / MOON_SYNODIC_MONTH_DAYS) * 8) % 8;
}

function moonPhaseLabel(date) {
  const index = moonPhaseIndex(date);
  return `${MOON_PHASE_EMOJI[index]} ${MOON_PHASE_NAMES[index]}`;
}

/** A real rendered crescent/gibbous shape rather than just the emoji/text
 *  label - one lit disc plus a "terminator" disc offset and sized per
 *  phase (see .moon-visual's 8 phase rules in style.css), the standard
 *  two-overlapping-circles trick for a CSS moon phase. */
function renderMoonPhaseVisual(id, date) {
  const el = byId(id);
  if (!el) return;
  const index = moonPhaseIndex(date);
  // Only swaps the phase class - preserves any size/placement modifier
  // class (e.g. .moon-visual-small on the Ambient Mode instance) already
  // on the element, rather than clobbering the whole className.
  el.className = el.className.replace(/\bmoon-visual--phase-\d+\b/, "").trim();
  el.classList.add("moon-visual", `moon-visual--phase-${index}`);
  el.setAttribute("aria-label", MOON_PHASE_NAMES[index]);
}

// ---------------------------------------------------------------------------
// Night Sky View - which naked-eye planets (Mercury, Venus, Mars, Jupiter,
// Saturn) plus the Moon are actually above the horizon right now, and
// roughly where. Computed entirely offline from classical Keplerian
// orbital elements (the standard low-precision method - see Paul
// Schlyter's widely-used "Computing planetary positions" tutorial), not
// fetched from any astronomy API - in keeping with this fork's "no
// backend, works offline" ethos, and because there's no free, reliable,
// no-auth astronomy API to depend on anyway.
//
// This intentionally skips the small orbital-perturbation correction terms
// real ephemeris software applies (planets tugging on each other's orbits)
// - the base two-body ellipse alone is accurate to well under a degree for
// every body here, over any date this dashboard will realistically run on.
// That's plenty for "is Jupiter up, and roughly which direction" - this is
// a bedside decoration, not a telescope pointing tool.
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function normalizeDegrees(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** Schlyter's "d" - days since 1999 Dec 31, 00:00 UT, the reference epoch
 *  his orbital-element formulas below are all written against. */
function schlyterDays(date) {
  const julianDate = date.getTime() / 86400000 + 2440587.5;
  return julianDate - 2451543.5;
}

// One row per body: N=longitude of ascending node, i=inclination,
// w=argument of perihelion, a=semi-major axis (AU; Earth radii for the
// Moon), e=eccentricity, M=mean anomaly - each a base value plus a
// per-day rate, straight from Schlyter's reference tables. The Sun is
// modeled as an N=i=0 body "orbiting" Earth, which is mathematically
// equivalent to Earth orbiting the Sun for everything computed below.
const ORBITAL_ELEMENTS = {
  sun: {
    N: [0, 0],
    i: [0, 0],
    w: [282.9404, 4.70935e-5],
    a: [1.0, 0],
    e: [0.016709, -1.151e-9],
    M: [356.047, 0.9856002585],
  },
  moon: {
    N: [125.1228, -0.0529538083],
    i: [5.1454, 0],
    w: [318.0634, 0.1643573223],
    a: [60.2666, 0],
    e: [0.0549, 0],
    M: [115.3654, 13.0649929509],
  },
  mercury: {
    N: [48.3313, 3.24587e-5],
    i: [7.0047, 5.0e-8],
    w: [29.1241, 1.01444e-5],
    a: [0.387098, 0],
    e: [0.205635, 5.59e-10],
    M: [168.6562, 4.0923344368],
  },
  venus: {
    N: [76.6799, 2.4659e-5],
    i: [3.3946, 2.75e-8],
    w: [54.891, 1.38374e-5],
    a: [0.72333, 0],
    e: [0.006773, -1.302e-9],
    M: [48.0052, 1.6021302244],
  },
  mars: {
    N: [49.5574, 2.11081e-5],
    i: [1.8497, -1.78e-8],
    w: [286.5016, 2.92961e-5],
    a: [1.523688, 0],
    e: [0.093405, 2.516e-9],
    M: [18.6021, 0.5240207766],
  },
  jupiter: {
    N: [100.4542, 2.76854e-5],
    i: [1.303, -1.557e-7],
    w: [273.8777, 1.64505e-5],
    a: [5.20256, 0],
    e: [0.048498, 4.469e-9],
    M: [19.895, 0.0830853001],
  },
  saturn: {
    N: [113.6634, 2.3898e-5],
    i: [2.4886, -1.081e-7],
    w: [339.3939, 2.97661e-5],
    a: [9.55475, 0],
    e: [0.055546, -9.499e-9],
    M: [316.967, 0.0334442282],
  },
};

function elementAt([base, ratePerDay], d) {
  return base + ratePerDay * d;
}

/** Solves Kepler's equation (M = E - e*sin(E), all in degrees) for the
 *  eccentric anomaly E, Newton's method from Schlyter's own starting
 *  approximation - every eccentricity in ORBITAL_ELEMENTS is well under
 *  0.21, so this converges in just a few iterations. */
function eccentricAnomaly(M, e) {
  const Mrad = M * DEG_TO_RAD;
  let E = M + e * RAD_TO_DEG * Math.sin(Mrad) * (1 + e * Math.cos(Mrad));
  for (let i = 0; i < 6; i++) {
    const Erad = E * DEG_TO_RAD;
    const delta = (E - e * RAD_TO_DEG * Math.sin(Erad) - M) / (1 - e * Math.cos(Erad));
    E -= delta;
    if (Math.abs(delta) < 1e-6) break;
  }
  return E;
}

/** [xh,yh,zh] heliocentric ecliptic rectangular coordinates (AU), plus the
 *  same position in [r, lon] polar form (lon in degrees) - the shared
 *  first stage for both the Sun (whose "orbit" IS the Earth-Sun vector
 *  needed to re-center every other body below) and each planet. */
function heliocentricPosition(bodyKey, d) {
  const el = ORBITAL_ELEMENTS[bodyKey];
  const N = elementAt(el.N, d);
  const i = elementAt(el.i, d);
  const w = elementAt(el.w, d);
  const a = elementAt(el.a, d);
  const e = elementAt(el.e, d);
  const M = normalizeDegrees(elementAt(el.M, d));

  const E = eccentricAnomaly(M, e);
  const Erad = E * DEG_TO_RAD;
  const xv = a * (Math.cos(Erad) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(Erad));

  const r = Math.sqrt(xv * xv + yv * yv);
  const v = normalizeDegrees(Math.atan2(yv, xv) * RAD_TO_DEG);

  const Nrad = N * DEG_TO_RAD;
  const irad = i * DEG_TO_RAD;
  const vwRad = (v + w) * DEG_TO_RAD;

  const xh = r * (Math.cos(Nrad) * Math.cos(vwRad) - Math.sin(Nrad) * Math.sin(vwRad) * Math.cos(irad));
  const yh = r * (Math.sin(Nrad) * Math.cos(vwRad) + Math.cos(Nrad) * Math.sin(vwRad) * Math.cos(irad));
  const zh = r * (Math.sin(vwRad) * Math.sin(irad));

  const lon = normalizeDegrees(Math.atan2(yh, xh) * RAD_TO_DEG);
  return { xh, yh, zh, r, lon };
}

/** Geocentric ecliptic [lon, lat] (degrees) for any body - the Moon's own
 *  orbital elements are already geocentric (it orbits Earth), so its
 *  heliocentric-stage output IS its geocentric position; every other body
 *  needs the Sun's Earth-relative position added in to re-center from
 *  "around the Sun" to "around the Earth". */
function geocentricEclipticPosition(bodyKey, d, sunHelio) {
  if (bodyKey === "moon" || bodyKey === "sun") {
    const h = heliocentricPosition(bodyKey, d);
    const lat = normalizeDegrees(Math.atan2(h.zh, Math.sqrt(h.xh * h.xh + h.yh * h.yh)) * RAD_TO_DEG);
    return { lon: h.lon, lat: lat > 180 ? lat - 360 : lat };
  }

  const h = heliocentricPosition(bodyKey, d);
  const xs = sunHelio.r * Math.cos(sunHelio.lon * DEG_TO_RAD);
  const ys = sunHelio.r * Math.sin(sunHelio.lon * DEG_TO_RAD);
  const xg = h.xh + xs;
  const yg = h.yh + ys;
  const zg = h.zh;

  const lon = normalizeDegrees(Math.atan2(yg, xg) * RAD_TO_DEG);
  let lat = Math.atan2(zg, Math.sqrt(xg * xg + yg * yg)) * RAD_TO_DEG;
  return { lon, lat };
}

/** Geocentric ecliptic [lon, lat] -> equatorial [ra, dec] (degrees),
 *  rotating by Earth's axial tilt (the obliquity of the ecliptic). */
function eclipticToEquatorial(lon, lat, obliquityDeg) {
  const lonRad = lon * DEG_TO_RAD;
  const latRad = lat * DEG_TO_RAD;
  const eclRad = obliquityDeg * DEG_TO_RAD;

  const xeq = Math.cos(lonRad) * Math.cos(latRad);
  const yeq = Math.sin(lonRad) * Math.cos(latRad) * Math.cos(eclRad) - Math.sin(latRad) * Math.sin(eclRad);
  const zeq = Math.sin(lonRad) * Math.cos(latRad) * Math.sin(eclRad) + Math.sin(latRad) * Math.cos(eclRad);

  const ra = normalizeDegrees(Math.atan2(yeq, xeq) * RAD_TO_DEG);
  const dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)) * RAD_TO_DEG;
  return { ra, dec };
}

/** Equatorial [ra, dec] -> horizontal [alt, az] (degrees) for an observer
 *  at [latitude, longitude] and Greenwich Mean Sidereal Time gmst
 *  (degrees) - az is compass convention (0=North, 90=East, 180=South,
 *  270=West), matching how this gets labeled in the UI. */
function equatorialToHorizontal(ra, dec, gmstDeg, observerLat, observerLon) {
  const lst = normalizeDegrees(gmstDeg + observerLon);
  const ha = normalizeDegrees(lst - ra) * DEG_TO_RAD;
  const decRad = dec * DEG_TO_RAD;
  const latRad = observerLat * DEG_TO_RAD;

  const x = Math.cos(ha) * Math.cos(decRad);
  const y = Math.sin(ha) * Math.cos(decRad);
  const z = Math.sin(decRad);

  const xhor = x * Math.sin(latRad) - z * Math.cos(latRad);
  const yhor = y;
  const zhor = x * Math.cos(latRad) + z * Math.sin(latRad);

  const az = normalizeDegrees(Math.atan2(yhor, xhor) * RAD_TO_DEG + 180);
  const alt = Math.atan2(zhor, Math.sqrt(xhor * xhor + yhor * yhor)) * RAD_TO_DEG;
  return { alt, az };
}

/** [{key, alt, az}] for every body in ORBITAL_ELEMENTS except the Sun
 *  (that one's only needed internally, as the Earth-Sun vector every
 *  planet's geocentric position is computed relative to - a Night Sky
 *  view has no use for "where the Sun is" once it's below the horizon). */
function currentSkyPositions(date, lat = HOME_LATITUDE, lon = HOME_LONGITUDE) {
  const d = schlyterDays(date);
  const obliquity = 23.4393 - 3.563e-7 * d;

  const sunHelio = heliocentricPosition("sun", d);
  // Sun's own mean longitude (Ls = w + M, N=0 for this model) is also
  // Schlyter's shortcut to Greenwich Mean Sidereal Time at 0h UT - see
  // GMST0 below.
  const sunEl = ORBITAL_ELEMENTS.sun;
  const sunMeanLongitude = normalizeDegrees(elementAt(sunEl.w, d) + elementAt(sunEl.M, d));

  const utHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gmst = normalizeDegrees(sunMeanLongitude + 180 + utHours * 15);

  const planets = {};
  for (const key of Object.keys(ORBITAL_ELEMENTS)) {
    if (key === "sun") continue;
    const { lon: eclLon, lat: eclLat } = geocentricEclipticPosition(key, d, sunHelio);
    const { ra, dec } = eclipticToEquatorial(eclLon, eclLat, obliquity);
    const { alt, az } = equatorialToHorizontal(ra, dec, gmst, lat, lon);
    planets[key] = { alt, az };
  }
  // gmst is returned alongside the planets - visibleStars() needs the exact
  // same value to place fixed stars in the same sky, and recomputing it
  // there would just be duplicated work for an identical answer.
  return { planets, gmst };
}

const COMPASS_DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function compassDirection(azDeg) {
  const index = Math.round(normalizeDegrees(azDeg) / 22.5) % 16;
  return COMPASS_DIRECTIONS[index];
}

// ---------------------------------------------------------------------------
// Rendering - one function per card, each safely no-ops on missing/null
// data, plus the Morning Briefing.
// ---------------------------------------------------------------------------

let lastWeatherData = null;

/** Prefers the near-term, minute-resolution nowcast over the coarser
 *  same-day hourly one when both are available - "starting in ~15 min" is
 *  more actionable than "expected 2:00 PM" when it's actually about to
 *  start. Below 5 minutes just says "soon" rather than a jittery "~1 min"
 *  that'll be stale by the time anyone reads it (weather only refreshes
 *  every WEATHER_REFRESH_INTERVAL_MS anyway). */
function rainNowcastText(weather) {
  if (weather.rainStartsInMinutes != null) {
    return weather.rainStartsInMinutes < 5
      ? "Rain starting soon"
      : `Rain starting in ~${weather.rainStartsInMinutes} min`;
  }
  if (weather.rainExpectedAt) {
    return `Rain expected ${formatTimeOfDay(weather.rainExpectedAt)}`;
  }
  return "";
}

function renderWeather(weather) {
  lastWeatherData = weather;
  if (!weather) {
    setIcon("weather-icon", "cloud");
    setText("weather-temp", "--°");
    setText("weather-condition", "No data");
    setText("weather-high", "--°");
    setText("weather-low", "--°");
    byId("weather-rain")?.classList.add("hidden");
    byId("weather-uv")?.classList.add("hidden");
    byId("weather-aqi-nudge")?.classList.add("hidden");
    byId("weather-feelslike-nudge")?.classList.add("hidden");
    byId("weather-wind-nudge")?.classList.add("hidden");
    setIcon("weather-icon-lg", "cloud");
    setText("weather-temp-lg", "--°");
    setText("weather-condition-lg", "No data");
    setText("weather-high-lg", "--°");
    setText("weather-low-lg", "--°");
    setText("weather-sunrise-lg", "--:--");
    setText("weather-sunset-lg", "--:--");
    byId("weather-rain-lg")?.classList.add("hidden");
    byId("weather-uv-lg")?.classList.add("hidden");
    return;
  }

  const nightOverride = isPastNightWeatherThreshold(currentTimezone || undefined);
  const icon = nightOverride ? "moon" : WEATHER_ICON_BY_CONDITION[weather.condition] || "cloud";
  const temp = displayTemp(weather.temperature);
  const high = displayTemp(weather.high);
  const low = displayTemp(weather.low);

  // Weather appears twice - the compact Overview card and the big hero
  // tile on the Daily Info page - so both ids get updated together.
  setWeatherIcon("weather-icon", icon);
  setRollingNumber("weather-temp", temp, "°");
  setText("weather-condition", weather.condition);
  setRollingNumber("weather-high", high, "°");
  setRollingNumber("weather-low", low, "°");

  setWeatherIcon("weather-icon-lg", icon);
  setRollingNumber("weather-temp-lg", temp, "°");
  setText("weather-condition-lg", weather.condition);
  setRollingNumber("weather-high-lg", high, "°");
  setRollingNumber("weather-low-lg", low, "°");
  setText("weather-sunrise-lg", weather.sunrise ? formatTimeOfDay(weather.sunrise) : "--:--");
  setText("weather-sunset-lg", weather.sunset ? formatTimeOfDay(weather.sunset) : "--:--");

  // Same "bring an umbrella" signal the Morning Briefing already surfaces
  // (see renderMorningBriefing) - shown here too since the Weather card is
  // where you'd actually look for it once the briefing's scrolled by.
  // rainStartsInMinutes (15-minute-resolution, next ~2 hours only) is
  // preferred when it's set - genuinely more actionable than an hourly
  // threshold-crossing time when rain is imminent; rainExpectedAt covers
  // the rest of today for anything further out.
  const rainText = rainNowcastText(weather);
  setIcon("weather-rain-icon", "rain");
  setText("weather-rain-text", rainText);
  byId("weather-rain")?.classList.toggle("hidden", !rainText);
  setIcon("weather-rain-icon-lg", "rain");
  setText("weather-rain-text-lg", rainText);
  byId("weather-rain-lg")?.classList.toggle("hidden", !rainText);

  // Same idea as the umbrella nudge above, for UV instead of rain - only
  // surfaced at High or above (EPA/WHO's own "wear sunscreen" threshold
  // starts at 6), not every time UV data happens to be present, same
  // "above a might-actually-matter threshold" reasoning as everywhere
  // else this dashboard nudges rather than just displaying a raw number.
  const uvText = weather.uvIndex != null && weather.uvIndex >= UV_SUNSCREEN_THRESHOLD ? `UV ${weather.uvIndex} - wear sunscreen` : "";
  setIcon("weather-uv-icon", "sunny");
  setText("weather-uv-text", uvText);
  byId("weather-uv")?.classList.toggle("hidden", !uvText);
  setIcon("weather-uv-icon-lg", "sunny");
  setText("weather-uv-text-lg", uvText);
  byId("weather-uv-lg")?.classList.toggle("hidden", !uvText);

  // Same nudge pattern again, for air quality - Daily Info's own AQI line
  // (renderAirQuality()) always shows the number, but this only surfaces
  // proactively on the Overview card once it actually crosses into EPA's
  // "Unhealthy" band (151+), where everyone (not just sensitive groups)
  // may start noticing effects.
  const aqi = weather.airQualityIndex;
  const aqiNudgeText = aqi != null && aqi > AQI_NUDGE_THRESHOLD ? `AQI ${aqi} - air quality is unhealthy` : "";
  setIcon("weather-aqi-nudge-icon", "leaf");
  setText("weather-aqi-nudge-text", aqiNudgeText);
  byId("weather-aqi-nudge")?.classList.toggle("hidden", !aqiNudgeText);

  // Only when feels-like diverges into genuinely uncomfortable territory,
  // not just "a little warmer/cooler than the actual reading" (that's
  // already covered by the plain feels-like line in renderWeatherDetails).
  let feelsLikeNudgeText = "";
  if (weather.feelsLike != null) {
    if (weather.feelsLike >= FEELS_LIKE_HOT_THRESHOLD) feelsLikeNudgeText = `Feels like ${displayTemp(weather.feelsLike)}° - stay hydrated`;
    else if (weather.feelsLike <= FEELS_LIKE_COLD_THRESHOLD) feelsLikeNudgeText = `Feels like ${displayTemp(weather.feelsLike)}° - bundle up`;
  }
  setIcon("weather-feelslike-nudge-icon", "alertTriangle");
  setText("weather-feelslike-nudge-text", feelsLikeNudgeText);
  byId("weather-feelslike-nudge")?.classList.toggle("hidden", !feelsLikeNudgeText);

  // Rounds out the environmental-nudge family (rain/UV/AQI/feels-like) -
  // NWS's own Wind Advisory threshold is 25mph sustained, the same
  // "borrow the real agency's own line" reasoning as the UV/AQI nudges.
  const windText = weather.windSpeedMph != null && weather.windSpeedMph >= WIND_NUDGE_THRESHOLD ? `Wind ${weather.windSpeedMph} mph - secure loose outdoor items` : "";
  setIcon("weather-wind-nudge-icon", "wind");
  setText("weather-wind-nudge-text", windText);
  byId("weather-wind-nudge")?.classList.toggle("hidden", !windText);

  // A set wallpaper wins outright, same as the accent color following the
  // wallpaper rather than the weather in the original echo-dashboard -
  // once a photo is showing, it makes more sense for the UI to pick up
  // its color than to keep chasing the weather underneath it.
  if (wallpaperAccentColor) {
    document.documentElement.style.setProperty("--accent", wallpaperAccentColor);
  } else if (nightOverride) {
    document.documentElement.style.setProperty("--accent", NIGHT_WEATHER_ACCENT);
  } else {
    applyAccentColor(weather.condition);
  }
  setWeatherBackground(weather.condition, nightOverride);

  // Drives the clock's timezone too - see the comment above updateClock().
  if (weather.timezone) currentTimezone = weather.timezone;
  // Drives applyDayNightMode()'s dim/brighten thresholds too.
  latestSunrise = weather.sunrise || null;
  latestSunset = weather.sunset || null;
}

// Standard EPA breakpoints - a pure function of the number, so this stays
// client-side rather than Aurora computing and sending a label.
function aqiCategory(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

/** Daily Info page only, same as sunrise/sunset - hidden entirely rather
 *  than showing a stale/placeholder reading when Aurora hasn't resolved
 *  one yet (e.g. right after boot, before the first weather refresh). */
function renderAirQuality(weather) {
  const el = byId("weather-aqi-lg");
  if (!el) return;

  const aqi = weather && weather.airQualityIndex;
  if (aqi == null) {
    el.classList.add("hidden");
    return;
  }

  el.classList.remove("hidden");
  setIcon("weather-aqi-icon-lg", "leaf");
  setText("weather-aqi-text-lg", `AQI ${aqi} - ${aqiCategory(aqi)}`);
}

/** Daily Info page only - a single compact line rather than one row per
 *  metric (see .weather-details-lg's comment), and each piece is
 *  independently optional, same "degrade gracefully" reasoning as
 *  everything else on WeatherSnapshot. */
function renderWeatherDetails(weather) {
  const el = byId("weather-details-lg");
  if (!el) return;

  const parts = [];
  if (weather?.feelsLike != null && Math.abs(weather.feelsLike - Math.round(weather.temperature)) >= 3) {
    parts.push(`Feels ${displayTemp(weather.feelsLike)}°`);
  }
  if (weather?.windSpeedMph != null) parts.push(`Wind ${weather.windSpeedMph} mph`);
  if (weather?.humidityPercent != null) parts.push(`Humidity ${weather.humidityPercent}%`);
  if (weather?.uvIndex != null) parts.push(`UV ${weather.uvIndex}`);
  // Only worth a mention above a "might actually matter" threshold - most
  // days sit in the 0-20% range, and showing that every time would just be
  // noise (same reasoning as RAIN_PROBABILITY_THRESHOLD's own umbrella nudge).
  if (weather?.precipitationProbability != null && weather.precipitationProbability >= 20) {
    parts.push(`Rain ${weather.precipitationProbability}%`);
  }

  if (parts.length === 0) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.textContent = parts.join(" · ");
}

function forecastDayLabel(day, index) {
  return index === 0 ? "Today" : new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
}

// Condition alone (no per-day rain probability comes back from Open-Meteo's
// daily block, just a WMO code -> condition string) plus how close the
// day's high sits to a comfortable range - crude, but "good enough for a
// glance" is the whole point, same spirit as everything else this
// dashboard nudges on rather than a precise forecast model.
const OUTLOOK_GOOD_CONDITIONS = new Set(["Clear", "Partly Cloudy"]);
const OUTLOOK_COMFORTABLE_LOW = 65;
const OUTLOOK_COMFORTABLE_HIGH = 80;
// A day has to clear this to be worth calling out at all - stops a rainy,
// overcast week from still naming its "least bad" day as if it were good.
const OUTLOOK_MIN_SCORE = 10;

function outdoorScoreForDay(day) {
  let score = 0;
  if (OUTLOOK_GOOD_CONDITIONS.has(day.condition)) score += 10;
  else if (day.condition === "Overcast" || day.condition === "Fog") score += 3;

  if (day.high >= OUTLOOK_COMFORTABLE_LOW && day.high <= OUTLOOK_COMFORTABLE_HIGH) {
    score += 5;
  } else {
    const distance = day.high < OUTLOOK_COMFORTABLE_LOW ? OUTLOOK_COMFORTABLE_LOW - day.high : day.high - OUTLOOK_COMFORTABLE_HIGH;
    score += Math.max(0, 5 - distance / 5);
  }
  return score;
}

/** Prefers today's own best walk window (bestWalkWindow, hour-resolution)
 *  when one exists - genuinely more actionable right now than "some day
 *  this week" - falling back to the best upcoming day otherwise. */
function renderForecastOutlook(weather, days) {
  const el = byId("forecast-outlook");
  if (!el) return;

  if (weather.bestWalkWindow) {
    const { start, end } = weather.bestWalkWindow;
    el.textContent = `Best time today for a walk: ${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`;
    el.classList.remove("hidden");
    return;
  }

  if (days.length < 2) {
    el.classList.add("hidden");
    return;
  }

  let bestIndex = 0;
  let bestScore = outdoorScoreForDay(days[0]);
  for (let i = 1; i < days.length; i++) {
    const score = outdoorScoreForDay(days[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestScore < OUTLOOK_MIN_SCORE) {
    el.classList.add("hidden");
    return;
  }

  el.textContent = `Best day for outdoor plans: ${forecastDayLabel(days[bestIndex], bestIndex)}`;
  el.classList.remove("hidden");
}

/** Today plus the next few days (see WeatherConfig.FORECAST_DAYS on the
 *  Aurora side) - Daily Info page only, same reasoning as the radar panel
 *  for why it doesn't also try to fit in the compact Overview card. */
function renderDailyForecast(weather) {
  const strip = byId("forecast-strip");
  if (!strip) return;

  const days = (weather && weather.dailyForecast) || [];
  if (days.length === 0) {
    strip.classList.add("hidden");
    byId("forecast-outlook")?.classList.add("hidden");
    return;
  }

  strip.classList.remove("hidden");
  strip.innerHTML = days
    .map((day, index) => {
      const label = index === 0 ? "Today" : new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
      const icon = WEATHER_ICON_BY_CONDITION[day.condition] || "cloud";
      return `<div class="forecast-day">
          <div class="forecast-day-label">${escapeHtml(label)}</div>
          <span class="icon-slot" data-icon="${icon}">${ICONS[icon] || ""}</span>
          <div class="forecast-day-temps"><b>${displayTemp(day.high)}°</b><span>${displayTemp(day.low)}°</span></div>
        </div>`;
    })
    .join("");

  renderForecastOutlook(weather, days);
}

const RADAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // don't hammer radar.weather.gov every 30s poll
let lastRadarStation = null;
let lastRadarRefreshAt = 0;

/** Fetched directly from radar.weather.gov by the browser, not proxied
 *  through Aurora - an <img src> load isn't subject to CORS (unlike a JS
 *  fetch() reading the response body), so no backend involvement is
 *  needed beyond Aurora resolving which station covers the current
 *  location (see WeatherSnapshot.radarStation). Refreshed at most every
 *  RADAR_REFRESH_INTERVAL_MS regardless of the 30s dashboard poll cadence -
 *  the image is a few hundred KB and the underlying loop only updates
 *  every few minutes anyway, so polling it every 30s would be wasteful.
 *  setupRadar()'s onerror handler (not this function) is what hides the
 *  panel if the image fails to load - see its comment. */
function renderRadar(weather) {
  const panel = byId("panel-radar");
  const img = byId("radar-image");
  if (!panel || !img) return;

  const station = weather && weather.radarStation;
  if (!station) {
    panel.classList.add("hidden");
    lastRadarStation = null;
    return;
  }

  panel.classList.remove("hidden");
  setIcon("radar-title-icon", "radar");

  const now = Date.now();
  const stationChanged = station !== lastRadarStation;
  if (stationChanged || now - lastRadarRefreshAt >= RADAR_REFRESH_INTERVAL_MS) {
    img.src = `https://radar.weather.gov/ridge/standard/${station}_loop.gif?t=${now}`;
    lastRadarStation = station;
    lastRadarRefreshAt = now;
  }
}

/** The Echo Show may have no route to the public internet even when it
 *  can reach Aurora fine over the LAN (or radar.weather.gov itself may be
 *  down) - unlike Aurora going offline, there's no cached fallback for an
 *  image, so a load failure just hides the whole panel rather than
 *  leaving a broken-image glyph on a kiosk display. */
function setupRadar() {
  byId("radar-image")?.addEventListener("error", () => {
    byId("panel-radar")?.classList.add("hidden");
  });
}

/** Ambient Mode's "tiny weather" line - just a plain text summary, not
 *  the full icon/high/low card treatment the other pages use. */
function renderAmbientWeather(weather) {
  setText("ambient-weather", weather ? `${displayTemp(weather.temperature)}° ${weather.condition}` : "");
  setText("ambient-moon", moonPhaseLabel(new Date()));
  renderMoonPhaseVisual("ambient-moon-visual", new Date());
}

// Aurora has no stable alert id (see WeatherAlert.kt - just event/headline/
// severity), so "which alert" is identified by that pair - good enough
// since a genuinely new or updated alert always changes at least one of
// them. Dismissing is per-alert, not "severe alerts in general": once the
// NWS alert changes or clears and a different one (or none) comes in, the
// stored key no longer matches and the banner is free to show again.
const SEVERE_ALERT_DISMISSED_KEY = "aurora-dashboard:severe-alert-dismissed";
let dismissedSevereAlertKey = localStorage.getItem(SEVERE_ALERT_DISMISSED_KEY) || "";
let lastSevereAlert = null;

function severeAlertKey(alert) {
  return alert ? `${alert.event}|${alert.headline}` : "";
}

/** NWS-sourced severe weather alert (see WeatherAlertRepository on the
 *  Aurora side) - shown on both the Overview and Daily Info pages, unlike
 *  most render* functions which only touch one page's worth of ids, since
 *  this needs to be visible no matter which page is currently swiped to. */
function renderSevereAlert(alert) {
  lastSevereAlert = alert;
  const dismissed = Boolean(alert) && severeAlertKey(alert) === dismissedSevereAlertKey;
  const shown = dismissed ? null : alert;

  [
    { banner: "severe-alert-banner", icon: "severe-alert-icon", event: "severe-alert-event", headline: "severe-alert-headline" },
    { banner: "severe-alert-banner-lg", icon: "severe-alert-icon-lg", event: "severe-alert-event-lg", headline: "severe-alert-headline-lg" }
  ].forEach((ids) => {
    const banner = byId(ids.banner);
    if (!banner) return;
    banner.classList.toggle("hidden", !shown);
    if (!shown) return;

    setIcon(ids.icon, "alertTriangle");
    setText(ids.event, shown.event);
    setText(ids.headline, shown.headline);
  });
}

function setupSevereAlertDismiss() {
  ["severe-alert-dismiss", "severe-alert-dismiss-lg"].forEach((id) => {
    byId(id)?.addEventListener("click", () => {
      dismissedSevereAlertKey = severeAlertKey(lastSevereAlert);
      localStorage.setItem(SEVERE_ALERT_DISMISSED_KEY, dismissedSevereAlertKey);
      renderSevereAlert(lastSevereAlert);
    });
  });
}

// ---------------------------------------------------------------------------
// Agenda - a manually-kept upcoming-events list, replacing the calendar
// sync this fork has no phone to source from. Pure localStorage; managed
// from the same "This Week" popover the calendar icon always opened - now
// both a viewer and an editor, the same "combine viewer+editor in one
// popover" shape sticky notes already use elsewhere on this page.
// ---------------------------------------------------------------------------

const AGENDA_KEY = "aurora-dashboard:agenda";
const AGENDA_MAX = 200;

let agendaItems = [];
try {
  agendaItems = JSON.parse(localStorage.getItem(AGENDA_KEY) || "[]");
} catch (err) {
  agendaItems = [];
}

function saveAgenda() {
  agendaItems = agendaItems.slice(-AGENDA_MAX);
  localStorage.setItem(AGENDA_KEY, JSON.stringify(agendaItems));
}

/** yyyy-MM-dd, built from local Y/M/D directly rather than through Date's
 *  own ISO-string parsing (`new Date("yyyy-MM-dd")` parses as UTC
 *  midnight, which can format one day off in a timezone-aware
 *  toLocaleDateString call). */
function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Sorted all-day-first, then by time - matches how a normal calendar
 *  app orders a single day's list. */
function agendaEntriesForDate(dateKey) {
  return agendaItems
    .filter((item) => item.date === dateKey)
    .sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    });
}

function addAgendaItem(date, time, title) {
  const trimmed = (title || "").trim();
  if (!date || !trimmed) return;
  agendaItems.push({ id: `${Date.now()}`, date, time: time || null, title: trimmed });
  saveAgenda();
  renderSchedule();
  renderWeekView();
  renderBedsideTomorrow();
}

function removeAgendaItem(id) {
  agendaItems = agendaItems.filter((item) => item.id !== id);
  saveAgenda();
  renderSchedule();
  renderWeekView();
  renderBedsideTomorrow();
}

function renderSchedule() {
  setIcon("schedule-title-icon", "calendar");
  setIcon("schedule-title-icon-lg", "calendar");
  setText("schedule-title-text", "Today's Agenda");
  setText("schedule-title-text-lg", "Today's Agenda");

  const todayEvents = agendaEntriesForDate(localDateKey(new Date()));
  const html =
    todayEvents.length === 0
      ? '<li class="schedule-empty">No events - tap the calendar icon to add one</li>'
      : todayEvents
          .map((event) => {
            const time = escapeHtml(event.time ? formatTimeOfDay(event.time) : "All day");
            const title = escapeHtml(event.title);
            return `<li class="schedule-item">
        <span class="schedule-time">${time}</span>
        <span class="schedule-title">${title}</span>
      </li>`;
          })
          .join("");

  const list = byId("schedule-list");
  if (list) list.innerHTML = html;
  const listLg = byId("schedule-list-lg");
  if (listLg) listLg.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Week view - a glance-and-edit popover for the next 7 days, opened from
// the calendar icon on the Agenda card. Independent of renderSchedule()'s
// own today-only window above.
// ---------------------------------------------------------------------------

function weekViewDayHtml(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const dateKey = localDateKey(date);
  const isToday = offset === 0;
  const weekdayLabel = isToday ? "Today" : date.toLocaleDateString("en-US", { weekday: "long" });
  const monthDayLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const events = agendaEntriesForDate(dateKey);

  const eventsHtml =
    events.length === 0
      ? '<div class="week-view-empty">No events</div>'
      : events
          .map(
            (event) => `<div class="week-view-event">
                  <span class="week-view-event-time">${escapeHtml(event.time ? formatTimeOfDay(event.time) : "All day")}</span>
                  <span class="week-view-event-title">${escapeHtml(event.title)}</span>
                  <button class="week-view-event-remove" type="button" data-id="${escapeHtml(event.id)}" aria-label="Remove event">&times;</button>
                </div>`
          )
          .join("");

  return `<div class="week-view-day${isToday ? " is-today" : ""}">
      <div class="week-view-day-header">
        <span>${escapeHtml(weekdayLabel)}</span>
        <span class="week-view-day-date">${escapeHtml(monthDayLabel)}</span>
      </div>
      ${eventsHtml}
    </div>`;
}

function renderWeekView() {
  const container = byId("week-view-days");
  if (!container) return;
  container.innerHTML = Array.from({ length: 7 }, (_, i) => weekViewDayHtml(i)).join("");
}

function openWeekView() {
  renderWeekView();
  byId("week-view-popover")?.classList.remove("hidden");
  byId("week-view-backdrop")?.classList.remove("hidden");
}

function closeWeekView() {
  byId("week-view-popover")?.classList.add("hidden");
  byId("week-view-backdrop")?.classList.add("hidden");
}

function setupWeekView() {
  setIcon("week-view-trigger-icon", "calendar");
  byId("week-view-trigger-btn")?.addEventListener("click", openWeekView);
  byId("week-view-close")?.addEventListener("click", closeWeekView);
  byId("week-view-backdrop")?.addEventListener("click", closeWeekView);

  const dateInput = byId("agenda-add-date");
  if (dateInput && !dateInput.value) dateInput.value = localDateKey(new Date());

  byId("agenda-add-btn")?.addEventListener("click", () => {
    const date = byId("agenda-add-date")?.value;
    const time = byId("agenda-add-time")?.value;
    const titleInput = byId("agenda-add-title");
    addAgendaItem(date, time, titleInput?.value);
    if (titleInput) titleInput.value = "";
  });

  byId("week-view-days")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".week-view-event-remove");
    if (!removeBtn) return;
    removeAgendaItem(removeBtn.dataset.id);
  });
}

/** Bedside Mode's own caption - specifically tomorrow's first agenda item,
 *  since Bedside Mode means "going to sleep," and what's relevant then is
 *  what's coming up after waking, not what's left of today. */
function renderBedsideTomorrow() {
  const el = byId("bedside-tomorrow");
  if (!el) return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const firstEvent = agendaEntriesForDate(localDateKey(tomorrow))[0];
  if (!firstEvent) {
    el.textContent = "";
    return;
  }
  const time = firstEvent.time ? formatTimeOfDay(firstEvent.time) : "all day";
  el.textContent = `Tomorrow: ${firstEvent.title} at ${time}`;
}

// ---------------------------------------------------------------------------
// Bedtime Briefing - a short spoken recap of tomorrow (weather, first
// Agenda item, next alarm), read aloud via the browser's own built-in
// speech synthesis when you tap the Goodnight button. No network, no cloud
// voice service, no API key - this is the one place the dashboard actually
// talks back, the one thing an actual Echo Show used to do (via Alexa)
// that a screen alone otherwise can't.
// ---------------------------------------------------------------------------

/** Composes from whatever's already loaded (lastWeatherData, agendaItems,
 *  wakeAlarms) rather than fetching anything new - if weather hasn't
 *  loaded yet, or there's no Agenda item or alarm, that sentence is just
 *  skipped rather than reading a gap or a "null" out loud. */
// ---------------------------------------------------------------------------
// Companion Server - an optional LAN-only companion service (source in
// server/ of this repo, deployed separately on hardware Rusty controls, not
// a third-party cloud dependency) backing four opt-in features the WebView
// can't do fully on-device: spoken briefings (this WebView's
// window.speechSynthesis is confirmed unsupported - see the speaking-check
// below), ISS pass prediction (needs live TLE data, out of scope for Night
// Sky View's own offline design), an off-device backup copy, and a
// generated one-line daily insight. Every one of these quietly does nothing
// if the server URL is unset or unreachable - nothing here is required for
// the dashboard to work, matching the rest of the app's degrade-quietly
// pattern (e.g. the rain-sound hint).
// ---------------------------------------------------------------------------
const COMPANION_URL_KEY = "aurora-dashboard:companion-server-url";
const COMPANION_KEY_KEY = "aurora-dashboard:companion-server-key";

function companionServerConfig() {
  const url = (localStorage.getItem(COMPANION_URL_KEY) || "").trim().replace(/\/+$/, "");
  const key = (localStorage.getItem(COMPANION_KEY_KEY) || "").trim();
  return url ? { url, key } : null;
}

/** Returns the fetch Response on success, or null on any failure/timeout/
 *  missing config - callers never need to try/catch, just check truthiness. */
async function companionFetch(path, options = {}) {
  const config = companionServerConfig();
  if (!config) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const headers = Object.assign({}, options.headers);
    if (config.key) headers["X-Dashboard-Key"] = config.key;
    const resp = await fetch(config.url + path, {
      method: options.method || "GET",
      headers,
      body: options.body,
      signal: controller.signal,
    });
    return resp.ok ? resp : null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function companionServerReachable() {
  const resp = await companionFetch("/health", { timeoutMs: 3000 });
  return !!resp;
}

// Lets the server's own separate heartbeat_check.py (a systemd timer, not
// part of the always-on server process) notice and alert if this dashboard
// goes quiet - crashed, powered off, wifi dropped. Pure fire-and-forget:
// failures here aren't logged or surfaced anywhere on the dashboard itself,
// since a missed heartbeat is exactly what the server-side check is for.
const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

async function sendHeartbeat() {
  await companionFetch("/heartbeat", { method: "POST", timeoutMs: 5000 });
}

function setupHeartbeat() {
  if (!companionServerConfig()) return;
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Homelab Status page - mirrors homelab-dashboard's own status.json (a
// separate small server on the LAN, see ~/Projects/homelab-dashboard),
// showing the same "what's going on across the homelab" cards natively
// in this app's own theme instead of embedding it. A different server
// than the Companion Server above (that one's this app's own optional
// backend; this is a general homelab overview that exists independently
// of this dashboard) - separate URL, separate localStorage key. Same
// degrade-quietly philosophy: unset or unreachable just means an empty
// page, never an error state.
// ---------------------------------------------------------------------------
const HOMELAB_URL_KEY = "aurora-dashboard:homelab-dashboard-url";
const HOMELAB_POLL_INTERVAL_MS = 60 * 1000;

function homelabDashboardUrl() {
  return (localStorage.getItem(HOMELAB_URL_KEY) || "").trim().replace(/\/+$/, "");
}

/** Returns the parsed status.json body, or null on any failure/timeout/
 *  missing config - same shape as companionFetch's contract. */
async function fetchHomelabStatus() {
  const base = homelabDashboardUrl();
  if (!base) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(base + "/status.json", { signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function homelabCardHtml(item) {
  const dotClass = item.ok === null || item.ok === undefined ? "unknown" : item.ok ? "ok" : "bad";
  const detailHtml = item.url
    ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.detail)}</a>`
    : escapeHtml(item.detail || "");
  return (
    `<div class="homelab-card">` +
    `<div class="homelab-card-head"><span class="homelab-dot ${dotClass}"></span><span class="homelab-card-title">${escapeHtml(item.title)}</span></div>` +
    `<div class="homelab-status-line">${escapeHtml(item.status_line || "")}</div>` +
    `<div class="homelab-detail">${detailHtml}</div>` +
    `</div>`
  );
}

function renderHomelabStatus(data) {
  const localGrid = byId("homelab-local-grid");
  const servicesGrid = byId("homelab-services-grid");
  const updated = byId("homelab-updated");
  const emptyHint = byId("homelab-empty-hint");

  const hasConfig = !!homelabDashboardUrl();
  emptyHint?.classList.toggle("hidden", hasConfig);

  if (!data) {
    if (localGrid) localGrid.innerHTML = "";
    if (servicesGrid) servicesGrid.innerHTML = "";
    if (updated) updated.textContent = hasConfig ? "Couldn't reach the homelab dashboard." : "";
    return;
  }

  if (localGrid) localGrid.innerHTML = (data.local_tools || []).map(homelabCardHtml).join("");
  if (servicesGrid) servicesGrid.innerHTML = (data.services || []).map(homelabCardHtml).join("");
  if (updated) {
    const generated = data.generated ? new Date(data.generated) : new Date();
    updated.textContent = "Updated " + generated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

async function refreshHomelabStatus() {
  const data = await fetchHomelabStatus();
  renderHomelabStatus(data);
}

function setupHomelabStatusPage() {
  setIcon("homelab-title-icon", "globe");
  refreshHomelabStatus();
  setInterval(refreshHomelabStatus, HOMELAB_POLL_INTERVAL_MS);
}

function setupHomelabDashboardSettings() {
  const urlInput = byId("homelab-dashboard-url-input");
  const hint = byId("homelab-dashboard-hint");

  const showHint = (text) => {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle("hidden", !text);
  };

  if (urlInput) urlInput.value = localStorage.getItem(HOMELAB_URL_KEY) || "";

  byId("homelab-dashboard-save-btn")?.addEventListener("click", async () => {
    localStorage.setItem(HOMELAB_URL_KEY, (urlInput?.value || "").trim());
    showHint("Checking connection...");
    const data = await fetchHomelabStatus();
    showHint(data ? "Connected." : "Saved, but couldn't reach it - double check the address and that homelab-dashboard is running.");
    renderHomelabStatus(data);
  });
}

// ---------------------------------------------------------------------------
// Discord inbox - DM the Companion Server's Discord bot ("note: ..." or
// "shop: ..." - see discord_bot.py) from anywhere, and it shows up here on
// the next poll. The dashboard is still fully phone-free on its own; this
// is an *additional*, entirely optional way to get something onto it
// remotely, not a dependency the core experience needs.
// ---------------------------------------------------------------------------
const DISCORD_INBOX_POLL_INTERVAL_MS = 5 * 60 * 1000;

async function pollDiscordInbox() {
  const resp = await companionFetch("/discord-inbox", { timeoutMs: 10000 });
  if (!resp) return;
  const data = await resp.json();
  const items = data.items || [];
  if (items.length === 0) return;

  let shoppingListChanged = false;
  for (const item of items) {
    if (!item.text) continue;
    if (item.type === "note") {
      addStickyNote(item.text);
    } else if (item.type === "shop") {
      shoppingListItems.push({ id: `shop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: item.text, checked: false });
      shoppingListChanged = true;
    } else if (item.type === "tell") {
      queueTellMessage(item.text);
    }
  }
  if (shoppingListChanged) {
    saveShoppingList();
    renderShoppingList();
  }
}

// ---------------------------------------------------------------------------
// /tell - an urgent, glanceable-from-across-the-room banner (same visual
// weight as the severe weather alert, in blue instead of red), for when a
// quiet Sticky Note isn't attention-grabbing enough. One-directional
// (Discord -> dashboard) by design - reading/replying to other people's
// real Discord messages isn't something a bot can legitimately do; this is
// just you messaging your own future bedside-self.
// ---------------------------------------------------------------------------
const TELL_MESSAGES_KEY = "aurora-dashboard:tell-messages";

function loadTellMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TELL_MESSAGES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let tellMessages = loadTellMessages();

function saveTellMessages() {
  localStorage.setItem(TELL_MESSAGES_KEY, JSON.stringify(tellMessages));
}

function queueTellMessage(text) {
  tellMessages.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, receivedAt: Date.now() });
  saveTellMessages();
  renderTellBanner();
}

/** Shows the oldest unread one (FIFO, not a rotating cycle like Sticky
 *  Notes - this is meant to be acknowledged and cleared one at a time,
 *  like a real notification, not passively browsed). */
function renderTellBanner() {
  const banner = byId("tell-banner");
  if (!banner) return;
  const show = tellMessages.length > 0 && !privacyModeActive;
  banner.classList.toggle("hidden", !show);
  if (!show) return;

  setText("tell-text", tellMessages[0].text);
  const count = byId("tell-count");
  if (count) {
    count.classList.toggle("hidden", tellMessages.length <= 1);
    count.textContent = `+${tellMessages.length - 1}`;
  }
}

function dismissTellMessage() {
  tellMessages.shift();
  saveTellMessages();
  renderTellBanner();
}

function setupTellBanner() {
  setIcon("tell-icon", "bell");
  renderTellBanner();
  byId("tell-dismiss")?.addEventListener("click", dismissTellMessage);
}

function setupDiscordInboxPolling() {
  if (!companionServerConfig()) return;
  pollDiscordInbox();
  setInterval(pollDiscordInbox, DISCORD_INBOX_POLL_INTERVAL_MS);
}

let activeCompanionAudio = null;
// Whichever button currently shows .speaking, if any - covers the whole
// span from tap to either cancel or natural completion, across both the
// fetch-in-flight window and playback. This, not the `btn` parameter of
// whichever speakBriefingText() call happens to be running, is the source
// of truth for which button a cancel should affect: Bedtime and Morning
// Briefing share this same speaking state (only one can talk at a time),
// so tapping Morning while Bedtime is mid-sentence needs to silence
// Bedtime's button, not silently no-op on a button that was never
// speaking - using the tapped button there previously left the *other*
// button's icon pulsing forever, since nothing else would ever clear it.
let activeSpeakingBtn = null;
// Discriminates a stale in-flight fetch's result after a cancel/restart -
// see the requestId check below.
let companionTtsRequestId = 0;

function isBriefingSpeaking() {
  return activeSpeakingBtn !== null;
}

/** Speaks text via the companion server's TTS if configured and reachable,
 *  falling back to window.speechSynthesis, falling back to doing nothing.
 *  A second call while already speaking - including mid-fetch, before any
 *  audio exists yet, and regardless of which of the two briefing buttons
 *  is tapped - stops whichever one is actually speaking. */
async function speakBriefingText(text, btn) {
  if (isBriefingSpeaking()) {
    companionTtsRequestId = 0; // invalidates any in-flight fetch's result, see below
    if (activeCompanionAudio) {
      activeCompanionAudio.pause();
      activeCompanionAudio.currentTime = 0;
      activeCompanionAudio = null;
    }
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    activeSpeakingBtn?.classList.remove("speaking");
    activeSpeakingBtn = null;
    return;
  }

  const config = companionServerConfig();
  if (config) {
    const requestId = ++companionTtsRequestId;
    activeSpeakingBtn = btn;
    btn?.classList.add("speaking");
    const resp = await companionFetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      timeoutMs: 15000,
    });
    if (companionTtsRequestId !== requestId) {
      // Cancelled (or superseded by a newer request) while this one was
      // still in flight - the cancel branch above already cleared the
      // button, discard this result.
      return;
    }
    companionTtsRequestId = 0;
    if (resp) {
      const blob = await resp.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      activeCompanionAudio = audio;
      // Safety net: if 'ended'/'error' ever fails to fire for some reason
      // (a media-stack quirk on this specific embedded WebView, an audio
      // element that silently stalls, etc.), don't leave the icon pulsing
      // forever - briefings are always well under this, so it only ever
      // fires as a fallback.
      const safetyTimeoutId = setTimeout(() => {
        if (activeCompanionAudio !== audio) return;
        btn?.classList.remove("speaking");
        activeCompanionAudio = null;
        if (activeSpeakingBtn === btn) activeSpeakingBtn = null;
      }, 30000);
      audio.onended = audio.onerror = () => {
        clearTimeout(safetyTimeoutId);
        btn?.classList.remove("speaking");
        URL.revokeObjectURL(audioUrl);
        if (activeCompanionAudio === audio) activeCompanionAudio = null;
        if (activeSpeakingBtn === btn) activeSpeakingBtn = null;
      };
      audio.play();
      return;
    }
    btn?.classList.remove("speaking");
    activeSpeakingBtn = null;
    // Falls through to speechSynthesis below if the server call failed.
  }

  if (typeof window.speechSynthesis === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  activeSpeakingBtn = btn;
  utterance.onstart = () => btn?.classList.add("speaking");
  utterance.onend = () => {
    btn?.classList.remove("speaking");
    if (activeSpeakingBtn === btn) activeSpeakingBtn = null;
  };
  utterance.onerror = () => {
    btn?.classList.remove("speaking");
    if (activeSpeakingBtn === btn) activeSpeakingBtn = null;
  };
  window.speechSynthesis.speak(utterance);
}

function buildBedtimeBriefingText() {
  const sentences = [];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tomorrowForecast = lastWeatherData?.dailyForecast?.[1];
  if (tomorrowForecast) {
    sentences.push(
      `Tomorrow looks ${tomorrowForecast.condition.toLowerCase()}, with a high of ${displayTemp(tomorrowForecast.high)} and a low of ${displayTemp(tomorrowForecast.low)}.`
    );
  }

  const firstEvent = agendaEntriesForDate(localDateKey(tomorrow))[0];
  if (firstEvent) {
    const time = firstEvent.time ? formatTimeOfDay(firstEvent.time) : "sometime tomorrow";
    sentences.push(`Your first thing tomorrow is ${firstEvent.title}, at ${time}.`);
  }

  const nextAlarm = nextWakeAlarmOccurrence();
  if (nextAlarm) {
    sentences.push(`Your alarm is set for ${formatTimeOfDay(nextAlarm.hhmm)}.`);
  }

  if (sentences.length === 0) return "Good night. Sleep well.";
  return `Good night. ${sentences.join(" ")} Sleep well.`;
}

function speakBedtimeBriefing() {
  const btn = byId("bedtime-briefing-btn");
  speakBriefingText(buildBedtimeBriefingText(), btn);
}

function setupBedtimeBriefing() {
  const btn = byId("bedtime-briefing-btn");
  if (typeof window.speechSynthesis === "undefined" && !companionServerConfig()) {
    // No speech synthesis in this WebView and no companion server configured
    // - hide the button entirely rather than leaving a control that
    // silently does nothing.
    btn?.classList.add("hidden");
    return;
  }
  setIcon("bedtime-briefing-icon", "moon");
  btn?.addEventListener("click", speakBedtimeBriefing);
}

// ---------------------------------------------------------------------------
// Good Morning Briefing - the wake-side twin of Bedtime Briefing above, same
// speechSynthesis mechanism, no mic involved. Sentences mirror what
// renderMorningBriefing() already puts on screen (greeting, weather with
// umbrella/jacket heads-up, first Agenda item, due reminders) - spoken as
// full sentences here rather than the terse on-screen fragments.
// ---------------------------------------------------------------------------

/** Composes from whatever's already loaded, same "skip a gap rather than
 *  read a null" approach as buildBedtimeBriefingText() above. */
function buildMorningBriefingText() {
  const sentences = [];

  const hour = currentHourInTimezone(currentTimezone || undefined);
  const greeting = greetingForHour(hour);
  sentences.push(userName ? `${greeting}, ${userName}.` : `${greeting}.`);

  const weather = lastWeatherData;
  if (weather) {
    let weatherLine = `It's ${displayTemp(weather.temperature)} degrees and ${weather.condition.toLowerCase()}, reaching ${displayTemp(weather.high)} today.`;
    if (weather.rainExpectedAt) {
      weatherLine += ` Bring an umbrella - rain's expected around ${formatTimeOfDay(weather.rainExpectedAt)}.`;
    }
    // Same raw-Fahrenheit threshold check as renderMorningBriefing() - see
    // its comment for why this ignores the display-only tempUnit.
    if (weather.low != null && weather.low < 45) {
      weatherLine += ` It'll be jacket weather, with a low of ${displayTemp(weather.low)}.`;
    }
    sentences.push(weatherLine);
  }

  const firstEvent = agendaEntriesForDate(localDateKey(new Date()))[0];
  if (firstEvent) {
    const time = firstEvent.time ? formatTimeOfDay(firstEvent.time) : "sometime today";
    sentences.push(`Your first thing today is ${firstEvent.title}, at ${time}.`);
  }

  const dueReminderCount = recurringReminders.filter((r) => daysUntilReminderDue(r) <= 0).length;
  if (dueReminderCount > 0) {
    sentences.push(`You have ${dueReminderCount} reminder${dueReminderCount === 1 ? "" : "s"} due.`);
  }

  return sentences.join(" ");
}

function speakMorningBriefing() {
  const btn = byId("morning-briefing-btn");
  speakBriefingText(buildMorningBriefingText(), btn);
}

function setupMorningBriefing() {
  const btn = byId("morning-briefing-btn");
  if (typeof window.speechSynthesis === "undefined" && !companionServerConfig()) {
    btn?.classList.add("hidden");
    return;
  }
  // Sun rather than speaker - both buttons play audio, so sharing one icon
  // made them visually indistinguishable sitting right next to each other.
  setIcon("morning-briefing-icon", "sunny");
  btn?.addEventListener("click", speakMorningBriefing);
}

/** "Next Alarm" now means the soonest enabled Wake Alarm - see
 *  nextWakeAlarmOccurrence() further down. This fork dropped the phone's
 *  own separate stock-alarm-clock reading Aurora used to also show here,
 *  which only ever existed because Aurora had two unrelated alarm
 *  systems; with just the one, this card can show it directly instead of
 *  duplicating "next alarm" two different ways. */
function renderNextWakeAlarmInline() {
  const next = nextWakeAlarmOccurrence();
  const text = next ? formatTimeOfDay(next.hhmm) : "No alarm";

  setIcon("alarm-title-icon", "alarm");
  setText("alarm-time", text);
  setIcon("alarm-title-icon-lg", "alarm");
  setText("alarm-time-lg", text);
  setIcon("alarm-title-icon-bedside", "alarm");
  setText("alarm-time-bedside", text);
}

/** Sets a <input type=range>'s value from server state, unless the user is
 *  actively dragging it - same "don't fight the user mid-drag" rule as the
 *  picker sync below, just for whichever of the two volume sliders (compact
 *  Overview card or the big one on the Clock/Sound page) isn't in use. */
function syncRangeInputIfIdle(id, value) {
  const el = byId(id);
  if (el && document.activeElement !== el) {
    el.value = String(value);
  }
}

/** Same idea as syncRangeInputIfIdle, for the sound-picker <select>s. */
function syncPickerIfIdle(id, soundName) {
  const picker = byId(id);
  if (!picker || document.activeElement === picker || !soundName) return;
  const matching = Array.from(picker.options).find((opt) => opt.textContent === soundName);
  if (matching) picker.value = matching.value;
}

// Sound Machine appears three times - the compact Overview card, the full
// control panel on the Clock/Sound page, and again in Bedside Mode - all
// three sets of controls get updated together so any of them reflects
// reality regardless of which one was used to change it.
const SOUND_MACHINE_ID_SUFFIXES = ["", "-lg", "-bedside"];

/** Reads straight from local playback state (currentSoundId,
 *  isLocallyPlaying, gainNode's own volume, sleepTimerEndAt) - this page
 *  is the only source of truth now, there's no separate server state to
 *  reflect. */
function renderSoundMachine() {
  const displayName = currentSoundId ? soundDisplayNameById.get(currentSoundId) : null;
  const minutesLeft = sleepTimerEndAt ? Math.max(0, Math.round((sleepTimerEndAt - Date.now()) / 60000)) : null;
  const nameText = displayName ? displayName + (minutesLeft != null ? ` · ${minutesLeft} min left` : "") : "Off";
  const playPauseIcon = isLocallyPlaying ? "pause" : "play";
  const playPauseLabel = isLocallyPlaying ? "Pause" : "Play";
  const volume = currentVolumePercent;

  SOUND_MACHINE_ID_SUFFIXES.forEach((suffix) => {
    setIcon(`sound-icon${suffix}`, "speaker");
    setText(`sound-name${suffix}`, nameText);
    setIcon(`sound-play-pause-icon${suffix}`, playPauseIcon);
    byId(`sound-play-pause${suffix}`)?.setAttribute("aria-label", playPauseLabel);
    setIcon(`sound-stop-icon${suffix}`, "stop");
    setIcon(`volume-icon${suffix}`, volume === 0 ? "volumeMuted" : "volume");
    syncRangeInputIfIdle(`sound-volume${suffix}`, volume);
    setText(`sound-volume-label${suffix}`, `${volume}%`);
    syncPickerIfIdle(`sound-picker${suffix}`, displayName);
  });
  renderRecentSounds();
}

const RAIN_SOUND_SUGGESTED_KEY = "aurora-dashboard:rain-sound-suggested-date";
const RAIN_SOUND_CONDITION_RE = /rain|drizzle|thunderstorm|showers/i;

/** A once-per-day, dismissible nudge - never auto-plays anything itself.
 *  Skipped entirely if a sound's already loaded (playing or paused), so it
 *  never second-guesses something already in progress. */
function maybeSuggestRainSound(weather) {
  const hint = byId("sound-rain-hint");
  if (!hint) return;

  const isRaining = RAIN_SOUND_CONDITION_RE.test(weather?.condition || "");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: currentTimezone || undefined });
  const alreadySuggestedToday = localStorage.getItem(RAIN_SOUND_SUGGESTED_KEY) === today;

  if (!isRaining || alreadySuggestedToday || currentSoundId) {
    hint.classList.add("hidden");
    return;
  }

  setIcon("sound-rain-hint-icon", "rain");
  hint.classList.remove("hidden");
}

function dismissRainSoundHint() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: currentTimezone || undefined });
  localStorage.setItem(RAIN_SOUND_SUGGESTED_KEY, today);
  byId("sound-rain-hint")?.classList.add("hidden");
}

function setupRainSoundHint() {
  byId("sound-rain-hint-play")?.addEventListener("click", async () => {
    await startLocalPlayback("rain", 0);
    saveSoundState();
    renderSoundMachine();
    dismissRainSoundHint();
  });
  byId("sound-rain-hint-dismiss")?.addEventListener("click", dismissRainSoundHint);
}

/** null if [minutesUntil] is negative or unknown - "in 45 min" / "in 3
 *  hrs" otherwise. Rounds to the hour past 60 minutes out; nobody needs
 *  "in 3 hrs 12 min" at a glance. */
function formatCountdown(minutesUntil) {
  if (minutesUntil == null || minutesUntil < 0) return null;
  if (minutesUntil < 1) return "now";
  if (minutesUntil < 60) return `in ${minutesUntil} min`;
  const hours = Math.round(minutesUntil / 60);
  return `in ${hours} hr${hours === 1 ? "" : "s"}`;
}

/** Bare duration, no "in"/"until" framing - "45 min" / "2 hrs" - for
 *  slotting into a sentence that already supplies its own preposition
 *  (e.g. "Full in ~${formatDuration(...)}"). */
function formatDuration(minutes) {
  if (minutes == null || minutes < 0) return null;
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}

/**
 * A genuine at-a-glance summary, not a restatement of the cards sitting
 * right below it. Weather gets an umbrella heads-up when rain's actually
 * forecast, and the first event shows a countdown instead of a flat clock
 * time - both are things you'd otherwise have to compute yourself. Reads
 * purely local state now (userName, the last weather fetch, the local
 * Agenda) rather than one big fetched blob, since there's no single
 * /dashboard response left to build it from.
 */
function renderMorningBriefing() {
  const hour = currentHourInTimezone(currentTimezone || undefined);
  const greeting = greetingForHour(hour);
  setText("briefing-greeting", userName ? `${greeting}, ${userName}.` : `${greeting}.`);

  const weather = lastWeatherData;
  let weatherLine = "Weather data isn't available yet.";
  if (weather) {
    weatherLine = `${displayTemp(weather.temperature)}°${tempUnit} and ${weather.condition.toLowerCase()}, reaching ${displayTemp(weather.high)}° today.`;
    if (weather.rainExpectedAt) {
      weatherLine += ` Bring an umbrella - rain expected around ${formatTimeOfDay(weather.rainExpectedAt)}.`;
    }
    // Checked against the raw Fahrenheit value regardless of tempUnit (the
    // display-only conversion), so the 45° threshold means the same actual
    // temperature no matter which unit is currently shown.
    if (weather.low != null && weather.low < 45) {
      weatherLine += ` Jacket weather - low of ${displayTemp(weather.low)}°.`;
    }
  }
  setText("briefing-weather", weatherLine);

  const firstEvent = agendaEntriesForDate(localDateKey(new Date()))[0];
  let eventLine = "No events today";
  if (firstEvent && !firstEvent.time) {
    eventLine = `${firstEvent.title} - all day`;
  } else if (firstEvent) {
    const nowMinutes = currentMinutesInTimezone(currentTimezone || undefined);
    const minutesUntil = minutesFromHHMM(firstEvent.time) - nowMinutes;
    const countdown = formatCountdown(minutesUntil);
    eventLine = countdown ? `${firstEvent.title} ${countdown}` : `${firstEvent.title} at ${formatTimeOfDay(firstEvent.time)}`;
  }
  // Tacked onto the same line rather than a whole new one - the hero panel
  // is already tight on vertical space, and this is meant as a passing
  // heads-up, not something that needs its own dedicated row the way the
  // Reminders tile itself does.
  const dueReminderCount = recurringReminders.filter((r) => daysUntilReminderDue(r) <= 0).length;
  if (dueReminderCount > 0) {
    eventLine += ` · ${dueReminderCount} reminder${dueReminderCount === 1 ? "" : "s"} due`;
  }
  setText("briefing-summary", eventLine);
}

let lastAppliedLayoutJson = null;

/**
 * Rebuilds the Morning Overview's .card-row wrappers from a layout config:
 * groups visible tiles two per row in the given order, and sets each
 * row's/card's flex-grow from TILE_SIZE_WEIGHT. The <section class="card">
 * elements are moved, not cloned or recreated, so this never touches their
 * ids, listeners, or already-rendered content - only where they sit in the
 * grid. A hidden tile is simply left unattached; the render functions
 * below (e.g. renderSoundMachine) then safely no-op on it via their
 * existing "element not found" guards, no special-casing needed.
 *
 * Skips the rebuild entirely if the layout is unchanged since last call,
 * so a routine settings change doesn't replay the card-fade-in animation or touch
 * the DOM for no reason.
 */
// Captured once, from the cards' original HTML position, and reused on
// every applyTileLayout() call after that - re-querying byId() each time
// would fail for any tile that's ever been hidden, since a hidden tile's
// card is detached from the document entirely (see below) and
// getElementById only finds nodes actually attached to it. Without this
// cache, a tile hidden once could never be shown again until a full page
// reload re-created it from the static HTML.
let cachedCardElements = null;

function applyTileLayout(tiles) {
  const grid = document.querySelector(".card-grid");
  if (!grid) return;

  const layoutJson = JSON.stringify(tiles);
  if (layoutJson === lastAppliedLayoutJson) return;
  lastAppliedLayoutJson = layoutJson;

  if (!cachedCardElements) {
    cachedCardElements = {};
    for (const tileId of Object.keys(TILE_DOM_ID)) {
      const el = byId(TILE_DOM_ID[tileId]);
      if (el) cachedCardElements[tileId] = el;
    }
  }
  const cardElements = cachedCardElements;

  // grid.innerHTML = "" only destroys the throwaway .card-row wrapper
  // divs - the actual card nodes above are already referenced via
  // cachedCardElements, so they aren't lost even though this detaches
  // them; appendChild below reattaches an existing node rather than
  // requiring a fresh one.
  grid.innerHTML = "";

  const visibleTiles = tiles.filter((tile) => tile.visible && cardElements[tile.id]);
  for (let i = 0; i < visibleTiles.length; i += 2) {
    const rowTiles = visibleTiles.slice(i, i + 2);
    const row = document.createElement("div");
    row.className = "card-row";
    // flex-basis: 0 forces each row's/card's share of the grid to come
    // purely from its flex-grow ratio, not its content's natural size -
    // without this, a row with unusually tall content (e.g. today's
    // notification list) can claim more than its fair share and push
    // later rows past the page's clipped height, since flex-shrink
    // pulling a content-sized item back down isn't reliably supported by
    // the Echo Show's WebView across this many nested flex levels.
    row.style.flexGrow = String(Math.max(...rowTiles.map((tile) => TILE_SIZE_WEIGHT[tile.size] ?? 1)));
    row.style.flexBasis = "0";

    rowTiles.forEach((tile, indexInRow) => {
      const card = cardElements[tile.id];
      card.style.flexGrow = String(TILE_SIZE_WEIGHT[tile.size] ?? 1);
      card.style.flexBasis = "0";
      card.style.animationDelay = `${(i + indexInRow) * 40}ms`;
      row.appendChild(card);
    });

    grid.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Dashboard Layout settings (Settings page) - pure localStorage now, same
// tile-config shape Aurora's phone app used to write. No POST, no re-poll -
// a change here takes effect immediately and that's the whole story.
// ---------------------------------------------------------------------------

const TILE_LABELS = {
  weather: "Weather",
  schedule: "Today's Agenda",
  alarm: "Next Alarm",
  sound: "Sound Machine",
  worldclock: "World Clock",
  countdown: "Countdown",
  nightroutine: "Night Routine",
  habits: "Habits",
  reminders: "Reminders",
  shoppinglist: "Shopping List",
};

let lastLayoutTiles = null;

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const stored = parsed && parsed.length > 0 ? parsed : DEFAULT_TILE_LAYOUT;

    // A tile added to DEFAULT_TILE_LAYOUT after someone already saved a
    // customized layout (e.g. this update's new Countdown tile) wouldn't
    // exist in their stored array at all - without this merge, it would
    // just silently never appear, since a customized layout is otherwise
    // used exactly as saved. Appended at the end with its own configured
    // default visibility/size rather than dropped.
    const storedIds = new Set(stored.map((tile) => tile.id));
    const missingTiles = DEFAULT_TILE_LAYOUT.filter((tile) => !storedIds.has(tile.id));
    return missingTiles.length > 0 ? [...stored, ...missingTiles] : stored;
  } catch (err) {
    return DEFAULT_TILE_LAYOUT;
  }
}

function layoutRowHtml(tile, index, tiles) {
  const label = TILE_LABELS[tile.id] || tile.id;
  const sizes = ["small", "medium", "large"];
  const sizeButtons = sizes
    .map(
      (size) =>
        `<button class="settings-size-btn${tile.size === size ? " active" : ""}" type="button" data-size="${size}">${size[0].toUpperCase()}</button>`
    )
    .join("");
  return `<div class="settings-layout-row" data-tile-id="${tile.id}">
      <span class="settings-app-label">${escapeHtml(label)}</span>
      <div class="settings-size-segmented">${sizeButtons}</div>
      <button class="settings-reorder-btn" type="button" data-dir="up" aria-label="Move ${escapeHtml(label)} up"${index === 0 ? " disabled" : ""}>&uarr;</button>
      <button class="settings-reorder-btn" type="button" data-dir="down" aria-label="Move ${escapeHtml(label)} down"${index === tiles.length - 1 ? " disabled" : ""}>&darr;</button>
      <button class="settings-switch" role="switch" aria-checked="${tile.visible}" aria-label="Show ${escapeHtml(label)} tile"></button>
    </div>`;
}

function renderLayoutSettings(tiles) {
  const list = byId("settings-layout-list");
  if (!list) return;
  lastLayoutTiles = tiles;
  list.innerHTML = tiles.map(layoutRowHtml).join("");
}

function saveLayoutUpdate(tiles) {
  lastLayoutTiles = tiles;
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(tiles));
  renderLayoutSettings(tiles);
  applyTileLayout(tiles);

  // World Clock self-heals within a second either way (updateClock() calls
  // renderWorldClocks() every tick), but Countdown/Night Routine/Habits/
  // Reminders/Shopping List only re-render on a CRUD action or the
  // once-a-day boundary check - so switching one of them on here wouldn't
  // actually show anything until one of those happened to fire. Cheap and
  // idempotent, so just always refresh all six the moment a layout change
  // lands, rather than leaving a newly-visible tile blank until something
  // else happens to trigger it.
  renderWorldClocks();
  renderCountdowns();
  renderNightRoutine();
  renderHabits();
  renderRecurringReminders();
  renderShoppingList();
}

function setupLayoutSettings() {
  const list = byId("settings-layout-list");
  if (!list) return;

  list.addEventListener("click", (event) => {
    if (!lastLayoutTiles) return;
    const row = event.target.closest(".settings-layout-row");
    if (!row) return;
    const index = lastLayoutTiles.findIndex((t) => t.id === row.dataset.tileId);
    if (index === -1) return;

    const sizeBtn = event.target.closest(".settings-size-btn");
    const reorderBtn = event.target.closest(".settings-reorder-btn");
    const switchBtn = event.target.closest(".settings-switch");

    const tiles = lastLayoutTiles.map((t) => ({ ...t }));
    if (sizeBtn) {
      tiles[index].size = sizeBtn.dataset.size;
    } else if (reorderBtn) {
      const swapWith = reorderBtn.dataset.dir === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= tiles.length) return;
      [tiles[index], tiles[swapWith]] = [tiles[swapWith], tiles[index]];
    } else if (switchBtn) {
      tiles[index].visible = !tiles[index].visible;
    } else {
      return;
    }

    saveLayoutUpdate(tiles);
  });
}

// ---------------------------------------------------------------------------
// Sound machine - the actual audio engine, and now the sound library too.
// There's no phone left to stream files from, so every ambient loop is
// synthesized right here with the Web Audio API instead: a fixed-length
// buffer of noise, colored per sound (white/pink/brown, or shaped further
// for Rain/Ocean Waves - see generateNoiseBuffer()), decoded once and
// looped with source.loop = true - the same sample-accurate, gapless loop
// this dashboard always used for playback, just generated instead of
// fetched. This page is also now the only source of truth for what's
// playing (no server to reconcile against) - every control acts on the
// AudioContext and persists to localStorage directly, so a reload picks
// up exactly where it left off via restoreSoundStateFromStorage().
//
// Browser autoplay policy note: starting audio with no prior user gesture
// on this page load (exactly the reload-resume case) can be blocked by
// Chromium's autoplay policy. startLocalPlayback() below handles the
// rejection by queuing the request and retrying on the next touch
// anywhere on the screen (see the pointerdown listener) - if unattended
// resume after a reboot doesn't produce sound until the screen is
// touched, that's this policy, not a bug; check Fully Kiosk Browser's
// advanced web settings for an autoplay/media-gesture override if it
// needs to be fully unattended.
// ---------------------------------------------------------------------------

const SOUND_LIBRARY = [
  { id: "whitenoise", displayName: "White Noise" },
  { id: "pinknoise", displayName: "Pink Noise" },
  { id: "brownnoise", displayName: "Brown Noise" },
  { id: "rain", displayName: "Rain" },
  { id: "ocean", displayName: "Ocean Waves" },
  { id: "thunderstorm", displayName: "Thunderstorm" },
  { id: "fireplace", displayName: "Fireplace" },
  { id: "fan", displayName: "Fan" },
  { id: "chime", displayName: "Chime" },
];
// Rebuilt whenever customSounds changes (see rebuildSoundDisplayNameMap()
// further down) - starts as just the built-in library so every lookup
// works before the custom-sounds IndexedDB load resolves.
let soundDisplayNameById = new Map(SOUND_LIBRARY.map((entry) => [entry.id, entry.displayName]));

const NOISE_BUFFER_SECONDS = 20;
const SLEEP_TIMER_FADE_MS = 10_000;
const SOUND_STATE_KEY = "aurora-dashboard:sound-state";

let audioContext = null;
let gainNode = null;
let currentSource = null; // the AudioBufferSourceNode currently playing, or null
const bufferCache = new Map(); // soundId -> generated AudioBuffer

let currentSoundId = null; // which sound is loaded locally (playing or paused)
let isLocallyPlaying = false;
let playbackOffsetSeconds = 0; // position within the loop, captured on pause
let playbackStartContextTime = 0; // audioContext.currentTime the current source effectively started at
// The user's actual configured volume - tracked separately from
// gainNode.gain.value because that AudioParam is mid-ramp for
// SOUND_FADE_IN_SECONDS after every play() (see startLocalPlayback()), so
// reading it directly right after pressing play would capture whatever
// transient value the fade-in happened to be at, not the real target.
let currentVolumePercent = 50;

let sleepTimerHandle = null;
let sleepTimerFadeHandle = null;
let sleepTimerEndAt = null; // epoch ms, persisted so a reload can resume the countdown

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextCtor();
    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
  }
  return audioContext;
}

/** Paul Kellet's economy pink-noise approximation - a standard, cheap
 *  filter cascade over white noise, reused below (further shaped) for
 *  Rain too, since real rain's spectrum sits much closer to pink than
 *  flat white. */
function fillPinkNoise(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.075079;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

/** Leaky-integrated white noise - duller and deeper than pink, reused
 *  (further shaped) for Ocean Waves below. */
function fillBrownNoise(data) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
}

function fillWhiteNoise(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

/** Keeps a layered sample (base noise + an added rumble/pop) within
 *  AudioBuffer's valid range - Web Audio doesn't clamp this itself, and
 *  two sources summed can exceed ±1 even though each alone doesn't. */
function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

/** A slow, smooth 0..1 oscillation for shaping amplitude over time (rain's
 *  intensity drift, a wave's swell) - periodSeconds is chosen so a whole
 *  number of cycles fits NOISE_BUFFER_SECONDS exactly, so the loop point
 *  never has an audible envelope jump even though the underlying noise
 *  itself needs no such care (see generateNoiseBuffer()'s doc comment). */
function envelopeValue(sampleIndex, sampleRate, periodSeconds) {
  return (Math.sin((2 * Math.PI * sampleIndex) / (sampleRate * periodSeconds)) + 1) / 2;
}

/** Builds one looping AudioBuffer for [soundId] - this is the "network
 *  fetch" this dashboard's Sound Machine always did, just generated
 *  instead. A noise buffer loops seamlessly at any length at all -
 *  consecutive noise samples have no special relationship to preserve
 *  across the seam - so only the slower amplitude shaping below needs to
 *  complete a whole number of cycles across the buffer. */
function generateNoiseBuffer(soundId) {
  const ctx = ensureAudioContext();
  const length = Math.round(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  switch (soundId) {
    case "pinknoise":
      fillPinkNoise(data);
      break;
    case "brownnoise":
      fillBrownNoise(data);
      break;
    case "rain":
      fillPinkNoise(data);
      for (let i = 0; i < length; i++) {
        data[i] *= 0.65 + 0.35 * envelopeValue(i, ctx.sampleRate, NOISE_BUFFER_SECONDS / 2);
      }
      break;
    case "ocean":
      fillBrownNoise(data);
      for (let i = 0; i < length; i++) {
        data[i] *= 0.35 + 0.65 * envelopeValue(i, ctx.sampleRate, NOISE_BUFFER_SECONDS);
      }
      break;
    case "thunderstorm": {
      // Rain's own shaped-pink-noise base, quieter, plus a handful of
      // distant rumbles - a leaky integrator over white noise (same idea
      // as fillBrownNoise, run fresh per rumble so each one decays
      // independently) rather than a single low tone, so it reads as an
      // actual rumble instead of a hum. Fixed start times (not random)
      // so this buffer, once generated, always loops identically.
      fillPinkNoise(data);
      for (let i = 0; i < length; i++) {
        data[i] *= 0.55 + 0.35 * envelopeValue(i, ctx.sampleRate, NOISE_BUFFER_SECONDS / 4);
      }
      for (const startSec of [3, 11, 16]) {
        const startSample = Math.round(startSec * ctx.sampleRate);
        const rumbleSamples = Math.min(Math.round(2.5 * ctx.sampleRate), length - startSample);
        let rumbleState = 0;
        for (let j = 0; j < rumbleSamples; j++) {
          const white = Math.random() * 2 - 1;
          rumbleState = (rumbleState + 0.01 * white) / 1.01;
          const decay = 1 - j / rumbleSamples;
          data[startSample + j] = clampSample(data[startSample + j] + rumbleState * 1.8 * decay * decay);
        }
      }
      break;
    }
    case "fireplace": {
      // A quiet brown-noise roar as the base, plus sparse short crackle
      // pops layered on top - each pop is confined well clear of the
      // buffer's own loop boundary so it never gets cut off mid-decay.
      fillBrownNoise(data);
      for (let i = 0; i < length; i++) data[i] *= 0.45;
      const popSamples = Math.round(0.02 * ctx.sampleRate);
      for (let c = 0; c < 40; c++) {
        const startSample = Math.floor(Math.random() * (length - popSamples));
        const amp = 0.35 + Math.random() * 0.45;
        for (let j = 0; j < popSamples; j++) {
          const decay = 1 - j / popSamples;
          const idx = startSample + j;
          data[idx] = clampSample(data[idx] + (Math.random() * 2 - 1) * amp * decay);
        }
      }
      break;
    }
    case "fan": {
      // Broadband white noise with a gentle, steady blade-passing wobble -
      // faster than Ocean Waves' slow swell, more regular than Rain's,
      // meant to read as a motor rather than weather. 3 cycles/second
      // divides evenly into NOISE_BUFFER_SECONDS (60 whole cycles).
      fillWhiteNoise(data);
      for (let i = 0; i < length; i++) {
        data[i] *= 0.55 + 0.15 * envelopeValue(i, ctx.sampleRate, NOISE_BUFFER_SECONDS / 60);
      }
      break;
    }
    case "chime": {
      // A repeating short tone rather than shaped noise - urgent and
      // alarm-appropriate, not meant to blend into the background the way
      // the ambient sounds above do. One beat per second divides evenly
      // into NOISE_BUFFER_SECONDS, so the loop point falls silent-to-
      // silent with no audible seam.
      const freq = 880;
      const beatSeconds = 1;
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        const withinBeat = t % beatSeconds;
        const envelope = withinBeat < 0.3 ? Math.sin((withinBeat / 0.3) * Math.PI) : 0;
        data[i] = envelope * Math.sin(2 * Math.PI * freq * t) * 0.6;
      }
      break;
    }
    default:
      fillWhiteNoise(data);
  }

  return buffer;
}

// Each cached entry is a fully-decoded PCM AudioBuffer - a custom sound's
// decodeAudioData() output can run tens of MB for a few minutes of audio -
// and this dashboard's page is a kiosk that stays open for days, never
// reloading. An unbounded cache here just grows for as long as the device
// is on, which on the Echo Show's limited WebView memory eventually tips
// over into Fully Kiosk killing and restarting the "unresponsive" WebView.
// Capped at more than the 4 the Mixer can have active at once, so normal
// use never evicts something that's actually playing.
const BUFFER_CACHE_MAX_ENTRIES = 8;

/** soundIds that must never be evicted because they're playing right now -
 *  the Single engine's current sound, plus whatever the Mixer's layers are
 *  assigned to while it's running. */
function soundIdsInActiveUse() {
  const ids = new Set();
  if (currentSoundId) ids.add(currentSoundId);
  if (mixerPlaying) {
    for (const layer of mixerLayers) {
      if (layer.soundId) ids.add(layer.soundId);
    }
  }
  return ids;
}

function pruneBufferCache() {
  if (bufferCache.size <= BUFFER_CACHE_MAX_ENTRIES) return;
  const active = soundIdsInActiveUse();
  for (const id of bufferCache.keys()) {
    if (bufferCache.size <= BUFFER_CACHE_MAX_ENTRIES) break;
    if (active.has(id)) continue;
    bufferCache.delete(id);
  }
}

async function loadSoundBuffer(soundId) {
  if (bufferCache.has(soundId)) {
    const buffer = bufferCache.get(soundId);
    // Move to the end (most-recently-used) so a later prune evicts stale
    // entries first, not whatever was merely cached earliest.
    bufferCache.delete(soundId);
    bufferCache.set(soundId, buffer);
    return buffer;
  }
  const ctx = ensureAudioContext();
  let buffer;
  if (isCustomSoundId(soundId)) {
    const record = await loadCustomSoundRecord(soundId);
    if (!record) throw new Error(`Custom sound "${soundId}" no longer exists`);
    const arrayBuffer = await record.blob.arrayBuffer();
    buffer = await ctx.decodeAudioData(arrayBuffer);
  } else {
    buffer = generateNoiseBuffer(soundId);
  }
  bufferCache.set(soundId, buffer);
  pruneBufferCache();
  return buffer;
}

function stopSourceNode() {
  if (!currentSource) return;
  try {
    currentSource.stop();
  } catch (err) {
    // Already stopped - fine.
  }
  currentSource.disconnect();
  currentSource = null;
}

/**
 * Never gates on ctx.state - a source can be created and start()'d on a
 * suspended AudioContext perfectly validly, it just stays silent (queued)
 * until the context actually resumes. Earlier this bailed out entirely
 * when resume() didn't synchronously leave "suspended" (a real, fairly
 * common outcome of autoplay policy on this kiosk WebView), which told
 * Aurora "playing" while nothing local had actually started - the
 * dashboard needed a second, unrelated touch (via the pointerdown
 * fallback below) to notice and actually begin sound. Finishing the setup
 * unconditionally means the very next resume - from this call's own
 * attempt, or any later touch - makes the already-queued source audible
 * immediately, with no second startLocalPlayback() call needed.
 */
// A gentle rise instead of the sound snapping straight to full volume the
// instant playback starts - purely cosmetic to the ear, but reads as a
// lot less jarring for something meant to help you fall asleep.
const SOUND_FADE_IN_SECONDS = 2.5;

async function startLocalPlayback(soundId, offsetSeconds = 0) {
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const buffer = await loadSoundBuffer(soundId);
  stopSourceNode();

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gainNode);

  const startOffset = buffer.duration > 0 ? offsetSeconds % buffer.duration : 0;
  source.start(0, startOffset);

  // Whatever setLocalVolume() last set is the real target - ramp up to
  // it rather than starting there outright. Cancels any in-flight ramp
  // first so rapid stop/start doesn't leave two competing schedules.
  const targetGain = gainNode.gain.value;
  const now = ctx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(targetGain, now + SOUND_FADE_IN_SECONDS);

  currentSource = source;
  currentSoundId = soundId;
  playbackStartContextTime = ctx.currentTime - startOffset;
  isLocallyPlaying = true;
}

function pauseLocalPlayback() {
  if (!isLocallyPlaying) return;
  const buffer = bufferCache.get(currentSoundId);
  if (buffer && buffer.duration > 0) {
    playbackOffsetSeconds = (audioContext.currentTime - playbackStartContextTime) % buffer.duration;
  }
  stopSourceNode();
  isLocallyPlaying = false;
  cancelLocalSleepTimer();
}

function stopLocalPlaybackFully() {
  stopSourceNode();
  isLocallyPlaying = false;
  playbackOffsetSeconds = 0;
  cancelLocalSleepTimer();
}

function setLocalVolume(percent) {
  ensureAudioContext();
  currentVolumePercent = percent;
  gainNode.gain.value = percent / 100;
}

// Resolves autoplay-policy blocks: startLocalPlayback()/startWakeAlarmSound()
// already create and start() their source nodes unconditionally, so a
// suspended AudioContext just means the source is queued but silent - the
// first touch anywhere on the kiosk screen only needs to resume() the
// context(s) for whatever's queued to become audible, nothing needs to be
// restarted.
document.addEventListener(
  "pointerdown",
  () => {
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    if (wakeAlarmAudioContext && wakeAlarmAudioContext.state === "suspended") {
      wakeAlarmAudioContext.resume().catch(() => {});
    }
  },
  { passive: true }
);

function cancelLocalSleepTimer() {
  if (sleepTimerHandle) {
    clearTimeout(sleepTimerHandle);
    sleepTimerHandle = null;
  }
  if (sleepTimerFadeHandle) {
    clearInterval(sleepTimerFadeHandle);
    sleepTimerFadeHandle = null;
  }
  sleepTimerEndAt = null;
}

/** Arms the actual setTimeout from the already-computed sleepTimerEndAt -
 *  split out from startLocalSleepTimer() so restoreSoundStateFromStorage()
 *  can resume a timer that was already counting down before a reload,
 *  without recomputing a fresh duration from scratch. */
function armSleepTimerFromEndAt() {
  if (!sleepTimerEndAt) return;
  const remainingMs = sleepTimerEndAt - Date.now();
  const fadeStartDelayMs = Math.max(remainingMs - SLEEP_TIMER_FADE_MS, 0);
  sleepTimerHandle = setTimeout(() => {
    sleepTimerHandle = null;
    fadeOutAndStop();
  }, fadeStartDelayMs);
}

function startLocalSleepTimer(totalMinutes) {
  cancelLocalSleepTimer();
  if (totalMinutes == null) {
    saveSoundState();
    return;
  }
  sleepTimerEndAt = Date.now() + totalMinutes * 60_000;
  armSleepTimerFromEndAt();
  saveSoundState();
}

function fadeOutAndStop() {
  if (!isLocallyPlaying) return;

  const steps = 20;
  const stepMs = SLEEP_TIMER_FADE_MS / steps;
  const startGain = gainNode.gain.value;
  let step = 0;

  sleepTimerFadeHandle = setInterval(() => {
    step += 1;
    gainNode.gain.value = startGain * Math.max(1 - step / steps, 0);

    if (step >= steps) {
      clearInterval(sleepTimerFadeHandle);
      sleepTimerFadeHandle = null;
      stopLocalPlaybackFully();
      gainNode.gain.value = startGain; // restored for the next play()
      saveSoundState();
      renderSoundMachine();
    }
  }, stepMs);
}

/** "until alarm" is the one preset that needs live computation (everything
 *  else is a flat number of minutes) - resolved against the local Wake
 *  Alarms list, same as Aurora used to resolve it server-side. */
function resolveSleepTimerMinutes(preset) {
  if (preset === "off") return null;
  if (preset === "untilAlarm") {
    const next = nextWakeAlarmOccurrence();
    return next ? Math.max(1, Math.round((next.epochMs - Date.now()) / 60_000)) : null;
  }
  const minutes = Number(preset);
  return Number.isFinite(minutes) ? minutes : null;
}

function saveSoundState() {
  localStorage.setItem(
    SOUND_STATE_KEY,
    JSON.stringify({
      playing: isLocallyPlaying,
      soundId: currentSoundId,
      volume: currentVolumePercent,
      sleepTimerEndAt,
    })
  );
}

/** Resumes exactly what was playing (and any in-progress sleep timer)
 *  before the last reload - the local equivalent of the old "Aurora
 *  remembers, the first poll after reload picks it back up" mechanism,
 *  just sourced from localStorage instead of a server. */
function restoreSoundStateFromStorage() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SOUND_STATE_KEY) || "null");
  } catch (err) {
    saved = null;
  }
  if (!saved) return;

  setLocalVolume(saved.volume ?? 50);
  if (saved.sleepTimerEndAt && saved.sleepTimerEndAt > Date.now()) {
    sleepTimerEndAt = saved.sleepTimerEndAt;
    armSleepTimerFromEndAt();
  }
  if (saved.playing && saved.soundId) {
    startLocalPlayback(saved.soundId, 0).then(renderSoundMachine);
  } else if (saved.soundId) {
    currentSoundId = saved.soundId;
  }
  renderSoundMachine();
}

// Last few distinct sounds actually chosen (via the picker or a recent
// chip) - most-recent-first, deduped, capped short since this is meant to
// be a handful of quick-tap favorites, not a full history. Clock/Sound
// page only, see .sound-recent's comment in style.css.
const RECENT_SOUNDS_KEY = "aurora-dashboard:recent-sounds";
const RECENT_SOUNDS_MAX = 4;
let recentSoundIds = [];
try {
  recentSoundIds = JSON.parse(localStorage.getItem(RECENT_SOUNDS_KEY) || "[]");
} catch (err) {
  recentSoundIds = [];
}

function renderRecentSounds() {
  const container = byId("sound-recent");
  if (!container) return;
  if (recentSoundIds.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.innerHTML = recentSoundIds
    .map((id) => {
      const name = soundDisplayNameById.get(id) || id;
      const active = id === currentSoundId && isLocallyPlaying;
      return `<button class="sound-recent-chip${active ? " active" : ""}" type="button" data-sound-id="${escapeHtml(id)}">${escapeHtml(name)}</button>`;
    })
    .join("");
  container.classList.remove("hidden");
}

function recordRecentSound(soundId) {
  if (!soundId) return;
  recentSoundIds = [soundId, ...recentSoundIds.filter((id) => id !== soundId)].slice(0, RECENT_SOUNDS_MAX);
  localStorage.setItem(RECENT_SOUNDS_KEY, JSON.stringify(recentSoundIds));
  renderRecentSounds();
}

function setupRecentSounds() {
  const container = byId("sound-recent");
  if (!container) return;
  container.addEventListener("click", async (event) => {
    const chip = event.target.closest(".sound-recent-chip");
    if (!chip) return;
    const soundId = chip.dataset.soundId;
    if (!soundId) return;
    await startLocalPlayback(soundId, 0);
    recordRecentSound(soundId);
    saveSoundState();
    renderSoundMachine();
  });
}

function soundOptionHtml(entry) {
  return `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.displayName)}</option>`;
}

/** Fills every sound picker on the page from the local SOUND_LIBRARY plus
 *  any imported custom sounds (see "Custom sounds" section below) - fully
 *  synchronous, no network involved. Re-run after every import/delete, not
 *  just once at startup. */
function populateSoundPickers() {
  const builtInHtml = SOUND_LIBRARY.map(soundOptionHtml).join("");
  const customHtml =
    customSounds.length > 0
      ? `<optgroup label="Custom">${customSounds.map(soundOptionHtml).join("")}</optgroup>`
      : "";
  const optionsHtml = builtInHtml + customHtml;

  ["sound-picker", "sound-picker-lg", "sound-picker-bedside"].forEach((id) => {
    const el = byId(id);
    if (el) el.innerHTML = optionsHtml;
  });
  // Alarms fall back to the default alarm sound when nothing's chosen (see
  // resolveAlarmSoundId()), so this picker gets an explicit "Default"
  // option the ambient pickers above don't need.
  const wakeAlarmPicker = byId("wakealarm-sound-picker");
  if (wakeAlarmPicker) wakeAlarmPicker.innerHTML = `<option value="">Default</option>${optionsHtml}`;
  const defaultAlarmSoundPicker = byId("wakealarm-default-sound-picker");
  if (defaultAlarmSoundPicker) defaultAlarmSoundPicker.innerHTML = optionsHtml;

  // Each Mixer layer can also be "Off" (the wake-alarm picker's "Default"
  // option doesn't apply here - there's no fallback sound for a layer,
  // silence is a perfectly normal choice for an unused slot).
  for (let i = 0; i < MIXER_LAYER_COUNT; i++) {
    const picker = byId(`mixer-layer-picker-${i}`);
    if (!picker) continue;
    picker.innerHTML = `<option value="">Off</option>${optionsHtml}`;
    picker.value = mixerLayers[i].soundId || "";
  }

  renderRecentSounds();
}

// ---------------------------------------------------------------------------
// Custom sounds - real audio files you import yourself, stored locally in
// IndexedDB (not localStorage - no practical size limit) and playable
// anywhere a built-in sound is: the Sound Machine and Wake Alarms alike.
// This is the actual answer to "can I use real sounds instead of
// synthesized ones" - rather than this fork trying to source and bundle
// audio of uncertain size/licensing, you bring your own, and it Just
// Works everywhere the built-in library does (loadSoundBuffer() above
// already branches on isCustomSoundId(), so nothing downstream needs to
// know the difference between a custom sound and a generated one).
// ---------------------------------------------------------------------------

const CUSTOM_SOUNDS_DB_NAME = "aurora-dashboard-sounds";
const CUSTOM_SOUNDS_STORE = "customSounds";
const CUSTOM_SOUND_MAX_BYTES = 25 * 1024 * 1024; // generous for a multi-minute loop, still safe on modest hardware

let customSounds = []; // [{id, displayName}] - metadata only; blobs stay in IndexedDB until actually played
let customSoundsDbPromise = null;

function openCustomSoundsDb() {
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB not available"));
  if (!customSoundsDbPromise) {
    customSoundsDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CUSTOM_SOUNDS_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(CUSTOM_SOUNDS_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return customSoundsDbPromise;
}

function isCustomSoundId(id) {
  return typeof id === "string" && id.startsWith("custom_");
}

async function saveCustomSoundRecord(id, displayName, blob) {
  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_SOUNDS_STORE, "readwrite");
    tx.objectStore(CUSTOM_SOUNDS_STORE).put({ id, displayName, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Full record including the blob - only called from loadSoundBuffer()
 *  right before actually decoding it, not for the Settings list (which
 *  only needs displayName - see loadAllCustomSoundRecords() below). */
async function loadCustomSoundRecord(id) {
  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_SOUNDS_STORE, "readonly");
    const request = tx.objectStore(CUSTOM_SOUNDS_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function loadAllCustomSoundRecords() {
  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_SOUNDS_STORE, "readonly");
    const request = tx.objectStore(CUSTOM_SOUNDS_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteCustomSoundRecord(id) {
  const db = await openCustomSoundsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CUSTOM_SOUNDS_STORE, "readwrite");
    tx.objectStore(CUSTOM_SOUNDS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function rebuildSoundDisplayNameMap() {
  soundDisplayNameById = new Map([
    ...SOUND_LIBRARY.map((entry) => [entry.id, entry.displayName]),
    ...customSounds.map((entry) => [entry.id, entry.displayName]),
  ]);
}

function renderCustomSoundsSettings() {
  const list = byId("settings-customsounds-list");
  if (!list) return;
  if (customSounds.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No custom sounds imported yet</div>';
    return;
  }
  list.innerHTML = customSounds
    .map(
      (entry) => `<div class="settings-app-row" data-id="${escapeHtml(entry.id)}">
        <span class="settings-app-label">${escapeHtml(entry.displayName)}</span>
        <button class="icon-button customsound-remove" type="button" aria-label="Remove ${escapeHtml(entry.displayName)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function showCustomSoundImportHint(text) {
  const hint = byId("customsound-import-hint");
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle("hidden", !text);
}

async function importCustomSoundFiles(fileList) {
  const skipped = [];
  for (const file of Array.from(fileList)) {
    if (file.size > CUSTOM_SOUND_MAX_BYTES) {
      skipped.push(file.name);
      continue;
    }
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const displayName = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Custom Sound";
    try {
      await saveCustomSoundRecord(id, displayName, file);
      customSounds.push({ id, displayName });
    } catch (err) {
      skipped.push(file.name);
    }
  }

  rebuildSoundDisplayNameMap();
  populateSoundPickers();
  renderCustomSoundsSettings();
  renderSoundMachine();

  showCustomSoundImportHint(
    skipped.length > 0
      ? `Skipped ${skipped.join(", ")} - over the 25 MB per-file limit, or couldn't be stored.`
      : ""
  );
}

async function setupCustomSounds() {
  const importInput = byId("customsound-import-input");
  const importLabel = byId("customsound-import-label");
  if (!window.indexedDB) {
    // Degrade gracefully rather than offering a control that can't work -
    // same "hide, don't half-work" philosophy as the radar panel and
    // Today in History card elsewhere in this file.
    importLabel?.classList.add("hidden");
    showCustomSoundImportHint("Custom sounds need IndexedDB, which this browser doesn't support.");
    return;
  }

  try {
    const records = await loadAllCustomSoundRecords();
    customSounds = records.map((r) => ({ id: r.id, displayName: r.displayName }));
  } catch (err) {
    customSounds = [];
  }
  rebuildSoundDisplayNameMap();
  populateSoundPickers();
  renderCustomSoundsSettings();
  renderSoundMachine();

  importInput?.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) await importCustomSoundFiles(files);
    event.target.value = ""; // lets the same filename be re-imported later
  });

  byId("settings-customsounds-list")?.addEventListener("click", async (event) => {
    const removeBtn = event.target.closest(".customsound-remove");
    if (!removeBtn) return;
    const id = removeBtn.closest("[data-id]")?.dataset.id;
    if (!id) return;

    await deleteCustomSoundRecord(id);
    customSounds = customSounds.filter((s) => s.id !== id);
    bufferCache.delete(id);
    rebuildSoundDisplayNameMap();
    populateSoundPickers();
    renderCustomSoundsSettings();

    // A deleted sound that's currently playing has to actually stop -
    // its buffer is gone, so any further reference to it would throw.
    if (currentSoundId === id) {
      stopLocalPlaybackFully();
      saveSoundState();
    }
    renderSoundMachine();
  });
}

// ---------------------------------------------------------------------------
// Wallpaper - photos you import yourself, stored locally in IndexedDB, same
// "bring your own files" pattern as Custom Sounds above. Aurora used to
// sync a phone photo library for this; there's no phone left, so the
// import button is the library. Downscaled on import (resizeImageFile())
// since a handful of full camera-resolution photos would eat a meaningful
// chunk of an Echo Show 5's limited storage for no visual benefit on a
// 960x480 screen. Three display modes - rotating (default), single, and a
// time-of-day schedule - plus a plain solid-black override, all mirroring
// the original echo-dashboard's wallpaper feature exactly; only where the
// photos come from changed.
// ---------------------------------------------------------------------------

const WALLPAPER_DB_NAME = "aurora-dashboard-wallpapers";
const WALLPAPER_STORE = "photos";
const WALLPAPER_MAX_DIMENSION = 1600; // long edge, in px - comfortably above any real display this runs on
const WALLPAPER_JPEG_QUALITY = 0.82;
const WALLPAPER_ROTATION_INTERVAL_MS = 5 * 60 * 1000;

const WALLPAPER_MODE_KEY = "aurora-dashboard:wallpaper-mode";
const WALLPAPER_SINGLE_KEY = "aurora-dashboard:wallpaper-single";
const WALLPAPER_SCHEDULE_KEY = "aurora-dashboard:wallpaper-schedule";
const WALLPAPER_BLACK_KEY = "aurora-dashboard:wallpaper-black";

let wallpaperPhotoIds = []; // metadata only, in import order - blobs stay in IndexedDB until actually shown
let wallpaperObjectUrls = new Map(); // photoId -> blob: URL, created once per id and reused (thumbnails + full display alike)
let wallpaperDbPromise = null;

let wallpaperMode = localStorage.getItem(WALLPAPER_MODE_KEY) || "rotating";
let wallpaperSingleId = localStorage.getItem(WALLPAPER_SINGLE_KEY) || null;
let wallpaperSchedule = [];
try {
  wallpaperSchedule = JSON.parse(localStorage.getItem(WALLPAPER_SCHEDULE_KEY) || "[]");
} catch (err) {
  wallpaperSchedule = [];
}
let wallpaperForcedBlack = localStorage.getItem(WALLPAPER_BLACK_KEY) === "true";

function openWallpaperDb() {
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB not available"));
  if (!wallpaperDbPromise) {
    wallpaperDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(WALLPAPER_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(WALLPAPER_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return wallpaperDbPromise;
}

async function saveWallpaperRecord(id, blob) {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLPAPER_STORE, "readwrite");
    tx.objectStore(WALLPAPER_STORE).put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadWallpaperRecord(id) {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLPAPER_STORE, "readonly");
    const request = tx.objectStore(WALLPAPER_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function loadAllWallpaperRecords() {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLPAPER_STORE, "readonly");
    const request = tx.objectStore(WALLPAPER_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteWallpaperRecord(id) {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLPAPER_STORE, "readwrite");
    tx.objectStore(WALLPAPER_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Draws [file] into a canvas capped at WALLPAPER_MAX_DIMENSION on its
 *  long edge (untouched if already smaller) and re-encodes as JPEG - a
 *  4000x3000 camera photo has no business being stored at full size for a
 *  960x480 kiosk display. */
async function localResizeImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, WALLPAPER_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/jpeg", WALLPAPER_JPEG_QUALITY);
  });
}

/** Sends [file]'s raw bytes to the Companion Server's /wallpaper-upscale -
 *  the server itself decides whether the photo's actually small enough to
 *  be worth running through waifu2x, and always returns a properly capped/
 *  encoded JPEG either way, so a caller never needs its own size check.
 *  Returns null on any failure/timeout/missing config, same contract as
 *  companionFetch(). */
async function requestServerUpscale(file) {
  const resp = await companionFetch("/wallpaper-upscale", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    timeoutMs: 60000,
  });
  if (!resp) return null;
  return await resp.blob();
}

async function resizeImageFile(file) {
  if (companionServerConfig()) {
    const upscaled = await requestServerUpscale(file);
    if (upscaled) return upscaled;
  }
  return localResizeImageFile(file);
}

/** Same cache-once-reuse-everywhere shape as loadSoundBuffer()'s
 *  bufferCache - a photo's object URL is created at most once, whether
 *  it's being drawn full-screen or as a tiny Settings-grid thumbnail. */
async function wallpaperObjectUrl(id) {
  if (wallpaperObjectUrls.has(id)) return wallpaperObjectUrls.get(id);
  const record = await loadWallpaperRecord(id);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  wallpaperObjectUrls.set(id, url);
  return url;
}

async function importWallpaperFiles(fileList) {
  const skipped = [];
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith("image/")) {
      skipped.push(file.name);
      continue;
    }
    const id = `wallpaper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const resized = await resizeImageFile(file);
      await saveWallpaperRecord(id, resized);
      wallpaperPhotoIds.push(id);
    } catch (err) {
      skipped.push(file.name);
    }
  }

  renderWallpaperSettings();
  applyWallpaperMode();

  showWallpaperImportHint(skipped.length > 0 ? `Skipped ${skipped.join(", ")} - couldn't be read as an image.` : "");
}

function showWallpaperImportHint(text) {
  const hint = byId("wallpaper-import-hint");
  if (!hint) return;
  hint.textContent = text;
  hint.classList.toggle("hidden", !text);
}

let wallpaperPhotoIndex = -1;
let wallpaperActiveLayer = "a";
let wallpaperRotationHandle = null;
let currentWallpaperPhotoId = null;

/** Crossfades to [photoId] - a no-op if it's already showing, so calling
 *  this on every clock tick (single/scheduled modes - see applyWallpaperMode())
 *  doesn't restart the fade or re-derive the same object URL. Shared by
 *  rotating/single/scheduled so there's exactly one crossfade + accent-
 *  color implementation. */
async function showWallpaperPhoto(photoId) {
  if (!photoId || photoId === currentWallpaperPhotoId) return;
  const url = await wallpaperObjectUrl(photoId);
  if (!url) return;

  const img = new Image();
  const loaded = await new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded) return;

  const nextLayer = byId(wallpaperActiveLayer === "a" ? "wallpaper-bg-b" : "wallpaper-bg-a");
  const prevLayer = byId(wallpaperActiveLayer === "a" ? "wallpaper-bg-a" : "wallpaper-bg-b");
  if (!nextLayer || !prevLayer) return;

  nextLayer.style.backgroundImage = `url("${url}")`;
  nextLayer.classList.add("visible");
  prevLayer.classList.remove("visible");
  wallpaperActiveLayer = wallpaperActiveLayer === "a" ? "b" : "a";
  currentWallpaperPhotoId = photoId;

  wallpaperAccentColor = extractWallpaperAccentColor(img);
  if (lastWeatherData) renderWeather(lastWeatherData); // re-runs the accent precedence check with the new color
}

async function showNextWallpaperPhoto() {
  if (wallpaperPhotoIds.length === 0) return;
  wallpaperPhotoIndex = (wallpaperPhotoIndex + 1) % wallpaperPhotoIds.length;
  await showWallpaperPhoto(wallpaperPhotoIds[wallpaperPhotoIndex]);
}

function stopWallpaperRotation() {
  clearInterval(wallpaperRotationHandle);
  wallpaperRotationHandle = null;
}

function startWallpaperRotation() {
  if (wallpaperPhotoIds.length === 0) return; // No photos imported yet - leave the layer empty.
  if (wallpaperRotationHandle) return; // Already rotating - calling this again shouldn't reset the timer.
  showNextWallpaperPhoto();
  wallpaperRotationHandle = setInterval(showNextWallpaperPhoto, WALLPAPER_ROTATION_INTERVAL_MS);
}

/** [entries] must already be sorted by time ascending. Picks whichever
 *  entry's time-of-day has most recently passed, wrapping around to the
 *  last entry if none have fired yet today - so a schedule always covers
 *  the full 24 hours with no gaps to configure by hand. */
function activeScheduledPhotoId(entries) {
  if (!entries || entries.length === 0) return null;
  const nowMinutes = currentMinutesInTimezone(currentTimezone || undefined);
  let active = entries[entries.length - 1];
  for (const entry of entries) {
    if (minutesFromHHMM(entry.time) > nowMinutes) break;
    active = entry;
  }
  return active.photoId;
}

/** Hides whatever photo is currently showing and drops the wallpaper-
 *  driven accent color back to weather-driven - shared by the black-
 *  background override and by switching modes, so neither has to wait for
 *  the next photo to load before the display looks right again. */
function clearWallpaperLayers() {
  byId("wallpaper-bg-a")?.classList.remove("visible");
  byId("wallpaper-bg-b")?.classList.remove("visible");
  currentWallpaperPhotoId = null;
  wallpaperAccentColor = null;
  if (lastWeatherData) renderWeather(lastWeatherData);
}

/** Called from updateClock() every tick - cheap and idempotent either way
 *  (showWallpaperPhoto() no-ops once the right photo is already showing),
 *  which is what lets Scheduled mode notice a time-of-day boundary
 *  passing without a dedicated timer of its own. The black-background
 *  override short-circuits all of this - the mode/single/schedule state
 *  underneath is left completely alone, so turning the override off
 *  resumes exactly where it was. */
function applyWallpaperMode() {
  if (wallpaperForcedBlack) {
    stopWallpaperRotation();
    if (currentWallpaperPhotoId) clearWallpaperLayers();
    return;
  }
  if (wallpaperPhotoIds.length === 0) {
    stopWallpaperRotation();
    return;
  }
  if (wallpaperMode === "single") {
    stopWallpaperRotation();
    showWallpaperPhoto(wallpaperSingleId && wallpaperPhotoIds.includes(wallpaperSingleId) ? wallpaperSingleId : wallpaperPhotoIds[0]);
  } else if (wallpaperMode === "scheduled") {
    stopWallpaperRotation();
    showWallpaperPhoto(activeScheduledPhotoId(wallpaperSchedule));
  } else {
    startWallpaperRotation();
  }
}

// ---------------------------------------------------------------------------
// Wallpaper settings (Settings page) - the write side of wallpaperMode/
// wallpaperSingleId/wallpaperSchedule above, plus the one thing the
// original echo-dashboard never needed a UI for: actually deleting a
// photo from the library. There, the library was managed on the Aurora
// phone app; here, this IS where photos get imported, so each thumbnail
// gets its own small remove badge in the corner alongside the tap-to-
// select behavior the grid already has.
// ---------------------------------------------------------------------------

// Which photo the schedule "Add" row will use next - a photo grid tap
// means something different depending on mode (see setupWallpaperSettings):
// an immediate single-photo selection in Single mode, vs just staging a
// selection here in Scheduled mode until a time is picked and "Add" is
// pressed.
let wallpaperPendingPhotoId = null;

async function renderWallpaperPhotoGrid() {
  const grid = byId("wallpaper-photo-grid");
  if (!grid) return;
  if (wallpaperPhotoIds.length === 0) {
    grid.innerHTML = '<div class="settings-photo-empty">No photos imported yet</div>';
    return;
  }
  const selectedId = wallpaperMode === "single" ? wallpaperSingleId : wallpaperPendingPhotoId;
  const urls = await Promise.all(wallpaperPhotoIds.map((id) => wallpaperObjectUrl(id)));
  grid.innerHTML = wallpaperPhotoIds
    .map((id, i) => {
      const active = id === selectedId;
      return `<div class="settings-photo-thumb-wrap">
          <button class="settings-photo-thumb${active ? " active" : ""}" type="button" data-photo-id="${escapeHtml(id)}" style="background-image:url('${urls[i]}')" aria-label="Select photo"></button>
          <button class="settings-photo-thumb-remove" type="button" data-photo-id="${escapeHtml(id)}" aria-label="Remove photo">${ICONS.close}</button>
        </div>`;
    })
    .join("");
}

async function renderWallpaperSchedule() {
  const list = byId("wallpaper-schedule-list");
  if (!list) return;
  if (wallpaperSchedule.length === 0) {
    list.innerHTML = '<div class="settings-photo-empty">No scheduled entries yet</div>';
    return;
  }
  const urls = await Promise.all(wallpaperSchedule.map((entry) => wallpaperObjectUrl(entry.photoId)));
  list.innerHTML = wallpaperSchedule
    .map(
      (entry, i) => `<div class="settings-schedule-row" data-photo-id="${escapeHtml(entry.photoId)}" data-time="${escapeHtml(entry.time)}">
          <span class="settings-photo-thumb" style="background-image:url('${urls[i]}')"></span>
          <span class="settings-schedule-time">${escapeHtml(formatTimeOfDay(entry.time))}</span>
          <button class="settings-schedule-remove" type="button" aria-label="Remove scheduled entry">&times;</button>
        </div>`
    )
    .join("");
}

function renderWallpaperSettings() {
  const segmented = byId("wallpaper-mode-segmented");
  if (!segmented) return;

  segmented.querySelectorAll(".settings-segment").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === wallpaperMode);
  });

  const isScheduled = wallpaperMode === "scheduled";
  byId("wallpaper-schedule-add-row")?.classList.toggle("hidden", !isScheduled);
  byId("wallpaper-schedule-list")?.classList.toggle("hidden", !isScheduled);
  // Only meaningful in Rotating mode - shuffling would just get silently
  // overwritten by the next clock tick's applyWallpaperMode() in Single/
  // Scheduled, since those modes always snap back to their own fixed
  // photo rather than whatever showNextWallpaperPhoto() just picked.
  byId("wallpaper-shuffle-btn")?.classList.toggle("hidden", wallpaperMode !== "rotating" || wallpaperPhotoIds.length < 2);
  byId("wallpaper-upscale-btn")?.classList.toggle("hidden", !companionServerConfig() || wallpaperPhotoIds.length === 0);

  renderWallpaperPhotoGrid();
  renderWallpaperSchedule();

  byId("wallpaper-black-toggle")?.setAttribute("aria-checked", String(wallpaperForcedBlack));
}

// ---------------------------------------------------------------------------
// Server-curated wallpaper rotation - an optional trickle of one new photo
// per day from the Companion Server's wallpapers/processed/ folder (drop
// files into wallpapers/inbox/ on the server, see server/README.md; it
// handles resizing/JPEG re-encoding/dedup server-side, same idea as
// resizeImageFile() below just done once centrally instead of per-import).
// Reuses the exact same IndexedDB storage and rotation logic as manually
// imported photos - a server-sourced photo is just another entry in
// wallpaperPhotoIds, distinguished only by its "server-" id prefix so this
// can find and cap its own subset without touching manually imported ones.
// ---------------------------------------------------------------------------
const SERVER_WALLPAPER_LAST_PULL_KEY = "aurora-dashboard:server-wallpaper-last-pull";
const SERVER_WALLPAPER_MAX_COUNT = 15;

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pullServerWallpaper() {
  if (!companionServerConfig()) return;
  const todayKey = localDateKey(new Date());
  if (localStorage.getItem(SERVER_WALLPAPER_LAST_PULL_KEY) === todayKey) return;

  const resp = await companionFetch("/wallpaper/random", { timeoutMs: 15000 });
  if (!resp) return;
  const blob = await resp.blob();
  const hash = await sha256Hex(await blob.arrayBuffer());
  const id = `server-${hash.slice(0, 16)}`;

  localStorage.setItem(SERVER_WALLPAPER_LAST_PULL_KEY, todayKey);
  if (wallpaperPhotoIds.includes(id)) return; // server reshuffled into one already pulled before

  await saveWallpaperRecord(id, blob);
  wallpaperPhotoIds.push(id);

  // Cap how many server-sourced photos accumulate over time - evict the
  // oldest ones first, never touching manually imported ("wallpaper_...")
  // photos, which aren't part of this rotation at all.
  const serverIds = wallpaperPhotoIds.filter((pid) => pid.startsWith("server-"));
  if (serverIds.length > SERVER_WALLPAPER_MAX_COUNT) {
    for (const oldId of serverIds.slice(0, serverIds.length - SERVER_WALLPAPER_MAX_COUNT)) {
      await deleteWallpaperRecord(oldId);
      wallpaperPhotoIds = wallpaperPhotoIds.filter((pid) => pid !== oldId);
      const url = wallpaperObjectUrls.get(oldId);
      if (url) URL.revokeObjectURL(url);
      wallpaperObjectUrls.delete(oldId);
      if (wallpaperSingleId === oldId) {
        wallpaperSingleId = null;
        localStorage.removeItem(WALLPAPER_SINGLE_KEY);
      }
    }
  }
}

/** Retroactively runs every already-imported photo (manual and server-
 *  pulled alike) back through /wallpaper-upscale, replacing each record
 *  in place under its existing id - the set of photos, their ids, and
 *  anything referencing them (Single/Schedule selections) stay exactly as
 *  they were, only the stored bytes improve. wallpaperObjectUrls caches an
 *  object URL per id pointing at the specific Blob instance it was created
 *  from, which a later IndexedDB put() doesn't retroactively change - each
 *  migrated id's cached URL has to be revoked so the next render actually
 *  re-reads the new blob instead of continuing to show the old one. */
async function upscaleExistingWallpapers() {
  if (!companionServerConfig() || wallpaperPhotoIds.length === 0) return;
  const btn = byId("wallpaper-upscale-btn");
  if (btn) btn.disabled = true;

  const ids = [...wallpaperPhotoIds];
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    showWallpaperImportHint(`Upscaling ${done + 1}/${ids.length}...`);
    try {
      const record = await loadWallpaperRecord(id);
      if (!record) continue;
      const upscaled = await requestServerUpscale(record.blob);
      if (!upscaled) {
        failed++;
        continue;
      }
      await saveWallpaperRecord(id, upscaled);
      const oldUrl = wallpaperObjectUrls.get(id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      wallpaperObjectUrls.delete(id);
    } catch (err) {
      failed++;
    }
    done++;
  }

  if (ids.includes(currentWallpaperPhotoId)) {
    // Force the on-screen photo to re-fetch its (now-replaced) object URL
    // rather than waiting for the next rotation/mode re-apply.
    const shownId = currentWallpaperPhotoId;
    currentWallpaperPhotoId = null;
    await showWallpaperPhoto(shownId);
  }

  renderWallpaperPhotoGrid();
  showWallpaperImportHint(
    failed > 0 ? `Upscaled ${done - failed}/${ids.length} - ${failed} couldn't be reached.` : `Upscaled all ${ids.length} photos.`
  );
  if (btn) btn.disabled = false;
}

async function setupWallpaperSettings() {
  const importInput = byId("wallpaper-import-input");
  const importLabel = byId("wallpaper-import-label");
  const segmented = byId("wallpaper-mode-segmented");
  if (!segmented) return;

  if (!window.indexedDB) {
    // Degrade gracefully rather than offering a control that can't work -
    // same "hide, don't half-work" philosophy as Custom Sounds above.
    importLabel?.classList.add("hidden");
    showWallpaperImportHint("Wallpaper needs IndexedDB, which this browser doesn't support.");
    return;
  }

  try {
    const records = await loadAllWallpaperRecords();
    wallpaperPhotoIds = records.map((r) => r.id);
  } catch (err) {
    wallpaperPhotoIds = [];
  }
  pullServerWallpaper();
  renderWallpaperSettings();
  applyWallpaperMode();

  importInput?.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) await importWallpaperFiles(files);
    event.target.value = ""; // lets the same filename be re-imported later
  });

  byId("wallpaper-shuffle-btn")?.addEventListener("click", () => {
    showNextWallpaperPhoto();
    renderWallpaperPhotoGrid(); // the grid's "active" thumbnail follows Single mode's selection, not rotation - no-op there, harmless either way
  });

  byId("wallpaper-upscale-btn")?.addEventListener("click", upscaleExistingWallpapers);

  segmented.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    wallpaperMode = btn.dataset.mode;
    localStorage.setItem(WALLPAPER_MODE_KEY, wallpaperMode);
    renderWallpaperSettings();
    applyWallpaperMode();
  });

  byId("wallpaper-photo-grid")?.addEventListener("click", async (event) => {
    const removeBtn = event.target.closest(".settings-photo-thumb-remove");
    if (removeBtn) {
      const id = removeBtn.dataset.photoId;
      await deleteWallpaperRecord(id);
      wallpaperPhotoIds = wallpaperPhotoIds.filter((p) => p !== id);
      wallpaperSchedule = wallpaperSchedule.filter((entry) => entry.photoId !== id);
      localStorage.setItem(WALLPAPER_SCHEDULE_KEY, JSON.stringify(wallpaperSchedule));
      const url = wallpaperObjectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      wallpaperObjectUrls.delete(id);
      if (wallpaperSingleId === id) {
        wallpaperSingleId = null;
        localStorage.removeItem(WALLPAPER_SINGLE_KEY);
      }
      if (wallpaperPendingPhotoId === id) wallpaperPendingPhotoId = null;
      // A deleted photo that's currently showing has to actually clear -
      // its object URL is gone, so any further reference to it would 404.
      if (currentWallpaperPhotoId === id) clearWallpaperLayers();
      renderWallpaperSettings();
      applyWallpaperMode();
      return;
    }

    const thumb = event.target.closest(".settings-photo-thumb");
    if (!thumb) return;
    const photoId = thumb.dataset.photoId;
    if (wallpaperMode === "scheduled") {
      wallpaperPendingPhotoId = photoId;
      renderWallpaperPhotoGrid();
    } else {
      wallpaperSingleId = photoId;
      localStorage.setItem(WALLPAPER_SINGLE_KEY, photoId);
      renderWallpaperPhotoGrid();
      applyWallpaperMode();
    }
  });

  byId("wallpaper-schedule-add-btn")?.addEventListener("click", () => {
    const time = byId("wallpaper-schedule-time")?.value;
    if (!time || !wallpaperPendingPhotoId) return;
    wallpaperSchedule = [...wallpaperSchedule, { photoId: wallpaperPendingPhotoId, time }].sort((a, b) => a.time.localeCompare(b.time));
    localStorage.setItem(WALLPAPER_SCHEDULE_KEY, JSON.stringify(wallpaperSchedule));
    renderWallpaperSchedule();
    applyWallpaperMode();
  });

  byId("wallpaper-schedule-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".settings-schedule-remove");
    if (!removeBtn) return;
    const row = removeBtn.closest(".settings-schedule-row");
    wallpaperSchedule = wallpaperSchedule.filter(
      (entry) => !(entry.photoId === row.dataset.photoId && entry.time === row.dataset.time)
    );
    localStorage.setItem(WALLPAPER_SCHEDULE_KEY, JSON.stringify(wallpaperSchedule));
    renderWallpaperSchedule();
    applyWallpaperMode();
  });

  const blackToggle = byId("wallpaper-black-toggle");
  if (blackToggle) {
    blackToggle.setAttribute("aria-checked", String(wallpaperForcedBlack));
    blackToggle.addEventListener("click", () => {
      wallpaperForcedBlack = !wallpaperForcedBlack;
      blackToggle.setAttribute("aria-checked", String(wallpaperForcedBlack));
      localStorage.setItem(WALLPAPER_BLACK_KEY, String(wallpaperForcedBlack));
      if (wallpaperForcedBlack) {
        applyWallpaperMode();
      } else {
        currentWallpaperPhotoId = null; // forces showWallpaperPhoto() to actually redraw, not no-op
        applyWallpaperMode();
      }
    });
  }
}

/**
 * Wires one set of Sound Machine controls to the shared playback engine
 * above. Called three times - the compact Overview card, the full control
 * panel on the Clock/Sound page, and Bedside Mode - since all three sets
 * of controls act on the exact same local playback state, just with a
 * different id suffix.
 */
function setupSoundControlsFor(idSuffix) {
  const playPauseButton = byId(`sound-play-pause${idSuffix}`);
  const stopButton = byId(`sound-stop${idSuffix}`);
  const volumeInput = byId(`sound-volume${idSuffix}`);
  const soundPicker = byId(`sound-picker${idSuffix}`);
  const timerPicker = byId(`timer-picker${idSuffix}`);

  playPauseButton?.addEventListener("click", async () => {
    if (isLocallyPlaying) {
      pauseLocalPlayback();
    } else {
      const soundId = soundPicker?.value || currentSoundId || SOUND_LIBRARY[0].id;
      await startLocalPlayback(soundId, currentSoundId === soundId ? playbackOffsetSeconds : 0);
      recordRecentSound(soundId);
    }
    saveSoundState();
    renderSoundMachine();
  });

  stopButton?.addEventListener("click", () => {
    stopLocalPlaybackFully();
    saveSoundState();
    renderSoundMachine();
  });

  soundPicker?.addEventListener("change", async () => {
    const soundId = soundPicker.value;
    if (!soundId) return;
    await startLocalPlayback(soundId, 0);
    recordRecentSound(soundId);
    saveSoundState();
    renderSoundMachine();
  });

  timerPicker?.addEventListener("change", () => {
    startLocalSleepTimer(resolveSleepTimerMinutes(timerPicker.value));
    renderSoundMachine();
  });

  let volumeDebounceHandle = null;
  volumeInput?.addEventListener("input", () => {
    const percent = Number(volumeInput.value);
    setText(`sound-volume-label${idSuffix}`, `${percent}%`);
    setLocalVolume(percent);
    clearTimeout(volumeDebounceHandle);
    volumeDebounceHandle = setTimeout(() => saveSoundState(), VOLUME_DEBOUNCE_MS);
  });
}

// Mute is just "volume 0, remember what it was" - derived from the
// GainNode's own current value for the icon (see renderSoundMachine
// above) rather than a separate tracked boolean, so it can never disagree
// with what's actually playing. Shared across all three UI surfaces
// (Overview card, Clock/Sound page, Bedside overlay) since they all
// reflect the same underlying volume, not three independent ones.
let volumeBeforeMute = null;

function setupMuteButtons() {
  SOUND_MACHINE_ID_SUFFIXES.forEach((suffix) => {
    const muteBtn = byId(`sound-mute${suffix}`);
    const volumeInput = byId(`sound-volume${suffix}`);
    if (!muteBtn || !volumeInput) return;

    muteBtn.addEventListener("click", () => {
      const current = Number(volumeInput.value);
      const target = current > 0 ? 0 : volumeBeforeMute || 50;
      if (current > 0) volumeBeforeMute = current;

      volumeInput.value = String(target);
      setText(`sound-volume-label${suffix}`, `${target}%`);
      setIcon(`volume-icon${suffix}`, target === 0 ? "volumeMuted" : "volume");
      setLocalVolume(target);
      saveSoundState();
    });
  });
}

function setupSoundControls() {
  populateSoundPickers();
  setupSoundControlsFor("");
  setupSoundControlsFor("-lg");
  setupSoundControlsFor("-bedside");
  setupMuteButtons();
  setupRecentSounds();
}

// ---------------------------------------------------------------------------
// Soundscape Mixer - a second Sound Machine mode (segmented alongside
// Single, Clock/Sound page only) that blends up to MIXER_LAYER_COUNT
// sounds together, each with its own volume, instead of just one at a
// time - rain plus a low hum, white noise under ocean waves, whatever
// combination actually works for falling asleep. Reuses the same shared
// AudioContext as the Single-sound engine (ensureAudioContext()), so the
// existing autoplay-unlock handled by the page's pointerdown listener
// covers this for free - but each layer gets its own independent
// GainNode/BufferSourceNode, entirely separate from the Single engine's
// currentSource/gainNode. Starting one engine always stops the other so
// they can never play over each other.
// ---------------------------------------------------------------------------

const MIXER_LAYER_COUNT = 4;
const MIXER_STATE_KEY = "aurora-dashboard:mixer-layers"; // [{soundId, volumePercent}, ...]
const MIXER_PRESETS_KEY = "aurora-dashboard:mixer-presets"; // [{id, name, layers}]

function loadMixerLayers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MIXER_STATE_KEY) || "null");
    if (Array.isArray(parsed) && parsed.length === MIXER_LAYER_COUNT) return parsed;
  } catch (err) {
    // fall through to defaults
  }
  return Array.from({ length: MIXER_LAYER_COUNT }, () => ({ soundId: "", volumePercent: 50 }));
}

let mixerLayers = loadMixerLayers();

function saveMixerLayerState() {
  localStorage.setItem(MIXER_STATE_KEY, JSON.stringify(mixerLayers));
}

function loadMixerPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MIXER_PRESETS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let mixerPresets = loadMixerPresets();

function saveMixerPresets() {
  localStorage.setItem(MIXER_PRESETS_KEY, JSON.stringify(mixerPresets));
}

let mixerPlaying = false;
let mixerSources = new Array(MIXER_LAYER_COUNT).fill(null);
let mixerGains = new Array(MIXER_LAYER_COUNT).fill(null);
let mixerSleepTimerHandle = null;

async function startMixerLayer(index) {
  const layer = mixerLayers[index];
  if (!layer.soundId) return;
  const ctx = ensureAudioContext();
  const buffer = await loadSoundBuffer(layer.soundId);
  // mixerPlaying can have been cleared by a Stop tap while this await was
  // in flight (a custom sound's decodeAudioData() isn't instant) - bail
  // rather than starting a layer nobody asked to hear anymore.
  if (!mixerPlaying) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = layer.volumePercent / 100;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
  mixerSources[index] = source;
  mixerGains[index] = gain;
}

function stopMixerLayer(index) {
  const source = mixerSources[index];
  if (source) {
    try {
      source.stop();
    } catch (err) {
      // Already stopped - fine.
    }
    mixerSources[index] = null;
  }
  mixerGains[index] = null;
}

function cancelMixerSleepTimer() {
  if (mixerSleepTimerHandle) {
    clearTimeout(mixerSleepTimerHandle);
    mixerSleepTimerHandle = null;
  }
}

async function startMixerPlayback() {
  stopLocalPlaybackFully(); // mutual exclusion with the Single engine
  mixerPlaying = true;
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  for (let i = 0; i < MIXER_LAYER_COUNT; i++) {
    await startMixerLayer(i);
  }
}

function stopMixerPlayback() {
  mixerPlaying = false;
  for (let i = 0; i < MIXER_LAYER_COUNT; i++) stopMixerLayer(i);
  cancelMixerSleepTimer();
}

function setMixerLayerVolume(index, percent) {
  mixerLayers[index].volumePercent = percent;
  if (mixerGains[index]) mixerGains[index].gain.value = percent / 100;
}

async function setMixerLayerSound(index, soundId) {
  mixerLayers[index].soundId = soundId;
  if (mixerPlaying) {
    stopMixerLayer(index);
    await startMixerLayer(index);
  }
}

function renderMixerPlayButton() {
  const btn = byId("mixer-play-pause-btn");
  if (!btn) return;
  btn.setAttribute("aria-label", mixerPlaying ? "Stop mix" : "Play mix");
  setIcon("mixer-play-pause-icon", mixerPlaying ? "pause" : "play");
}

function renderMixerLayers() {
  for (let i = 0; i < MIXER_LAYER_COUNT; i++) {
    const picker = byId(`mixer-layer-picker-${i}`);
    if (picker) picker.value = mixerLayers[i].soundId || "";
    const volumeInput = byId(`mixer-layer-volume-${i}`);
    if (volumeInput) volumeInput.value = String(mixerLayers[i].volumePercent);
  }
}

function renderMixerPresets() {
  const container = byId("mixer-presets-row");
  if (!container) return;
  if (mixerPresets.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = mixerPresets
    .map(
      (preset) => `<div class="mixer-preset-chip-wrap">
        <button class="mixer-preset-chip" type="button" data-id="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</button>
        <button class="icon-button-small mixer-preset-remove" type="button" data-id="${escapeHtml(preset.id)}" aria-label="Delete ${escapeHtml(preset.name)}">
          <span class="icon-slot tiny" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

async function applyMixerPreset(preset) {
  mixerLayers = preset.layers.map((layer) => ({ ...layer }));
  saveMixerLayerState();
  renderMixerLayers();
  if (mixerPlaying) {
    stopMixerPlayback();
    await startMixerPlayback();
    renderMixerPlayButton();
  }
}

/** Fetches soundIds/volumes for a typed mood from the Companion Server
 *  (see generate_soundscape() in server.py, which only ever picks from the
 *  real SOUND_LIBRARY ids) and applies it via the exact same
 *  applyMixerPreset() a saved Blend uses - padded/truncated to
 *  MIXER_LAYER_COUNT first, since the model may return fewer than 4. */
async function requestMoodSoundscape() {
  const input = byId("mixer-mood-input");
  const btn = byId("mixer-mood-btn");
  const mood = input?.value.trim();
  if (!mood) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Thinking...";
  }
  const resp = await companionFetch("/soundscape-mood", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mood }),
    timeoutMs: 30000,
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Set Mood";
  }
  if (!resp) return;

  const data = await resp.json();
  const layers = (data.layers || []).slice(0, MIXER_LAYER_COUNT);
  while (layers.length < MIXER_LAYER_COUNT) layers.push({ soundId: "", volumePercent: 50 });
  await applyMixerPreset({ layers });
}

function setupMoodSoundscape() {
  if (!companionServerConfig()) return; // stays hidden - no server, no mood matching
  byId("mixer-mood-row")?.classList.remove("hidden");
  byId("mixer-mood-btn")?.addEventListener("click", requestMoodSoundscape);
  byId("mixer-mood-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") requestMoodSoundscape();
  });
}

function setupSoundscapeMixer() {
  for (let i = 0; i < MIXER_LAYER_COUNT; i++) {
    const picker = byId(`mixer-layer-picker-${i}`);
    picker?.addEventListener("change", async () => {
      await setMixerLayerSound(i, picker.value);
      saveMixerLayerState();
    });

    const volumeInput = byId(`mixer-layer-volume-${i}`);
    volumeInput?.addEventListener("input", () => {
      const percent = Number(volumeInput.value);
      setMixerLayerVolume(i, percent);
      saveMixerLayerState();
    });
  }

  byId("mixer-play-pause-btn")?.addEventListener("click", async () => {
    if (mixerPlaying) {
      stopMixerPlayback();
    } else {
      await startMixerPlayback();
    }
    renderMixerPlayButton();
  });

  byId("mixer-timer-picker")?.addEventListener("change", (event) => {
    cancelMixerSleepTimer();
    const minutes = Number(event.target.value);
    if (!minutes) return;
    mixerSleepTimerHandle = setTimeout(() => {
      mixerSleepTimerHandle = null;
      stopMixerPlayback();
      renderMixerPlayButton();
    }, minutes * 60_000);
  });

  byId("mixer-save-preset-btn")?.addEventListener("click", () => {
    const nameInput = byId("mixer-preset-name-input");
    const name = nameInput?.value.trim();
    if (!name) return;
    mixerPresets.push({ id: `mixerpreset-${Date.now()}`, name, layers: mixerLayers.map((l) => ({ ...l })) });
    saveMixerPresets();
    renderMixerPresets();
    if (nameInput) nameInput.value = "";
  });

  byId("mixer-presets-row")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".mixer-preset-remove");
    if (removeBtn) {
      mixerPresets = mixerPresets.filter((p) => p.id !== removeBtn.dataset.id);
      saveMixerPresets();
      renderMixerPresets();
      return;
    }
    const chip = event.target.closest(".mixer-preset-chip");
    if (!chip) return;
    const preset = mixerPresets.find((p) => p.id === chip.dataset.id);
    if (preset) applyMixerPreset(preset);
  });

  setupMoodSoundscape();

  const segmented = byId("sound-mode-segmented");
  segmented?.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    segmented.querySelectorAll(".settings-segment").forEach((b) => b.classList.toggle("active", b === btn));
    byId("sound-single-view")?.classList.toggle("hidden", btn.dataset.mode !== "single");
    byId("sound-mixer-view")?.classList.toggle("hidden", btn.dataset.mode !== "mixer");
    // Switching modes always stops whichever engine was playing for the
    // OTHER mode - same mutual-exclusion rule as pressing either engine's
    // own Play button, just triggered by the mode switch itself instead.
    if (btn.dataset.mode === "mixer") {
      stopLocalPlaybackFully();
      saveSoundState();
      renderSoundMachine();
    } else {
      stopMixerPlayback();
      renderMixerPlayButton();
    }
  });

  renderMixerLayers();
  renderMixerPresets();
  renderMixerPlayButton();
}

// ---------------------------------------------------------------------------
// Wake Alarms - a self-contained alarm clock, not the phone's stock one
// (there's no phone at all anymore). Pure localStorage; scheduling is
// checked once a minute from the same clock tick that already drives
// everything else (see checkWakeAlarms(), called from updateClock()) -
// this only works while the page itself stays loaded and powered, which
// is exactly the normal condition for an always-on kiosk display.
// ---------------------------------------------------------------------------

const WAKE_ALARMS_KEY = "aurora-dashboard:wake-alarms";
const DEFAULT_ALARM_SOUND_KEY = "aurora-dashboard:default-alarm-sound";

let wakeAlarms = [];
try {
  wakeAlarms = JSON.parse(localStorage.getItem(WAKE_ALARMS_KEY) || "[]");
} catch (err) {
  wakeAlarms = [];
}
// "Chime" rather than one of the ambient sounds - waking up to rain or
// ocean waves is a poor default for something meant to be urgent.
let defaultAlarmSoundId = localStorage.getItem(DEFAULT_ALARM_SOUND_KEY) || "chime";

function saveWakeAlarms() {
  localStorage.setItem(WAKE_ALARMS_KEY, JSON.stringify(wakeAlarms));
}

function setWakeAlarm(alarm) {
  const withId = alarm.id ? alarm : { ...alarm, id: `${Date.now()}` };
  wakeAlarms = wakeAlarms.filter((a) => a.id !== withId.id).concat(withId);
  saveWakeAlarms();
  renderWakeAlarms();
  renderNextWakeAlarmInline();
}

function deleteWakeAlarm(id) {
  wakeAlarms = wakeAlarms.filter((a) => a.id !== id);
  saveWakeAlarms();
  renderWakeAlarms();
  renderNextWakeAlarmInline();
}

function resolveAlarmSoundId(alarm) {
  return alarm.soundId || defaultAlarmSoundId || SOUND_LIBRARY[0].id;
}

/** The next epoch this alarm will actually ring, or null if it never will
 *  (shouldn't happen for an enabled alarm, but a malformed daysOfWeek
 *  shouldn't throw either). One-time alarms (empty daysOfWeek) only ever
 *  look one day ahead - today if the time's still ahead, otherwise
 *  tomorrow, same as WakeAlarm's own doc comment describes. Repeating
 *  alarms look a full week ahead, which is always enough to find a match
 *  even when today's own weekday is selected but its time already passed. */
function nextTriggerEpochForAlarm(alarm, fromEpoch = Date.now()) {
  const repeating = alarm.daysOfWeek && alarm.daysOfWeek.length > 0;
  const maxOffset = repeating ? 7 : 1;
  for (let dayOffset = 0; dayOffset <= maxOffset; dayOffset++) {
    const candidate = new Date(fromEpoch);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(alarm.hour, alarm.minute, 0, 0);
    if (candidate.getTime() <= fromEpoch) continue;
    if (repeating) {
      const calendarDay = candidate.getDay() + 1; // JS Sun=0 -> Calendar.SUNDAY=1
      if (!alarm.daysOfWeek.includes(calendarDay)) continue;
    }
    return candidate.getTime();
  }
  return null;
}

/** The soonest upcoming occurrence across every enabled alarm - drives
 *  both the "Next Alarm" card/inline readouts and the Sound Machine's
 *  "Timer: Alarm" sleep-timer preset. */
function nextWakeAlarmOccurrence() {
  let best = null;
  for (const alarm of wakeAlarms) {
    if (!alarm.enabled) continue;
    const epochMs = nextTriggerEpochForAlarm(alarm);
    if (epochMs == null) continue;
    if (!best || epochMs < best.epochMs) {
      best = {
        epochMs,
        alarm,
        hhmm: `${String(alarm.hour).padStart(2, "0")}:${String(alarm.minute).padStart(2, "0")}`,
      };
    }
  }
  return best;
}

const DAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // index 0 = Calendar.SUNDAY(1)

let selectedWakeAlarmDays = new Set(); // Calendar.DAY_OF_WEEK values (1-7)

function buildWakeAlarmDayToggle() {
  const container = byId("wakealarm-days");
  if (!container) return;

  container.innerHTML = DAY_ABBREVIATIONS.map(
    (abbrev, index) =>
      `<button type="button" class="wakealarm-day-btn" data-day="${index + 1}" aria-label="${abbrev}">${abbrev[0]}</button>`
  ).join("");

  container.querySelectorAll(".wakealarm-day-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = Number(btn.dataset.day);
      if (selectedWakeAlarmDays.has(day)) {
        selectedWakeAlarmDays.delete(day);
      } else {
        selectedWakeAlarmDays.add(day);
      }
      btn.classList.toggle("active");
    });
  });
}

function formatWakeAlarmDays(daysOfWeek) {
  if (!daysOfWeek || daysOfWeek.length === 0) return "Once";
  if (daysOfWeek.length === 7) return "Every day";
  return daysOfWeek
    .slice()
    .sort((a, b) => a - b)
    .map((day) => DAY_ABBREVIATIONS[day - 1])
    .join(", ");
}

function renderWakeAlarms() {
  const list = byId("wakealarm-list");
  if (!list) return;

  if (wakeAlarms.length === 0) {
    list.innerHTML = '<li class="wakealarm-empty">No alarms set</li>';
    return;
  }

  const sorted = wakeAlarms.slice().sort((a, b) => a.hour - b.hour || a.minute - b.minute);
  list.innerHTML = sorted
    .map((alarm) => {
      const time = formatTimeOfDay(`${String(alarm.hour).padStart(2, "0")}:${String(alarm.minute).padStart(2, "0")}`);
      const labelHtml = alarm.label ? `<span class="wakealarm-item-label">${escapeHtml(alarm.label)}</span>` : "";
      const sunriseHtml = alarm.sunriseEnabled
        ? `<span class="icon-slot tiny wakealarm-sunrise-icon" aria-label="Sunrise wake-up">${ICONS.sunny}</span>`
        : "";
      return `<li class="wakealarm-item${alarm.enabled ? "" : " disabled"}" data-id="${escapeHtml(alarm.id)}">
        <input type="checkbox" class="wakealarm-toggle" ${alarm.enabled ? "checked" : ""} aria-label="Enabled" />
        <div class="wakealarm-item-info">
          <div class="wakealarm-item-time-row">
            <span class="wakealarm-item-time">${time}</span>
            ${sunriseHtml}
          </div>
          ${labelHtml}
          <span class="wakealarm-item-days">${escapeHtml(formatWakeAlarmDays(alarm.daysOfWeek))}</span>
        </div>
        <button class="icon-button wakealarm-delete" type="button" aria-label="Delete alarm">
          <span class="icon-slot" aria-hidden="true">${ICONS.trash}</span>
        </button>
      </li>`;
    })
    .join("");
}

function setupWakeAlarmList() {
  const list = byId("wakealarm-list");
  if (!list) return;

  list.addEventListener("change", (event) => {
    if (!event.target.classList.contains("wakealarm-toggle")) return;
    const id = event.target.closest("[data-id]")?.dataset.id;
    const alarm = id && wakeAlarms.find((a) => a.id === id);
    if (!alarm) return;
    setWakeAlarm({ ...alarm, enabled: event.target.checked });
  });

  list.addEventListener("click", (event) => {
    if (!event.target.closest(".wakealarm-delete")) return;
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (id) deleteWakeAlarm(id);
  });
}

/** Reflects the currently-configured default alarm sound in the picker,
 *  unless the user is mid-selection (same "don't fight an active
 *  interaction" rule as syncRangeInputIfIdle/syncPickerIfIdle above). */
function syncDefaultAlarmSoundPicker() {
  const picker = byId("wakealarm-default-sound-picker");
  if (!picker || document.activeElement === picker) return;
  if ([...picker.options].some((opt) => opt.value === defaultAlarmSoundId)) {
    picker.value = defaultAlarmSoundId;
  }
}

function setupWakeAlarmForm() {
  setIcon("wakealarms-title-icon", "alarm");
  setIcon("wakealarm-add-icon", "plus");
  setIcon("wakealarm-default-sound-preview-icon", "play");
  setIcon("wakealarm-sound-preview-icon", "play");
  setupAlarmSoundPreviewButtons();
  buildWakeAlarmDayToggle();
  setupWakeAlarmList();
  syncDefaultAlarmSoundPicker();

  // This kiosk's WebView doesn't paint an empty <input type="time">'s
  // placeholder digits at all (unlike desktop Chrome's "--:-- --") - it
  // just renders a blank box until a value exists, which reads as broken
  // rather than as an unset field. A sensible starting value sidesteps
  // that entirely; the native picker (confirmed working - tapping it
  // opens the OS clock dialog) is how the user actually changes it.
  const timeInput = byId("wakealarm-time-input");
  if (timeInput && !timeInput.value) timeInput.value = "07:00";

  byId("wakealarm-default-sound-picker")?.addEventListener("change", (event) => {
    defaultAlarmSoundId = event.target.value;
    localStorage.setItem(DEFAULT_ALARM_SOUND_KEY, defaultAlarmSoundId);
  });

  const sunriseToggle = byId("wakealarm-sunrise-toggle");
  sunriseToggle?.addEventListener("click", () => {
    sunriseToggle.setAttribute("aria-checked", String(sunriseToggle.getAttribute("aria-checked") !== "true"));
  });

  byId("wakealarm-add-btn")?.addEventListener("click", () => {
    const timeInput = byId("wakealarm-time-input");
    const labelInput = byId("wakealarm-label-input");
    const soundPicker = byId("wakealarm-sound-picker");
    const [hour, minute] = (timeInput?.value || "").split(":").map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return;

    setWakeAlarm({
      id: null,
      hour,
      minute,
      daysOfWeek: Array.from(selectedWakeAlarmDays),
      enabled: true,
      label: labelInput?.value.trim() || "",
      soundId: soundPicker?.value || null,
      sunriseEnabled: sunriseToggle?.getAttribute("aria-checked") === "true",
    });

    if (labelInput) labelInput.value = "";
    selectedWakeAlarmDays = new Set();
    byId("wakealarm-days")
      ?.querySelectorAll(".wakealarm-day-btn.active")
      .forEach((btn) => btn.classList.remove("active"));
    sunriseToggle?.setAttribute("aria-checked", "false");
  });
}

// ---- Sound preview ----------------------------------------------------
// A small play/stop button next to each alarm sound picker, so you can
// hear what you're about to set as an alarm without waiting for one to
// actually ring. Its own AudioContext/gain, independent of both the
// ambient Sound Machine and the alarm-ringing engine below, so previewing
// a sound can never interfere with (or get interfered with by) whatever
// either of those is doing at the time.

const ALARM_PREVIEW_DURATION_MS = 4000;
let alarmPreviewAudioContext = null;
let alarmPreviewSource = null;
let alarmPreviewTimeoutHandle = null;
let alarmPreviewActive = null; // {btnId, iconId} for whichever button is currently playing, or null

function stopAlarmSoundPreview() {
  if (alarmPreviewSource) {
    try {
      alarmPreviewSource.onended = null; // about to stop it ourselves - the natural "ended" handler would just re-run this
      alarmPreviewSource.stop();
    } catch (err) {
      // Already stopped/ended - fine, that's the state we wanted anyway.
    }
    alarmPreviewSource = null;
  }
  if (alarmPreviewTimeoutHandle) {
    clearTimeout(alarmPreviewTimeoutHandle);
    alarmPreviewTimeoutHandle = null;
  }
  if (alarmPreviewActive) {
    byId(alarmPreviewActive.btnId)?.setAttribute("aria-pressed", "false");
    setIcon(alarmPreviewActive.iconId, "play");
    alarmPreviewActive = null;
  }
}

/** [btnId]/[iconId] identify which of the two preview buttons was pressed,
 *  purely so the icon/aria-pressed can be reset correctly - clicking
 *  either button while the other is previewing stops the first one first
 *  (only one preview plays at a time), same as toggling either off. */
async function toggleAlarmSoundPreview(soundId, btnId, iconId) {
  const wasThisOnePlaying = alarmPreviewActive?.btnId === btnId;
  stopAlarmSoundPreview();
  if (wasThisOnePlaying) return;

  if (!alarmPreviewAudioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    alarmPreviewAudioContext = new AudioContextCtor();
  }
  if (alarmPreviewAudioContext.state === "suspended") {
    alarmPreviewAudioContext.resume().catch(() => {});
  }

  const buffer = await loadSoundBuffer(soundId);
  const source = alarmPreviewAudioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(alarmPreviewAudioContext.destination);
  source.onended = stopAlarmSoundPreview; // a short buffer (e.g. Chime) finishing on its own, before the timeout below
  source.start(0);
  alarmPreviewSource = source;
  alarmPreviewActive = { btnId, iconId };

  byId(btnId)?.setAttribute("aria-pressed", "true");
  setIcon(iconId, "pause");
  // Caps how long a long ambient loop or a multi-minute custom song plays
  // for - this is a preview, not actually starting the alarm early.
  alarmPreviewTimeoutHandle = setTimeout(stopAlarmSoundPreview, ALARM_PREVIEW_DURATION_MS);
}

function setupAlarmSoundPreviewButtons() {
  byId("wakealarm-default-sound-preview-btn")?.addEventListener("click", () => {
    const soundId = byId("wakealarm-default-sound-picker")?.value;
    if (soundId) toggleAlarmSoundPreview(soundId, "wakealarm-default-sound-preview-btn", "wakealarm-default-sound-preview-icon");
  });
  byId("wakealarm-sound-preview-btn")?.addEventListener("click", () => {
    // Empty value means "Default" (see populateSoundPickers()) - preview
    // what the alarm would actually ring with, same fallback as
    // resolveAlarmSoundId(), rather than silently doing nothing.
    const soundId = byId("wakealarm-sound-picker")?.value || defaultAlarmSoundId || SOUND_LIBRARY[0].id;
    if (soundId) toggleAlarmSoundPreview(soundId, "wakealarm-sound-preview-btn", "wakealarm-sound-preview-icon");
  });
}

// ---- Ringing --------------------------------------------------------------
// A separate AudioContext/gain from the ambient sound engine above, on
// purpose: an alarm needs to ring at a fixed, reliably loud volume
// regardless of whatever the ambient volume slider is set to.

let wakeAlarmAudioContext = null;
let wakeAlarmGainNode = null;
let wakeAlarmSource = null;
let isAlarmRinging = false;
let ringingLabel = "";
let ringingSoundId = null;

// Starts quiet rather than snapping to full volume - a real bedside alarm
// clock rings, it doesn't blast - and ramps up over this long, so even a
// deep sleeper who misses the first few seconds still gets full volume
// well before it'd be worth ignoring the whole point of an alarm.
const WAKE_ALARM_START_GAIN = 0.08;
const WAKE_ALARM_RAMP_SECONDS = 45;

function ensureWakeAlarmAudioContext() {
  if (!wakeAlarmAudioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    wakeAlarmAudioContext = new AudioContextCtor();
    wakeAlarmGainNode = wakeAlarmAudioContext.createGain();
    wakeAlarmGainNode.connect(wakeAlarmAudioContext.destination);
    wakeAlarmGainNode.gain.value = WAKE_ALARM_START_GAIN;
  }
  return wakeAlarmAudioContext;
}

/** Same "never gate on ctx.state" fix as startLocalPlayback() above - see
 *  its doc comment. An alarm silently failing to sound until a second,
 *  unrelated touch is an even worse outcome than the ambient sound
 *  machine doing the same, so this gets the identical treatment. */
async function startWakeAlarmSound(soundId) {
  const ctx = ensureWakeAlarmAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const buffer = await loadSoundBuffer(soundId || defaultAlarmSoundId);
  stopWakeAlarmSound();

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(wakeAlarmGainNode);
  source.start(0);
  wakeAlarmSource = source;

  const now = ctx.currentTime;
  wakeAlarmGainNode.gain.cancelScheduledValues(now);
  wakeAlarmGainNode.gain.setValueAtTime(WAKE_ALARM_START_GAIN, now);
  wakeAlarmGainNode.gain.linearRampToValueAtTime(1, now + WAKE_ALARM_RAMP_SECONDS);
}

// Screen brightness ramps alongside the audio gain ramp above - same
// motivation (a jarring full-brightness flash is as rude a wake-up as a
// blast of full-volume sound), same duration, just driven by setInterval
// since Fully's setScreenBrightness is a plain imperative call, not a Web
// Audio param that supports its own scheduling.
const WAKE_ALARM_BRIGHTNESS_START = 15;
const WAKE_ALARM_BRIGHTNESS_TICK_MS = 1000;
let wakeAlarmBrightnessInterval = null;

function startAlarmBrightnessRamp() {
  if (!window.fully || typeof window.fully.setScreenBrightness !== "function") return;
  stopAlarmBrightnessRamp();
  const startTime = Date.now();
  const durationMs = WAKE_ALARM_RAMP_SECONDS * 1000;
  window.fully.setScreenBrightness(WAKE_ALARM_BRIGHTNESS_START);
  wakeAlarmBrightnessInterval = setInterval(() => {
    const progress = Math.min((Date.now() - startTime) / durationMs, 1);
    const brightness = Math.round(
      WAKE_ALARM_BRIGHTNESS_START + (DAY_SCREEN_BRIGHTNESS - WAKE_ALARM_BRIGHTNESS_START) * progress
    );
    window.fully.setScreenBrightness(brightness);
    if (progress >= 1) stopAlarmBrightnessRamp();
  }, WAKE_ALARM_BRIGHTNESS_TICK_MS);
}

function stopAlarmBrightnessRamp() {
  if (!wakeAlarmBrightnessInterval) return;
  clearInterval(wakeAlarmBrightnessInterval);
  wakeAlarmBrightnessInterval = null;
}

function stopWakeAlarmSound() {
  if (!wakeAlarmSource) return;
  try {
    wakeAlarmSource.stop();
  } catch (err) {
    // Already stopped - fine.
  }
  wakeAlarmSource.disconnect();
  wakeAlarmSource = null;
}

function showAlarmRingingOverlay(label) {
  const overlay = byId("alarm-ringing-overlay");
  if (!overlay) return;
  setText("alarm-ringing-label", label || "Alarm");
  overlay.classList.remove("hidden");
}

function hideAlarmRingingOverlay() {
  byId("alarm-ringing-overlay")?.classList.add("hidden");
}

/** Actually starts an alarm ringing - called from checkWakeAlarms() below,
 *  either for a real scheduled alarm or a snooze. Stops the ambient sound
 *  machine unconditionally first (a ringing alarm always wins), same as
 *  this dashboard has always done. */
function startWakeAlarmRinging(label, soundId) {
  isAlarmRinging = true;
  ringingLabel = label || "Alarm";
  ringingSoundId = soundId;

  stopSunriseAlarm();
  stopLocalPlaybackFully();
  saveSoundState();
  renderSoundMachine();
  startWakeAlarmSound(soundId);
  startAlarmBrightnessRamp();
  showAlarmRingingOverlay(ringingLabel);
  // A ringing alarm needs the full-screen dismiss/snooze overlay visible
  // and audible - staying in Bedside Mode's own dim, quiet view would bury
  // it, so an active bedside session's visual state ends the moment an
  // alarm goes off. The sleep *session* itself stays open though
  // (endSession=false) - you're not actually up yet, just ringing; it only
  // ends once dismissWakeAlarm() fires, not on every snooze.
  if (document.body.classList.contains("bedside-active")) {
    exitBedsideMode(false);
  }
}

function stopWakeAlarmRinging() {
  isAlarmRinging = false;
  ringingSoundId = null;
  stopWakeAlarmSound();
  stopAlarmBrightnessRamp();
  // Re-evaluate day/night brightness from scratch rather than leaving the
  // screen wherever the ramp left it - if it's still nighttime, this puts
  // it back to the dim level instead of stuck bright post-dismiss.
  isNightMode = null;
  applyDayNightMode();
  hideAlarmRingingOverlay();
}

// A one-off, unscheduled re-ring - not a stored alarm, so it isn't shown
// in the list and doesn't survive a reload (an edge case rare and low-
// stakes enough not to be worth persisting for).
let snoozeState = null; // {epochMs, soundId, label} | null

let lastWakeAlarmCheckMinuteKey = null;

/** Checked once a minute (guarded by lastWakeAlarmCheckMinuteKey) from
 *  every clock tick - this dashboard's alarm scheduler, replacing
 *  Aurora's own AlarmManager-backed one now that there's no phone to run
 *  it on. Only works while this page stays loaded, which is the normal
 *  condition for an always-on kiosk. */
function checkWakeAlarms() {
  if (isAlarmRinging) return;

  if (snoozeState && Date.now() >= snoozeState.epochMs) {
    const { soundId, label } = snoozeState;
    snoozeState = null;
    startWakeAlarmRinging(label, soundId);
    return;
  }

  const now = new Date();
  const minuteKey = `${localDateKey(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (minuteKey === lastWakeAlarmCheckMinuteKey) return;
  lastWakeAlarmCheckMinuteKey = minuteKey;

  const calendarDay = now.getDay() + 1;
  const match = wakeAlarms.find(
    (alarm) =>
      alarm.enabled &&
      alarm.hour === now.getHours() &&
      alarm.minute === now.getMinutes() &&
      (!alarm.daysOfWeek || alarm.daysOfWeek.length === 0 || alarm.daysOfWeek.includes(calendarDay))
  );
  if (!match) return;

  startWakeAlarmRinging(match.label, resolveAlarmSoundId(match));

  // One-time alarms disable themselves after firing, same as a normal
  // clock app; repeating ones just continue.
  if (!match.daysOfWeek || match.daysOfWeek.length === 0) {
    setWakeAlarm({ ...match, enabled: false });
  }
}

// ---------------------------------------------------------------------------
// Sunrise Alarm - an optional per-alarm "Sunrise wake-up" toggle. When on,
// the screen gradually brightens and warms in color over the configured
// window (Wake Alarms page's "Sunrise length" picker) leading up to that
// alarm's trigger time - silent, just light, like a Hatch/Philips wake-up
// lamp built into the display already sitting on the nightstand. Checked
// on the same once-a-minute cadence as checkWakeAlarms() (called right
// alongside it from updateClock()), and always yields cleanly to the real
// ringing overlay the moment the alarm itself actually fires (see
// startWakeAlarmRinging()).
// ---------------------------------------------------------------------------

const SUNRISE_DURATION_KEY = "aurora-dashboard:sunrise-duration-minutes";
let sunriseDurationMinutes = parseInt(localStorage.getItem(SUNRISE_DURATION_KEY), 10) || 25;

const SUNRISE_BRIGHTNESS_START = 5;

// Four matching color stops (near-horizon -> zenith) for night vs. full
// dawn - sunriseGradientAt() blends between them by progress, interpolating
// each stop's RGB independently, so the whole sky brightens and warms
// together rather than as a flat color swap.
const SUNRISE_NIGHT_STOPS = [
  [8, 8, 24],
  [4, 4, 16],
  [2, 2, 10],
  [0, 0, 6],
];
const SUNRISE_DAWN_STOPS = [
  [255, 197, 143],
  [255, 154, 128],
  [246, 173, 176],
  [148, 174, 214],
];

function sunriseGradientAt(progress) {
  const stops = SUNRISE_NIGHT_STOPS.map((nightRgb, i) => {
    const dawnRgb = SUNRISE_DAWN_STOPS[i];
    const r = Math.round(nightRgb[0] + (dawnRgb[0] - nightRgb[0]) * progress);
    const g = Math.round(nightRgb[1] + (dawnRgb[1] - nightRgb[1]) * progress);
    const b = Math.round(nightRgb[2] + (dawnRgb[2] - nightRgb[2]) * progress);
    return `rgb(${r}, ${g}, ${b})`;
  });
  return `linear-gradient(to top, ${stops[0]} 0%, ${stops[1]} 35%, ${stops[2]} 65%, ${stops[3]} 100%)`;
}

let sunriseActiveAlarmId = null;
let sunriseSkippedTriggerEpoch = null; // a manually-skipped occurrence, so it doesn't immediately restart

function updateSunriseOverlay(progress) {
  const overlay = byId("sunrise-overlay");
  if (overlay) overlay.style.background = sunriseGradientAt(progress);
  if (window.fully && typeof window.fully.setScreenBrightness === "function") {
    const brightness = Math.round(SUNRISE_BRIGHTNESS_START + (DAY_SCREEN_BRIGHTNESS - SUNRISE_BRIGHTNESS_START) * progress);
    window.fully.setScreenBrightness(brightness);
  }
}

function startSunriseAlarm(alarmId) {
  sunriseActiveAlarmId = alarmId;
  byId("sunrise-overlay")?.classList.remove("hidden");
  updateSunriseOverlay(0);
}

function stopSunriseAlarm() {
  if (!sunriseActiveAlarmId) return;
  sunriseActiveAlarmId = null;
  byId("sunrise-overlay")?.classList.add("hidden");
  // Same reasoning as stopWakeAlarmRinging() - re-derive from scratch
  // rather than leaving brightness wherever the ramp stopped.
  isNightMode = null;
  applyDayNightMode();
}

/** Checked alongside checkWakeAlarms() from every clock tick (its own
 *  once-a-minute throttle below keeps this cheap). Finds the soonest
 *  enabled, sunrise-enabled alarm whose trigger time falls within the
 *  configured window from now, and keeps the overlay's progress in sync
 *  with it - or tears the overlay down if nothing currently qualifies
 *  (the window closed, the alarm got disabled/deleted, or it was skipped). */
let lastSunriseCheckMinuteKey = null;

function checkSunriseAlarms() {
  if (isAlarmRinging) {
    stopSunriseAlarm();
    return;
  }

  const now = new Date();
  const minuteKey = `${localDateKey(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (minuteKey === lastSunriseCheckMinuteKey) return;
  lastSunriseCheckMinuteKey = minuteKey;

  const nowMs = Date.now();
  const durationMs = sunriseDurationMinutes * 60000;
  let best = null;
  for (const alarm of wakeAlarms) {
    if (!alarm.enabled || !alarm.sunriseEnabled) continue;
    const triggerEpoch = nextTriggerEpochForAlarm(alarm);
    if (triggerEpoch == null) continue;
    if (triggerEpoch === sunriseSkippedTriggerEpoch) continue;
    const windowStart = triggerEpoch - durationMs;
    if (nowMs < windowStart || nowMs >= triggerEpoch) continue;
    if (!best || triggerEpoch < best.triggerEpoch) best = { alarm, triggerEpoch, windowStart };
  }

  if (!best) {
    stopSunriseAlarm();
    return;
  }

  if (sunriseActiveAlarmId !== best.alarm.id) startSunriseAlarm(best.alarm.id);
  const progress = Math.min(1, Math.max(0, (nowMs - best.windowStart) / durationMs));
  updateSunriseOverlay(progress);
}

function setupSunriseAlarm() {
  const durationPicker = byId("wakealarm-sunrise-duration-picker");
  if (durationPicker) {
    durationPicker.value = String(sunriseDurationMinutes);
    durationPicker.addEventListener("change", () => {
      sunriseDurationMinutes = parseInt(durationPicker.value, 10) || 25;
      localStorage.setItem(SUNRISE_DURATION_KEY, String(sunriseDurationMinutes));
    });
  }

  byId("sunrise-skip-btn")?.addEventListener("click", () => {
    if (sunriseActiveAlarmId) {
      const alarm = wakeAlarms.find((a) => a.id === sunriseActiveAlarmId);
      if (alarm) sunriseSkippedTriggerEpoch = nextTriggerEpochForAlarm(alarm);
    }
    stopSunriseAlarm();
  });
}

const SNOOZE_DURATION_KEY = "aurora-dashboard:snooze-duration";

function dismissWakeAlarm() {
  // Actually getting up, not just snoozing - see startWakeAlarmRinging()'s
  // exitBedsideMode(false) call for why the session wasn't already closed.
  endSleepSession();
  stopWakeAlarmRinging();
}

function snoozeWakeAlarm() {
  const minutes = Number(byId("alarm-snooze-duration")?.value || "9");
  snoozeState = { epochMs: Date.now() + minutes * 60_000, soundId: ringingSoundId, label: ringingLabel };
  recordSnoozeEvent();
  renderSleepHistory();
  stopWakeAlarmRinging();
}

function setupWakeAlarmRingingControls() {
  setIcon("alarm-ringing-icon", "alarm");

  const durationPicker = byId("alarm-snooze-duration");
  const savedDuration = localStorage.getItem(SNOOZE_DURATION_KEY);
  if (durationPicker && savedDuration) durationPicker.value = savedDuration;
  durationPicker?.addEventListener("change", () => {
    localStorage.setItem(SNOOZE_DURATION_KEY, durationPicker.value);
  });

  byId("alarm-dismiss-btn")?.addEventListener("click", dismissWakeAlarm);
  byId("alarm-snooze-btn")?.addEventListener("click", snoozeWakeAlarm);

  // Tap-ANYTHING-to-dismiss - the whole point of a ringing alarm is that
  // you're half-asleep in the dark, exactly the condition under which
  // aiming for a specific small button is hardest. Snooze stays a
  // deliberate, separate tap on its own (still distinct) button, so a
  // stray touch actually gets you up rather than quietly buying another
  // 9 minutes. Excludes the dismiss button, snooze button, and duration
  // picker themselves so this doesn't double-fire alongside their own
  // click handlers above.
  byId("alarm-ringing-overlay")?.addEventListener("click", (event) => {
    if (event.target.closest("#alarm-dismiss-btn, #alarm-snooze-btn, #alarm-snooze-duration")) return;
    dismissWakeAlarm();
  });
}

// ---------------------------------------------------------------------------
// Timer & Stopwatch (own page) - dashboard-only, no Aurora involvement.
// Both track an epoch (when the current run started/will end) and compute
// elapsed/remaining from Date.now() on every tick, rather than
// incrementing/decrementing a counter each time the interval fires - that
// way neither drifts if a tick ever runs late (a throttled tab, a slow
// frame), since the displayed value is always freshly derived from real
// wall-clock time.
// ---------------------------------------------------------------------------

/** A short, fixed-volume beep for the countdown timer finishing - reuses
 *  the Sound Machine's shared AudioContext (see ensureAudioContext())
 *  rather than opening a second one, but its own GainNode straight to the
 *  destination, so muting/lowering the ambient sound doesn't also
 *  silence the timer alert. */
function playTimerBeep() {
  const ctx = ensureAudioContext();
  const beepGain = ctx.createGain();
  beepGain.gain.value = 0.25;
  beepGain.connect(ctx.destination);
  [0, 0.35, 0.7].forEach((offset) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(beepGain);
    const startAt = ctx.currentTime + offset;
    osc.start(startAt);
    osc.stop(startAt + 0.25);
  });
}

function formatClockDisplay(totalSeconds, tenths) {
  const clamped = Math.max(0, totalSeconds);
  const seconds = clamped % 60;
  const minutes = Math.floor(clamped / 60);
  const hours = Math.floor(minutes / 60);
  const mm = String(hours > 0 ? minutes % 60 : minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  const base = hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  return tenths == null ? base : `${base}.${tenths}`;
}

let timerDurationSeconds = 300;
let timerRemainingSeconds = 300;
let timerEndAt = null;
let timerHandle = null;
let timerRingingHandle = null; // repeats the chime after hitting zero, until dismissed

function renderTimerDisplay() {
  const display = byId("timer-display");
  if (!display) return;
  display.textContent = formatClockDisplay(timerRemainingSeconds);
  display.classList.toggle("timer-running", Boolean(timerHandle));
  display.classList.toggle("timer-done", Boolean(timerRingingHandle));
}

function stopTimerInterval() {
  clearInterval(timerHandle);
  timerHandle = null;
}

/** Stops the repeating post-zero chime (see startTimerRinging()) without
 *  touching timerRemainingSeconds - callers decide separately whether to
 *  also reset the duration (resetTimer()) or leave it at zero (dismissing
 *  via the Start/Dismiss button, ready for the next "Start" to re-arm). */
function stopTimerRinging() {
  clearInterval(timerRingingHandle);
  timerRingingHandle = null;
}

/** A single triple-beep (playTimerBeep()) is easy to miss if you're not in
 *  the room - this keeps it going every few seconds, same "ring until you
 *  do something about it" idea as a Wake Alarm, until Dismiss or Reset. */
function startTimerRinging() {
  playTimerBeep();
  timerRingingHandle = setInterval(playTimerBeep, 4000);
  setText("timer-start-btn", "Dismiss");
  renderTimerDisplay();
}

function tickTimer() {
  timerRemainingSeconds = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
  if (timerRemainingSeconds === 0) {
    stopTimerInterval();
    timerEndAt = null;
    startTimerRinging();
  }
  renderTimerDisplay();
}

function startTimer() {
  if (timerRemainingSeconds === 0) timerRemainingSeconds = timerDurationSeconds;
  timerEndAt = Date.now() + timerRemainingSeconds * 1000;
  timerHandle = setInterval(tickTimer, 250);
  setText("timer-start-btn", "Pause");
  renderTimerDisplay();
}

function pauseTimer() {
  timerRemainingSeconds = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
  stopTimerInterval();
  timerEndAt = null;
  setText("timer-start-btn", "Start");
  renderTimerDisplay();
}

function resetTimer() {
  stopTimerInterval();
  stopTimerRinging();
  timerEndAt = null;
  timerRemainingSeconds = timerDurationSeconds;
  setText("timer-start-btn", "Start");
  renderTimerDisplay();
}

function setupTimer() {
  renderTimerDisplay();

  byId("timer-presets")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".timer-preset-btn");
    if (!btn) return;
    timerDurationSeconds = Number(btn.dataset.minutes) * 60;
    resetTimer();
    byId("timer-presets")
      ?.querySelectorAll(".timer-preset-btn")
      .forEach((b) => b.classList.toggle("active", b === btn));
  });

  byId("timer-start-btn")?.addEventListener("click", () => {
    if (timerRingingHandle) {
      stopTimerRinging();
      setText("timer-start-btn", "Start");
      renderTimerDisplay();
    } else if (timerHandle) {
      pauseTimer();
    } else {
      startTimer();
    }
  });
  byId("timer-reset-btn")?.addEventListener("click", resetTimer);
}

// ---------------------------------------------------------------------------
// Custom Timer Presets - named durations ("Tea - 3 min") beyond the fixed
// 1/5/10/15/30/60 buttons. Rendered as real .timer-preset-btn elements
// inside the same #timer-presets row (via #timer-custom-presets, styled
// display:contents so they're true flex siblings, not nested in a box) -
// the existing generic click handler in setupTimer() already selects by
// class and reads data-minutes, so a custom preset needs no special-cased
// click handling of its own, only rendering. Add/remove management lives
// in its own popover so the Timer page itself never grows a second row of
// controls just for that.
// ---------------------------------------------------------------------------

const TIMER_CUSTOM_PRESETS_KEY = "aurora-dashboard:timer-custom-presets";

function loadCustomTimerPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMER_CUSTOM_PRESETS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let customTimerPresets = loadCustomTimerPresets();

function saveCustomTimerPresets() {
  localStorage.setItem(TIMER_CUSTOM_PRESETS_KEY, JSON.stringify(customTimerPresets));
}

function renderCustomTimerPresets() {
  const chips = byId("timer-custom-presets");
  if (chips) {
    chips.innerHTML = customTimerPresets
      .map((preset) => `<button class="timer-preset-btn" type="button" data-minutes="${preset.minutes}">${escapeHtml(preset.label)}</button>`)
      .join("");
  }

  const list = byId("timer-preset-list");
  if (!list) return;
  if (customTimerPresets.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No custom presets yet</div>';
    return;
  }
  list.innerHTML = customTimerPresets
    .map(
      (preset, index) => `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(preset.label)} — ${preset.minutes} min</span>
        <button class="icon-button timer-preset-remove" type="button" aria-label="Remove ${escapeHtml(preset.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function openTimerPresetPopover() {
  byId("timer-preset-popover")?.classList.remove("hidden");
  byId("timer-preset-backdrop")?.classList.remove("hidden");
}

function closeTimerPresetPopover() {
  byId("timer-preset-popover")?.classList.add("hidden");
  byId("timer-preset-backdrop")?.classList.add("hidden");
}

function setupTimerPresets() {
  renderCustomTimerPresets();

  byId("timer-preset-manage-btn")?.addEventListener("click", openTimerPresetPopover);
  byId("timer-preset-popover-close")?.addEventListener("click", closeTimerPresetPopover);
  byId("timer-preset-backdrop")?.addEventListener("click", closeTimerPresetPopover);

  byId("timer-preset-add-confirm-btn")?.addEventListener("click", () => {
    const labelInput = byId("timer-preset-add-label");
    const minutesInput = byId("timer-preset-add-minutes");
    const label = labelInput?.value.trim();
    const minutes = Number(minutesInput?.value);
    if (!label || !Number.isFinite(minutes) || minutes <= 0) return;
    customTimerPresets.push({ label, minutes: Math.round(minutes) });
    saveCustomTimerPresets();
    renderCustomTimerPresets();
    if (labelInput) labelInput.value = "";
    if (minutesInput) minutesInput.value = "";
  });

  byId("timer-preset-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".timer-preset-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    customTimerPresets.splice(index, 1);
    saveCustomTimerPresets();
    renderCustomTimerPresets();
  });
}

let stopwatchElapsedMs = 0;
let stopwatchStartedAt = null;
let stopwatchHandle = null;
let stopwatchLaps = [];

function currentStopwatchElapsedMs() {
  return stopwatchElapsedMs + (stopwatchStartedAt ? Date.now() - stopwatchStartedAt : 0);
}

function renderStopwatchDisplay() {
  const display = byId("stopwatch-display");
  if (!display) return;
  const ms = currentStopwatchElapsedMs();
  display.textContent = formatClockDisplay(Math.floor(ms / 1000), Math.floor((ms % 1000) / 100));
  display.classList.toggle("timer-running", Boolean(stopwatchStartedAt));
}

function renderStopwatchLaps() {
  const list = byId("stopwatch-laps");
  if (!list) return;
  list.innerHTML = stopwatchLaps
    .map((lapMs, index) => {
      const label = formatClockDisplay(Math.floor(lapMs / 1000), Math.floor((lapMs % 1000) / 100));
      return `<li><span>Lap ${index + 1}</span><span>${escapeHtml(label)}</span></li>`;
    })
    .join("");
}

function setupStopwatch() {
  renderStopwatchDisplay();

  byId("stopwatch-start-btn")?.addEventListener("click", () => {
    const lapBtn = byId("stopwatch-lap-btn");
    if (stopwatchStartedAt) {
      stopwatchElapsedMs = currentStopwatchElapsedMs();
      stopwatchStartedAt = null;
      clearInterval(stopwatchHandle);
      stopwatchHandle = null;
      setText("stopwatch-start-btn", "Start");
      if (lapBtn) lapBtn.disabled = true;
    } else {
      stopwatchStartedAt = Date.now();
      stopwatchHandle = setInterval(renderStopwatchDisplay, 100);
      setText("stopwatch-start-btn", "Pause");
      if (lapBtn) lapBtn.disabled = false;
    }
    renderStopwatchDisplay();
  });

  byId("stopwatch-lap-btn")?.addEventListener("click", () => {
    if (!stopwatchStartedAt) return;
    stopwatchLaps.push(currentStopwatchElapsedMs());
    renderStopwatchLaps();
  });

  byId("stopwatch-reset-btn")?.addEventListener("click", () => {
    clearInterval(stopwatchHandle);
    stopwatchHandle = null;
    stopwatchStartedAt = null;
    stopwatchElapsedMs = 0;
    stopwatchLaps = [];
    setText("stopwatch-start-btn", "Start");
    const lapBtn = byId("stopwatch-lap-btn");
    if (lapBtn) lapBtn.disabled = true;
    renderStopwatchDisplay();
    renderStopwatchLaps();
  });
}

function setupTimerPage() {
  setupTimer();
  setupTimerPresets();
  setupStopwatch();

  const segmented = byId("timer-mode-segmented");
  segmented?.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    segmented.querySelectorAll(".settings-segment").forEach((b) => b.classList.toggle("active", b === btn));
    byId("timer-view")?.classList.toggle("hidden", btn.dataset.mode !== "timer");
    byId("stopwatch-view")?.classList.toggle("hidden", btn.dataset.mode !== "stopwatch");
  });
}

// ---------------------------------------------------------------------------
// Countdown - an optional Overview tile (off by default, like World Clock)
// showing days remaining until one or more self-picked dates. Pure
// localStorage, no network - re-rendered once per calendar day (see
// lastCountdownRenderDateKey, checked from updateClock()) rather than
// every tick, since "days until" only ever changes at midnight.
// ---------------------------------------------------------------------------

const COUNTDOWN_KEY = "aurora-dashboard:countdowns";
let countdownEntries = [];
try {
  countdownEntries = JSON.parse(localStorage.getItem(COUNTDOWN_KEY) || "[]");
} catch (err) {
  countdownEntries = [];
}
let lastCountdownRenderDateKey = null;

function saveCountdowns() {
  localStorage.setItem(COUNTDOWN_KEY, JSON.stringify(countdownEntries));
}

/** [repeatsYearly] rolls a date that's already passed this year forward to
 *  its next occurrence (birthdays/anniversaries) instead of going negative -
 *  renderCountdowns() filters out negative-days entries, so without this a
 *  repeating date would just vanish forever the day after it passes. */
function daysUntil(dateKey, repeatsYearly) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let target = new Date(year, month - 1, day);
  target.setHours(0, 0, 0, 0);
  if (repeatsYearly && target < today) {
    target = new Date(today.getFullYear(), month - 1, day);
    target.setHours(0, 0, 0, 0);
    if (target < today) target = new Date(today.getFullYear() + 1, month - 1, day);
  }
  return Math.round((target - today) / 86400000);
}

function renderCountdowns() {
  const list = byId("countdown-list");
  if (!list) return;

  const upcoming = countdownEntries
    .map((entry) => ({ ...entry, days: daysUntil(entry.date, entry.repeatsYearly) }))
    .filter((entry) => entry.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  if (upcoming.length === 0) {
    list.innerHTML = `<div class="worldclock-empty">${countdownEntries.length === 0 ? "Add a date in Settings" : "No upcoming dates"}</div>`;
    return;
  }

  list.innerHTML = upcoming
    .map((entry) => {
      const dayWord = entry.days === 0 ? "Today" : entry.days === 1 ? "Tomorrow" : `${entry.days} days`;
      return `<div class="worldclock-row">
          <span class="worldclock-label">${escapeHtml(entry.label)}</span>
          <span class="worldclock-time">${escapeHtml(dayWord)}</span>
        </div>`;
    })
    .join("");
}

function renderCountdownSettings() {
  const list = byId("settings-countdown-list");
  if (!list) return;
  if (countdownEntries.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No dates added yet</div>';
    return;
  }
  list.innerHTML = countdownEntries
    .map((entry, index) => {
      const yearlyBadge = entry.repeatsYearly ? `<span class="countdown-yearly-badge">Yearly</span>` : "";
      return `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(entry.label)} - ${escapeHtml(entry.date)}${yearlyBadge}</span>
        <button class="icon-button countdown-remove" type="button" aria-label="Remove ${escapeHtml(entry.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`;
    })
    .join("");
}

function setupCountdown() {
  setIcon("countdown-title-icon", "calendar");
  renderCountdowns();
  renderCountdownSettings();

  const yearlySwitch = byId("countdown-add-yearly");
  yearlySwitch?.addEventListener("click", () => {
    yearlySwitch.setAttribute("aria-checked", String(yearlySwitch.getAttribute("aria-checked") !== "true"));
  });

  byId("countdown-add-btn")?.addEventListener("click", () => {
    const dateInput = byId("countdown-add-date");
    const labelInput = byId("countdown-add-label");
    const date = dateInput?.value;
    const label = labelInput?.value.trim();
    if (!date || !label) return;
    countdownEntries.push({ date, label, repeatsYearly: yearlySwitch?.getAttribute("aria-checked") === "true" });
    saveCountdowns();
    renderCountdowns();
    renderCountdownSettings();
    if (labelInput) labelInput.value = "";
    yearlySwitch?.setAttribute("aria-checked", "false");
  });

  byId("settings-countdown-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".countdown-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    countdownEntries.splice(index, 1);
    saveCountdowns();
    renderCountdowns();
    renderCountdownSettings();
  });
}

// ---------------------------------------------------------------------------
// Night Routine - an optional Overview tile (off by default, like World
// Clock/Countdown) showing a small user-defined checklist that resets
// itself once a day. Ships with three starter items so it's immediately
// useful the moment it's turned on, rather than opening to a blank list -
// unlike Countdown/World Clock, which are inherently personal data with no
// sane default. That starter set is a first-run default only: once
// NIGHT_ROUTINE_ITEMS_KEY exists at all (even as an empty array, after a
// user deletes everything), it's never repopulated - an intentionally
// emptied list has to stay empty.
// ---------------------------------------------------------------------------

const NIGHT_ROUTINE_ITEMS_KEY = "aurora-dashboard:night-routine-items";
const NIGHT_ROUTINE_STATE_KEY = "aurora-dashboard:night-routine-state";
const DEFAULT_NIGHT_ROUTINE_ITEMS = [
  { id: "nr-doors", label: "Doors locked" },
  { id: "nr-alarm", label: "Alarm set for tomorrow" },
  { id: "nr-charging", label: "Phone charging" },
];

function loadNightRoutineItems() {
  try {
    const raw = localStorage.getItem(NIGHT_ROUTINE_ITEMS_KEY);
    if (raw === null) return DEFAULT_NIGHT_ROUTINE_ITEMS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_NIGHT_ROUTINE_ITEMS;
  } catch (err) {
    return DEFAULT_NIGHT_ROUTINE_ITEMS;
  }
}

let nightRoutineItems = loadNightRoutineItems();

function saveNightRoutineItems() {
  localStorage.setItem(NIGHT_ROUTINE_ITEMS_KEY, JSON.stringify(nightRoutineItems));
}

function loadNightRoutineState() {
  try {
    const raw = localStorage.getItem(NIGHT_ROUTINE_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.checkedIds) ? parsed : { dateKey: "", checkedIds: [] };
  } catch (err) {
    return { dateKey: "", checkedIds: [] };
  }
}

let nightRoutineState = loadNightRoutineState();

function saveNightRoutineState() {
  localStorage.setItem(NIGHT_ROUTINE_STATE_KEY, JSON.stringify(nightRoutineState));
}

/** Resets checkedIds back to empty the first time this runs on a new
 *  calendar day - a fresh checklist to fill in each night, same as a
 *  paper one would be. */
function ensureNightRoutineStateForToday() {
  const todayKey = localDateKey(new Date());
  if (nightRoutineState.dateKey === todayKey) return;
  nightRoutineState = { dateKey: todayKey, checkedIds: [] };
  saveNightRoutineState();
}

function renderNightRoutine() {
  const list = byId("nightroutine-list");
  if (!list) return;
  setIcon("nightroutine-title-icon", "checklist");
  if (privacyModeActive) {
    list.innerHTML = '<div class="worldclock-empty">Hidden - Privacy Mode is on</div>';
    setText("nightroutine-progress", "");
    return;
  }
  ensureNightRoutineStateForToday();

  if (nightRoutineItems.length === 0) {
    list.innerHTML = '<div class="worldclock-empty">Add a routine item in Settings</div>';
    setText("nightroutine-progress", "");
    return;
  }

  const checkedSet = new Set(nightRoutineState.checkedIds);
  list.innerHTML = nightRoutineItems
    .map(
      (item) => `<label class="nightroutine-row">
        <input type="checkbox" class="nightroutine-checkbox" data-id="${escapeHtml(item.id)}" ${checkedSet.has(item.id) ? "checked" : ""} />
        <span class="${checkedSet.has(item.id) ? "nightroutine-label nightroutine-label-done" : "nightroutine-label"}">${escapeHtml(item.label)}</span>
      </label>`
    )
    .join("");
  setText("nightroutine-progress", `${checkedSet.size}/${nightRoutineItems.length}`);
}

function renderNightRoutineSettings() {
  const list = byId("settings-nightroutine-list");
  if (!list) return;
  if (nightRoutineItems.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No routine items yet</div>';
    return;
  }
  list.innerHTML = nightRoutineItems
    .map(
      (item, index) => `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(item.label)}</span>
        <button class="icon-button nightroutine-remove" type="button" aria-label="Remove ${escapeHtml(item.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function setupNightRoutine() {
  renderNightRoutine();
  renderNightRoutineSettings();

  byId("nightroutine-list")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".nightroutine-checkbox");
    if (!checkbox) return;
    ensureNightRoutineStateForToday();
    const id = checkbox.dataset.id;
    const checkedSet = new Set(nightRoutineState.checkedIds);
    if (checkbox.checked) checkedSet.add(id);
    else checkedSet.delete(id);
    nightRoutineState.checkedIds = [...checkedSet];
    saveNightRoutineState();
    renderNightRoutine();
  });

  byId("nightroutine-add-btn")?.addEventListener("click", () => {
    const input = byId("nightroutine-add-label");
    const label = input?.value.trim();
    if (!label) return;
    nightRoutineItems.push({ id: `nr-${Date.now()}`, label });
    saveNightRoutineItems();
    renderNightRoutine();
    renderNightRoutineSettings();
    if (input) input.value = "";
  });

  byId("settings-nightroutine-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".nightroutine-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    nightRoutineItems.splice(index, 1);
    saveNightRoutineItems();
    renderNightRoutine();
    renderNightRoutineSettings();
  });
}

// ---------------------------------------------------------------------------
// Habits - an optional Overview tile (off by default), a short user-defined
// list of daily habits with a streak count. No starter defaults, unlike
// Night Routine - habits are entirely personal, there's no sane universal
// set to pre-fill. habitStreak() counts backward from today, but doesn't
// break the streak just because today itself hasn't been checked off yet
// (it starts counting from yesterday instead in that case) - otherwise a
// genuinely intact streak would read as broken all morning, every single
// day, until the habit gets checked.
// ---------------------------------------------------------------------------

const HABITS_KEY = "aurora-dashboard:habits";
const HABIT_LOG_KEY = "aurora-dashboard:habit-log";

function loadHabits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HABITS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let habits = loadHabits();

function saveHabits() {
  localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
}

function loadHabitLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HABIT_LOG_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

let habitLog = loadHabitLog();

function saveHabitLog() {
  localStorage.setItem(HABIT_LOG_KEY, JSON.stringify(habitLog));
}

function isHabitCheckedToday(habitId) {
  return (habitLog[habitId] || []).includes(localDateKey(new Date()));
}

function toggleHabitToday(habitId) {
  const todayKey = localDateKey(new Date());
  const dates = new Set(habitLog[habitId] || []);
  if (dates.has(todayKey)) dates.delete(todayKey);
  else dates.add(todayKey);
  habitLog[habitId] = [...dates];
  saveHabitLog();
}

function habitStreak(habitId) {
  const dates = new Set(habitLog[habitId] || []);
  const cursor = new Date();
  if (!dates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dates.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Longest run anywhere in the log, not just the trailing-from-today run
 *  habitStreak() computes - for "best streak ever" in Habit History. Walks
 *  the sorted date strings once rather than testing every possible start
 *  date against the Set, since consecutive calendar dates are also
 *  consecutive ISO date strings once sorted. */
function habitBestStreak(habitId) {
  const dates = [...(habitLog[habitId] || [])].sort();
  if (dates.length === 0) return 0;
  let best = 1;
  let current = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const cur = new Date(dates[i]);
    const dayGap = Math.round((cur - prev) / 86400000);
    current = dayGap === 1 ? current + 1 : 1;
    best = Math.max(best, current);
  }
  return best;
}

const HABIT_WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Below this many total check-ins (across every habit combined), there
// just isn't enough data yet to claim a real day-of-week pattern rather
// than noise from the first couple of habits added.
const HABIT_DAY_INSIGHT_MIN_CHECKINS = 14;

/** Which day of the week has the most check-ins, combined across every
 *  habit - null if there isn't enough data yet to say anything meaningful
 *  (see HABIT_DAY_INSIGHT_MIN_CHECKINS). */
function habitBestDayOfWeek() {
  const countsByWeekday = new Array(7).fill(0);
  let total = 0;
  Object.values(habitLog).forEach((dates) => {
    dates.forEach((dateKey) => {
      const [year, month, day] = dateKey.split("-").map(Number);
      countsByWeekday[new Date(year, month - 1, day).getDay()]++;
      total++;
    });
  });
  if (total < HABIT_DAY_INSIGHT_MIN_CHECKINS) return null;

  let bestDay = 0;
  for (let i = 1; i < 7; i++) {
    if (countsByWeekday[i] > countsByWeekday[bestDay]) bestDay = i;
  }
  return HABIT_WEEKDAY_NAMES[bestDay];
}

function renderHabitDayInsight() {
  const el = byId("habits-day-insight");
  if (!el) return;
  const bestDay = habitBestDayOfWeek();
  el.textContent = bestDay ? `You're most consistent on ${bestDay}s` : "";
  el.classList.toggle("hidden", !bestDay);
}

// A streak crossing one of these gets a one-shot celebratory flourish
// (see renderHabits() below) rather than a permanently different look -
// the milestone is the moment it's reached, not an ongoing state.
const HABIT_MILESTONE_STREAKS = new Set([7, 14, 30, 50, 100, 150, 200, 365]);

/** Shared by the Overview tile's #habits-list and the dedicated Habits
 *  page's #page-habits-list - same markup, same data, just two places it
 *  can be visible at once (the tile is optional/off by default; the page
 *  always shows everything). */
function renderHabitsInto(listId) {
  const list = byId(listId);
  if (!list) return;
  if (privacyModeActive) {
    list.innerHTML = '<div class="worldclock-empty">Hidden - Privacy Mode is on</div>';
    return;
  }

  if (habits.length === 0) {
    list.innerHTML = '<div class="worldclock-empty">Add a habit in Settings</div>';
    return;
  }

  // Every render fully replaces this list's innerHTML (no diffing), so the
  // only way to tell "just reached 30" apart from "still at 30 from an
  // unrelated re-render" is to read back whatever streak each row last
  // showed before overwriting it - same idea as setText()'s value-pulse,
  // just read from the DOM instead of compared against it inline.
  const previousStreaks = new Map();
  list.querySelectorAll(".habit-row[data-id]").forEach((row) => {
    const streakEl = row.querySelector(".habit-streak");
    if (streakEl) previousStreaks.set(row.dataset.id, Number(streakEl.dataset.streak));
  });

  list.innerHTML = habits
    .map((habit) => {
      const checked = isHabitCheckedToday(habit.id);
      const streak = habitStreak(habit.id);
      const justHitMilestone = HABIT_MILESTONE_STREAKS.has(streak) && previousStreaks.get(habit.id) !== streak;
      return `<div class="habit-row" data-id="${escapeHtml(habit.id)}">
        <label class="habit-row-main">
          <input type="checkbox" class="habit-checkbox" data-id="${escapeHtml(habit.id)}" ${checked ? "checked" : ""} />
          <span class="${checked ? "habit-label habit-label-done" : "habit-label"}">${escapeHtml(habit.label)}</span>
        </label>
        ${
          streak > 0
            ? `<span class="habit-streak${justHitMilestone ? " habit-streak-milestone" : ""}" data-streak="${streak}"><span class="icon-slot tiny" aria-hidden="true">${ICONS.flame}</span>${streak}</span>`
            : ""
        }
        <button class="icon-button-small habit-history-btn" type="button" data-id="${escapeHtml(habit.id)}" aria-label="View history for ${escapeHtml(habit.label)}">
          <span class="icon-slot tiny" aria-hidden="true">${ICONS.calendar}</span>
        </button>
      </div>`;
    })
    .join("");
}

function renderHabits() {
  setIcon("habits-title-icon", "flame");
  setIcon("habits-page-title-icon", "flame");
  renderHabitsInto("habits-list");
  renderHabitsInto("page-habits-list");
  renderHabitDayInsight();
}

function renderHabitsSettings() {
  const list = byId("settings-habits-list");
  if (!list) return;
  if (habits.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No habits yet</div>';
    return;
  }
  list.innerHTML = habits
    .map(
      (habit, index) => `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(habit.label)}</span>
        <button class="icon-button habit-remove" type="button" aria-label="Remove ${escapeHtml(habit.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function setupHabits() {
  renderHabits();
  renderHabitsSettings();

  const handleHabitToggle = (event) => {
    const checkbox = event.target.closest(".habit-checkbox");
    if (!checkbox) return;
    toggleHabitToday(checkbox.dataset.id);
    renderHabits();
  };
  byId("habits-list")?.addEventListener("change", handleHabitToggle);
  byId("page-habits-list")?.addEventListener("change", handleHabitToggle);

  byId("habits-add-btn")?.addEventListener("click", () => {
    const input = byId("habits-add-label");
    const label = input?.value.trim();
    if (!label) return;
    habits.push({ id: `habit-${Date.now()}`, label });
    saveHabits();
    renderHabits();
    renderHabitsSettings();
    if (input) input.value = "";
  });

  byId("settings-habits-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".habit-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    habits.splice(index, 1);
    saveHabits();
    renderHabits();
    renderHabitsSettings();
  });

  const handleHabitHistoryClick = (event) => {
    const historyBtn = event.target.closest(".habit-history-btn");
    if (historyBtn) openHabitHistory(historyBtn.dataset.id);
  };
  byId("habits-list")?.addEventListener("click", handleHabitHistoryClick);
  byId("page-habits-list")?.addEventListener("click", handleHabitHistoryClick);

  byId("see-habits-btn")?.addEventListener("click", () => {
    byId("page-habits")?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  });
  byId("manage-habits-btn")?.addEventListener("click", () => {
    byId("page-settings")?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  });
}

// ---------------------------------------------------------------------------
// Habit History - a read-only month calendar heatmap for one habit, reached
// by tapping its calendar icon on the Overview tile. Same
// backdrop/popover shape as Week View/Journal History; unlike Journal
// History there's no per-day drill-down (a habit day is just done/not-done,
// nothing to read), so it's a single view with month navigation instead of
// a list/detail pair.
// ---------------------------------------------------------------------------

let habitHistoryId = null;
let habitHistoryYear = null;
let habitHistoryMonth = null; // 0-indexed, same convention as Date

function renderHabitHistory() {
  const habit = habits.find((h) => h.id === habitHistoryId);
  if (!habit) return;

  setText("habit-history-title", habit.label);

  const dates = new Set(habitLog[habitHistoryId] || []);
  const monthStart = new Date(habitHistoryYear, habitHistoryMonth, 1);
  const daysInMonth = new Date(habitHistoryYear, habitHistoryMonth + 1, 0).getDate();
  const doneThisMonth = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((day) =>
    dates.has(localDateKey(new Date(habitHistoryYear, habitHistoryMonth, day)))
  ).length;

  setText(
    "habit-history-stats",
    `Current streak: ${habitStreak(habitHistoryId)} · Best: ${habitBestStreak(habitHistoryId)} · ${doneThisMonth}/${daysInMonth} this month`
  );
  setText("habit-history-month-label", monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" }));

  const weekdaysEl = byId("habit-history-weekdays");
  if (weekdaysEl && !weekdaysEl.childElementCount) {
    weekdaysEl.innerHTML = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("");
  }

  const todayKey = localDateKey(new Date());
  const leadingBlanks = monthStart.getDay();
  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push('<span class="habit-history-cell habit-history-cell-blank"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = localDateKey(new Date(habitHistoryYear, habitHistoryMonth, day));
    const classes = ["habit-history-cell"];
    if (dates.has(dateKey)) classes.push("habit-history-cell-done");
    if (dateKey === todayKey) classes.push("habit-history-cell-today");
    cells.push(`<span class="${classes.join(" ")}">${day}</span>`);
  }
  const grid = byId("habit-history-grid");
  if (grid) grid.innerHTML = cells.join("");
}

function openHabitHistory(habitId) {
  habitHistoryId = habitId;
  const today = new Date();
  habitHistoryYear = today.getFullYear();
  habitHistoryMonth = today.getMonth();
  renderHabitHistory();
  byId("habit-history-popover")?.classList.remove("hidden");
  byId("habit-history-backdrop")?.classList.remove("hidden");
}

function closeHabitHistory() {
  byId("habit-history-popover")?.classList.add("hidden");
  byId("habit-history-backdrop")?.classList.add("hidden");
}

function shiftHabitHistoryMonth(delta) {
  const next = new Date(habitHistoryYear, habitHistoryMonth + delta, 1);
  habitHistoryYear = next.getFullYear();
  habitHistoryMonth = next.getMonth();
  renderHabitHistory();
}

function setupHabitHistory() {
  byId("habit-history-close")?.addEventListener("click", closeHabitHistory);
  byId("habit-history-backdrop")?.addEventListener("click", closeHabitHistory);
  byId("habit-history-prev-btn")?.addEventListener("click", () => shiftHabitHistoryMonth(-1));
  byId("habit-history-next-btn")?.addEventListener("click", () => shiftHabitHistoryMonth(1));
}

// ---------------------------------------------------------------------------
// Recurring Reminders - an optional Overview tile (off by default) for
// interval-based reminders ("every N days") - the thing neither Night
// Routine (resets every single night) nor Countdown (a fixed one-off date)
// covers: "water the plant every 10 days", "change the AC filter every 30".
// Each reminder just tracks when it was last marked done; its next due date
// is computed from that plus its interval, not stored separately, so
// "marking done" is the only write a normal use of this feature ever needs.
// ---------------------------------------------------------------------------

const RECURRING_REMINDERS_KEY = "aurora-dashboard:recurring-reminders";

function loadRecurringReminders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECURRING_REMINDERS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let recurringReminders = loadRecurringReminders();

function saveRecurringReminders() {
  localStorage.setItem(RECURRING_REMINDERS_KEY, JSON.stringify(recurringReminders));
}

/** Positive = days until due, 0 = due today, negative = overdue by that
 *  many days. lastDoneDate of null means "never done" - treated as
 *  already due, same as a freshly-added reminder should read. */
function daysUntilReminderDue(reminder) {
  if (!reminder.lastDoneDate) return 0;
  // Y/M/D components, not new Date(dateKeyString) - that string form parses
  // as UTC midnight while `today` below is constructed in local time, and
  // the two silently disagree by a day near local midnight (same pitfall
  // daysUntil() for Countdown already avoids the same way).
  const [year, month, day] = reminder.lastDoneDate.split("-").map(Number);
  const last = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.round((today - last) / 86400000);
  return reminder.intervalDays - daysSince;
}

function markReminderDone(id) {
  const reminder = recurringReminders.find((r) => r.id === id);
  if (!reminder) return;
  reminder.lastDoneDate = localDateKey(new Date());
  saveRecurringReminders();
  renderRecurringReminders();
}

function renderRecurringReminders() {
  const list = byId("reminders-list");
  if (!list) return;
  setIcon("reminders-title-icon", "bell");

  if (recurringReminders.length === 0) {
    list.innerHTML = '<div class="worldclock-empty">Add a reminder in Settings</div>';
    return;
  }

  const withDueInfo = recurringReminders
    .map((r) => ({ ...r, daysUntilDue: daysUntilReminderDue(r) }))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  list.innerHTML = withDueInfo
    .map((r) => {
      const dueText =
        r.daysUntilDue === 0
          ? "Due today"
          : r.daysUntilDue < 0
          ? `Overdue ${-r.daysUntilDue}d`
          : `Due in ${r.daysUntilDue}d`;
      return `<label class="nightroutine-row">
          <input type="checkbox" class="reminder-done-checkbox" data-id="${escapeHtml(r.id)}" />
          <span class="${r.daysUntilDue <= 0 ? "worldclock-time reminder-due" : "worldclock-time"}">${escapeHtml(dueText)}</span>
          <span class="nightroutine-label">${escapeHtml(r.label)}</span>
        </label>`;
    })
    .join("");
}

function renderRecurringRemindersSettings() {
  const list = byId("settings-reminders-list");
  if (!list) return;
  if (recurringReminders.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No reminders yet</div>';
    return;
  }
  list.innerHTML = recurringReminders
    .map(
      (r, index) => `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(r.label)} - every ${r.intervalDays}d</span>
        <button class="icon-button reminder-remove" type="button" aria-label="Remove ${escapeHtml(r.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function setupRecurringReminders() {
  renderRecurringReminders();
  renderRecurringRemindersSettings();

  // A checkbox here means "done", not "currently done" - checking it marks
  // it done and immediately re-renders (removing/reordering the row along
  // with everything else), so it never actually stays checked on screen.
  byId("reminders-list")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".reminder-done-checkbox");
    if (!checkbox || !checkbox.checked) return;
    markReminderDone(checkbox.dataset.id);
  });

  byId("reminders-add-btn")?.addEventListener("click", () => {
    const labelInput = byId("reminders-add-label");
    const intervalInput = byId("reminders-add-interval");
    const label = labelInput?.value.trim();
    const intervalDays = Number(intervalInput?.value);
    if (!label || !Number.isFinite(intervalDays) || intervalDays < 1) return;
    recurringReminders.push({ id: `reminder-${Date.now()}`, label, intervalDays, lastDoneDate: null });
    saveRecurringReminders();
    renderRecurringReminders();
    renderRecurringRemindersSettings();
    if (labelInput) labelInput.value = "";
    if (intervalInput) intervalInput.value = "";
  });

  byId("settings-reminders-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".reminder-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    recurringReminders.splice(index, 1);
    saveRecurringReminders();
    renderRecurringReminders();
    renderRecurringRemindersSettings();
  });
}

// ---------------------------------------------------------------------------
// Shopping List - an optional Overview tile (off by default, same as World
// Clock/Countdown/Habits) for a plain grocery/errand list. Unlike Night
// Routine's checklist, items never reset - checking one off just marks it
// bought, and it stays that way (sorted to the bottom, out of the way)
// until "Clear checked" sweeps them out. Managed entirely on the tile
// itself rather than from Settings like Habits/Countdown/Reminders are -
// a shopping list gets edited constantly during the week, so burying
// add/remove in Settings would make it annoying to actually use.
// ---------------------------------------------------------------------------

const SHOPPING_LIST_KEY = "aurora-dashboard:shopping-list";

function loadShoppingList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOPPING_LIST_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

let shoppingListItems = loadShoppingList();

function saveShoppingList() {
  localStorage.setItem(SHOPPING_LIST_KEY, JSON.stringify(shoppingListItems));
}

function renderShoppingList() {
  const list = byId("shoppinglist-list");
  if (!list) return;
  setIcon("shoppinglist-title-icon", "cart");
  setIcon("shoppinglist-clear-icon", "trash");

  if (shoppingListItems.length === 0) {
    list.innerHTML = '<div class="worldclock-empty">Add something below</div>';
    setText("shoppinglist-progress", "");
    return;
  }

  // Unchecked items first (in the order they were added), checked ones
  // pushed to the bottom - out of the way, but still visible/undoable
  // until "Clear checked" actually removes them.
  const sorted = [...shoppingListItems].sort((a, b) => Number(a.checked) - Number(b.checked));
  list.innerHTML = sorted
    .map(
      (item) => `<div class="shoppinglist-row" data-id="${escapeHtml(item.id)}">
        <label class="shoppinglist-row-main">
          <input type="checkbox" class="shoppinglist-checkbox nightroutine-checkbox" data-id="${escapeHtml(item.id)}" ${item.checked ? "checked" : ""} />
          <span class="${item.checked ? "nightroutine-label nightroutine-label-done" : "nightroutine-label"}">${escapeHtml(item.label)}</span>
        </label>
        <button class="icon-button-small shoppinglist-remove" type="button" data-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.label)}">
          <span class="icon-slot tiny" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");

  const uncheckedCount = shoppingListItems.filter((item) => !item.checked).length;
  setText("shoppinglist-progress", uncheckedCount > 0 ? `${uncheckedCount} left` : "");
}

function addShoppingListItem() {
  const input = byId("shoppinglist-add-input");
  const label = input?.value.trim();
  if (!label) return;
  shoppingListItems.push({ id: `shop-${Date.now()}`, label, checked: false });
  saveShoppingList();
  renderShoppingList();
  if (input) input.value = "";
}

function setupShoppingList() {
  renderShoppingList();
  setIcon("shoppinglist-add-icon", "plus");

  byId("shoppinglist-add-btn")?.addEventListener("click", addShoppingListItem);
  byId("shoppinglist-add-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addShoppingListItem();
  });

  byId("shoppinglist-list")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".shoppinglist-checkbox");
    if (!checkbox) return;
    const item = shoppingListItems.find((i) => i.id === checkbox.dataset.id);
    if (!item) return;
    item.checked = checkbox.checked;
    saveShoppingList();
    renderShoppingList();
  });

  byId("shoppinglist-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".shoppinglist-remove");
    if (!removeBtn) return;
    shoppingListItems = shoppingListItems.filter((i) => i.id !== removeBtn.dataset.id);
    saveShoppingList();
    renderShoppingList();
  });

  byId("shoppinglist-clear-btn")?.addEventListener("click", () => {
    shoppingListItems = shoppingListItems.filter((i) => !i.checked);
    saveShoppingList();
    renderShoppingList();
  });

  setupMealIdea();
}

/** Suggests a simple meal from whatever's currently on the Shopping List,
 *  via the Companion Server (see generate_meal_idea() in server.py) -
 *  purely a fun supplement, stays hidden entirely without a server
 *  configured rather than offering a button that can't do anything. */
async function requestMealIdea() {
  if (!companionServerConfig() || shoppingListItems.length === 0) return;
  const btn = byId("shoppinglist-meal-idea-btn");
  const textEl = byId("shoppinglist-meal-idea-text");
  if (btn) btn.disabled = true;
  if (textEl) {
    textEl.textContent = "Thinking of something...";
    textEl.classList.remove("hidden");
  }

  const resp = await companionFetch("/meal-idea", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: shoppingListItems.map((i) => i.label) }),
    timeoutMs: 30000,
  });
  if (btn) btn.disabled = false;
  if (!resp) {
    if (textEl) textEl.classList.add("hidden");
    return;
  }
  const data = await resp.json();
  if (textEl && data.text) {
    textEl.textContent = data.text;
    textEl.classList.remove("hidden");
  }
}

function setupMealIdea() {
  const btn = byId("shoppinglist-meal-idea-btn");
  if (!companionServerConfig()) return; // stays hidden - no server, no meal ideas
  setIcon("shoppinglist-meal-idea-icon", "flame");
  btn?.classList.remove("hidden");
  btn?.addEventListener("click", requestMealIdea);
}

// ---------------------------------------------------------------------------
// Weather - fetched directly from two free, unauthenticated, CORS-enabled
// public APIs (Open-Meteo and the National Weather Service) instead of
// proxied through Aurora, which no longer exists. Uses the home coordinate
// set by the Setup Wizard (see HOME_LATITUDE/HOME_LONGITUDE at the top of
// this file) - there's no phone location to follow anymore, so this is the
// only coordinate this build ever uses.
// Builds a WeatherSnapshot-shaped object matching exactly what Aurora used
// to send, so renderWeather()/renderRadar()/renderAirQuality()/
// renderWeatherDetails()/renderDailyForecast() all still work completely
// unchanged below - only the data source moved.
// ---------------------------------------------------------------------------

// Today plus this many upcoming days, for the daily forecast strip - 5 is
// a common weather-app convention and fits the Echo Show's width without
// the per-day cells getting cramped.
const WeatherConfig = { FORECAST_DAYS: 5 };

// Matches WeatherConditionMapper.kt's WMO-code mapping exactly.
function wmoCodeToCondition(code) {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain Showers";
  if ([85, 86].includes(code)) return "Snow Showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown";
}

// Below this, "might rain" isn't worth an umbrella nudge - Open-Meteo's
// hourly probabilities are frequently in the 10-30% range for a mostly dry
// day, and a warning that fires half the time trains you to ignore it.
const RAIN_PROBABILITY_THRESHOLD = 50;

// The standard EPA/WHO UV Index scale calls 6 the start of "High" - their
// own threshold for actively recommending sunscreen, not an arbitrary
// pick of this dashboard's own.
const UV_SUNSCREEN_THRESHOLD = 6;

// EPA's own US AQI breakpoint for "Unhealthy" (everyone, not just
// sensitive groups) starts at 151 - see aqiCategory().
const AQI_NUDGE_THRESHOLD = 151;

// Raw Fahrenheit thresholds for the feels-like nudge - genuinely
// uncomfortable territory, not just "a couple degrees off actual."
const FEELS_LIKE_HOT_THRESHOLD = 100;
const FEELS_LIKE_COLD_THRESHOLD = 32;

// NWS's own Wind Advisory threshold - sustained wind at or above this is
// worth a heads-up, not just an arbitrary pick of this dashboard's own.
const WIND_NUDGE_THRESHOLD = 25;

/** "2026-07-27T06:15" -> "06:15" */
function extractTimeOfDayIso(isoDateTime) {
  const time = isoDateTime && isoDateTime.split("T")[1];
  return time || null;
}

/** First hour from now through the end of today whose precipitation
 *  probability clears RAIN_PROBABILITY_THRESHOLD - null if none does. ISO
 *  8601 datetime strings sort chronologically as plain strings, so this
 *  needs no date parsing to compare against the current hour. */
function findRainExpectedAt(current, hourly) {
  const isoNow = current.time;
  const today = isoNow.split("T")[0];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = hourly.time[i];
    if (!hour.startsWith(today) || hour < isoNow) continue;
    const probability = hourly.precipitation_probability?.[i];
    if (probability != null && probability >= RAIN_PROBABILITY_THRESHOLD) return extractTimeOfDayIso(hour);
  }
  return null;
}

// How far ahead findRainStartingSoon() looks - beyond this, rainExpectedAt
// (today's hourly forecast) already covers it; this is only meant for
// "grab an umbrella before you walk out the door right now."
const RAIN_STARTING_SOON_WINDOW_MINUTES = 120;

/** Minutes from now until the first upcoming 15-minute interval (within
 *  RAIN_STARTING_SOON_WINDOW_MINUTES) whose precipitation probability
 *  clears the threshold - null if none does. Parses actual datetimes
 *  (rather than comparing ISO strings like findRainExpectedAt() does)
 *  since this needs a minute count, not just an ordering; the minutely_15
 *  array is already sorted ascending, so once an entry falls outside the
 *  window every later one does too. */
function findRainStartingSoon(current, minutely15) {
  const isoNow = current.time;
  if (!isoNow) return null;
  const now = new Date(isoNow);
  if (Number.isNaN(now.getTime())) return null;

  for (let i = 0; i < minutely15.time.length; i++) {
    const time = new Date(minutely15.time[i]);
    if (Number.isNaN(time.getTime()) || time < now) continue;
    const minutesUntil = Math.round((time - now) / 60000);
    if (minutesUntil > RAIN_STARTING_SOON_WINDOW_MINUTES) break;
    const probability = minutely15.precipitation_probability?.[i];
    if (probability != null && probability >= RAIN_PROBABILITY_THRESHOLD) return minutesUntil;
  }
  return null;
}

/** Highest hourly probability from now through the end of today - same
 *  today-only bounding as findRainExpectedAt(), just reported as the peak
 *  number rather than a threshold-crossing time. */
function findTodayMaxPrecipitationProbability(current, hourly) {
  const isoNow = current.time;
  const today = isoNow.split("T")[0];
  let max = null;
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = hourly.time[i];
    if (!hour.startsWith(today) || hour < isoNow) continue;
    const probability = hourly.precipitation_probability?.[i];
    if (probability != null && (max == null || probability > max)) max = probability;
  }
  return max;
}

// Below this counts as "dry enough" for a walk - a lower bar than
// RAIN_PROBABILITY_THRESHOLD's own umbrella nudge, since a window doesn't
// need to be bone-dry to be pleasant, just not likely to get rained on.
const WALK_WINDOW_RAIN_THRESHOLD = 30;
// A single dry hour isn't worth naming as a "window" - this is the
// shortest run that's actually useful to plan around.
const WALK_WINDOW_MIN_HOURS = 2;

/** {start, end} "HH:mm" strings for the longest consecutive run of dry
 *  hours from now through the end of today, or null if nothing today
 *  clears WALK_WINDOW_MIN_HOURS - same today-only bounding as
 *  findRainExpectedAt(), just looking for the best stretch instead of the
 *  first threshold crossing. */
function findBestWalkWindow(current, hourly) {
  const isoNow = current.time;
  const today = isoNow.split("T")[0];

  const todayHours = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = hourly.time[i];
    if (!hour.startsWith(today) || hour < isoNow) continue;
    const probability = hourly.precipitation_probability?.[i];
    if (probability == null) continue;
    todayHours.push({ hour, dry: probability < WALK_WINDOW_RAIN_THRESHOLD });
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < todayHours.length; i++) {
    if (todayHours[i].dry) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < WALK_WINDOW_MIN_HOURS) return null;

  const startTime = extractTimeOfDayIso(todayHours[bestStart].hour);
  // The last dry hour's own timestamp is its start (e.g. "16:00" means
  // 4-5pm is dry) - the window's end is one hour past that.
  const endDate = new Date(`${todayHours[bestStart + bestLen - 1].hour}:00`);
  endDate.setHours(endDate.getHours() + 1);
  const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
  return { start: startTime, end: endTime };
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteoWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${HOME_LATITUDE}&longitude=${HOME_LONGITUDE}` +
    "&current=temperature_2m,weather_code,apparent_temperature,wind_speed_10m,relative_humidity_2m,uv_index" +
    "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code" +
    "&hourly=precipitation_probability" +
    "&minutely_15=precipitation_probability" +
    "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto" +
    `&forecast_days=${WeatherConfig.FORECAST_DAYS}`;
  const response = await fetchJson(url);

  const dayCount = Math.min(
    response.daily.time.length,
    response.daily.temperature_2m_max.length,
    response.daily.temperature_2m_min.length,
    response.daily.weather_code.length
  );
  const dailyForecast = [];
  for (let i = 0; i < dayCount; i++) {
    dailyForecast.push({
      date: response.daily.time[i],
      high: Math.round(response.daily.temperature_2m_max[i]),
      low: Math.round(response.daily.temperature_2m_min[i]),
      condition: wmoCodeToCondition(response.daily.weather_code[i]),
    });
  }

  return {
    temperature: Math.round(response.current.temperature_2m),
    condition: wmoCodeToCondition(response.current.weather_code),
    high: Math.round(response.daily.temperature_2m_max[0]),
    low: Math.round(response.daily.temperature_2m_min[0]),
    timezone: response.timezone,
    sunrise: extractTimeOfDayIso(response.daily.sunrise?.[0]),
    sunset: extractTimeOfDayIso(response.daily.sunset?.[0]),
    rainExpectedAt: findRainExpectedAt(response.current, response.hourly || { time: [] }),
    precipitationProbability: findTodayMaxPrecipitationProbability(response.current, response.hourly || { time: [] }),
    rainStartsInMinutes: findRainStartingSoon(response.current, response.minutely_15 || { time: [] }),
    bestWalkWindow: findBestWalkWindow(response.current, response.hourly || { time: [] }),
    feelsLike: response.current.apparent_temperature != null ? Math.round(response.current.apparent_temperature) : null,
    windSpeedMph: response.current.wind_speed_10m != null ? Math.round(response.current.wind_speed_10m) : null,
    humidityPercent: response.current.relative_humidity_2m ?? null,
    uvIndex: response.current.uv_index != null ? Math.round(response.current.uv_index) : null,
    dailyForecast,
  };
}

async function fetchAirQualityIndex() {
  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${HOME_LATITUDE}&longitude=${HOME_LONGITUDE}&current=us_aqi&timezone=auto`;
  const response = await fetchJson(url);
  return response.current?.us_aqi ?? null;
}

/** NWS rejects coordinates with more than 4 decimal digits of precision. */
async function fetchRadarStation() {
  const lat = HOME_LATITUDE.toFixed(4);
  const lon = HOME_LONGITUDE.toFixed(4);
  const response = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { Accept: "application/geo+json" },
  });
  return response.properties?.radarStation ?? null;
}

// Lower rank = more severe - matches NwsAlertParser.kt's SEVERITY_RANK.
const NWS_SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };

async function fetchSevereAlertFromNws() {
  const response = await fetchJson(
    `https://api.weather.gov/alerts/active?point=${HOME_LATITUDE},${HOME_LONGITUDE}`,
    { headers: { Accept: "application/geo+json" } }
  );
  const features = response.features || [];
  if (features.length === 0) return null;

  const highest = features.reduce((best, feature) => {
    const rank = NWS_SEVERITY_RANK[feature.properties.severity] ?? 4;
    const bestRank = best ? NWS_SEVERITY_RANK[best.properties.severity] ?? 4 : Infinity;
    return rank < bestRank ? feature : best;
  }, null);
  if (!highest) return null;

  return {
    event: highest.properties.event,
    headline: highest.properties.headline || highest.properties.event,
    severity: highest.properties.severity,
  };
}

const WEATHER_CACHE_KEY = "aurora-dashboard:last-weather:v1";
let lastWeatherFetchAt = null;
let lastWeatherFetchFailed = false;

/** Same "always return a shape, never throw" resilience this codebase's
 *  own weather layer has always had - a failed fetch keeps showing
 *  whatever weather was already on screen (or the last cached one, right
 *  after a fresh page load) rather than blanking out to "--°". */
async function refreshWeather() {
  try {
    const [weather, airQualityIndex, radarStation] = await Promise.all([
      fetchOpenMeteoWeather(),
      fetchAirQualityIndex().catch(() => lastWeatherData?.airQualityIndex ?? null),
      fetchRadarStation().catch(() => lastWeatherData?.radarStation ?? null),
    ]);
    weather.airQualityIndex = airQualityIndex;
    weather.radarStation = radarStation;

    lastWeatherFetchAt = Date.now();
    lastWeatherFetchFailed = false;
    try {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
    } catch (err) {
      // Storage full/unavailable - not fatal, just no cache for next load.
    }

    renderWeather(weather);
    renderRadar(weather);
    renderAirQuality(weather);
    renderWeatherDetails(weather);
    renderDailyForecast(weather);
    renderAmbientWeather(weather);
    renderMoonPhaseVisual("moon-visual-daily", new Date());
    setText("weather-moon-label-lg", moonPhaseLabel(new Date()));
    renderMorningBriefing();
    maybeSuggestRainSound(weather);
  } catch (err) {
    lastWeatherFetchFailed = true;
  }
  updateStatusLine();
}

async function refreshSevereAlert() {
  try {
    const alert = await fetchSevereAlertFromNws();
    renderSevereAlert(alert);
  } catch (err) {
    // Best-effort - keep showing whatever alert (or lack of one) was
    // already on screen rather than clearing a real warning over one
    // transient NWS hiccup.
  }
}

function loadCachedWeather() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function formatRelativeTime(ms) {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

// ---------------------------------------------------------------------------
// Status line - "Updated Xs ago" while healthy (quiet, low-contrast); a
// visible warning only after a real failure. A premium display shouldn't
// nag about connectivity, but a persistent freshness indicator is
// different from an error state - it's useful even when nothing's wrong.
// ---------------------------------------------------------------------------

function updateStatusLine() {
  const el = byId("status-line");
  const textEl = byId("status-text");
  if (!el || !textEl) return;

  el.classList.remove("state-reconnecting", "state-offline");

  if (!lastWeatherFetchFailed) {
    textEl.textContent = lastWeatherFetchAt ? `Weather updated ${formatRelativeTime(lastWeatherFetchAt)}` : "";
    return;
  }

  textEl.textContent = lastWeatherFetchAt
    ? `Weather unavailable - showing data from ${formatRelativeTime(lastWeatherFetchAt)}`
    : "Weather unavailable";
  el.classList.add("state-offline");
}

const MANUAL_REFRESH_COOLDOWN_MS = 3000;
let manualRefreshCooldownUntil = 0;

/** Tapping the status line forces an immediate refresh instead of waiting
 *  for the next timer tick. A short cooldown (rather than disabling the
 *  element) keeps repeated taps from hammering the weather APIs while
 *  never leaving the control in a visibly "broken" disabled state. */
function setupManualRefresh() {
  byId("status-line")?.addEventListener("click", () => {
    if (Date.now() < manualRefreshCooldownUntil) return;
    manualRefreshCooldownUntil = Date.now() + MANUAL_REFRESH_COOLDOWN_MS;

    const el = byId("status-line");
    el?.classList.remove("refreshing");
    void el?.offsetWidth; // force reflow so the animation restarts cleanly
    el?.classList.add("refreshing");

    refreshWeather();
    refreshSevereAlert();
  });
}

function startWeatherRefreshLoop() {
  const cached = loadCachedWeather();
  if (cached) {
    renderWeather(cached);
    renderRadar(cached);
    renderAirQuality(cached);
    renderWeatherDetails(cached);
    renderDailyForecast(cached);
    renderAmbientWeather(cached);
    renderMoonPhaseVisual("moon-visual-daily", new Date());
    setText("weather-moon-label-lg", moonPhaseLabel(new Date()));
  }
  renderMorningBriefing();

  refreshWeather();
  refreshSevereAlert();
  setInterval(refreshWeather, WEATHER_REFRESH_INTERVAL_MS);
  setInterval(refreshSevereAlert, ALERT_REFRESH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Pager - four pages swiped through via native touch scrolling + CSS
// scroll-snap (see .pager/.page in style.css). This just keeps the dot
// indicators in sync with whichever page is currently snapped into view,
// and lets tapping a dot jump there without swiping.
// ---------------------------------------------------------------------------

function setupPager() {
  const pager = byId("pager");
  const dots = Array.from(document.querySelectorAll(".page-dot"));
  if (!pager || dots.length === 0) return;

  const pages = Array.from(pager.children);

  // Tracked so leaving the Extras page (Journal/Word Game/Trivia/Puzzle)
  // can auto-lock the Journal behind it - see lockJournal(). Only fires on
  // an actual page change, not the initial setActivePage(0) call below.
  let previousPageId = null;
  const setActivePage = (index) => {
    const newPageId = pages[index]?.id;
    if (previousPageId === "page-extras" && newPageId !== "page-extras") {
      lockJournal();
    }
    previousPageId = newPageId;
    dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
  };
  setActivePage(0);

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const page = pages[Number(dot.dataset.page)];
      page?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          setActivePage(pages.indexOf(entry.target));
        }
      });
    },
    { root: pager, threshold: 0.5 }
  );
  pages.forEach((page) => observer.observe(page));
}

// Subtle scale+fade on whichever page is mid-swipe, driven directly off
// scroll position rather than a fixed-duration transition - it needs to
// track the finger 1:1, not ease on its own schedule. Skipped entirely
// under prefers-reduced-motion since it's a continuous transform effect,
// not a CSS animation/transition the global reduced-motion rule catches.
function setupPageScrollEffect() {
  const pager = byId("pager");
  if (!pager) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const pages = Array.from(pager.children);
  let ticking = false;

  const update = () => {
    ticking = false;
    const pagerRect = pager.getBoundingClientRect();
    const center = pagerRect.left + pagerRect.width / 2;
    pages.forEach((page) => {
      const rect = page.getBoundingClientRect();
      const pageCenter = rect.left + rect.width / 2;
      const progress = Math.min(Math.abs(pageCenter - center) / rect.width, 1);
      page.style.transform = `scale(${1 - progress * 0.06})`;
      page.style.opacity = String(1 - progress * 0.35);
    });
  };

  pager.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });

  update();
}

// ---------------------------------------------------------------------------
// Theme picker - one shared layout/markup for every theme; each theme is
// just a [data-theme] CSS block (see the end of style.css) swapping
// palette/typography/shape, not a different frontend. The actual
// application already happened synchronously in index.html's inline
// <head> script (to avoid a flash of the wrong theme on load) - this
// just keeps the Settings page's swatches in sync and handles taps.
// ---------------------------------------------------------------------------

const THEME_STORAGE_KEY = "echo-dashboard-theme";

function applyTheme(themeId) {
  if (themeId && themeId !== "default") {
    document.documentElement.dataset.theme = themeId;
  } else {
    delete document.documentElement.dataset.theme;
    themeId = "default";
  }
  document.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeValue === themeId);
  });
}

function setupThemePicker() {
  const grid = byId("theme-grid");
  if (!grid) return;

  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || "default");

  grid.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      const themeId = btn.dataset.themeValue;
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
      applyTheme(themeId);
    });
  });
}

// ---------------------------------------------------------------------------
// Bedside Mode - a one-tap "going to sleep" action: starts rain, dims the
// display further than the ordinary night dim (see body.bedside-active in
// style.css), and makes sure any wake alarms are actually armed, instead
// of several manual steps. The overlay itself (huge clock, alarm/tomorrow
// caption, Sound Machine) lives outside the pager, like the alarm-ringing
// overlay - it's a summoned view, not one more page to swipe to.
// ---------------------------------------------------------------------------

const BEDSIDE_RAIN_SOUND_ID = "rain";
const BEDSIDE_DEFAULT_BRIGHTNESS_PERCENT = 50;

/** Live-updates the --bedside-brightness custom property style.css's
 *  body.bedside-active reads (see the comment there) - purely a local
 *  display preference, nothing to send to Aurora. */
function setBedsideBrightness(percent) {
  document.documentElement.style.setProperty("--bedside-brightness", String(percent / 100));
  setText("bedside-brightness-label", `${percent}%`);
}

async function enterBedsideMode() {
  // Mutually exclusive with Ambient Mode - see setupAmbientMode()'s doc
  // comment for why idle-triggered ambient viewing never fires while
  // this deliberate "going to sleep" mode is active.
  exitAmbientMode();
  clearTimeout(ambientIdleTimer);
  exitReadingMode();
  startSleepSession();

  byId("bedside-overlay")?.classList.remove("hidden");
  document.body.classList.add("bedside-active");

  const slider = byId("bedside-brightness-slider");
  if (slider) slider.value = String(BEDSIDE_DEFAULT_BRIGHTNESS_PERCENT);
  setBedsideBrightness(BEDSIDE_DEFAULT_BRIGHTNESS_PERCENT);

  if (bedsideAutoSoundEnabled) {
    await startLocalPlayback(BEDSIDE_RAIN_SOUND_ID, 0);
    saveSoundState();
    renderSoundMachine();
  }

  // Going to bed re-arms any alarm that got disabled by firing earlier
  // (see checkWakeAlarms()'s "one-time alarms disable themselves" note) -
  // same courtesy Aurora's own Bedside Mode always did.
  wakeAlarms.filter((alarm) => !alarm.enabled).forEach((alarm) => setWakeAlarm({ ...alarm, enabled: true }));
}

/** endSession defaults to true (the manual exit button's plain
 *  addEventListener("click", exitBedsideMode) call passes a MouseEvent
 *  here, which is truthy and !== false, so that default is preserved) -
 *  pass false only when the sleep session should stay open, e.g. a ringing
 *  alarm force-closing the overlay without actually ending the night yet.
 *  See startWakeAlarmRinging()/dismissWakeAlarm(). */
function exitBedsideMode(endSession) {
  byId("bedside-overlay")?.classList.add("hidden");
  document.body.classList.remove("bedside-active");
  resetAmbientIdleTimer();
  if (endSession !== false) endSleepSession();
}

function setupBedsideMode() {
  setIcon("bedside-trigger-icon", "moon");
  setIcon("bedside-exit-icon", "close");
  setIcon("bedside-brightness-icon", "sunny");
  byId("bedside-trigger-btn")?.addEventListener("click", enterBedsideMode);
  byId("bedside-exit-btn")?.addEventListener("click", exitBedsideMode);
  byId("bedside-brightness-slider")?.addEventListener("input", (event) => {
    setBedsideBrightness(Number(event.target.value));
  });
}

// ---------------------------------------------------------------------------
// Weather Background settings (Settings page) - the write side of
// weatherBgManualOverride/weatherBgSchedule above. The effect grid +
// duration select are a shared "staging area" for both actions below
// them (Activate now / Schedule), the same shape as the wallpaper
// schedule's photo grid + time input + Add button.
// ---------------------------------------------------------------------------

let weatherBgSelectedEffect = "rain";

function weatherBgDurationLabel(duration) {
  if (duration === "restofday") return "Rest of day";
  if (duration === "indefinite") return "Indefinite";
  const minutes = parseInt(duration, 10) || 60;
  return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} min`;
}

/** Same idea as currentMinutesInTimezone, in reverse - needed to show a
 *  manual override's expiry in the same timezone the rest of the clock
 *  uses, not the display's raw system time. */
function hhmmFromEpoch(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

function renderWeatherBgActiveHint() {
  const hint = byId("weatherbg-active-hint");
  const stopBtn = byId("weatherbg-stop-btn");
  if (!hint || !stopBtn) return;
  if (!weatherBgManualOverride) {
    hint.classList.add("hidden");
    stopBtn.classList.add("hidden");
    return;
  }
  const label = WEATHER_BG_EFFECT_LABELS[weatherBgManualOverride.effect] || weatherBgManualOverride.effect;
  const untilText =
    weatherBgManualOverride.expiresAt == null
      ? "indefinitely"
      : `until ${formatTimeOfDay(hhmmFromEpoch(weatherBgManualOverride.expiresAt, currentTimezone || undefined))}`;
  hint.textContent = `Forcing ${label} ${untilText}`;
  hint.classList.remove("hidden");
  stopBtn.classList.remove("hidden");
}

function renderWeatherBgSchedule() {
  const list = byId("weatherbg-schedule-list");
  if (!list) return;
  list.innerHTML = weatherBgSchedule
    .map((entry) => {
      const label = WEATHER_BG_EFFECT_LABELS[entry.effect] || entry.effect;
      return `<div class="settings-schedule-row" data-id="${escapeHtml(entry.id)}">
          <span class="settings-schedule-time">${escapeHtml(formatTimeOfDay(entry.time))} · ${escapeHtml(label)} · ${escapeHtml(weatherBgDurationLabel(entry.duration))}</span>
          <button class="settings-schedule-remove" type="button" aria-label="Remove scheduled entry">&times;</button>
        </div>`;
    })
    .join("");
}

function setupWeatherBgSettings() {
  const grid = byId("weatherbg-effect-grid");
  const durationSelect = byId("weatherbg-duration-select");
  if (!grid) return;

  grid.querySelectorAll(".weatherbg-effect-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.effect === weatherBgSelectedEffect);
  });
  renderWeatherBgActiveHint();
  renderWeatherBgSchedule();

  grid.addEventListener("click", (event) => {
    const btn = event.target.closest(".weatherbg-effect-btn");
    if (!btn) return;
    const effect = btn.dataset.effect;
    // "Auto" is an immediate action (go back to the real weather), not a
    // staged pick like every other button here - it has nothing to do
    // with the Activate/Schedule buttons below.
    if (effect === "auto") {
      stopWeatherBgOverride();
      renderWeatherBgActiveHint();
      return;
    }
    weatherBgSelectedEffect = effect;
    grid.querySelectorAll(".weatherbg-effect-btn").forEach((b) => b.classList.toggle("active", b.dataset.effect === effect));
  });

  byId("weatherbg-activate-btn")?.addEventListener("click", () => {
    activateWeatherBgOverride(weatherBgSelectedEffect, durationSelect?.value || "60");
    renderWeatherBgActiveHint();
  });

  byId("weatherbg-stop-btn")?.addEventListener("click", () => {
    stopWeatherBgOverride();
    renderWeatherBgActiveHint();
  });

  byId("weatherbg-schedule-add-btn")?.addEventListener("click", () => {
    const time = byId("weatherbg-schedule-time")?.value;
    if (!time) return;
    weatherBgSchedule = [
      ...weatherBgSchedule,
      { id: `${Date.now()}`, effect: weatherBgSelectedEffect, time, duration: durationSelect?.value || "60" },
    ].sort((a, b) => minutesFromHHMM(a.time) - minutesFromHHMM(b.time));
    saveWeatherBgSchedule();
    renderWeatherBgSchedule();
  });

  byId("weatherbg-schedule-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".settings-schedule-remove");
    if (!removeBtn) return;
    const id = removeBtn.closest(".settings-schedule-row")?.dataset.id;
    weatherBgSchedule = weatherBgSchedule.filter((entry) => entry.id !== id);
    saveWeatherBgSchedule();
    renderWeatherBgSchedule();
  });
}

// ---------------------------------------------------------------------------
// Ambient Mode - a screensaver-style idle view: after the configured idle
// timeout with no touch anywhere on the dashboard, it takes over with a
// huge clock, a tiny weather line, and a twinkling starfield (the same one
// the "Night" weather background uses) - there's no phone-imported photo
// library to cycle through anymore, so this is the whole visual. Any touch
// exits it immediately. Never triggers while Bedside Mode is active -
// that's already a deliberate minimal state, not an idle one.
// ---------------------------------------------------------------------------

const AMBIENT_IDLE_TIMEOUT_KEY = "aurora-dashboard:ambient-idle-minutes";
let ambientIdleMinutes = parseInt(localStorage.getItem(AMBIENT_IDLE_TIMEOUT_KEY), 10) || 30;
const AMBIENT_DEFAULT_BRIGHTNESS_PERCENT = 60;

let ambientIdleTimer = null;

function enterAmbientMode() {
  if (document.body.classList.contains("bedside-active")) return;
  exitReadingMode();

  byId("ambient-overlay")?.classList.remove("hidden");
  document.body.classList.add("ambient-active");
  document.documentElement.style.setProperty(
    "--ambient-brightness",
    String(AMBIENT_DEFAULT_BRIGHTNESS_PERCENT / 100)
  );
  byId("ambient-starfield")?.classList.add("active");
}

function exitAmbientMode() {
  byId("ambient-overlay")?.classList.add("hidden");
  document.body.classList.remove("ambient-active");
}

function isAmbientModeActive() {
  return !(byId("ambient-overlay")?.classList.contains("hidden") ?? true);
}

function resetAmbientIdleTimer() {
  clearTimeout(ambientIdleTimer);
  ambientIdleTimer = setTimeout(() => {
    if (!document.body.classList.contains("bedside-active")) enterAmbientMode();
  }, ambientIdleMinutes * 60 * 1000);
}

function setupAmbientTimeoutSetting() {
  const select = byId("settings-ambient-timeout");
  if (!select) return;
  select.value = String(ambientIdleMinutes);
  select.addEventListener("change", () => {
    ambientIdleMinutes = parseInt(select.value, 10) || 30;
    localStorage.setItem(AMBIENT_IDLE_TIMEOUT_KEY, String(ambientIdleMinutes));
  });
}

function setupAmbientMode() {
  if (!byId("ambient-overlay")) return;

  ["pointerdown", "keydown"].forEach((eventName) => {
    document.addEventListener(
      eventName,
      () => {
        if (isAmbientModeActive()) exitAmbientMode();
        resetAmbientIdleTimer();
      },
      { passive: true }
    );
  });

  resetAmbientIdleTimer();
}

// ---------------------------------------------------------------------------
// World Clock - an optional Overview tile (see TILE_DOM_ID/
// DEFAULT_TILE_LAYOUT) showing a short, user-configured list of other
// timezones. Pure localStorage/Intl, no network involved. The add form is
// a curated <select> of common cities rather than free-text IANA entry -
// typing "America/New_York" correctly via an on-screen keyboard is a poor
// kiosk experience, and the select's own option text doubles as the
// display label so there's nothing else to type at all.
// ---------------------------------------------------------------------------

const WORLD_CLOCK_KEY = "aurora-dashboard:world-clock-cities";
let worldClockCities = [];
try {
  worldClockCities = JSON.parse(localStorage.getItem(WORLD_CLOCK_KEY) || "[]");
} catch (err) {
  worldClockCities = [];
}

function saveWorldClockCities() {
  localStorage.setItem(WORLD_CLOCK_KEY, JSON.stringify(worldClockCities));
}

function renderWorldClocks() {
  const list = byId("worldclock-list");
  if (!list) return;
  if (worldClockCities.length === 0) {
    list.innerHTML = '<div class="worldclock-empty">Add a city in Settings</div>';
    return;
  }
  const now = new Date();
  list.innerHTML = worldClockCities
    .map((city) => {
      let time = "--:--";
      try {
        time = new Intl.DateTimeFormat("en-US", {
          timeZone: city.timezone,
          hour: clock24h ? "2-digit" : "numeric",
          minute: "2-digit",
          hour12: !clock24h,
          hourCycle: clock24h ? "h23" : undefined,
        }).format(now);
      } catch (err) {
        // Unsupported IANA name on this WebView's ICU data - leave the placeholder.
      }
      return `<div class="worldclock-row">
          <span class="worldclock-label">${escapeHtml(city.label)}</span>
          <span class="worldclock-time">${escapeHtml(time)}</span>
        </div>`;
    })
    .join("");
}

function renderWorldClockSettings() {
  const list = byId("settings-worldclock-list");
  if (!list) return;
  if (worldClockCities.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No cities added yet</div>';
    return;
  }
  list.innerHTML = worldClockCities
    .map(
      (city, index) => `<div class="settings-app-row" data-index="${index}">
        <span class="settings-app-label">${escapeHtml(city.label)}</span>
        <button class="icon-button worldclock-remove" type="button" aria-label="Remove ${escapeHtml(city.label)}">
          <span class="icon-slot small" aria-hidden="true">${ICONS.close}</span>
        </button>
      </div>`
    )
    .join("");
}

function setupWorldClock() {
  setIcon("worldclock-title-icon", "globe");
  renderWorldClocks();
  renderWorldClockSettings();

  byId("worldclock-add-btn")?.addEventListener("click", () => {
    const select = byId("worldclock-add-timezone");
    const timezone = select?.value;
    const label = select?.selectedOptions[0]?.textContent;
    if (!timezone || !label) return;
    if (worldClockCities.some((c) => c.timezone === timezone)) return; // no duplicates
    worldClockCities.push({ label, timezone });
    saveWorldClockCities();
    renderWorldClocks();
    renderWorldClockSettings();
  });

  byId("settings-worldclock-list")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".worldclock-remove");
    if (!removeBtn) return;
    const index = Number(removeBtn.closest("[data-index]")?.dataset.index);
    if (Number.isNaN(index)) return;
    worldClockCities.splice(index, 1);
    saveWorldClockCities();
    renderWorldClocks();
    renderWorldClockSettings();
  });
}

// ---------------------------------------------------------------------------
// Breathing Mode - a full-screen guided breathing exercise (inhale / hold /
// exhale / hold), the same "summoned overlay, not a page" shape Bedside/
// Ambient Mode use. A small phase state machine drives a label and a CSS
// class swap; the actual expand/contract motion is a CSS transition on
// .breathing-circle (see style.css), not JS-driven, so it stays smooth
// regardless of main-thread load. Any touch exits it.
// ---------------------------------------------------------------------------

// Hold phases deliberately carry no className - the circle's CSS
// transition (see .breathing-circle in style.css) already takes 4s to
// reach full scale, so simply not touching its class during a 4s hold
// leaves it exactly where the transition settled, no separate "stay put"
// rule needed.
const BREATHING_PHASES = [
  { label: "Breathe in", seconds: 4, className: "breathing-inhale" },
  { label: "Hold", seconds: 4, className: null },
  { label: "Breathe out", seconds: 4, className: "breathing-exhale" },
  { label: "Hold", seconds: 4, className: null },
];

let breathingPhaseIndex = 0;
let breathingPhaseHandle = null;

function runBreathingPhase() {
  const phase = BREATHING_PHASES[breathingPhaseIndex];
  const circle = byId("breathing-circle");
  const label = byId("breathing-label");
  if (circle && phase.className) circle.className = `breathing-circle ${phase.className}`;
  if (label) label.textContent = phase.label;
  breathingPhaseHandle = setTimeout(() => {
    breathingPhaseIndex = (breathingPhaseIndex + 1) % BREATHING_PHASES.length;
    runBreathingPhase();
  }, phase.seconds * 1000);
}

function enterBreathingMode() {
  exitReadingMode();
  byId("breathing-overlay")?.classList.remove("hidden");
  document.body.classList.add("breathing-active");
  breathingPhaseIndex = 0;
  runBreathingPhase();
}

function exitBreathingMode() {
  byId("breathing-overlay")?.classList.add("hidden");
  document.body.classList.remove("breathing-active");
  clearTimeout(breathingPhaseHandle);
  breathingPhaseHandle = null;
}

function setupBreathingMode() {
  setIcon("breathing-trigger-icon", "wind");
  byId("breathing-trigger-btn")?.addEventListener("click", enterBreathingMode);
  byId("breathing-overlay")?.addEventListener("click", exitBreathingMode);
}

// ---------------------------------------------------------------------------
// Night Sky View UI - the summoned overlay for currentSkyPositions() above.
// Renders a horizon-panorama chart (azimuth along the x-axis, altitude
// along the y-axis, horizon at the bottom - the same idea as a real
// "what's up tonight" panorama, just flattened to a strip instead of a
// projected dome, since that's both simpler to draw correctly and easier
// to read at a glance than a fisheye-style hemisphere) plus a plain text
// list underneath. Same "summoned overlay, tap anywhere to exit" shape as
// Breathing Mode.
// ---------------------------------------------------------------------------

const NIGHT_SKY_BODY_LABELS = {
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
};

// ~40 of the brightest, most recognizable stars (J2000 RA/Dec in degrees,
// apparent magnitude - lower is brighter), grouped into a dozen easy-to-spot
// constellations. Fixed stars don't need orbital elements the way planets
// do - their RA/Dec barely shifts on human timescales - so this reuses
// equatorialToHorizontal() directly with the same gmst currentSkyPositions()
// already computes once per render, rather than needing any new math.
const STAR_CATALOG = [
  // Ursa Major (Big Dipper)
  { name: "Dubhe", con: "Ursa Major", ra: 165.93, dec: 61.75, mag: 1.79 },
  { name: "Merak", con: "Ursa Major", ra: 165.46, dec: 56.38, mag: 2.37 },
  { name: "Phecda", con: "Ursa Major", ra: 178.46, dec: 53.69, mag: 2.44 },
  { name: "Megrez", con: "Ursa Major", ra: 183.86, dec: 57.03, mag: 3.31 },
  { name: "Alioth", con: "Ursa Major", ra: 193.51, dec: 55.96, mag: 1.77 },
  { name: "Mizar", con: "Ursa Major", ra: 200.98, dec: 54.93, mag: 2.23 },
  { name: "Alkaid", con: "Ursa Major", ra: 206.89, dec: 49.31, mag: 1.86 },
  // Ursa Minor
  { name: "Polaris", con: "Ursa Minor", ra: 37.95, dec: 89.26, mag: 1.98 },
  // Orion
  { name: "Betelgeuse", con: "Orion", ra: 88.79, dec: 7.41, mag: 0.5 },
  { name: "Rigel", con: "Orion", ra: 78.63, dec: -8.2, mag: 0.13 },
  { name: "Bellatrix", con: "Orion", ra: 81.28, dec: 6.35, mag: 1.64 },
  { name: "Mintaka", con: "Orion", ra: 83.0, dec: -0.3, mag: 2.23 },
  { name: "Alnilam", con: "Orion", ra: 84.05, dec: -1.2, mag: 1.69 },
  { name: "Alnitak", con: "Orion", ra: 85.19, dec: -1.94, mag: 1.74 },
  { name: "Saiph", con: "Orion", ra: 86.94, dec: -9.67, mag: 2.06 },
  // Cassiopeia
  { name: "Schedar", con: "Cassiopeia", ra: 10.13, dec: 56.54, mag: 2.24 },
  { name: "Caph", con: "Cassiopeia", ra: 2.29, dec: 59.15, mag: 2.28 },
  { name: "Gamma Cas", con: "Cassiopeia", ra: 14.18, dec: 60.72, mag: 2.47 },
  { name: "Ruchbah", con: "Cassiopeia", ra: 21.45, dec: 60.24, mag: 2.68 },
  { name: "Segin", con: "Cassiopeia", ra: 28.6, dec: 63.67, mag: 3.35 },
  // Leo
  { name: "Regulus", con: "Leo", ra: 152.09, dec: 11.97, mag: 1.35 },
  { name: "Algieba", con: "Leo", ra: 154.99, dec: 19.84, mag: 2.08 },
  { name: "Zosma", con: "Leo", ra: 168.53, dec: 20.52, mag: 2.56 },
  { name: "Chertan", con: "Leo", ra: 168.56, dec: 15.43, mag: 3.34 },
  { name: "Denebola", con: "Leo", ra: 177.26, dec: 14.57, mag: 2.14 },
  // Cygnus (Northern Cross)
  { name: "Deneb", con: "Cygnus", ra: 310.36, dec: 45.28, mag: 1.25 },
  { name: "Sadr", con: "Cygnus", ra: 305.56, dec: 40.26, mag: 2.23 },
  { name: "Gienah Cygni", con: "Cygnus", ra: 315.13, dec: 33.97, mag: 2.46 },
  { name: "Delta Cyg", con: "Cygnus", ra: 296.24, dec: 45.13, mag: 2.87 },
  { name: "Albireo", con: "Cygnus", ra: 292.68, dec: 27.96, mag: 3.18 },
  // Scorpius
  { name: "Antares", con: "Scorpius", ra: 247.35, dec: -26.43, mag: 1.06 },
  { name: "Dschubba", con: "Scorpius", ra: 240.08, dec: -22.62, mag: 2.29 },
  { name: "Graffias", con: "Scorpius", ra: 241.36, dec: -19.81, mag: 2.56 },
  { name: "Sargas", con: "Scorpius", ra: 264.33, dec: -43.0, mag: 1.86 },
  { name: "Shaula", con: "Scorpius", ra: 263.4, dec: -37.1, mag: 1.62 },
  // Single bright stars, no constellation lines drawn for these
  { name: "Sirius", con: null, ra: 101.29, dec: -16.72, mag: -1.46 },
  { name: "Capella", con: null, ra: 79.17, dec: 46.0, mag: 0.08 },
  { name: "Arcturus", con: null, ra: 213.92, dec: 19.18, mag: -0.05 },
  { name: "Vega", con: null, ra: 279.23, dec: 38.78, mag: 0.03 },
  { name: "Aldebaran", con: null, ra: 68.98, dec: 16.51, mag: 0.87 },
  { name: "Procyon", con: null, ra: 114.83, dec: 5.22, mag: 0.34 },
  { name: "Altair", con: null, ra: 297.7, dec: 8.87, mag: 0.76 },
  { name: "Spica", con: null, ra: 201.3, dec: -11.16, mag: 0.98 },
  { name: "Fomalhaut", con: null, ra: 344.41, dec: -29.62, mag: 1.16 },
];

// Which named stars connect to sketch each constellation's familiar
// shape - deliberately simplified to the recognizable "connect the dots"
// pattern (e.g. the Big Dipper asterism, Orion's belt and shoulders),
// not the full IAU constellation boundary.
const CONSTELLATION_LINES = [
  ["Dubhe", "Merak"], ["Merak", "Phecda"], ["Phecda", "Megrez"], ["Megrez", "Dubhe"],
  ["Megrez", "Alioth"], ["Alioth", "Mizar"], ["Mizar", "Alkaid"],
  ["Betelgeuse", "Bellatrix"], ["Bellatrix", "Mintaka"], ["Mintaka", "Alnilam"],
  ["Alnilam", "Alnitak"], ["Alnitak", "Saiph"], ["Rigel", "Saiph"], ["Rigel", "Mintaka"],
  ["Betelgeuse", "Alnilam"],
  ["Caph", "Schedar"], ["Schedar", "Gamma Cas"], ["Gamma Cas", "Ruchbah"], ["Ruchbah", "Segin"],
  ["Regulus", "Algieba"], ["Algieba", "Zosma"], ["Zosma", "Denebola"], ["Zosma", "Chertan"], ["Chertan", "Regulus"],
  ["Deneb", "Sadr"], ["Sadr", "Albireo"], ["Delta Cyg", "Sadr"], ["Sadr", "Gienah Cygni"],
  ["Dschubba", "Graffias"], ["Dschubba", "Antares"], ["Antares", "Sargas"], ["Sargas", "Shaula"],
];

// Only stars fainter than the naked-eye-friendly cutoff and above the
// horizon get drawn - the catalog above is already curated to bright,
// recognizable stars, so this mostly just guards against an unusually
// permissive future addition rather than filtering much today.
const STAR_MAGNITUDE_CUTOFF = 3.6;

function visibleStars(gmst, lat = HOME_LATITUDE, lon = HOME_LONGITUDE) {
  return STAR_CATALOG.map((star) => {
    const { alt, az } = equatorialToHorizontal(star.ra, star.dec, gmst, lat, lon);
    return { ...star, alt, az };
  }).filter((star) => star.alt > 0 && star.mag <= STAR_MAGNITUDE_CUTOFF);
}

function altitudeDescription(alt) {
  if (alt >= 60) return "near overhead";
  if (alt >= 30) return "high";
  if (alt >= 10) return "partway up";
  return "low, near the horizon";
}

/** Star dot radius shrinks with magnitude (fainter = smaller), same idea
 *  real star charts use - r=2.6 at the brightest end down to r=0.9 at the
 *  cutoff, clamped so nothing vanishes or overwhelms the fixed-size
 *  planet dots drawn on top of them. */
function starDotRadius(mag) {
  const r = 2.6 - (mag + 1.5) * 0.35;
  return Math.max(0.9, Math.min(2.6, r));
}

function renderNightSkyChart(visibleBodies, stars) {
  const svg = byId("night-sky-chart");
  if (!svg) return;

  const toX = (az) => (az / 360) * 360;
  const toY = (alt) => 130 - (Math.max(0, Math.min(90, alt)) / 90) * 120;

  const compassTicks = [
    { label: "N", az: 0 },
    { label: "E", az: 90 },
    { label: "S", az: 180 },
    { label: "W", az: 270 },
    { label: "N", az: 360 },
  ]
    .map((tick) => `<text x="${toX(tick.az)}" y="145" text-anchor="middle" class="night-sky-compass-label">${tick.label}</text>`)
    .join("");

  // Azimuth wraps at 360/0 (north) - a line whose two ends land on
  // opposite sides of that seam would otherwise draw a spurious streak
  // clear across the chart, so lines wider than half the sky are skipped
  // rather than drawn wrapped.
  const starByName = new Map(stars.map((s) => [s.name, s]));
  const lines = CONSTELLATION_LINES.map(([fromName, toName]) => {
    const from = starByName.get(fromName);
    const to = starByName.get(toName);
    if (!from || !to || Math.abs(from.az - to.az) > 180) return "";
    return `<line x1="${toX(from.az)}" y1="${toY(from.alt)}" x2="${toX(to.az)}" y2="${toY(to.alt)}" class="night-sky-constellation-line" />`;
  }).join("");

  // One label per constellation, anchored to its first-listed (brightest
  // by catalog order) star - every star getting its own name would be
  // unreadable clutter at this scale.
  const labeledConstellations = new Set();
  const starDots = stars
    .map((star) => {
      const x = toX(star.az);
      const y = toY(star.alt);
      let label = "";
      if (star.con && !labeledConstellations.has(star.con)) {
        labeledConstellations.add(star.con);
        label = `<text x="${x}" y="${y - 6}" text-anchor="middle" class="night-sky-star-label">${escapeHtml(star.con)}</text>`;
      }
      return `<circle cx="${x}" cy="${y}" r="${starDotRadius(star.mag)}" class="night-sky-star-dot" />${label}`;
    })
    .join("");

  const planetDots = visibleBodies
    .map((body) => {
      const x = toX(body.az);
      const y = toY(body.alt);
      return `<g>
          <circle cx="${x}" cy="${y}" r="4" class="night-sky-dot" />
          <text x="${x}" y="${y - 8}" text-anchor="middle" class="night-sky-dot-label">${NIGHT_SKY_BODY_LABELS[body.key]}</text>
        </g>`;
    })
    .join("");

  svg.innerHTML = `<line x1="0" y1="130" x2="360" y2="130" class="night-sky-horizon-line" />${compassTicks}${lines}${starDots}${planetDots}`;
}

function renderNightSkyList(visibleBodies) {
  const list = byId("night-sky-list");
  if (!list) return;

  if (visibleBodies.length === 0) {
    list.innerHTML = '<div class="night-sky-empty">Nothing bright is up right now.</div>';
    return;
  }

  list.innerHTML = visibleBodies
    .map(
      (body) => `<div class="night-sky-row">
        <span class="night-sky-row-name">${NIGHT_SKY_BODY_LABELS[body.key]}</span>
        <span class="night-sky-row-detail">${altitudeDescription(body.alt)} in the ${compassDirection(body.az)}</span>
      </div>`
    )
    .join("");
}

// Annual meteor showers, peak month/day (roughly stable year to year -
// within about a day of the same calendar date) and typical peak hourly
// rate under dark skies. A shower's peak date is a fixed, well-documented
// annual event safe to hardcode - unlike ISS passes (see
// refreshIssPassHint() below), which need live orbital data and are
// deliberately kept as a separate, opt-in Companion Server call rather than
// baked into this otherwise fully offline table.
const METEOR_SHOWERS = [
  { name: "Quadrantids", month: 1, day: 3, rate: 80 },
  { name: "Lyrids", month: 4, day: 22, rate: 18 },
  { name: "Eta Aquariids", month: 5, day: 5, rate: 30 },
  { name: "Perseids", month: 8, day: 12, rate: 60 },
  { name: "Draconids", month: 10, day: 8, rate: 10 },
  { name: "Orionids", month: 10, day: 21, rate: 20 },
  { name: "Leonids", month: 11, day: 17, rate: 15 },
  { name: "Geminids", month: 12, day: 13, rate: 120 },
  { name: "Ursids", month: 12, day: 22, rate: 10 },
];

// Within a day either side of the listed peak - a shower is a few-day
// window in reality, but the peak date is the only part worth naming.
const METEOR_SHOWER_WINDOW_DAYS = 1;

function activeMeteorShower(date) {
  return METEOR_SHOWERS.find((shower) => {
    const peak = new Date(date.getFullYear(), shower.month - 1, shower.day);
    const daysAway = Math.abs((date - peak) / 86400000);
    return daysAway <= METEOR_SHOWER_WINDOW_DAYS;
  });
}

// First real integration between the weather layer and the astronomy
// layer - previously entirely separate systems. Only speaks up for
// unambiguous conditions (properly Clear, or properly cloudy/precipitating)
// - Partly Cloudy and unrecognized codes stay silent rather than guessing.
const STARGAZING_POOR_CONDITIONS = new Set(["Overcast", "Fog", "Drizzle", "Rain", "Snow", "Rain Showers", "Snow Showers", "Thunderstorm"]);

function stargazingForecastText(weather) {
  if (!weather?.condition) return "";
  if (weather.condition === "Clear") return "Clear skies tonight - good for stargazing.";
  if (STARGAZING_POOR_CONDITIONS.has(weather.condition)) return "Cloudy skies tonight - stars may not be visible.";
  return "";
}

// ISS pass prediction - the one thing METEOR_SHOWERS' comment above flags as
// needing live orbital data (TLE), which this view otherwise deliberately
// avoids. The Companion Server fetches/caches the TLE and does the pass
// math (see server/server.py's find_iss_passes()); the dashboard only ever
// asks for a computed list and caches it locally for a few hours so
// re-opening Night Sky View repeatedly doesn't hit the server every time.
const ISS_PASSES_CACHE_KEY = "aurora-dashboard:iss-passes-cache";
const ISS_PASSES_CACHE_MAX_AGE_MS = 3 * 3600 * 1000;

function hhmmFromDate(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function nextIssPassText(passes) {
  const now = new Date();
  const next = (passes || []).find((p) => new Date(p.set) > now);
  if (!next) return "";
  const rise = new Date(next.rise);
  const sameDay = localDateKey(rise) === localDateKey(now);
  const dayLabel = sameDay ? "tonight" : "tomorrow night";
  return `ISS pass ${dayLabel} at ${formatTimeOfDay(hhmmFromDate(rise))}, up to ${Math.round(next.max_elevation)}° high.`;
}

async function refreshIssPassHint() {
  const hint = byId("night-sky-iss-hint");
  if (!hint || !companionServerConfig()) return;

  const cached = JSON.parse(localStorage.getItem(ISS_PASSES_CACHE_KEY) || "null");
  let passes = cached && Date.now() - cached.fetchedAt < ISS_PASSES_CACHE_MAX_AGE_MS ? cached.passes : null;

  if (!passes) {
    const resp = await companionFetch(
      `/iss-passes?lat=${HOME_LATITUDE}&lon=${HOME_LONGITUDE}&hours=72`,
      { timeoutMs: 10000 }
    );
    if (!resp) return;
    const data = await resp.json();
    passes = data.passes || [];
    localStorage.setItem(ISS_PASSES_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), passes }));
  }

  const text = nextIssPassText(passes);
  hint.textContent = text;
  hint.classList.toggle("hidden", !text);
}

function renderNightSkyView() {
  const now = new Date();
  renderMoonPhaseVisual("moon-visual-nightsky", now);
  setText("night-sky-moon-label", moonPhaseLabel(now));

  const stargazingText = stargazingForecastText(lastWeatherData);
  const stargazingEl = byId("night-sky-stargazing");
  if (stargazingEl) {
    stargazingEl.textContent = stargazingText;
    stargazingEl.classList.toggle("hidden", !stargazingText);
  }

  const shower = activeMeteorShower(now);
  const hint = byId("night-sky-meteor-hint");
  if (hint) {
    hint.textContent = shower ? `${shower.name} peak tonight - up to ~${shower.rate}/hr after midnight.` : "";
    hint.classList.toggle("hidden", !shower);
  }

  const { planets, gmst } = currentSkyPositions(now);
  const bodies = Object.entries(planets)
    .map(([key, pos]) => ({ key, ...pos }))
    .filter((body) => body.alt > 0)
    .sort((a, b) => b.alt - a.alt);
  const stars = visibleStars(gmst);

  renderNightSkyChart(bodies, stars);
  renderNightSkyList(bodies);
}

function enterNightSkyView() {
  renderNightSkyView();
  refreshIssPassHint();
  byId("night-sky-overlay")?.classList.remove("hidden");
}

function exitNightSkyView() {
  byId("night-sky-overlay")?.classList.add("hidden");
}

function setupNightSkyView() {
  byId("night-sky-trigger-btn")?.addEventListener("click", enterNightSkyView);
  byId("night-sky-overlay")?.addEventListener("click", exitNightSkyView);
}

// ---------------------------------------------------------------------------
// Daily quote - a deterministic pick from a small local list, keyed off the
// day of the year so it's the same all day and changes at midnight. Zero
// network involved on purpose, unlike Today in History below - there's no
// reason this should ever be unavailable.
// ---------------------------------------------------------------------------

const DAILY_QUOTES = [
  "The secret of getting ahead is getting started. - Mark Twain",
  "It always seems impossible until it's done. - Nelson Mandela",
  "Well done is better than well said. - Benjamin Franklin",
  "What we think, we become. - Marcus Aurelius",
  "The only way out is through. - Robert Frost",
  "Simplicity is the ultimate sophistication. - Leonardo da Vinci",
  "Do the best you can until you know better. Then do better. - Maya Angelou",
  "Not all those who wander are lost. - J.R.R. Tolkien",
  "The unexamined life is not worth living. - Socrates",
  "Turn your wounds into wisdom. - Oprah Winfrey",
  "Small deeds done are better than great deeds planned. - Peter Marshall",
  "Patience is bitter, but its fruit is sweet. - Jean-Jacques Rousseau",
  "You miss 100% of the shots you don't take. - Wayne Gretzky",
  "Whether you think you can or think you can't, you're right. - Henry Ford",
  "The best time to plant a tree was 20 years ago. The second best time is now.",
  "Fall seven times, stand up eight. - Japanese proverb",
  "Out of clutter, find simplicity. - Albert Einstein",
  "He who has a why to live can bear almost any how. - Friedrich Nietzsche",
  "A journey of a thousand miles begins with a single step. - Laozi",
  "The obstacle is the way. - Marcus Aurelius",
  "Quiet the mind, and the soul will speak. - Ma Jaya Sati Bhagavati",
  "Yesterday is history, tomorrow is a mystery, today is a gift. - Eleanor Roosevelt",
  "Rest when you're weary. Refresh and renew yourself. - Ralph Marston",
  "Almost everything will work again if you unplug it for a few minutes, including you. - Anne Lamott",
  "You are not a drop in the ocean. You are the entire ocean in a drop. - Rumi",
  "The wound is the place where the light enters you. - Rumi",
  "Nothing in life is to be feared, it is only to be understood. - Marie Curie",
  "This too shall pass. - Persian proverb",
  "Wherever you go, go with all your heart. - Confucius",
  "Slow down and everything you are chasing will come around and catch you. - John De Paola",
];

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function renderDailyQuote() {
  setText("briefing-quote", DAILY_QUOTES[dayOfYear(new Date()) % DAILY_QUOTES.length]);
}

function setupDailyQuote() {
  renderDailyQuote();
}

// ---------------------------------------------------------------------------
// Word of the Day - same deterministic day-of-year pick as Daily Quote,
// shown right alongside it. A short vocabulary word, its definition, and
// one example sentence, kept together on one line since the Overview's
// briefing area has no room to spare.
// ---------------------------------------------------------------------------

const WORD_OF_THE_DAY_LIST = [
  { word: "Ephemeral", def: "lasting for a very short time", example: "The morning fog was ephemeral, gone within the hour." },
  { word: "Serendipity", def: "a pleasant surprise found by chance", example: "Finding that old photo was pure serendipity." },
  { word: "Ubiquitous", def: "present everywhere at once", example: "Smartphones have become ubiquitous." },
  { word: "Resilient", def: "able to recover quickly from difficulty", example: "The old oak proved resilient after the storm." },
  { word: "Meticulous", def: "showing great care and precision", example: "She kept meticulous notes on every plant." },
  { word: "Candid", def: "truthful and straightforward", example: "He gave a candid answer, even though it stung." },
  { word: "Eloquent", def: "fluent and persuasive in speaking or writing", example: "Her eloquent toast brought the room to tears." },
  { word: "Tenacious", def: "persistent, not easily giving up", example: "The tenacious vine climbed the whole fence by August." },
  { word: "Whimsical", def: "playfully quaint or fanciful", example: "The garden had a whimsical little gate shaped like a moon." },
  { word: "Diligent", def: "showing careful, persistent effort", example: "A diligent student rereads the hard parts twice." },
  { word: "Placid", def: "calm and peaceful, without disturbance", example: "The lake was placid at dawn, not a ripple in sight." },
  { word: "Verbose", def: "using more words than needed", example: "The report was verbose; half the words could go." },
  { word: "Prudent", def: "acting with care and good judgment", example: "It was prudent to check the weather before the hike." },
  { word: "Nostalgic", def: "sentimentally longing for the past", example: "The song made her nostalgic for summers as a kid." },
  { word: "Astute", def: "sharp-minded and perceptive", example: "His astute question caught something everyone else missed." },
  { word: "Genuine", def: "authentic, not fake or pretended", example: "His surprise at the party was completely genuine." },
  { word: "Lucid", def: "clear and easy to understand", example: "She gave a lucid explanation of a tricky topic." },
  { word: "Solitude", def: "the state of being alone, often peacefully", example: "He treasured an hour of solitude before the house woke up." },
  { word: "Amiable", def: "friendly and good-natured", example: "The new neighbor was amiable from the first hello." },
  { word: "Fortitude", def: "courage and strength in facing hardship", example: "She faced the diagnosis with quiet fortitude." },
  { word: "Meander", def: "to wander slowly, without a fixed path", example: "The trail meanders along the creek for a mile." },
  { word: "Ponder", def: "to think about something carefully", example: "He paused on the porch to ponder the question." },
  { word: "Innate", def: "existing from birth, not learned", example: "Curiosity seemed innate in the puppy from day one." },
  { word: "Concise", def: "brief but complete", example: "Her concise summary said in two lines what took him a page." },
  { word: "Wistful", def: "full of vague or regretful longing", example: "He looked wistful, watching the last of the fireflies." },
];

function renderWordOfTheDay() {
  const entry = WORD_OF_THE_DAY_LIST[dayOfYear(new Date()) % WORD_OF_THE_DAY_LIST.length];
  setText("briefing-word", `${entry.word}: ${entry.def}. "${entry.example}"`);
}

function setupWordOfTheDay() {
  renderWordOfTheDay();
}

// ---------------------------------------------------------------------------
// Dynamic Insight - a one-sentence, non-templated summary of today generated
// by the Companion Server's local Ollama model from whatever's already
// loaded (weather, sleep streak, habit streaks, next Agenda item). Cached
// per calendar day in localStorage, same "generate once, not per page-view"
// idea as Daily Quote/Trivia/Puzzle, since a generation costs a few seconds
// of the server's CPU. Silently stays hidden if no server is configured or
// the request fails - this is a pure upgrade over the templated briefing
// lines above it, never a requirement.
// ---------------------------------------------------------------------------
const DYNAMIC_INSIGHT_KEY = "aurora-dashboard:dynamic-insight";

function dynamicInsightFacts() {
  const facts = {};

  const weather = lastWeatherData;
  if (weather) {
    facts.weather = `${weather.condition}, currently ${displayTemp(weather.temperature)}, high ${displayTemp(weather.high)}${weather.low != null ? `, low ${displayTemp(weather.low)}` : ""}`;
    // Raw Fahrenheit (not the display-converted value) + this dashboard's
    // location, so the server can compare against its own historical
    // average for today's date - see historical_high_average() in
    // server.py. Omitted (server just skips that fact) if weather hasn't
    // loaded yet.
    if (weather.high != null) {
      facts.lat = HOME_LATITUDE;
      facts.lon = HOME_LONGITUDE;
      facts.todayHigh = weather.high;
    }
  }

  const sleepStreak = computeSleepStreak(sleepMinutesByDate());
  const lastNightMinutes = sleepMinutesByDate().get(localDateKey(new Date(Date.now() - 86400000)));
  if (sleepStreak > 0 || lastNightMinutes) {
    facts.sleep = `streak ${sleepStreak} night${sleepStreak === 1 ? "" : "s"}${lastNightMinutes ? `, last night ${(lastNightMinutes / 60).toFixed(1)}h` : ""}`;
  }

  const habitSummaries = habits
    .map((h) => ({ label: h.label, streak: habitStreak(h.id) }))
    .filter((h) => h.streak > 0)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 2)
    .map((h) => `${h.label} (${h.streak}-day streak)`);
  if (habitSummaries.length > 0) facts.habits = habitSummaries.join(", ");

  const firstEvent = agendaEntriesForDate(localDateKey(new Date()))[0];
  if (firstEvent) {
    facts.calendar = firstEvent.title + (firstEvent.time ? ` at ${formatTimeOfDay(firstEvent.time)}` : "");
  }

  // Raw history, not a pre-computed summary - the server does the actual
  // correlation math (see compute_trend_fact() in server.py) since a 1B
  // local model is unreliable at arithmetic, and folds any real finding
  // back into the same one-sentence insight rather than a separate stat.
  facts.sleepHistory = recentSleepHistoryForServer();
  facts.habitCompletionByDate = recentHabitCompletionByDateForServer();

  return facts;
}

/** Shared by dynamicInsightFacts() above and generateWeekInReview() below -
 *  every Companion Server endpoint that reasons about sleep/habit history
 *  wants the same raw shape, computed the same way. */
function recentSleepHistoryForServer() {
  return [...sleepMinutesByDate().entries()].map(([date, minutes]) => ({ date, minutes }));
}

function recentHabitCompletionByDateForServer(days = 60) {
  return Array.from({ length: days }, (_, i) => {
    const dateKey = localDateKey(new Date(Date.now() - i * 86400000));
    return { date: dateKey, completed: habits.some((h) => (habitLog[h.id] || []).includes(dateKey)) };
  });
}

async function refreshDynamicInsight() {
  if (!companionServerConfig()) return;
  const todayKey = localDateKey(new Date());
  const cached = JSON.parse(localStorage.getItem(DYNAMIC_INSIGHT_KEY) || "null");
  if (cached && cached.date === todayKey) {
    renderDynamicInsight(cached.text);
    return;
  }

  const resp = await companionFetch("/insight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dynamicInsightFacts()),
    timeoutMs: 20000,
  });
  if (!resp) return;
  const { text } = await resp.json();
  if (!text) return;
  localStorage.setItem(DYNAMIC_INSIGHT_KEY, JSON.stringify({ date: todayKey, text }));
  renderDynamicInsight(text);
}

function renderDynamicInsight(text) {
  const el = byId("briefing-insight");
  if (!el) return;
  setText("briefing-insight", text);
  el.classList.toggle("hidden", !text);
}

function setupDynamicInsight() {
  refreshDynamicInsight();
}

// ---------------------------------------------------------------------------
// Daily Trivia - same deterministic day-of-year pick as Daily Quote above
// and the Word Puzzle below, just paired with a question/answer instead of
// a passive line, on the Extras page. Tap to reveal rather than showing
// the answer outright, same "don't spoil it before you've had a chance to
// guess" idea as Word Puzzle's own Reveal button.
// ---------------------------------------------------------------------------

const TRIVIA_QUESTIONS = [
  { q: "What's the only mammal capable of true flight?", a: "The bat." },
  { q: "What planet has the most moons in our solar system?", a: "Saturn." },
  { q: "In what year did the Berlin Wall fall?", a: "1989." },
  { q: "What's the smallest country in the world by area?", a: "Vatican City." },
  { q: "What metal is liquid at room temperature?", a: "Mercury." },
  { q: "How many bones are in the adult human body?", a: "206." },
  { q: "What's the longest river in the world?", a: "The Nile." },
  { q: "Who painted the ceiling of the Sistine Chapel?", a: "Michelangelo." },
  { q: "What's the hardest natural substance on Earth?", a: "Diamond." },
  { q: "What was the first country to grant women the right to vote?", a: "New Zealand, in 1893." },
  { q: "What's the tallest mountain in the world, measured from base to peak?", a: "Mauna Kea (most of it underwater) - Everest is tallest above sea level." },
  { q: "What language has the most native speakers worldwide?", a: "Mandarin Chinese." },
  { q: "What's the smallest bone in the human body?", a: "The stapes, in the ear." },
  { q: "What year did the Titanic sink?", a: "1912." },
  { q: "What's the largest desert in the world?", a: "Antarctica - deserts are defined by low precipitation, not heat." },
  { q: "How many hearts does an octopus have?", a: "Three." },
  { q: "What's the currency of Japan?", a: "The yen." },
  { q: "Who wrote 'Romeo and Juliet'?", a: "William Shakespeare." },
  { q: "What's the speed of light, roughly?", a: "About 186,000 miles per second." },
  { q: "What ocean is the largest?", a: "The Pacific." },
  { q: "What's the capital of Australia?", a: "Canberra, not Sydney." },
  { q: "How many strings does a standard violin have?", a: "Four." },
  { q: "What element has the chemical symbol 'Au'?", a: "Gold." },
  { q: "What's the world's most spoken second language?", a: "English." },
  { q: "What year did humans first land on the Moon?", a: "1969." },
  { q: "What's the largest organ in the human body?", a: "The skin." },
  { q: "What animal is the fastest on land?", a: "The cheetah." },
  { q: "How many time zones does Russia span?", a: "Eleven." },
  { q: "What's the boiling point of water at sea level, in Fahrenheit?", a: "212°F." },
  { q: "What ancient wonder of the world still stands today?", a: "The Great Pyramid of Giza." },
];

// If the Companion Server generated one today (see refreshServerTrivia()
// below), use that instead of the static day-of-year pick - still falls
// straight back to the static list on any day it didn't/couldn't.
const SERVER_TRIVIA_KEY = "aurora-dashboard:server-trivia";

function currentTrivia() {
  const todayKey = localDateKey(new Date());
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(SERVER_TRIVIA_KEY) || "null");
  } catch (err) {
    cached = null;
  }
  if (cached && cached.date === todayKey) return { q: cached.q, a: cached.a };
  return TRIVIA_QUESTIONS[dayOfYear(new Date()) % TRIVIA_QUESTIONS.length];
}

function renderDailyTrivia() {
  const trivia = currentTrivia();
  setText("trivia-question", trivia.q);
  const answerEl = byId("trivia-answer");
  if (answerEl) {
    answerEl.textContent = trivia.a;
    answerEl.classList.add("hidden");
  }
  byId("trivia-reveal-btn")?.classList.remove("hidden");
}

/** Generates once per day (cached, same idea as Dynamic Insight) rather
 *  than on every visit to the Trivia tab - a generation costs a few
 *  seconds of the server's CPU. Silently does nothing if unconfigured or
 *  unreachable; the static list is always there as a fallback either way. */
async function refreshServerTrivia() {
  if (!companionServerConfig()) return;
  const todayKey = localDateKey(new Date());
  const cached = JSON.parse(localStorage.getItem(SERVER_TRIVIA_KEY) || "null");
  if (cached && cached.date === todayKey) return;

  const resp = await companionFetch("/trivia", { method: "POST", timeoutMs: 20000 });
  if (!resp) return;
  const data = await resp.json();
  if (!data.q || !data.a) return;
  localStorage.setItem(SERVER_TRIVIA_KEY, JSON.stringify({ date: todayKey, q: data.q, a: data.a }));
  renderDailyTrivia();
}

function setupDailyTrivia() {
  setIcon("trivia-title-icon", "sparkle");
  renderDailyTrivia();
  refreshServerTrivia();
  byId("trivia-reveal-btn")?.addEventListener("click", () => {
    byId("trivia-answer")?.classList.remove("hidden");
    byId("trivia-reveal-btn")?.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------------
// Daily Puzzle - "Odd One Out": four options, one doesn't share the
// category the other three do, tap to guess. A genuinely different puzzle
// shape from Trivia (pattern recognition, not recall) and Word Scramble
// (a tap choice, not typed text - no on-screen keyboard needed). Same
// deterministic day-of-year pick as everything else on this page.
// ---------------------------------------------------------------------------

const PUZZLE_ROUNDS = [
  { options: ["Apple", "Banana", "Carrot", "Orange"], oddIndex: 2, reason: "Carrot is a vegetable - the rest are fruits." },
  { options: ["Salmon", "Trout", "Dolphin", "Tuna"], oddIndex: 2, reason: "A dolphin is a mammal - the rest are fish." },
  { options: ["Square", "Triangle", "Circle", "Sphere"], oddIndex: 3, reason: "A sphere is 3D - the rest are flat shapes." },
  { options: ["Guitar", "Violin", "Cello", "Flute"], oddIndex: 3, reason: "A flute is a wind instrument - the rest are strings." },
  { options: ["Spider", "Ant", "Beetle", "Scorpion"], oddIndex: 1, reason: "An ant has six legs (an insect) - the rest have eight." },
  { options: ["Jupiter", "Mars", "Venus", "Moon"], oddIndex: 3, reason: "The Moon is a moon, not a planet." },
  { options: ["Oak", "Maple", "Pine", "Fern"], oddIndex: 3, reason: "A fern isn't a tree - the rest are." },
  { options: ["Paris", "Tokyo", "Sydney", "California"], oddIndex: 3, reason: "California is a state, not a city." },
  { options: ["Copper", "Iron", "Oxygen", "Silver"], oddIndex: 2, reason: "Oxygen is a gas at room temperature - the rest are metals." },
  { options: ["Piano", "Xylophone", "Drums", "Trumpet"], oddIndex: 3, reason: "A trumpet isn't percussion - the rest are." },
  { options: ["Football", "Chess", "Basketball", "Tennis"], oddIndex: 1, reason: "Chess has no ball - the rest are ball sports." },
  { options: ["Whale", "Dolphin", "Shark", "Seal"], oddIndex: 2, reason: "A shark is a fish - the rest are marine mammals." },
  { options: ["Red", "Blue", "Yellow", "Green"], oddIndex: 3, reason: "Green is a mixed color - red, blue, and yellow are primary colors." },
  { options: ["Saturn", "Earth", "Mars", "Pluto"], oddIndex: 3, reason: "Pluto is classified as a dwarf planet, not a full planet." },
  { options: ["Eagle", "Penguin", "Sparrow", "Robin"], oddIndex: 1, reason: "A penguin can't fly - the rest can." },
  { options: ["Diamond", "Ruby", "Quartz", "Emerald"], oddIndex: 2, reason: "Quartz isn't typically classed as a precious gemstone - the rest are." },
  { options: ["2", "3", "9", "5"], oddIndex: 2, reason: "9 is the only one that isn't a prime number." },
  { options: ["Rome", "Athens", "Cairo", "Berlin"], oddIndex: 2, reason: "Cairo is in Africa - the rest are European capitals." },
  { options: ["Lion", "Tiger", "Wolf", "Leopard"], oddIndex: 2, reason: "A wolf isn't a big cat - the rest are." },
  { options: ["Mercury", "Venus", "Saturn", "Mars"], oddIndex: 2, reason: "Saturn has rings visible from Earth - the rest are the closest rocky planets to the Sun." },
  { options: ["Novel", "Poem", "Essay", "Painting"], oddIndex: 3, reason: "A painting isn't a form of writing - the rest are." },
  { options: ["Hammer", "Screwdriver", "Wrench", "Nail"], oddIndex: 3, reason: "A nail is a fastener, not a tool that drives one." },
  { options: ["Frog", "Toad", "Newt", "Lizard"], oddIndex: 3, reason: "A lizard is a reptile - the rest are amphibians." },
  { options: ["January", "March", "April", "September"], oddIndex: 0, reason: "January has 31 days - the rest have 30." },
];

let dailyPuzzleAnswered = false;

// Persisted so the streak survives reloads and so re-visiting today's
// already-answered puzzle shows the result again instead of letting a
// second guess quietly overwrite it. Keyed by date rather than just a
// running counter so a day skipped entirely (dashboard off, or never
// opened this tab) correctly breaks the streak instead of being invisible.
const PUZZLE_RESULTS_KEY = "aurora-dashboard:puzzle-results";
const PUZZLE_RESULTS_MAX = 60;

let puzzleResults = [];
try {
  puzzleResults = JSON.parse(localStorage.getItem(PUZZLE_RESULTS_KEY) || "[]");
} catch (err) {
  puzzleResults = [];
}

function savePuzzleResult(correct) {
  const todayKey = localDateKey(new Date());
  puzzleResults = [...puzzleResults.filter((r) => r.date !== todayKey), { date: todayKey, correct }].slice(-PUZZLE_RESULTS_MAX);
  localStorage.setItem(PUZZLE_RESULTS_KEY, JSON.stringify(puzzleResults));
}

function todaysPuzzleResult() {
  return puzzleResults.find((r) => r.date === localDateKey(new Date())) || null;
}

/** Consecutive days answered correctly, walking backward from today - same
 *  "don't break the streak just because today hasn't been played yet"
 *  reasoning as habitStreak() and computeSleepStreak(). */
function puzzleGuessStreak() {
  const byDate = new Map(puzzleResults.map((r) => [r.date, r.correct]));
  const dateKeyForOffset = (i) => localDateKey(new Date(Date.now() - i * 86400000));
  let streak = 0;
  let offset = byDate.has(dateKeyForOffset(0)) ? 0 : 1;
  while (byDate.get(dateKeyForOffset(offset)) === true) {
    streak++;
    offset++;
  }
  return streak;
}

function renderPuzzleStreak() {
  const streak = puzzleGuessStreak();
  setText("puzzle-streak", streak > 0 ? `${streak}-day streak` : "");
}

function showPuzzleResult(round, chosenIndex, correct) {
  dailyPuzzleAnswered = true;
  byId("puzzle-options")
    ?.querySelectorAll(".puzzle-option-btn")
    .forEach((b, i) => {
      if (i === round.oddIndex) b.classList.add("correct");
      else if (i === chosenIndex) b.classList.add("incorrect");
    });

  const feedback = byId("puzzle-feedback");
  if (feedback) {
    feedback.textContent = (correct ? "Correct! " : "Not quite. ") + round.reason;
    feedback.classList.remove("hidden");
  }
}

// Same "prefer today's server-generated one, fall back to the static
// day-of-year pick" idea as currentTrivia() above.
const SERVER_PUZZLE_KEY = "aurora-dashboard:server-puzzle";

function currentPuzzleRound() {
  const todayKey = localDateKey(new Date());
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(SERVER_PUZZLE_KEY) || "null");
  } catch (err) {
    cached = null;
  }
  if (cached && cached.date === todayKey) {
    return { options: cached.options, oddIndex: cached.oddIndex, reason: cached.reason };
  }
  return PUZZLE_ROUNDS[dayOfYear(new Date()) % PUZZLE_ROUNDS.length];
}

/** Generates once per day, same caching idea as refreshServerTrivia() -
 *  note the puzzle endpoint runs a larger model server-side specifically
 *  because the small one wasn't reliable at "odd one out" logic (see
 *  server.py's own comment on generate_puzzle()), so this can take
 *  noticeably longer than the trivia refresh - still fine, it's a
 *  background fetch, not something the UI waits on. */
async function refreshServerPuzzle() {
  if (!companionServerConfig()) return;
  const todayKey = localDateKey(new Date());
  const cached = JSON.parse(localStorage.getItem(SERVER_PUZZLE_KEY) || "null");
  if (cached && cached.date === todayKey) return;

  const resp = await companionFetch("/puzzle", { method: "POST", timeoutMs: 30000 });
  if (!resp) return;
  const data = await resp.json();
  if (!Array.isArray(data.options) || data.options.length !== 4 || typeof data.oddIndex !== "number" || !data.reason) return;
  localStorage.setItem(
    SERVER_PUZZLE_KEY,
    JSON.stringify({ date: todayKey, options: data.options, oddIndex: data.oddIndex, reason: data.reason })
  );
  // Only re-render if today's puzzle hasn't already been answered - don't
  // swap the options out from under someone mid-guess or after they've
  // already played today's (static) round.
  if (!todaysPuzzleResult()) renderDailyPuzzle();
}

function renderDailyPuzzle() {
  const round = currentPuzzleRound();
  const container = byId("puzzle-options");
  if (!container) return;
  dailyPuzzleAnswered = false;
  container.innerHTML = round.options
    .map((opt, i) => `<button class="puzzle-option-btn" type="button" data-index="${i}">${escapeHtml(opt)}</button>`)
    .join("");
  const feedback = byId("puzzle-feedback");
  if (feedback) {
    feedback.textContent = "";
    feedback.classList.add("hidden");
  }
  renderPuzzleStreak();

  // Already played today (e.g. a reload) - show the same result again
  // rather than letting it be guessed a second time.
  const todaysResult = todaysPuzzleResult();
  if (todaysResult) {
    // The correct option's index is deterministic from the date, but which
    // option was actually chosen isn't recorded - only whether it was
    // right. A wrong guess just highlights the correct answer without
    // marking any option "incorrect" on reload, which is a fine trade for
    // not needing to persist the chosen index too.
    showPuzzleResult(round, todaysResult.correct ? round.oddIndex : -1, todaysResult.correct);
  }
}

function setupDailyPuzzle() {
  setIcon("puzzle-title-icon", "sparkle");
  renderDailyPuzzle();
  refreshServerPuzzle();
  byId("puzzle-options")?.addEventListener("click", (event) => {
    if (dailyPuzzleAnswered) return;
    const btn = event.target.closest(".puzzle-option-btn");
    if (!btn) return;

    const round = currentPuzzleRound();
    const chosenIndex = Number(btn.dataset.index);
    const correct = chosenIndex === round.oddIndex;
    showPuzzleResult(round, chosenIndex, correct);
    savePuzzleResult(correct);
    renderPuzzleStreak();
  });
}

// ---------------------------------------------------------------------------
// Today in History - Wikipedia's public "on this day" REST API (CORS-
// enabled, no key needed). Daily Info page only. Graceful "just hide the
// card" fallback on failure, same resilience philosophy as the weather
// layer above - this is decoration, not something worth a retry loop over.
// ---------------------------------------------------------------------------

async function loadTodayInHistory() {
  const card = byId("history-card");
  const list = byId("history-list");
  if (!card || !list) return;
  setIcon("history-title-icon", "scroll");

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  try {
    const response = await fetchJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/${month}/${day}`);
    const events = (response.selected || []).slice(0, 3);
    if (events.length === 0) {
      card.classList.add("hidden");
      return;
    }
    list.innerHTML = events
      .map((event) => `<li class="history-item"><b>${escapeHtml(String(event.year))}</b> ${escapeHtml(event.text)}</li>`)
      .join("");
    card.classList.remove("hidden");
  } catch (err) {
    card.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Journal - one short entry a night, keyed by date. Pure localStorage, no
// network. The point isn't the entry itself so much as what it becomes a
// year later: journalEntryOneYearAgo() surfaces whatever was written on
// this same month/day last year, right above tonight's blank box - the one
// feature on this dashboard that gets more valuable the longer it's used
// instead of just repeating the same view every day.
// ---------------------------------------------------------------------------

const JOURNAL_KEY = "aurora-dashboard:journal";
const JOURNAL_SAVE_DEBOUNCE_MS = 600;

function loadJournalEntries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

let journalEntries = loadJournalEntries();
let journalSaveHandle = null;

function saveJournalEntries() {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(journalEntries));
}

/** Looks up the entry from exactly one year before today's date - not
 *  "365 days ago", so it still lands on the same calendar date across leap
 *  years. */
function journalEntryOneYearAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return journalEntries[localDateKey(d)] || null;
}

function formatJournalDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isJournalLocked() {
  return !!journalPasswordHash && !journalUnlocked;
}

/** Called when swiping away from the Extras page (see setupPager()) - a
 *  password-protected Journal that stays unlocked for the rest of the
 *  kiosk session the moment you glance away isn't really a deterrent.
 *  No-ops if there's no password set, or it's already locked. */
function lockJournal() {
  if (!journalPasswordHash || !journalUnlocked) return;
  journalUnlocked = false;
  renderJournal();
}

function renderJournal() {
  const textarea = byId("journal-textarea");
  const callback = byId("journal-callback");
  const callbackText = byId("journal-callback-text");
  const gate = byId("journal-locked-gate");
  const historyBtn = byId("journal-history-btn");
  if (!textarea) return;

  const locked = isJournalLocked();
  gate?.classList.toggle("hidden", !locked);
  textarea.classList.toggle("hidden", locked);
  historyBtn?.classList.toggle("hidden", locked);
  if (locked) {
    callback?.classList.add("hidden");
    // Not an early return above renderJournalReflection() - that call has
    // to run in the locked case too, since it's the thing that hides the
    // Weekly Reflection button itself. It was missed here once already:
    // this exact early return skipped it entirely, leaving the button
    // visible (and clickable, and able to send journal content off-device)
    // even while the Journal was showing as locked.
    renderJournalReflection();
    return;
  }

  const todayKey = localDateKey(new Date());
  if (document.activeElement !== textarea) {
    textarea.value = journalEntries[todayKey] || "";
  }

  const lastYear = journalEntryOneYearAgo();
  if (callback && callbackText) {
    if (lastYear) {
      callbackText.textContent = lastYear;
      callback.classList.remove("hidden");
    } else {
      callback.classList.add("hidden");
    }
  }

  renderJournalReflection();
}

// ---------------------------------------------------------------------------
// Weekly Reflection - a generated 3-4 sentence reflection over the past
// week's Journal entries, from the Companion Server (local model only,
// never a cloud call - see generate_journal_reflection() in server.py).
// Explicitly gated behind the *same* protection the Journal itself already
// has: the button only ever appears while isJournalLocked() is false (see
// setupWeeklyReflection() below), and journal text is only ever sent on an
// explicit tap of this button - never automatically, never in the
// background. If no password is set on the Journal, this is exactly as
// open as the Journal itself already is - it doesn't add its own separate
// password, it inherits whichever protection the Journal already has.
// ---------------------------------------------------------------------------
const JOURNAL_REFLECTION_KEY = "aurora-dashboard:journal-reflection";

/** ISO 8601 week number as "YYYY-Www" - used as the cache key so this only
 *  ever generates once per calendar week, not once per tap. */
function currentIsoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function renderJournalReflection() {
  const area = byId("journal-reflection-area");
  const text = byId("journal-reflection-text");
  const btn = byId("journal-reflection-btn");
  // Both conditions matter here: no server configured means the feature
  // never applies at all, and locked means it's not applicable *right now*
  // - either way, the button (which would otherwise let a tap send journal
  // content off-device) has to stay hidden, not just the display area.
  const canShow = !isJournalLocked() && !!companionServerConfig();
  btn?.classList.toggle("hidden", !canShow);
  if (!area || !text) return;
  if (!canShow) {
    area.classList.add("hidden");
    return;
  }
  const cached = JSON.parse(localStorage.getItem(JOURNAL_REFLECTION_KEY) || "null");
  const thisWeek = currentIsoWeekKey(new Date());
  if (cached && cached.week === thisWeek) {
    text.textContent = cached.text;
    area.classList.remove("hidden");
  } else {
    area.classList.add("hidden");
  }
}

async function generateWeeklyReflection() {
  if (isJournalLocked() || !companionServerConfig()) return;
  const btn = byId("journal-reflection-btn");

  const cutoff = Date.now() - 7 * 86400000;
  const entries = Object.entries(journalEntries)
    .filter(([date]) => new Date(date).getTime() >= cutoff)
    .map(([date, text]) => ({ date, text }));
  if (entries.length === 0) return;

  const originalLabel = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Reflecting...";
  }
  const resp = await companionFetch("/journal-reflection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
    timeoutMs: 30000,
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
  if (!resp) return;
  const data = await resp.json();
  if (!data.text) return;
  localStorage.setItem(JOURNAL_REFLECTION_KEY, JSON.stringify({ week: currentIsoWeekKey(new Date()), text: data.text }));
  renderJournalReflection();
}

function setupWeeklyReflection() {
  renderJournalReflection();
  byId("journal-reflection-btn")?.addEventListener("click", generateWeeklyReflection);
}

function setupJournal() {
  setIcon("journal-title-icon", "book");
  setIcon("journal-history-icon", "scroll");
  setIcon("journal-locked-icon", "lock");
  renderJournal();
  setupJournalUnlockGate();
  setupJournalPasswordSettings();
  setupWeeklyReflection();

  byId("journal-textarea")?.addEventListener("input", (event) => {
    const todayKey = localDateKey(new Date());
    const text = event.target.value;
    if (journalSaveHandle) clearTimeout(journalSaveHandle);
    journalSaveHandle = setTimeout(() => {
      if (text.trim()) journalEntries[todayKey] = text;
      else delete journalEntries[todayKey];
      saveJournalEntries();
    }, JOURNAL_SAVE_DEBOUNCE_MS);
  });

  byId("journal-history-btn")?.addEventListener("click", openJournalHistory);
}

// ---------------------------------------------------------------------------
// Journal password - an always-on lock on this one page, separate from
// Privacy Mode (which is a come-and-go "someone's in the room right now"
// toggle covering other tiles). Only a SHA-256 hash is ever stored, never
// the plaintext password, but with no salt and nothing server-side to rate-
// limit guesses this is a casual glance-deterrent, not real security -
// anyone with direct access to this device's files could still read the
// raw localStorage/IndexedDB data underneath it. journalUnlocked is
// intentionally in-memory only (never persisted) so every fresh page load
// starts locked again, matching "no one else can read it without the
// password" rather than "read it once and it stays open forever."
// Changing or removing an existing password requires re-entering it
// correctly first - otherwise anyone could bypass the lock entirely just by
// visiting this unlocked Settings page, without ever knowing the password.
// ---------------------------------------------------------------------------

const JOURNAL_PASSWORD_HASH_KEY = "aurora-dashboard:journal-password-hash";
let journalPasswordHash = localStorage.getItem(JOURNAL_PASSWORD_HASH_KEY) || null;
let journalUnlocked = false;

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderJournalPasswordSettings() {
  const hasPassword = !!journalPasswordHash;
  byId("journal-password-set-row")?.classList.toggle("hidden", hasPassword);
  byId("journal-password-change-row")?.classList.toggle("hidden", !hasPassword);
}

function showJournalPasswordFeedback(text) {
  const feedback = byId("journal-password-feedback");
  if (!feedback) return;
  feedback.textContent = text;
  feedback.classList.toggle("hidden", !text);
}

function setupJournalPasswordSettings() {
  renderJournalPasswordSettings();

  byId("journal-password-set-btn")?.addEventListener("click", async () => {
    const input = byId("journal-password-new");
    const password = input?.value;
    if (!password) return;
    journalPasswordHash = await hashPassword(password);
    localStorage.setItem(JOURNAL_PASSWORD_HASH_KEY, journalPasswordHash);
    journalUnlocked = false; // setting a fresh password re-locks the page, even mid-session
    if (input) input.value = "";
    renderJournalPasswordSettings();
    renderJournal();
    showJournalPasswordFeedback("Password set.");
  });

  byId("journal-password-remove-btn")?.addEventListener("click", async () => {
    const input = byId("journal-password-current");
    const password = input?.value;
    if (!password) return;
    if ((await hashPassword(password)) !== journalPasswordHash) {
      showJournalPasswordFeedback("Wrong password.");
      return;
    }
    journalPasswordHash = null;
    localStorage.removeItem(JOURNAL_PASSWORD_HASH_KEY);
    journalUnlocked = true; // already proved they know it - no reason to also lock them out now
    if (input) input.value = "";
    renderJournalPasswordSettings();
    renderJournal();
    showJournalPasswordFeedback("Password removed.");
  });
}

function setupJournalUnlockGate() {
  const submit = async () => {
    const input = byId("journal-unlock-input");
    const feedback = byId("journal-unlock-feedback");
    const password = input?.value;
    if (!password) return;
    if ((await hashPassword(password)) === journalPasswordHash) {
      journalUnlocked = true;
      if (input) input.value = "";
      feedback?.classList.add("hidden");
      renderJournal();
    } else if (feedback) {
      feedback.textContent = "Wrong password.";
      feedback.classList.remove("hidden");
    }
  };
  byId("journal-unlock-btn")?.addEventListener("click", submit);
  byId("journal-unlock-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
}

// ---------------------------------------------------------------------------
// Journal History - a popover (same backdrop/popover shape as the Week
// View) listing every past entry newest-first. Only reachable while the
// Journal is unlocked (the button itself is hidden by renderJournal()
// while locked - see isJournalLocked()), and past entries are read-only:
// this is a diary you look back on, not one you go back and edit.
// ---------------------------------------------------------------------------

function renderJournalHistoryList() {
  const list = byId("journal-history-list");
  if (!list) return;
  const todayKey = localDateKey(new Date());
  const entries = Object.entries(journalEntries)
    .filter(([dateKey]) => dateKey !== todayKey)
    .sort((a, b) => b[0].localeCompare(a[0]));

  if (entries.length === 0) {
    list.innerHTML = '<div class="settings-app-empty">No past entries yet</div>';
    return;
  }

  list.innerHTML = entries
    .map(([dateKey, text]) => {
      const preview = text.length > 50 ? `${text.slice(0, 50)}…` : text;
      return `<button class="journal-history-row" type="button" data-date="${escapeHtml(dateKey)}">
          <span class="journal-history-row-date">${escapeHtml(formatJournalDate(dateKey))}</span>
          <span class="journal-history-row-preview">${escapeHtml(preview)}</span>
        </button>`;
    })
    .join("");
}

function openJournalHistoryDetail(dateKey) {
  byId("journal-history-list")?.classList.add("hidden");
  byId("journal-history-detail")?.classList.remove("hidden");
  setText("journal-history-detail-date", formatJournalDate(dateKey));
  setText("journal-history-detail-text", journalEntries[dateKey] || "");
}

function closeJournalHistoryDetail() {
  byId("journal-history-detail")?.classList.add("hidden");
  byId("journal-history-list")?.classList.remove("hidden");
}

function openJournalHistory() {
  renderJournalHistoryList();
  closeJournalHistoryDetail();
  byId("journal-history-popover")?.classList.remove("hidden");
  byId("journal-history-backdrop")?.classList.remove("hidden");
}

function closeJournalHistory() {
  byId("journal-history-popover")?.classList.add("hidden");
  byId("journal-history-backdrop")?.classList.add("hidden");
}

function setupJournalHistory() {
  byId("journal-history-close")?.addEventListener("click", closeJournalHistory);
  byId("journal-history-backdrop")?.addEventListener("click", closeJournalHistory);
  byId("journal-history-back-btn")?.addEventListener("click", closeJournalHistoryDetail);
  byId("journal-history-list")?.addEventListener("click", (event) => {
    const row = event.target.closest(".journal-history-row");
    if (row) openJournalHistoryDetail(row.dataset.date);
  });
}

// ---------------------------------------------------------------------------
// Word Scramble - a tiny daily puzzle, same deterministic-by-date pattern
// as the daily quote (dayOfYear() indexes a local word list, so it's the
// same word all day for everyone and changes at midnight). The scramble
// itself is seeded off that same day index via a small deterministic PRNG
// (mulberry32) so reloading the page mid-guess doesn't reshuffle the
// letters out from under an in-progress attempt.
// ---------------------------------------------------------------------------

const WORD_PUZZLE_WORDS = [
  "PILLOW", "BLANKET", "MORNING", "COFFEE", "GARDEN", "WHISPER", "LANTERN",
  "HARBOR", "MEADOW", "CANDLE", "JOURNEY", "AUTUMN", "STARLIT", "COZY",
  "DRIFT", "SUNRISE", "TWILIGHT", "GENTLE", "QUIET", "PORCH", "BREEZE",
  "ORCHARD", "VELVET", "AMBER", "HOLLOW", "RIPPLE", "FIREFLY", "HUMMING",
  "COTTAGE", "MOSAIC", "WANDER", "SILVER", "MEANDER", "HORIZON", "PEBBLE",
  "SATCHEL", "LULLABY", "MIDNIGHT", "FEATHER", "ANCHOR", "MELODY", "SUNSET",
  "TIMBER", "CRICKET", "GRANITE", "WILLOW", "COMPASS", "BLOSSOM", "CRIMSON",
  "SHELTER", "HARVEST",
];

const WORD_PUZZLE_STATE_KEY = "aurora-dashboard:word-puzzle-state";

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todaysPuzzleWord() {
  return WORD_PUZZLE_WORDS[dayOfYear(new Date()) % WORD_PUZZLE_WORDS.length];
}

/** Deterministic per-day shuffle - same seed (the day index) always
 *  produces the same scramble, so it doesn't change between renders or
 *  page reloads within the same day. Falls back to a plain reversal on the
 *  rare chance the shuffle lands back on the original word. */
function scrambleWord(word, seed) {
  const letters = word.split("");
  const rand = mulberry32(seed);
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const scrambled = letters.join("");
  return scrambled === word && word.length > 1 ? [...word].reverse().join("") : scrambled;
}

function loadWordPuzzleState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORD_PUZZLE_STATE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : { dateKey: "", solved: false, revealed: false };
  } catch (err) {
    return { dateKey: "", solved: false, revealed: false };
  }
}

let wordPuzzleState = loadWordPuzzleState();

function saveWordPuzzleState() {
  localStorage.setItem(WORD_PUZZLE_STATE_KEY, JSON.stringify(wordPuzzleState));
}

function ensureWordPuzzleStateForToday() {
  const todayKey = localDateKey(new Date());
  if (wordPuzzleState.dateKey === todayKey) return;
  wordPuzzleState = { dateKey: todayKey, solved: false, revealed: false };
  saveWordPuzzleState();
}

function renderWordPuzzle() {
  const scrambledEl = byId("wordpuzzle-scrambled");
  const feedbackEl = byId("wordpuzzle-feedback");
  const guessInput = byId("wordpuzzle-guess");
  if (!scrambledEl) return;

  ensureWordPuzzleStateForToday();
  setIcon("wordpuzzle-title-icon", "sparkle");

  const word = todaysPuzzleWord();
  const solvedOrRevealed = wordPuzzleState.solved || wordPuzzleState.revealed;

  scrambledEl.textContent = solvedOrRevealed ? word : scrambleWord(word, dayOfYear(new Date()));
  scrambledEl.classList.toggle("wordpuzzle-scrambled-solved", solvedOrRevealed);

  if (guessInput) guessInput.classList.toggle("hidden", solvedOrRevealed);
  byId("wordpuzzle-check-btn")?.classList.toggle("hidden", solvedOrRevealed);
  byId("wordpuzzle-reveal-btn")?.classList.toggle("hidden", solvedOrRevealed);

  if (feedbackEl) {
    if (wordPuzzleState.solved) feedbackEl.textContent = "Solved!";
    else if (wordPuzzleState.revealed) feedbackEl.textContent = "";
    else feedbackEl.textContent = "";
  }
}

function setupWordPuzzle() {
  renderWordPuzzle();

  const submitGuess = () => {
    const guessInput = byId("wordpuzzle-guess");
    const feedbackEl = byId("wordpuzzle-feedback");
    if (!guessInput) return;
    const guess = guessInput.value.trim().toUpperCase();
    if (!guess) return;
    if (guess === todaysPuzzleWord()) {
      wordPuzzleState.solved = true;
      saveWordPuzzleState();
      renderWordPuzzle();
    } else if (feedbackEl) {
      feedbackEl.textContent = "Not quite - try again";
      guessInput.value = "";
    }
  };

  byId("wordpuzzle-check-btn")?.addEventListener("click", submitGuess);
  byId("wordpuzzle-guess")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitGuess();
  });
  byId("wordpuzzle-reveal-btn")?.addEventListener("click", () => {
    wordPuzzleState.revealed = true;
    saveWordPuzzleState();
    renderWordPuzzle();
  });
}

/** Same segmented-toggle wiring as setupTimerPage() - Journal, Word
 *  Game, Trivia, and Puzzle share one page, one at a time. */
function setupExtrasPage() {
  setupJournal();
  setupWordPuzzle();
  setupDailyTrivia();
  setupDailyPuzzle();

  const segmented = byId("extras-mode-segmented");
  segmented?.addEventListener("click", (event) => {
    const btn = event.target.closest(".settings-segment");
    if (!btn) return;
    segmented.querySelectorAll(".settings-segment").forEach((b) => b.classList.toggle("active", b === btn));
    byId("journal-view")?.classList.toggle("hidden", btn.dataset.mode !== "journal");
    byId("wordpuzzle-view")?.classList.toggle("hidden", btn.dataset.mode !== "wordpuzzle");
    byId("trivia-view")?.classList.toggle("hidden", btn.dataset.mode !== "trivia");
    byId("puzzle-view")?.classList.toggle("hidden", btn.dataset.mode !== "puzzle");
  });
}

// ---------------------------------------------------------------------------
// Ask the Dashboard - free-text Q&A via the Companion Server's local model
// (see generate_answer() in server.py). Its own page rather than a tab
// inside Extras - a deliberate "I have a question" trip is a different
// kind of interaction from the casual, flip-past-it Trivia/Puzzle/Word
// Game tabs it used to share space with. No caching, no daily limit, just
// a plain question/answer exchange each time it's tapped.
// ---------------------------------------------------------------------------
async function submitAskQuestion() {
  const input = byId("ask-question-input");
  const answerEl = byId("ask-answer-text");
  const btn = byId("ask-submit-btn");
  const question = input?.value.trim();
  if (!question) return;

  if (btn) btn.disabled = true;
  if (answerEl) {
    answerEl.textContent = "Thinking...";
    answerEl.classList.remove("hidden");
  }

  const resp = await companionFetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    timeoutMs: 50000, // Ask runs on the larger/slower model - see generate_answer() in server.py
  });
  if (btn) btn.disabled = false;
  if (!resp) {
    if (answerEl) answerEl.textContent = "Couldn't reach the Companion Server.";
    return;
  }
  const data = await resp.json();
  if (answerEl) answerEl.textContent = data.text || "No answer came back.";
}

/** Same "empty-state hint instead of a hidden control" pattern as Homelab
 *  Status - this is a real page you can always swipe to, unlike the old
 *  Extras tab which stayed hidden entirely without a server configured. */
function setupAskPage() {
  setIcon("ask-title-icon", "sparkle");
  const hasServer = !!companionServerConfig();
  byId("ask-no-server-hint")?.classList.toggle("hidden", hasServer);
  byId("ask-question-input").disabled = !hasServer;
  byId("ask-submit-btn").disabled = !hasServer;
  byId("ask-submit-btn")?.addEventListener("click", submitAskQuestion);
  byId("ask-question-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitAskQuestion();
  });
}

// ---------------------------------------------------------------------------
// Backup - everything this dashboard knows, in one downloadable file. There's
// no server holding any of this: every setting, the whole Agenda, every
// Journal entry, every imported sound and wallpaper photo lives only in this
// browser's localStorage/IndexedDB. A cleared profile, a factory reset, or
// just moving to a new kiosk device would otherwise lose all of it with no
// way back - this is the way back.
//
// localStorage keys are collected dynamically (any "aurora-dashboard:" key,
// plus the theme choice) rather than off a hardcoded list, so a future
// feature that adds its own key is backed up automatically without anyone
// having to remember to update this section. WEATHER_CACHE_KEY is the one
// deliberate exclusion - it's a re-fetched cache, not a setting, and
// restoring a stale one would just show outdated weather until the next
// poll overwrites it anyway.
// ---------------------------------------------------------------------------

const BACKUP_VERSION = 1;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // "data:<mime>;base64,...."
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl, mimeType) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function collectBackupLocalStorage() {
  const entries = {};
  for (const key of Object.keys(localStorage)) {
    if (key === WEATHER_CACHE_KEY) continue;
    if (key.startsWith("aurora-dashboard:") || key === "echo-dashboard-theme") {
      entries[key] = localStorage.getItem(key);
    }
  }
  return entries;
}

async function buildBackupObject() {
  const [soundRecords, photoRecords] = await Promise.all([
    loadAllCustomSoundRecords().catch(() => []),
    loadAllWallpaperRecords().catch(() => []),
  ]);

  const customSoundsData = await Promise.all(
    soundRecords.map(async (r) => ({
      id: r.id,
      displayName: r.displayName,
      mimeType: r.blob.type,
      dataUrl: await blobToBase64(r.blob),
    }))
  );
  const wallpaperPhotosData = await Promise.all(
    photoRecords.map(async (r) => ({
      id: r.id,
      mimeType: r.blob.type,
      dataUrl: await blobToBase64(r.blob),
    }))
  );

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    localStorage: collectBackupLocalStorage(),
    customSounds: customSoundsData,
    wallpaperPhotos: wallpaperPhotosData,
  };
}

async function exportBackup() {
  const backup = await buildBackupObject();
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `echo-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Restore = replace, not merge - clears every existing "aurora-dashboard:"
 *  key and every existing custom sound/wallpaper photo before writing the
 *  backup's contents, so a restore never leaves stale entries mixed in
 *  alongside the recovered ones. Reloads the page once done rather than
 *  trying to hot-reload the dozens of module-level variables each section
 *  of this file initializes once from storage at load time - a fresh load
 *  is the only way to guarantee every one of them picks up the restored
 *  values. Shared by both the local file-based restore and the Companion
 *  Server restore below - only how `backup` is obtained differs. */
async function restoreBackupObject(backup) {
  if (!backup || typeof backup !== "object" || !backup.localStorage) {
    throw new Error("That doesn't look like a dashboard backup.");
  }

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("aurora-dashboard:") || key === "echo-dashboard-theme") {
      localStorage.removeItem(key);
    }
  }
  for (const [key, value] of Object.entries(backup.localStorage)) {
    localStorage.setItem(key, value);
  }

  const [existingSounds, existingPhotos] = await Promise.all([
    loadAllCustomSoundRecords().catch(() => []),
    loadAllWallpaperRecords().catch(() => []),
  ]);
  await Promise.all(existingSounds.map((r) => deleteCustomSoundRecord(r.id)));
  await Promise.all(existingPhotos.map((r) => deleteWallpaperRecord(r.id)));

  for (const entry of backup.customSounds || []) {
    const blob = base64ToBlob(entry.dataUrl, entry.mimeType);
    await saveCustomSoundRecord(entry.id, entry.displayName, blob);
  }
  for (const entry of backup.wallpaperPhotos || []) {
    const blob = base64ToBlob(entry.dataUrl, entry.mimeType);
    await saveWallpaperRecord(entry.id, blob);
  }
}

async function importBackup(file) {
  const text = await file.text();
  await restoreBackupObject(JSON.parse(text));
}

// ---------------------------------------------------------------------------
// Companion Server backup - the same backup object as the local Export/
// Import above, just sent to/fetched from the LAN server instead of a
// downloaded file, so there's an off-device copy without needing a phone or
// a manual file transfer. Purely opt-in - see setupCompanionServerSettings()
// for the Settings UI and companionServerConfig() for how it's configured.
// ---------------------------------------------------------------------------

async function backupToCompanionServer() {
  if (!companionServerConfig()) throw new Error("Companion Server isn't configured.");
  const backup = await buildBackupObject();
  const resp = await companionFetch("/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup),
    timeoutMs: 20000,
  });
  if (!resp) throw new Error("Couldn't reach the Companion Server.");
}

async function restoreFromCompanionServer() {
  if (!companionServerConfig()) throw new Error("Companion Server isn't configured.");
  const resp = await companionFetch("/backup/latest", { timeoutMs: 10000 });
  if (!resp) throw new Error("Couldn't reach the Companion Server, or no backup exists yet.");
  await restoreBackupObject(await resp.json());
}

function setupCompanionServerSettings() {
  const urlInput = byId("companion-server-url-input");
  const keyInput = byId("companion-server-key-input");
  const hint = byId("companion-server-hint");
  const backupHint = byId("companion-server-backup-hint");

  const showHint = (el, text) => {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  };

  if (urlInput) urlInput.value = localStorage.getItem(COMPANION_URL_KEY) || "";
  if (keyInput) keyInput.value = localStorage.getItem(COMPANION_KEY_KEY) || "";

  byId("companion-server-save-btn")?.addEventListener("click", async () => {
    localStorage.setItem(COMPANION_URL_KEY, (urlInput?.value || "").trim());
    localStorage.setItem(COMPANION_KEY_KEY, (keyInput?.value || "").trim());
    showHint(hint, "Checking connection...");
    const reachable = await companionServerReachable();
    showHint(
      hint,
      reachable
        ? "Connected. Reload the dashboard for every feature to pick it up."
        : "Saved, but couldn't reach it - double check the address and that the server is running."
    );
  });

  byId("companion-server-backup-btn")?.addEventListener("click", async () => {
    showHint(backupHint, "Backing up...");
    try {
      await backupToCompanionServer();
      showHint(backupHint, "Backed up just now.");
    } catch (err) {
      showHint(backupHint, err.message);
    }
  });

  byId("companion-server-restore-btn")?.addEventListener("click", async () => {
    if (!confirm("Restoring replaces every current setting, sound, and wallpaper photo with the server's latest backup. Continue?")) {
      return;
    }
    showHint(backupHint, "Restoring...");
    try {
      await restoreFromCompanionServer();
      showHint(backupHint, "Restored - reloading...");
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showHint(backupHint, err.message);
    }
  });
}

function setupBackupSettings() {
  byId("backup-export-btn")?.addEventListener("click", () => {
    exportBackup();
  });

  const importInput = byId("backup-import-input");
  importInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same filename be re-selected later
    if (!file) return;

    const hint = byId("backup-import-hint");
    const showHint = (text) => {
      if (!hint) return;
      hint.textContent = text;
      hint.classList.toggle("hidden", !text);
    };

    if (!confirm("Restoring a backup replaces every current setting, sound, and wallpaper photo. Continue?")) {
      return;
    }

    showHint("Restoring...");
    try {
      await importBackup(file);
      showHint("Restored - reloading...");
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showHint("Restore failed: " + err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  setupSetupWizard();
  setupPager();
  setupPageScrollEffect();
  setupThemePicker();
  setupBedsideMode();
  setupAmbientMode();
  setupSoundControls();
  setupSoundscapeMixer();
  restoreSoundStateFromStorage();
  setupCustomSounds();
  setupWakeAlarmForm();
  setupWakeAlarmRingingControls();
  setupSunriseAlarm();
  setupTimerPage();
  setupCountdown();
  setupNightRoutine();
  setupHabits();
  setupHabitHistory();
  setupRecurringReminders();
  setupShoppingList();
  setupExtrasPage();
  setupJournalHistory();
  setupPrivacyMode();
  setupReadingMode();
  setupWeekView();
  renderSleepHistory();
  setupRadar();
  setupManualRefresh();
  setupDimOffsetSlider();
  setupDimIntensitySlider();
  setupClockFormatSetting();
  setupTempUnitSetting();
  setupProfileSettings();
  setupStickyNote();
  setupTellBanner();
  setupSevereAlertDismiss();
  setupAutoBedsideSetting();
  setupBedsideAutoSoundSetting();
  setupLayoutSettings();
  setupWallpaperSettings();
  setupWeatherBgSettings();
  setupAmbientTimeoutSetting();
  setupWorldClock();
  setupBreathingMode();
  setupNightSkyView();
  setupBedtimeBriefing();
  setupMorningBriefing();
  setupRainSoundHint();
  setupSleepInsightsPage();
  setupDailyQuote();
  setupWordOfTheDay();
  setupDynamicInsight();
  setupCompanionServerSettings();
  setupHeartbeat();
  setupHomelabDashboardSettings();
  setupHomelabStatusPage();
  setupAskPage();
  setupDiscordInboxPolling();
  setupBackupSettings();
  loadTodayInHistory();

  renderSchedule();
  renderWeekView();
  renderWakeAlarms();
  renderNextWakeAlarmInline();

  // Applied last (but still synchronously, before anything async like
  // startWeatherRefreshLoop() yields control - so there's no risk of a
  // flash of the cards' unstyled, .card-row-less static markup on first
  // paint) rather than first, so that every setup*() call above it runs
  // while every card - including any tile currently invisible in the
  // saved layout - is still attached to the document. applyTileLayout()
  // detaches invisible tiles' card elements from the DOM entirely (see its
  // own comment on cachedCardElements); a setup*() function that does
  // byId("some-list")?.addEventListener(...) for an invisible tile's list
  // would otherwise silently find nothing and never attach its listener -
  // and since a detached node's listeners persist across being
  // reattached later (turning the tile on in Settings doesn't create a
  // new node), a listener that failed to attach here would stay missing
  // for the rest of the session, not just until the tile is switched on.
  applyTileLayout(loadLayout());
  renderLayoutSettings(loadLayout());

  startClock();
  startWeatherRefreshLoop();
}

/** Service workers require a secure context (https:, or http://localhost)
 *  and simply don't register at all under a file: origin - this
 *  dashboard's real deployment loads via a file:// startURL in Fully
 *  Kiosk, where register() rejects and this silently no-ops. Still worth
 *  calling unconditionally: local dev/testing and any future http(s)
 *  deployment get a cached app shell (survives a brief network drop,
 *  "Add to Home Screen"-installable) for free, and nothing breaks either
 *  way under file://. */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    // Expected under file: or any other unsupported context - nothing to
    // recover from, the dashboard works identically either way.
  });
}

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("load", registerServiceWorker);
