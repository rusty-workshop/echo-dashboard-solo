#!/usr/bin/env python3
"""Discord bot for echo-dashboard-solo's Companion Server - lets Rusty add
a Sticky Note or Shopping List item to the bedside dashboard from anywhere
on Discord. A separate always-on process from server.py (its own systemd
service, dashboard-discord-bot.service - see server/README.md), not
imported by it; the two only ever communicate through
data/discord_inbox.json, which server.py's GET /discord-inbox reads and
clears (see consume_discord_inbox() there) and the dashboard polls
periodically.

Slash commands, not plain-text DM parsing (an earlier version of this file
worked that way - see git history) - this app is installed as a **user
install** (Developer Portal → Installation → both User Install and Guild
Install are enabled, User Install's default scope is applications.commands),
which is what actually gets you "works in a DM with the bot AND in any
server, without needing to add the bot to a server you admin." User-installed
apps only receive slash-command interactions, not arbitrary message content,
in contexts the bot itself isn't a member of - so slash commands are the
only interface that actually works everywhere the install is meant to reach.
Global command sync (see setup_hook()) can take up to about an hour to
propagate the first time; it's instant on every restart after that.

Commands:
  /note text:<text>   -> queued as a Sticky Note
  /shop item:<item>   -> queued as a Shopping List item

Needs its own bot token (DASHBOARD_DISCORD_BOT_TOKEN in
~/dashboard-server/env) - separate from the judgment-bot already running on
this same box, kept as its own Discord Application/Bot so this
dashboard-specific integration doesn't get tangled up with that unrelated
project. See server/README.md for the exact Developer Portal steps.
"""
import json
import os
import sys
import time
from pathlib import Path

import discord
from discord import app_commands

BASE = Path(__file__).resolve().parent
DISCORD_INBOX_FILE = BASE / "data" / "discord_inbox.json"

TOKEN = os.environ.get("DASHBOARD_DISCORD_BOT_TOKEN", "")


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
    def __init__(self, *, intents):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await self.tree.sync()

    async def on_ready(self):
        print(f"discord_bot logged in as {self.user}")


intents = discord.Intents.default()
client = DashboardBot(intents=intents)


@client.tree.command(name="note", description="Add a Sticky Note to the bedside dashboard")
@app_commands.describe(text="What the note should say")
async def note_command(interaction: discord.Interaction, text: str):
    queue_item("note", text)
    await interaction.response.send_message(f"Added to Sticky Notes: {text}", ephemeral=True)


@client.tree.command(name="shop", description="Add an item to the bedside dashboard's Shopping List")
@app_commands.describe(item="What to add")
async def shop_command(interaction: discord.Interaction, item: str):
    queue_item("shop", item)
    await interaction.response.send_message(f"Added to Shopping List: {item}", ephemeral=True)


def main():
    if not TOKEN:
        print("DASHBOARD_DISCORD_BOT_TOKEN not set - nothing to do. See server/README.md.")
        sys.exit(0)
    client.run(TOKEN)


if __name__ == "__main__":
    main()
