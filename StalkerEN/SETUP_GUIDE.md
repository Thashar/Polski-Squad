# 🔄 StalkerEN Configuration Guide

This guide explains how to configure StalkerEN bot for your Discord servers.

---

## 📋 Quick Start

### Step 1: Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Give it a name (e.g., "StalkerEN")
4. Go to "Bot" section
5. Click "Add Bot"
6. **Enable these Privileged Gateway Intents:**
   - ✅ Server Members Intent
   - ✅ Message Content Intent
7. Click "Reset Token" and copy your bot token

### Step 2: Invite Bot to Server

1. Go to OAuth2 → URL Generator
2. Select scopes:
   - ✅ bot
   - ✅ applications.commands
3. Select bot permissions:
   - ✅ Read Messages/View Channels
   - ✅ Send Messages
   - ✅ Manage Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
   - ✅ Manage Roles
   - ✅ Use Slash Commands
4. Copy the generated URL and open in browser
5. Select your server and authorize

### Step 3: Configure Environment Variables

Create file `StalkerEN/.env`:

```env
STALKER_EN_DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
```

### Step 4: Configure Your Server

1. **Get your Guild ID:**
   - Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
   - Right-click your server icon → Copy ID

2. **Get Role IDs:**
   - Server Settings → Roles
   - Right-click each role → Copy ID

3. **Get Channel IDs:**
   - Right-click each channel → Copy ID

4. **Edit `StalkerEN/config/servers.json`:**

Replace `example_guild_id_123456789` with your actual Guild ID and update all role/channel IDs.

---

## 🌍 Adding Multiple Servers

To add additional servers, simply add new entries to `servers.json`:

```json
{
  "first_guild_id": {
    "serverName": "First Clan",
    // ... configuration
  },
  "second_guild_id": {
    "serverName": "Second Clan",
    // ... configuration
  }
}
```

Each server operates independently with its own punishment points, roles, and channels!

---

For detailed configuration instructions, see README.md
