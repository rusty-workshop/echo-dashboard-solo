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
Mode, Bedside/Ambient Mode, sticky notes, the animated weather
backgrounds, severe weather alerts, page transitions — carries over
unchanged. The Timer got one small change: it now keeps chiming every few
seconds after hitting zero, until dismissed, instead of a single
triple-beep that's easy to miss from another room.

## Features

- **Nine swipeable pages** (CSS scroll-snap, real touch scrolling,
  tap-to-jump dot indicators): a Morning Overview, a Daily Info page, a
  Clock/Alarm/Sound Machine page, a Wake Alarms page, a Sleep Insights page,
  a Habits page, a Settings page, a Timer/Stopwatch page, and a
  Journal/Word Game/Trivia/Puzzle page. Bedside Mode, Ambient Mode, and
  Breathing Mode are summoned full-screen overlays, not pages you swipe to.
- **Weather, live from public APIs**: [Open-Meteo](https://open-meteo.com/)
  for current conditions, a 5-day forecast, sunrise/sunset, air quality,
  and rain probability (both a same-day hourly estimate and a 15-minute-
  resolution near-term nowcast — "Rain starting in ~15 min" — for whichever
  is more precise); the [National Weather Service](https://www.weather.gov/documentation/services-web-api)
  for severe alerts and the radar station covering this dashboard's fixed
  home coordinate (see `HOME_LATITUDE`/`HOME_LONGITUDE` in `script.js`).
  Both are free, need no API key, and are fetched directly from the
  browser — no backend in between. When it's actually raining, the Sound
  Machine card offers a one-tap, once-a-day, dismissible suggestion to
  play the Rain sound — never auto-plays on its own. The same proactive
  nudge pattern also covers UV ("wear sunscreen", High or above), air
  quality ("air quality is unhealthy", EPA's own Unhealthy threshold),
  feels-like temperature ("stay hydrated" / "bundle up"), and wind ("secure
  loose outdoor items", NWS's own Wind Advisory threshold) once any of
  them crosses into genuinely-matters territory — nothing shows for a
  normal day. The Daily Info page's forecast strip calls out either the
  single best window later today for a walk (hour-resolution, from the
  same precipitation data as the rain nowcast) or, if today itself doesn't
  have one, the best upcoming day this week — scored from condition and
  how close the high sits to a comfortable range.
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
  normal condition for an always-on kiosk display. A play/stop preview
  button next to both sound pickers (the per-alarm one and the shared
  default) lets you hear the sound before committing to it, capped at a
  few seconds even for a long ambient loop or custom song.
- **Sunrise Alarm**: an optional per-alarm "Sunrise wake-up" toggle. When
  on, the screen itself gradually brightens and warms in color over a
  configurable window (10–30 min) ahead of that alarm's trigger time,
  simulating an actual sunrise — like a Hatch/Philips wake-up lamp, built
  into the display already on the nightstand instead of a separate
  gadget. Silent the whole time; the real alarm sound and full-brightness
  ramp still only start at the actual alarm time. A "Skip sunrise" button
  cancels just that one occurrence without touching the alarm itself.
- **Timer & Stopwatch**, with named custom presets: the fixed
  1/5/10/15/30/60-minute buttons can be joined by your own named durations
  ("Tea — 3 min", "Pizza — 12 min") via a "+" button on the same row —
  added, removed, and persisted from a small popover so the Timer page
  itself never grows a second row of controls.
- **Sound Machine**: White Noise, Pink Noise, Brown Noise, Rain, Ocean
  Waves, Thunderstorm, Fireplace, Fan, and a Chime, every one synthesized on
  the spot with the Web Audio API and looped gaplessly — no audio files
  bundled or fetched. Survives a reload (resumes whatever was playing,
  including an in-progress sleep timer) via `localStorage` instead of a
  remembered server-side state.
- **Soundscape Mixer**: a second Sound Machine mode (segmented alongside
  Single, Clock/Sound page) that blends up to four sounds together at
  once, each with its own volume — rain under a low brown-noise hum,
  white noise plus ocean waves, whatever combination actually works —
  instead of just one sound at a time. Save a blend as a named preset for
  one-tap recall later.
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
  otherwise follows the weather. A slow, continuous zoom/drift keeps
  whatever's showing from feeling like a static image, and a "Shuffle Now"
  button (Rotating mode only) jumps to the next photo on demand instead of
  waiting out the timer.
- **Bedside Mode**: one tap starts rain (optional — toggle "Play sound
  automatically" off in Settings for just the dimming/quiet clock), dims
  the display to a comfortable 50% (adjustable live via an on-screen
  slider), and re-arms any wake alarm that fired earlier — then summons a
  dedicated full-screen view with a huge centered clock, tomorrow's first
  Agenda item, and the Sound Machine controls, until you tap the exit
  button. Can also enter itself automatically at a scheduled time each night.
- **Bedtime Briefing** and **Good Morning Briefing**: tap the Goodnight
  button (hero panel) or the speaker icon next to the Overview's morning
  briefing card for a short spoken recap — weather, your first Agenda
  item, your next alarm at night; weather, umbrella/jacket heads-up, and
  today's first event in the morning. Read aloud via the browser's own
  built-in `speechSynthesis` by default (no network, no cloud voice
  service, no API key) — but this kiosk browser's WebView is known to not
  implement `speechSynthesis` at all, so if a [Companion Server](#companion-server-optional)
  is configured, its Piper-based TTS is used instead and the buttons stay
  usable either way; only hidden entirely if neither is available.
- **Night Sky View, with a real star map**: tap "Night Sky" next to the
  Moon phase (Daily Info page) for which naked-eye planets — Mercury,
  Venus, Mars, Jupiter, Saturn — plus the Moon and ~40 of the brightest
  stars across a dozen recognizable constellations (Big Dipper, Orion,
  Cassiopeia, Cygnus, and more) are above the horizon right now, drawn as
  a real connect-the-dots star chart on a horizon panorama. Computed
  entirely offline from classical orbital elements for the planets (the
  standard low-precision method used by hobbyist astronomy tools) and
  fixed catalog coordinates for the stars — nothing fetched from any API.
  Also flags when a major annual meteor shower is at its peak tonight
  (e.g. "Perseids peak tonight - up to ~60/hr after midnight"), from a
  small static almanac of the year's showers, and — the first real
  connection between the weather layer and the astronomy layer — a
  one-line stargazing forecast ("Clear skies tonight" / "Cloudy skies
  tonight") that only speaks up for unambiguous conditions, staying quiet
  rather than guessing on a partly-cloudy night. If a
  [Companion Server](#companion-server-optional) is configured, also shows
  the next ISS pass overhead at night ("ISS pass tonight at 9:47 PM, up to
  61° high") — the one thing this view can't compute offline, since it
  needs live orbital data.
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
- **Countdown**: an optional Overview tile (off by default — turn it on in
  Dashboard Layout) showing the days remaining until up to a handful of
  self-picked dates, managed from Settings. Purely local — no network,
  re-evaluated once per day rather than every clock tick. A "Repeats
  yearly" toggle on new entries is for birthdays/anniversaries: once the
  date passes, it rolls forward to next year instead of disappearing.
- **Night Routine**: an optional Overview tile — a short checklist that
  resets itself every night, ships with three starter items ("Doors
  locked", "Alarm set for tomorrow", "Phone charging") that can be edited
  or removed entirely from Settings.
- **Habits**: self-defined daily habits with a streak count next to each,
  both as an optional (off by default) Overview tile and as a full
  dedicated page so they're never more than a swipe away regardless of
  that tile's setting. Checking a habit off today never breaks an
  otherwise-intact streak just because it hasn't been checked off *yet*
  that day. A streak crossing a round number (7, 30, 100...) gets a
  one-shot celebratory flourish, not a permanently different look. A
  calendar icon on each habit opens its History — a month heatmap with
  current streak, best streak ever, and a completion count, navigable
  month to month; adding/removing habits still happens in Settings,
  linked directly from the new page. Once there's enough history (two
  weeks' worth of check-ins, combined across every habit), the page also
  surfaces which day of the week you're actually most consistent on.
- **Shopping List**: an optional Overview tile for a plain grocery/errand
  list — add and check off items right on the tile itself (no trip to
  Settings needed, unlike Habits/Countdown/Reminders), with checked items
  sliding to the bottom rather than disappearing, and a "clear checked"
  button to sweep them out once the trip's done.
- **Reminders**: an optional Overview tile — a short list of things on a
  repeating interval rather than a nightly reset, like "water the plant
  every 10 days." Each one just tracks when it was last marked done; its
  next due date is computed from that, not stored separately.
- **Journal**: a page for one short line a night — and a year later, that
  same page starts surfacing whatever was written on this exact date last
  year right above tonight's blank box. The one part of this dashboard
  that gets more useful the longer it's used, not just a repeating view.
  A History button opens every past entry, newest first, read-only. An
  optional password (Settings → Journal Password) locks the whole page —
  entry, callback, and history alike — until unlocked each time the
  dashboard loads; only a SHA-256 hash is ever stored, and this is a
  casual glance-deterrent, not real security, since anyone with direct
  access to this device's files could still read the raw data underneath.
- **Word Scramble, Daily Trivia, and a daily "Odd One Out" puzzle**: three
  more tiny daily diversions sharing the Journal's page (a four-way
  segmented view), each deterministically picked by date — same seed all
  day, same puzzle for everyone. Word Scramble unscrambles a word; Trivia
  poses a question with a tap-to-reveal answer; Odd One Out shows four
  options and asks which one doesn't share what the other three have in
  common, with the reasoning shown either way once you've guessed — it
  also keeps a day-streak of correct guesses, persisted so a reload shows
  the same result rather than letting today's puzzle be re-answered.
- **Today in History**: three real historical events for today's date, via
  Wikipedia's public "on this day" feed. Daily Info page only, and simply
  hides itself on a failed fetch rather than showing anything broken —
  this is decoration, not core information.
- **Moon phase**, rendered as an actual crescent/gibbous shape (not just an
  emoji) via a two-overlapping-circles CSS trick, alongside the existing
  text label — shown on the Daily Info page and in Ambient Mode.
- **A daily quote and Word of the Day**, both deterministically picked from
  a small local list keyed off the day of the year — no network involved,
  so they're the two lines on the dashboard guaranteed to never be blank.
  The word comes with a short definition and an example sentence.
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
- **Privacy Mode**: one tap (top of the Morning Overview) hides the
  sticky-note banner and blanks the Habits/Night Routine tiles with a
  generic placeholder — a quick "someone's in the room" toggle, separate
  from the Journal's own always-on password since the two solve different
  problems (a passing glance vs. deliberately reading it).
- **Sticky notes**: short dashboard-only reminders, one at a time
  (cycling if there's more than one), managed from a popover.
- **Sleep Insights**: its own dedicated page — a 7-day bar chart, a 30-day
  trend sparkline, a weekly average, a night-streak count, and how many
  times you've hit snooze this week, all from how long Bedside Mode ran
  each night (getting in bed to actually dismissing your alarm, not just
  when the alarm started ringing) — not sensor-based sleep tracking, just
  when Bedside Mode was genuinely on. A settable sleep goal (Settings →
  Sleep Insights, default 8 hours) shows how many nights this week
  actually met it, and — once there's enough recorded bedtimes — a
  bedtime-consistency line shows how many nights landed within 30 minutes
  of your own median bedtime that week.
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

### Companion Server (optional)

An optional, entirely opt-in LAN service — source in [`server/`](server/) —
meant to run on hardware you already control (in this dashboard's case, a
repurposed old laptop, not a third-party cloud), backing four things this
kiosk WebView can't do fully on its own. Leave it unconfigured
(Settings → Companion Server) and none of the following applies; the
dashboard works exactly as it does without it.

- **Better spoken briefings**: this WebView doesn't implement
  `window.speechSynthesis` at all, so Bedtime/Good Morning Briefing had no
  real voice before this existed. The server runs [Piper](https://github.com/rhasspy/piper),
  an offline neural TTS engine, and hands back a WAV file over the LAN.
- **ISS pass alerts**: Night Sky View shows the next nighttime pass of the
  ISS overhead, computed from a periodically-refreshed TLE (via
  [Celestrak](https://celestrak.org)) and a NOAA-formula sunset/sunrise
  check — the one thing that view can't do with zero network dependency.
- **Off-device backup**: Settings → Companion Server can push the exact
  same backup object the local Export button produces to the server, and
  restore the latest one back — a second copy that survives a factory
  reset or a dead browser profile without needing a phone or a manual file
  transfer.
- **A generated daily insight line**: a locally-run small language model
  (via [Ollama](https://ollama.com)) turns today's actual weather, sleep
  streak, habit streaks, and next Agenda item into one real generated
  sentence on the Overview, instead of picking from a canned template list
  like Daily Quote/Word of the Day do.

Every one of these degrades silently to "unavailable" if the server address
is unset or unreachable — nothing on the dashboard depends on it.

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
- **PWA basics** (`manifest.json` + `sw.js`): "Add to Home Screen"-installable,
  and the app shell (`index.html`/`style.css`/`script.js`) is cached so a
  brief network drop doesn't blank the page — everything actually shown
  (weather) still needs the network, only the shell that draws it is
  cached. Note: service workers require `https:` or `http://localhost` and
  simply don't register under a `file:` origin, which is how this
  dashboard's real Echo Show deployment loads (see the README's
  Installation section) — there this silently no-ops, harmless either way.
- **Stale-clock watchdog.** A kiosk display running 24/7 is the one place
  a silently frozen tab actually matters. Every successful clock tick
  stamps the time it completed; a separate check every 30s reloads the
  page if 5 minutes pass with no successful tick — catching a persistent
  broken state (an exception on every tick) or a badly degraded WebView,
  not a graceful fix for every possible freeze, since a genuinely
  deadlocked main thread can't run its own watchdog either.
- **A ringing alarm is easy to hit half-asleep.** Tapping *anywhere* on the
  ringing overlay snoozes it — no need to aim for a small button in the
  dark. Dismiss stays a deliberate, separate tap on its own button (also
  considerably larger and higher-contrast than a normal control), so a
  stray touch snoozes rather than accidentally killing the alarm outright.

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
