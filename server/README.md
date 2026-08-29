# echo-dashboard-solo Companion Server

An optional LAN-only companion service for [echo-dashboard-solo](..). See the
"Companion Server (optional)" section of the main README for what it does
and why. This file is the deploy/ops reference.

## Deployed on

A repurposed Dell Latitude E5470 (Arch Linux, headless), reachable at
`ssh latitude` (`192.168.1.158`). i5-6300U, 4 threads, no GPU — every model
choice here was picked to run comfortably on that CPU, not for maximum
quality. Two different local models are in play: `llama3.2:1b` for
everything latency-sensitive or purely subjective (TTS text, the daily
insight, trivia, meal ideas, journal reflections), and `qwen2.5:3b-instruct`
for the one thing the small model couldn't do reliably (odd-one-out puzzle
generation — see the comment on `generate_puzzle()` in `server.py`).

## Layout on the server

```
~/dashboard-server/
  server.py                    # main HTTP service, deployed via scp
  heartbeat_check.py            # systemd-timer job - alerts via ntfy on a missed check-in
  backup_integrity_check.py     # systemd-timer job - alerts via ntfy on a corrupt backup
  discord_bot.py                 # separate always-on process - Sticky Note/Shopping List via DM
  env                            # secrets/config - chmod 600, see below
  data/                          # TLE cache, heartbeat timestamp, historical-weather cache,
                                  # discord inbox queue, alert dedup state
  backups/                       # timestamped backup snapshots (90-day retention)
  wallpapers/
    inbox/                       # drop photos here (scp) to add them to the rotation
    processed/                    # resized/JPEG/deduped output, served by GET /wallpaper/random
  piper/
    piper/piper                   # the piper binary (from GitHub releases)
    voices/en_US-lessac-high.onnx(.json)
  venv/                          # skyfield, Pillow, discord.py - see Dependencies below
```

The main server runs as a **systemd --user service**
(`dashboard-server.service`), same pattern as `judgment-bot.service` on the
same box — `loginctl enable-linger rusty` is already set so everything here
starts at boot with nobody logged in. `heartbeat_check.py` and
`backup_integrity_check.py` are systemd **timers** (oneshot services, not
always-on), and `discord_bot.py` is its own always-on service, independent
of the main HTTP server.

## Dependencies installed on the server

```bash
sudo pacman -S ollama espeak-ng python-pip   # espeak-ng is unused now (kept from v1, harmless)
sudo systemctl enable --now ollama.service
ollama pull llama3.2:1b
ollama pull qwen2.5:3b-instruct
```

Piper isn't packaged in Arch's repos (the `piper` package there is an
unrelated gaming-mouse config tool) — installed from a GitHub release
instead:

```bash
mkdir -p ~/dashboard-server/piper && cd ~/dashboard-server/piper
curl -sL -o piper.tar.gz https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar xzf piper.tar.gz && rm piper.tar.gz
mkdir -p voices && cd voices
curl -sL -o en_US-lessac-high.onnx 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx'
curl -sL -o en_US-lessac-high.onnx.json 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json'
```

Everything else needs its own venv, since Arch's system Python is
externally-managed:

```bash
cd ~/dashboard-server && python3 -m venv venv
./venv/bin/pip install skyfield Pillow discord.py
```

No planetary ephemeris file needed for ISS passes —
`EarthSatellite.find_events()` only needs the TLE + observer lat/lon, not a
`.bsp` file. (The default `de421.bsp` mirror skyfield points at is dead - a
404 - if this ever comes up again for something else,
`https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp`
was also 404 as of 2026-08-29; hasn't been needed since ISS passes don't
use it.)

## Redeploying after editing `server.py` (or the other scripts)

```bash
python3 -m py_compile server/server.py server/heartbeat_check.py server/backup_integrity_check.py server/discord_bot.py
scp server/server.py server/heartbeat_check.py server/backup_integrity_check.py server/discord_bot.py latitude:~/dashboard-server/
ssh latitude "rm -rf ~/dashboard-server/__pycache__; systemctl --user restart dashboard-server.service && systemctl --user is-active dashboard-server.service"
```

`discord_bot.py` needs its own restart if changed
(`systemctl --user restart dashboard-discord-bot.service`) - it's a
separate process from `server.py`.

## systemd units

| Unit | Type | Purpose |
|---|---|---|
| `dashboard-server.service` | always-on | main HTTP API |
| `dashboard-discord-bot.service` | always-on | Discord DM listener (see below - inactive until a bot token is set) |
| `dashboard-heartbeat-check.timer` | every 10 min | alerts via ntfy if the dashboard stops checking in |
| `dashboard-backup-check.timer` | daily | alerts via ntfy if the latest backup is corrupt/unreadable |

Set up once:

```bash
systemctl --user daemon-reload
systemctl --user enable --now dashboard-server.service
systemctl --user enable --now dashboard-heartbeat-check.timer
systemctl --user enable --now dashboard-backup-check.timer
# dashboard-discord-bot.service: see "Discord bot setup" below before enabling
```

## Config / secrets

`~/dashboard-server/env` on the server (not committed, `chmod 600`):

