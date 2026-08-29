#!/usr/bin/env python3
"""Verifies the most recent backup in backups/ is valid, readable JSON with
the shape save_backup()/exportBackup() actually produce. Run on its own
systemd timer (dashboard-backup-check.timer), same pattern and same ntfy
alert channel as heartbeat_check.py - the off-device backup feature is
only actually worth anything if a real outage (disk fills up, a write gets
interrupted mid-save) doesn't go unnoticed. Alerts once per distinct
failure, same "don't re-alert every run" state-tracking idea as
heartbeat_check.py, tracked separately so the two don't clobber each
other's state.
"""
import json
from pathlib import Path

from heartbeat_check import load_alert_state, save_alert_state, send_ntfy  # reuses the same ntfy helper

BASE = Path(__file__).resolve().parent
BACKUP_DIR = BASE / "backups"
ALERT_STATE_FILE = BASE / "data" / "backup_alert_state.json"


def load_state():
    if ALERT_STATE_FILE.exists():
        try:
            return json.loads(ALERT_STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"alerted": False}


def save_state(state):
    ALERT_STATE_FILE.write_text(json.dumps(state))


def latest_backup_is_valid():
    files = sorted(BACKUP_DIR.glob("*.json"))
    if not files:
        return True, "no backups yet"  # not a failure - just nothing to check yet

    latest = files[-1]
    try:
        data = json.loads(latest.read_text())
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        return False, f"{latest.name} failed to parse: {e}"

    if not isinstance(data, dict) or "localStorage" not in data or "version" not in data:
        return False, f"{latest.name} is missing expected top-level keys"

    return True, latest.name


def main():
    state = load_state()
    ok, detail = latest_backup_is_valid()

    if not ok:
        if not state.get("alerted"):
            send_ntfy("Dashboard backup looks corrupt", detail)
            state["alerted"] = True
            save_state(state)
    else:
        if state.get("alerted"):
            send_ntfy("Dashboard backup is healthy again", detail, priority="default")
            state["alerted"] = False
            save_state(state)


if __name__ == "__main__":
    main()
