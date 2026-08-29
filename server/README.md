# echo-dashboard-solo Companion Server

An optional LAN-only companion service for [echo-dashboard-solo](..). See the
"Companion Server (optional)" section of the main README for what it does
and why. This file is the deploy/ops reference.

## Deployed on

A repurposed Dell Latitude E5470 (Arch Linux, headless), reachable at
`ssh latitude` (`192.168.1.158`). i5-6300U, 4 threads, no GPU — every model
choice here (`llama3.2:1b`, Piper's `medium` voice quality) was picked to
run comfortably on that CPU, not for maximum quality.

## Layout on the server

```
~/dashboard-server/
  server.py            # this file, deployed via scp
  env                   # DASHBOARD_SERVER_KEY / PORT / OLLAMA_MODEL - chmod 600
  data/                 # TLE cache
  backups/               # timestamped backup snapshots (90-day retention)
  piper/
    piper/piper           # the piper binary (from GitHub releases)
    voices/en_US-lessac-medium.onnx(.json)
```

Runs as a **systemd --user service** (`~/.config/systemd/user/dashboard-server.service`),
same pattern as `judgment-bot.service` on the same box — `loginctl enable-linger rusty`
is already set so it starts at boot with nobody logged in.

## Dependencies installed on the server

```bash
sudo pacman -S ollama espeak-ng python-pip   # espeak-ng is unused now (kept from v1, harmless)
sudo systemctl enable --now ollama.service
ollama pull llama3.2:1b
```

Piper isn't packaged in Arch's repos (the `piper` package there is an
unrelated gaming-mouse config tool) — installed from a GitHub release
instead:

```bash
mkdir -p ~/dashboard-server/piper && cd ~/dashboard-server/piper
curl -sL -o piper.tar.gz https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar xzf piper.tar.gz && rm piper.tar.gz
mkdir -p voices && cd voices
curl -sL -o en_US-lessac-medium.onnx 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx'
curl -sL -o en_US-lessac-medium.onnx.json 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'
```

`skyfield` (ISS pass math) needs its own venv, since Arch's system Python is
externally-managed:

```bash
cd ~/dashboard-server && python3 -m venv venv
./venv/bin/pip install skyfield
```

No planetary ephemeris file needed — `EarthSatellite.find_events()` only
needs the TLE + observer lat/lon, not a `.bsp` file. (The default
`de421.bsp` mirror skyfield points at is dead - a 404 - if this ever comes
up again for something else, `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp`
was also 404 as of 2026-08-29; hasn't been needed since ISS passes don't
use it.)

## Redeploying after editing `server.py`

```bash
python3 -m py_compile server/server.py   # sanity check locally first
scp server/server.py latitude:~/dashboard-server/server.py
ssh latitude "systemctl --user restart dashboard-server.service && systemctl --user is-active dashboard-server.service"
```

## Config / secrets

`~/dashboard-server/env` on the server (not committed, `chmod 600`):

```
DASHBOARD_SERVER_KEY=<random hex, checked against the X-Dashboard-Key header>
DASHBOARD_SERVER_PORT=8420
DASHBOARD_OLLAMA_MODEL=llama3.2:1b
```

The matching server address + key get typed into the dashboard's
Settings → Companion Server (stored in that browser's `localStorage`, not
in this repo).

## Firewall

Only reachable from the home LAN, not the whole world:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8420 proto tcp
```

## Checking status / logs

```bash
ssh latitude "systemctl --user status dashboard-server.service --no-pager"
ssh latitude "journalctl --user -u dashboard-server.service --no-pager -n 50"
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
```

## Passwordless sudo on this box

Set up once via `sudo EDITOR=nano TERM=xterm visudo -f /etc/sudoers.d/rusty`
(the `TERM=xterm` override was needed because the server profile has no
terminfo entry for `xterm-kitty`) containing `rusty ALL=(ALL) NOPASSWD: ALL`.
Only relevant if managing this box from a non-interactive session again.