```
DASHBOARD_SERVER_KEY=<random hex, checked against the X-Dashboard-Key header>
DASHBOARD_SERVER_PORT=8420
DASHBOARD_OLLAMA_MODEL=llama3.2:1b
DASHBOARD_PUZZLE_MODEL=qwen2.5:3b-instruct
DASHBOARD_NTFY_TOPIC=<a long random topic name - see Alerts below>
DASHBOARD_DISCORD_BOT_TOKEN=<optional - see Discord bot setup below>
```

The matching server address + key get typed into the dashboard's
Settings → Companion Server (stored in that browser's `localStorage`, not
in this repo).

## Alerts (ntfy.sh)

`heartbeat_check.py` and `backup_integrity_check.py` both alert via
[ntfy.sh](https://ntfy.sh) — free, keyless, no account. Pick a long random
topic name (so it's not guessable by anyone else - ntfy topics are public
if you know the name) and set it as `DASHBOARD_NTFY_TOPIC` above. To
receive alerts: install the ntfy app (iOS/Android) or visit
`https://ntfy.sh/<topic>` in a browser and subscribe. Both scripts only
alert once per distinct outage (tracked in `data/*_alert_state.json`), and
send a follow-up "back to normal" notification once resolved.

## Discord bot setup

Lets Rusty DM the bot from anywhere to add a Sticky Note (`note: <text>`)
or Shopping List item (`shop: <item>`) to the dashboard - see
`discord_bot.py`'s own docstring for exactly how it queues things and
`GET /discord-inbox` in `server.py` for how the dashboard picks them up.
This is a **separate bot/token** from the `judgment-bot` already running on
this box, on purpose - keeps the two projects' Discord presence
independent.

1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application → name it something like "Bedside Dashboard"
2. Bot tab → Add Bot → Reset Token, copy it
3. Bot tab → Privileged Gateway Intents → enable **Message Content Intent** (required to read DM text)
4. Add the token to `~/dashboard-server/env` as `DASHBOARD_DISCORD_BOT_TOKEN=...`, then:
   ```bash
   ssh latitude "chmod 600 ~/dashboard-server/env; systemctl --user daemon-reload && systemctl --user enable --now dashboard-discord-bot.service"
   ```
5. In Discord, open a DM with the bot (find it under your server's member list, or use its invite URL from the Developer Portal's OAuth2 tab with just the `bot` scope) and send it a message - no server-wide install needed for DMs to work.

## Wallpaper rotation

Drop photos into the inbox over scp - they show up in the dashboard's
rotation within a day (see `pullServerWallpaper()` in `script.js`, and
`WALLPAPER_MAX_DIMENSION`/dedup-by-hash in `server.py`'s
`process_wallpaper_inbox()`):

```bash
scp photo1.jpg photo2.jpg latitude:~/dashboard-server/wallpapers/inbox/
```

Processing runs lazily on the next `GET /wallpaper/random` request, not on
its own timer - cheap when there's nothing new, so no need for a
file-watcher. `wallpapers/processed/` itself is **not** pruned server-side
(only the dashboard's own local copy is capped, at
`SERVER_WALLPAPER_MAX_COUNT` in `script.js`) - clean out old ones by hand
if the inbox keeps growing indefinitely.

## Firewall

Only reachable from the home LAN, not the whole world:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8420 proto tcp
```

(The Discord bot doesn't need any inbound port - it makes outbound
connections to Discord's gateway, same direction as a normal chat client.)

## Checking status / logs

```bash
ssh latitude "systemctl --user status dashboard-server.service --no-pager"
ssh latitude "journalctl --user -u dashboard-server.service --no-pager -n 50"
ssh latitude "journalctl --user -u dashboard-discord-bot.service --no-pager -n 50"
ssh latitude "systemctl --user list-timers --no-pager"   # last/next run for both timers
ssh latitude "systemctl status ollama.service --no-pager"
```

## Manual endpoint smoke test

```bash
KEY=<the DASHBOARD_SERVER_KEY value>
BASE=http://192.168.1.158:8420
curl -s $BASE/health
curl -s -X POST $BASE/insight -H "X-Dashboard-Key: $KEY" -d '{"weather":"clear, 78F"}'
curl -s "$BASE/iss-passes?lat=<lat>&lon=<lon>&hours=72" -H "X-Dashboard-Key: $KEY"
curl -s -X POST $BASE/tts -H "X-Dashboard-Key: $KEY" -d '{"text":"test"}' -o test.wav
curl -s -X POST $BASE/trivia -H "X-Dashboard-Key: $KEY"
curl -s -X POST $BASE/puzzle -H "X-Dashboard-Key: $KEY"
curl -s -X POST $BASE/meal-idea -H "X-Dashboard-Key: $KEY" -d '{"items":["chicken","rice"]}'
curl -s $BASE/discord-inbox -H "X-Dashboard-Key: $KEY"
```

## Passwordless sudo on this box

Set up once via `sudo EDITOR=nano TERM=xterm visudo -f /etc/sudoers.d/rusty`
(the `TERM=xterm` override was needed because the server profile has no
terminfo entry for `xterm-kitty`) containing `rusty ALL=(ALL) NOPASSWD: ALL`.
Only relevant if managing this box from a non-interactive session again.
