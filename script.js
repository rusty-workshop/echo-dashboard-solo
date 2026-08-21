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

// Fixed home coordinate, used for weather/alerts/radar - there's no phone
// location to follow anymore, so unlike Aurora's own fallback this is the
// only coordinate this build ever uses. Update these two if this dashboard
// ever moves somewhere else.
const HOME_LATITUDE = 30.1588;
const HOME_LONGITUDE = -81.6206;

const WEATHER_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const ALERT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const VOLUME_DEBOUNCE_MS = 400;

// Below this and not charging, the battery warning banner shows - matches
// Android's own default low-battery threshold. (Kept even without a phone
// battery to warn about, in case a future card ever needs the same
// threshold - see aqiCategory()'s sibling EPA breakpoints for the same
// "pure function of a number" reasoning.)
const LOW_BATTERY_THRESHOLD = 15;

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
};

const TILE_SIZE_WEIGHT = { small: 0.7, medium: 1, large: 1.5 };

const DEFAULT_TILE_LAYOUT = [
  { id: "weather", visible: true, size: "medium" },
  { id: "schedule", visible: true, size: "large" },
  { id: "alarm", visible: true, size: "small" },
  { id: "sound", visible: true, size: "large" },
  { id: "worldclock", visible: false, size: "small" },
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
  battery:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 10v4"/><rect x="5" y="9.5" width="10" height="5" fill="currentColor" stroke="none"/></svg>',
  batteryCharging:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 10v4"/><path d="M12 9l-3 4h3l-1 4 4-5h-3z" fill="currentColor" stroke="none"/></svg>',
  batteryAlert:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 10v4"/><path d="M11 9v3M11 15h.01" stroke-width="2.4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  bellOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-9.33-5M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8v2.5M13.73 21a2 2 0 0 1-3.46 0"/><path d="M2 2l20 20"/></svg>',
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
  focus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h9a2.5 2.5 0 1 0-2.5-2.5"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
  scroll:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21a2 2 0 0 1-2-2V5a2 2 0 0 1 4 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2H10"/><path d="M6 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10h-4"/></svg>',
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

/** Calendar event titles and app names come from the phone - untrusted
 *  user data - so escape before dropping anything into innerHTML. */
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

/** Same timezone the clock uses (see currentTimezone below) - so "9pm" in
 *  the greeting means 9pm wherever the phone actually is, not wherever
 *  this display's own system clock happens to be set. */
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
    const dateKey = new Date(sleepSessionStartAt).toLocaleDateString("en-CA", { timeZone: currentTimezone || undefined });
    sleepSessions = [...sleepSessions, { date: dateKey, durationMinutes }].slice(-SLEEP_SESSIONS_MAX);
    localStorage.setItem(SLEEP_SESSIONS_KEY, JSON.stringify(sleepSessions));
  }
  sleepSessionStartAt = null;
  localStorage.removeItem(SLEEP_SESSION_START_KEY);
  renderSleepHistory();
}

/** Last 7 calendar days, oldest to newest - multiple sessions landing on
 *  the same night (e.g. exited and re-entered Bedside Mode) sum together
 *  rather than only keeping the last one. */
function renderSleepHistory() {
  const chart = byId("sleep-history-chart");
  if (!chart) return;

  const byDate = new Map();
  sleepSessions.forEach((session) => {
    byDate.set(session.date, (byDate.get(session.date) || 0) + session.durationMinutes);
  });

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
  setText(
    "sleep-history-avg",
    avgMinutes ? `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m average this week` : "No Bedside Mode sessions yet this week"
  );
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
  renderWorldClocks();
}

