#!/usr/bin/env python3
"""Discord bot for echo-dashboard-solo's Companion Server - lets Rusty add
a Sticky Note or Shopping List item to the bedside dashboard from anywhere,
by DMing this bot on Discord. A separate always-on process from server.py
(its own systemd service, dashboard-discord-bot.service - see
server/README.md), not imported by it; the two only ever communicate
through data/discord_inbox.json, which server.py's GET /discord-inbox
reads and clears (see consume_discord_inbox() there) and the dashboard
polls periodically.

DM commands (case-insensitive prefix, rest of the message is the text):
  note: <text>   -> queued as a Sticky Note
  shop: <item>   -> queued as a Shopping List item
Anything else gets a short reply explaining the two commands, and isn't
queued.

Needs its own bot token (DASHBOARD_DISCORD_BOT_TOKEN in
~/dashboard-server/env) - separate from the judgment-bot already running
on this same box, kept as its own Discord Application/Bot so this
dashboard-specific integration doesn't get tangled up with that unrelated
project. See server/README.md for the exact Developer Portal steps.
"""
import json
import os
import sys
import time
from pathlib import Path

import discord

BASE = Path(__file__).resolve().parent
DISCORD_INBOX_FILE = BASE / "data" / "discord_inbox.json"

TOKEN = os.environ.get("DASHBOARD_DISCORD_BOT_TOKEN", "")

HELP_TEXT = "Try one of these:\n`note: <text>` - adds a Sticky Note\n`shop: <item>` - adds a Shopping List item"


def queue_item(item_type, text):
    # Simple read-modify-write, no file locking - server.py's own reads are
    # infrequent (one dashboard poll every several minutes) and this bot is
    # single-user, so the race window is negligible in practice, not worth
    # the added complexity of a lock file for this.
    items = []
    if DISCORD_INBOX_FILE.exists():
        try:
            items = json.loads(DISCORD_INBOX_FILE.read_text())
            if not isinstance(items, list):
                items = []
        except (json.JSONDecodeError, OSError):
            items = []
    items.append({"type": item_type, "text": text, "receivedAt": time.time()})
    DISCORD_INBOX_FILE.write_text(json.dumps(items))


class DashboardBot(discord.Client):
    async def on_ready(self):
        print(f"discord_bot logged in as {self.user}")

    async def on_message(self, message):
        if message.author.bot or not isinstance(message.channel, discord.DMChannel):
            return

        text = message.content.strip()
        lowered = text.lower()

        if lowered.startswith("note:") or lowered.startswith("note "):
            note_text = text[5:].strip()
            if note_text:
                queue_item("note", note_text)
                await message.add_reaction("✅")
                return
        elif lowered.startswith("shop:") or lowered.startswith("shop "):
            item_text = text[5:].strip()
            if item_text:
                queue_item("shop", item_text)
                await message.add_reaction("✅")
                return

        await message.channel.send(HELP_TEXT)


def main():
    if not TOKEN:
        print("DASHBOARD_DISCORD_BOT_TOKEN not set - nothing to do. See server/README.md.")
        sys.exit(0)

    intents = discord.Intents.default()
    intents.message_content = True
    client = DashboardBot(intents=intents)
    client.run(TOKEN)


if __name__ == "__main__":
    main()
