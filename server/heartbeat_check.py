#!/usr/bin/env python3
"""Standalone staleness check for the dashboard's heartbeat, run on its own
systemd timer (dashboard-heartbeat-check.timer) rather than inside
server.py's always-on process - so a bug or hang in the main server doesn't
also take out its own monitor.

The dashboard (see setupHeartbeat() in script.js) POSTs to /heartbeat every
few minutes whenever a Companion Server is configured. If that stops
showing up for longer than HEARTBEAT_STALE_SECONDS, something's wrong -
Fully Kiosk crashed, the device lost power/wifi, the app hung - alert via
ntfy.sh (https://ntfy.sh/<topic>, no account, subscribe from the app or a
browser). Tracks whether it already alerted for the current outage in
alert_state.json, so it fires once per outage, not every time this script
runs, and resets once the heartbeat resumes.
"""
import json
import os
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
HEARTBEAT_FILE = BASE / "data" / "last_heartbeat"
ALERT_STATE_FILE = BASE / "data" / "heartbeat_alert_state.json"

HEARTBEAT_STALE_SECONDS = int(os.environ.get("DASHBOARD_HEARTBEAT_STALE_SECONDS", str(20 * 60)))
NTFY_TOPIC = os.environ.get("DASHBOARD_NTFY_TOPIC", "")
NTFY_URL = f"https://ntfy.sh/{NTFY_TOPIC}"


def load_alert_state():
    if ALERT_STATE_FILE.exists():
        try:
            return json.loads(ALERT_STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"alerted": False}


def save_alert_state(state):
    ALERT_STATE_FILE.write_text(json.dumps(state))


def send_ntfy(title, message, priority="high"):
    if not NTFY_TOPIC:
        print("DASHBOARD_NTFY_TOPIC not set - skipping alert:", title, message)
        return
    req = urllib.request.Request(
        NTFY_URL,
        data=message.encode("utf-8"),
        headers={"Title": title, "Priority": priority, "Tags": "warning"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()


def main():
    state = load_alert_state()

    if not HEARTBEAT_FILE.exists():
        # No heartbeat has ever arrived - not necessarily an outage (could
        # just be a fresh install where the Companion Server isn't
        # configured on the device yet), so stay quiet rather than alerting
        # on day one.
        return

    last_heartbeat = float(HEARTBEAT_FILE.read_text().strip())
    age_seconds = time.time() - last_heartbeat

    if age_seconds > HEARTBEAT_STALE_SECONDS:
        if not state.get("alerted"):
            minutes = round(age_seconds / 60)
            send_ntfy(
                "Bedside dashboard went quiet",
                f"No check-in from the Echo Show in {minutes} minutes. Might be crashed, powered off, or offline.",
            )
            state["alerted"] = True
            save_alert_state(state)
    else:
        if state.get("alerted"):
            send_ntfy("Bedside dashboard is back", "Checked in again after being quiet.", priority="default")
            state["alerted"] = False
            save_alert_state(state)


if __name__ == "__main__":
    main()