function startClock() {
  updateClock();
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
// Rendering - one function per card, each safely no-ops on missing/null
// data, plus the Morning Briefing.
// ---------------------------------------------------------------------------

let lastWeatherData = null;

function renderWeather(weather) {
  lastWeatherData = weather;
  if (!weather) {
    setIcon("weather-icon", "cloud");
    setText("weather-temp", "--°");
    setText("weather-condition", "No data");
    setText("weather-high", "--°");
    setText("weather-low", "--°");
    byId("weather-rain")?.classList.add("hidden");
    setIcon("weather-icon-lg", "cloud");
    setText("weather-temp-lg", "--°");
    setText("weather-condition-lg", "No data");
    setText("weather-high-lg", "--°");
    setText("weather-low-lg", "--°");
    setText("weather-sunrise-lg", "--:--");
    setText("weather-sunset-lg", "--:--");
    byId("weather-rain-lg")?.classList.add("hidden");
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
  const rainText = weather.rainExpectedAt ? `Rain expected ${formatTimeOfDay(weather.rainExpectedAt)}` : "";
  setIcon("weather-rain-icon", "rain");
  setText("weather-rain-text", rainText);
  byId("weather-rain")?.classList.toggle("hidden", !rainText);
  setIcon("weather-rain-icon-lg", "rain");
  setText("weather-rain-text-lg", rainText);
  byId("weather-rain-lg")?.classList.toggle("hidden", !rainText);

  if (nightOverride) {
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

/** Today plus the next few days (see WeatherConfig.FORECAST_DAYS on the
 *  Aurora side) - Daily Info page only, same reasoning as the radar panel
 *  for why it doesn't also try to fit in the compact Overview card. */
function renderDailyForecast(weather) {
  const strip = byId("forecast-strip");
  if (!strip) return;

  const days = (weather && weather.dailyForecast) || [];
  if (days.length === 0) {
    strip.classList.add("hidden");
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
};

let lastLayoutTiles = null;

function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.length > 0 ? parsed : DEFAULT_TILE_LAYOUT;
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

async function loadSoundBuffer(soundId) {
  if (bufferCache.has(soundId)) return bufferCache.get(soundId);
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
      return `<li class="wakealarm-item${alarm.enabled ? "" : " disabled"}" data-id="${escapeHtml(alarm.id)}">
        <input type="checkbox" class="wakealarm-toggle" ${alarm.enabled ? "checked" : ""} aria-label="Enabled" />
        <div class="wakealarm-item-info">
          <span class="wakealarm-item-time">${time}</span>
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
    });

    if (labelInput) labelInput.value = "";
    selectedWakeAlarmDays = new Set();
    byId("wakealarm-days")
      ?.querySelectorAll(".wakealarm-day-btn.active")
      .forEach((btn) => btn.classList.remove("active"));
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

  stopLocalPlaybackFully();
  saveSoundState();
  renderSoundMachine();
  startWakeAlarmSound(soundId);
  startAlarmBrightnessRamp();
  showAlarmRingingOverlay(ringingLabel);
  // A ringing alarm needs the full-screen dismiss/snooze overlay visible
  // and audible - staying in Bedside Mode's own dim, quiet view would
  // bury it, so an active bedside session ends automatically the moment
  // an alarm goes off.
  if (document.body.classList.contains("bedside-active")) {
    exitBedsideMode();
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

const SNOOZE_DURATION_KEY = "aurora-dashboard:snooze-duration";

function setupWakeAlarmRingingControls() {
  setIcon("alarm-ringing-icon", "alarm");

  const durationPicker = byId("alarm-snooze-duration");
  const savedDuration = localStorage.getItem(SNOOZE_DURATION_KEY);
  if (durationPicker && savedDuration) durationPicker.value = savedDuration;
  durationPicker?.addEventListener("change", () => {
    localStorage.setItem(SNOOZE_DURATION_KEY, durationPicker.value);
  });

  byId("alarm-dismiss-btn")?.addEventListener("click", () => {
    stopWakeAlarmRinging();
  });
  byId("alarm-snooze-btn")?.addEventListener("click", () => {
    const minutes = Number(durationPicker?.value || "9");
    snoozeState = { epochMs: Date.now() + minutes * 60_000, soundId: ringingSoundId, label: ringingLabel };
    stopWakeAlarmRinging();
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

function renderTimerDisplay() {
  const display = byId("timer-display");
  if (!display) return;
  display.textContent = formatClockDisplay(timerRemainingSeconds);
  display.classList.toggle("timer-running", Boolean(timerHandle));
  display.classList.toggle("timer-done", timerRemainingSeconds === 0 && !timerHandle && timerEndAt === null);
}

function stopTimerInterval() {
  clearInterval(timerHandle);
  timerHandle = null;
}

function tickTimer() {
  timerRemainingSeconds = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
  if (timerRemainingSeconds === 0) {
    stopTimerInterval();
    timerEndAt = null;
    setText("timer-start-btn", "Start");
    playTimerBeep();
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

  byId("timer-start-btn")?.addEventListener("click", () => (timerHandle ? pauseTimer() : startTimer()));
  byId("timer-reset-btn")?.addEventListener("click", resetTimer);
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
// Weather - fetched directly from two free, unauthenticated, CORS-enabled
// public APIs (Open-Meteo and the National Weather Service) instead of
// proxied through Aurora, which no longer exists. Same fixed home
// coordinate Aurora itself used to fall back to (see HOME_LATITUDE/
// HOME_LONGITUDE at the top of this file) - there's no phone location to
// follow anymore, so this is the only coordinate this build ever uses.
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

  const setActivePage = (index) => {
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

function exitBedsideMode() {
  byId("bedside-overlay")?.classList.add("hidden");
  document.body.classList.remove("bedside-active");
  resetAmbientIdleTimer();
  endSleepSession();
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
// Init
// ---------------------------------------------------------------------------

function init() {
  // Lays out the card grid immediately, before weather or anything else
  // has loaded - without this, the cards would render as one plain
  // full-width column (their static markup has no .card-row wrappers any
  // more; those are only built by applyTileLayout) for a brief moment on
  // first paint.
  applyTileLayout(loadLayout());
  renderLayoutSettings(loadLayout());

  setupPager();
  setupPageScrollEffect();
  setupThemePicker();
  setupBedsideMode();
  setupAmbientMode();
  setupSoundControls();
  restoreSoundStateFromStorage();
  setupCustomSounds();
  setupWakeAlarmForm();
  setupWakeAlarmRingingControls();
  setupTimerPage();
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
  setupSevereAlertDismiss();
  setupAutoBedsideSetting();
  setupBedsideAutoSoundSetting();
  setupLayoutSettings();
  setupWeatherBgSettings();
  setupAmbientTimeoutSetting();
  setupWorldClock();
  setupBreathingMode();
  setupDailyQuote();
  loadTodayInHistory();

  renderSchedule();
  renderWeekView();
  renderWakeAlarms();
  renderNextWakeAlarmInline();

  startClock();
  startWeatherRefreshLoop();
}

document.addEventListener("DOMContentLoaded", init);
