# echo-dashboard-solo

![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build%20step-none-success)
![No backend](https://img.shields.io/badge/backend-none-success)
![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)

A standalone fork of [**echo-dashboard**](https://github.com/rustyisacat/echo-dashboard)
with every phone-dependent feature removed — there's no companion app to
pair with at all. Vanilla HTML/CSS/JS, no framework, no bundler, no
backend of its own either: weather comes straight from public APIs, and
Wake Alarms and the Sound Machine are fully self-contained (Web
Audio-synthesized ambient loops instead of files streamed from a phone).
Point a browser at three static files and it works, on its own, forever.

## Why this exists

The original echo-dashboard talks to [Aurora](https://github.com/rustyisacat/Aurora),
an Android companion app, for phone status, notifications, and calendar
sync. Not everyone wants to dedicate a phone to a bedside display. This
fork answers "what's left, and what can replace it?"

**Dropped entirely** (no substitute exists without a phone): notifications,
Do Not Disturb, phone battery, synced calendar.

**Rebuilt as fully self-contained** (the same feature, with no server
behind it): Wake Alarms (scheduled and rung with a local timer instead of
Android's AlarmManager), the Sound Machine (procedurally-generated
white/pink/brown noise, rain, ocean waves, and an alarm chime — no audio
files to bundle or stream), weather (fetched directly from Open-Meteo and
the National Weather Service, both free and keyless), Wallpaper (photos
imported straight into the browser instead of synced from a phone photo
library), and Dashboard Layout (a local preference instead of something
the phone app configured).

**New, to make up for what's gone**: a manually-kept Agenda in place of
calendar sync, a proper rendered moon-phase visual, a World Clock, a
guided Breathing exercise, a "Today in History" card, and a deterministic
daily quote.

Everything that never needed a phone in the first place — themes, Reading
Mode, Bedside/Ambient Mode, sticky notes, Timer/Stopwatch, the animated
weather backgrounds, severe weather alerts, page transitions — carries
over unchanged.

## Features

- **Eight swipeable pages** (CSS scroll-snap, real touch scrolling,
  tap-to-jump dot indicators): a Morning Overview, a Daily Info page, a
  Clock/Alarm/Sound Machine page, a Wake Alarms page, a Settings page, a
  Timer/Stopwatch page, a Calculator/Converter page, and a Journal/Word
  Game page. Bedside Mode, Ambient Mode, and Breathing Mode are summoned
  full-screen overlays, not pages you swipe to.
- **Weather, live from public APIs**: [Open-Meteo](https://open-meteo.com/)
  for current conditions, a 5-day forecast, sunrise/sunset, air quality,
  and rain probability; the [National Weather Service](https://www.weather.gov/documentation/services-web-api)
  for severe alerts and the radar station covering this dashboard's fixed
  home coordinate (see `HOME_LATITUDE`/`HOME_LONGITUDE` in `script.js`).
  Both are free, need no API key, and are fetched directly from the
  browser — no backend in between.
- **Agenda**: a manually-kept list of upcoming events (add/remove from the
  calendar icon's popover), shown today-only on the Overview card and as a
  full week-ahead glance in that same popover. Not synced from anywhere —
  this is the one piece of "calendar" a phoneless display can honestly offer.
- **Wake Alarms**: fully self-contained — time, repeat days, which sound
  rings, checked once a minute against the device's own clock. One-time
  alarms disable themselves after firing, same as a normal clock app.
  When one fires, a full-screen overlay takes over with a looped alarm
  sound and Dismiss/Snooze, automatically stopping the ambient sound
  machine so the two never overlap. Survives a page reload mid-schedule;
  only requires the page itself to stay loaded and powered, which is the
  normal condition for an always-on kiosk display.
- **Sound Machine**: White Noise, Pink Noise, Brown Noise, Rain, Ocean
  Waves, and a Chime, every one synthesized on the spot with the Web Audio
  API and looped gaplessly — no audio files bundled or fetched. Survives a
  reload (resumes whatever was playing, including an in-progress sleep
  timer) via `localStorage` instead of a remembered server-side state.
- **Custom sounds**: import your own real audio files (Settings → Custom
  Sounds) — stored locally in IndexedDB, no size practically limiting
  them the way `localStorage` would, and no server involved. They show up
  as options everywhere a built-in sound does, including as a Wake Alarm's
  ringtone — this is the actual way to get real, non-synthesized audio
  onto the dashboard, rather than this fork trying to source and bundle
  audio of uncertain size and licensing.
- **Wallpaper**: import your own photos (Settings → Wallpaper) — each one
  downscaled to a sane size on import and stored locally in IndexedDB, no
  phone photo library involved. Rotate through the whole set, pin one
  fixed photo, or set a time-of-day schedule; a "solid black background"
  toggle overrides any of the three without touching the imported library.
  The dashboard's accent color follows whichever photo is showing (a
  downsampled color-average, boosted to a usable UI tone) the same way it
  otherwise follows the weather.
- **Bedside Mode**: one tap starts rain (optional — toggle "Play sound
  automatically" off in Settings for just the dimming/quiet clock), dims
  the display to a comfortable 50% (adjustable live via an on-screen
  slider), and re-arms any wake alarm that fired earlier — then summons a
  dedicated full-screen view with a huge centered clock, tomorrow's first
  Agenda item, and the Sound Machine controls, until you tap the exit
  button. Can also enter itself automatically at a scheduled time each night.
- **Ambient Mode**: after a configurable idle timeout with no touch (never
  while Bedside Mode is active), a screensaver-style view takes over —
  huge clock, tiny weather line, dimmed, a twinkling starfield. Any touch
  exits it instantly.
- **Breathing Mode**: a full-screen guided inhale/hold/exhale/hold
  exercise — a slow-scaling circle driven by CSS transitions, not JS
  animation, so it stays smooth regardless of what else the page is
  doing. Any touch exits it.
- **World Clock**: an optional Overview tile (off by default — turn it on
  in Dashboard Layout) showing a short, self-picked list of other cities'
  current time. Pure `Intl`/`localStorage`, no network involved.
- **Calculator and Unit Converter**: a seventh page, reached the same way as
  every other page (swipe or tap its dot), toggled between the two with a
  segmented control. The calculator is a plain left-to-right pocket
  calculator, not a full expression parser. The converter handles
  temperature, length, weight, and volume with exact standard conversion
  constants and a one-tap swap between "from"/"to" units.
- **Countdown**: an optional Overview tile (off by default — turn it on in
  Dashboard Layout) showing the days remaining until up to a handful of
  self-picked dates, managed from Settings. Purely local — no network,
  re-evaluated once per day rather than every clock tick.
- **Night Routine**: an optional Overview tile — a short checklist that
  resets itself every night, ships with three starter items ("Doors
  locked", "Alarm set for tomorrow", "Phone charging") that can be edited
  or removed entirely from Settings.
- **Habits**: an optional Overview tile — a few self-defined daily habits
  with a streak count next to each. Checking a habit off today never
  breaks an otherwise-intact streak just because it hasn't been checked
  off *yet* that day.
- **Journal**: a page for one short line a night — and a year later, that
  same page starts surfacing whatever was written on this exact date last
  year right above tonight's blank box. The one part of this dashboard
  that gets more useful the longer it's used, not just a repeating view.
- **Word Scramble**: a tiny daily word puzzle sharing the Journal's page,
  deterministically picked and scrambled by date (same seed all day, same
  word for everyone), for something to solve half-asleep.
- **Today in History**: three real historical events for today's date, via
  Wikipedia's public "on this day" feed. Daily Info page only, and simply
  hides itself on a failed fetch rather than showing anything broken —
  this is decoration, not core information.
- **Moon phase**, rendered as an actual crescent/gibbous shape (not just an
  emoji) via a two-overlapping-circles CSS trick, alongside the existing
  text label — shown on the Daily Info page and in Ambient Mode.
- **A daily quote**, deterministically picked from a small local list keyed
  off the day of the year — no network involved, so it's the one line on
  the dashboard guaranteed to never be blank.
- **8 Dashboard Themes** (Material You, Nothing OS, Pixel, Retro CRT, OLED
  Minimal, Catppuccin, Nord, Gruvbox), switchable from the Settings page —
  each swaps palette, typography, shape, and a couple of signature
  decorative touches over the same shared layout.
- **Animated weather backgrounds**, one of 8 richly layered effects
  (Clear, Partly Cloudy, Overcast, Fog, Rain, Snow, Thunderstorm, Night)
  playing in front of every page — a rotating-ray sun with its own
  lens-flare glint, puffy multi-lobed clouds, a milky fog wash, rain that
  genuinely falls, snow and stars scattered across three depth layers, real
  lightning bolts on independent timers, and a moon glow with an
  occasional shooting star at night. All CSS, no per-frame JS cost.
  Overridable on demand or on a daily schedule from Settings.
- **Reading Mode**: dims and warms whichever page is showing without
  taking it over the way Bedside/Ambient Mode do — cards stay fully visible.
- **Sticky notes**: short dashboard-only reminders, one at a time
  (cycling if there's more than one), managed from a popover.
- **Sleep History**: a 7-day chart of how long Bedside Mode ran each
  night — not sensor-based sleep tracking, just when Bedside Mode was on.
- **Customizable layout**: the Morning Overview's card order, visibility,
  and size, controlled entirely from the Settings page and saved locally.
- **Auto-dim at night, brightens in the morning**: the whole display dims
  itself for bedside comfort using actual sunrise/sunset from the live
  weather fetch (falls back to a fixed 9pm–7am window until the first one
  resolves), and nudges the real hardware backlight too if Fully Kiosk
  Browser's JS interface is enabled.
- **Resilient by default**: the last successful weather fetch is cached
  and shown immediately on load, survives the weather APIs going
  unreachable, and quietly shows a status line instead of ever going blank.
- **Backup** (Settings → Backup): everything on this dashboard lives only
  in this one browser's `localStorage`/IndexedDB — every setting, the
  Agenda, every Journal entry, every imported sound and wallpaper photo.
  Export bundles all of it into one downloadable JSON file; import
  restores it (with a confirmation first, since it replaces everything
  current) on a fresh install or after a cleared profile. The export list
  itself is built dynamically off whatever keys actually exist rather than
  a hardcoded list, so it never silently misses something new.

## Requirements

- Any modern browser with Web Audio API support (universal in practice).
  Built and tested for a kiosk browser (e.g.
  [Fully Kiosk Browser](https://www.fully-kiosk.com/)) on a rooted/sideloaded
  Amazon Echo Show 5 (1st gen), but nothing here is Echo-Show-specific —
  it renders fine in any browser window.
- A network connection reachable to `api.open-meteo.com`,
  `air-quality-api.open-meteo.com`, `api.weather.gov`, and
  `radar.weather.gov` for weather/alerts/radar, and to
  `api.wikimedia.org` for Today in History. Everything else works fully
  offline once loaded.

No build tools, no package manager, no dependencies, no backend: just
`index.html`, `style.css`, and `script.js`, served as static files.

## Installation

1. **Clone the repo:**

   ```
   git clone https://github.com/rustyisacat/echo-dashboard-solo.git
   cd echo-dashboard-solo
   ```

2. **Set your home coordinate** — edit the two constants at the top of
   `script.js` (defaults to Jacksonville, FL):

   ```js
   const HOME_LATITUDE = 30.1588;
   const HOME_LONGITUDE = -81.6206;
   ```

3. **Serve the three files.** Any static file server works:

   ```
   python3 -m http.server 8090
   ```

   then open `http://localhost:8090/`.

4. **Point your display's browser at that URL** and set it to kiosk/full-screen
   mode. On Fully Kiosk Browser, either serve these files from a small local
   HTTP server on the device itself, or use a `file://` URL if your kiosk
   setup allows it — either way, keep all three files in the same directory.

5. **(Optional) Enable Fully Kiosk's JS interface** if you want the
   night auto-dim and alarm-ringing ramp to control the actual screen
   backlight, not just this page's own contents. Without it, both still
   work, just as CSS-only effects.

## How it behaves

- **Two independent update loops.** The clock ticks every second off the
  browser's own local time (also driving day/night dimming, auto-Bedside-Mode,
  and the wake-alarm scheduler); weather refreshes on a timer against the
  public APIs above. Neither affects the other.
- **Never blank.** The last successful weather fetch is cached in
  `localStorage` and rendered immediately on load, before the first fetch
  even completes.
- **Sound Machine and Wake Alarms survive reloads.** Both persist their
  state to `localStorage` directly and resume exactly where they left off
  on the next page load — there's no server to remember anything on this
  fork's behalf.
- **Theme choice persists locally** (`localStorage`, applied synchronously
  before the page paints, so there's no flash of the wrong theme on reload).

## Adding a new card

1. Add a `<section class="card">` to `index.html`'s Morning Overview page
   (a `card-title` heading + whatever elements you need, each with a
   unique `id`), and an entry in `TILE_DOM_ID`/`TILE_LABELS`/
   `DEFAULT_TILE_LAYOUT` in `script.js`.
2. Add one `renderX(...)` function in `script.js`, next to
   `renderWeather`/`renderSoundMachine`/etc., and call it from wherever its
   underlying state changes (a weather refresh, a settings change, a clock
   tick — whichever fits).

## AI Disclaimer

Parts of this project were assisted or written by AI. If that's something
you're not comfortable with, no hard feelings, I understand and I don't
force anyone to use it. The code may have flaws. If you spot something
that could be better, contributions are very welcome. I'm still learning
and would appreciate the help.

## License

[AGPL v3](LICENSE)
