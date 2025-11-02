# 🎯 StalkerEN - Multi-Server Punishment & Vacation Bot

> **English version of Stalker bot with multi-server support**

[![Discord.js](https://img.shields.io/badge/discord.js-v14.21.0-blue.svg)](https://discord.js.org/)
[![Multi-Server](https://img.shields.io/badge/Multi--Server-✓-green.svg)]()
[![OCR](https://img.shields.io/badge/OCR-Tesseract.js-orange.svg)]()

---

## 🚀 Overview

StalkerEN is a Discord bot designed for clan management in Survivor.io. It automatically tracks boss battle participation using OCR (Optical Character Recognition), manages punishment points, and handles vacation requests. The bot supports **multiple Discord servers** with independent configurations.

### ✨ Key Features

- 🤖 **Multi-Server Support** - Configure multiple Discord servers independently
- 📸 **OCR Analysis** - Automatic image analysis using Tesseract.js
- ⚖️ **Punishment System** - Point-based punishment system with role management
- 🏖️ **Vacation Management** - Handle member vacation requests
- 🔄 **Weekly Cleanup** - Automatic weekly reset of punishment points
- 🌐 **Fully English** - All messages and commands in English
- 🔧 **Easy Configuration** - Simple JSON-based server configuration

---

## 🎮 Features

### Boss Battle Tracking

The bot analyzes screenshots from Lunar Mine Expedition battles:

- **Phase 1**: Full participant list (detects members with 0 damage)
- **Phase 2**: Boss battle rounds (3 rounds per boss)
- Automatically assigns punishment points for non-participation

### Punishment System

- **2 Points**: Punishment role assigned, lottery participation allowed
- **3+ Points**: Lottery ban role assigned, excluded from rewards
- **5+ Points**: Clan removal warning
- **Weekly Reset**: Points reset every Monday at midnight

### Vacation System

- Members can request vacation status
- Cooldown period: 6 hours between requests
- Interactive button-based system

### Commands

**Public Commands:**
- `/decode [code]` - Decode Survivor.io build codes (channel whitelist)
- `/wyniki` - View current week results

**Moderator Commands:**
- `/faza1` - Process Phase 1 screenshots (participant list)
- `/faza2` - Process Phase 2 screenshots (boss battles)
- `/punishment [user]` - View user punishment points
- `/points add [user] [points]` - Add punishment points manually
- `/points remove [user] [points]` - Remove punishment points manually

---

## 📦 Installation

### Prerequisites

- Node.js >= 16.0.0
- Discord Bot Token
- Discord Server with appropriate permissions

### Setup

1. **Create Discord Bot Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create new application
   - Go to "Bot" section and create bot
   - Copy the bot token
   - Enable required intents: Server Members, Message Content

2. **Install Dependencies** (if not already installed)
   ```bash
   cd "Polski Squad"
   npm install
   ```

3. **Configure Environment Variables**

   Create `.env` file in `StalkerEN/` directory:
   ```env
   STALKER_EN_DISCORD_TOKEN=your_bot_token_here
   ```

4. **Configure Servers**

   Edit `StalkerEN/config/servers.json`:
   ```json
   {
     "YOUR_GUILD_ID_HERE": {
       "serverName": "Your Server Name",
       "enabled": true,
       "allowedPunishRoles": [
         "moderator_role_id_1",
         "moderator_role_id_2"
       ],
       "punishmentRoleId": "punishment_role_id",
       "lotteryBanRoleId": "lottery_ban_role_id",
       "targetRoles": {
         "0": "squad_0_role_id",
         "1": "squad_1_role_id",
         "2": "squad_2_role_id",
         "main": "main_squad_role_id"
       },
       "roleDisplayNames": {
         "0": "🎮Squad⁰🎮",
         "1": "⚡Squad¹⚡",
         "2": "💥Squad²💥",
         "main": "🔥Main Squad🔥"
       },
       "warningChannels": {
         "squad_0_role_id": "warnings_channel_0_id",
         "squad_1_role_id": "warnings_channel_1_id",
         "squad_2_role_id": "warnings_channel_2_id",
         "main_squad_role_id": "warnings_channel_main_id"
       },
       "allowedDecodeChannels": [
         "channel_id_1",
         "channel_id_2"
       ],
       "vacationChannelId": "vacation_channel_id",
       "vacationRequestRoleId": "vacation_request_role_id"
       }
   }
   ```

---

## 🚀 Running the Bot

### Standalone Mode

```bash
# Run only StalkerEN bot
npm run stalkeren
```

### With Other Bots (Production)

Edit `bot-config.json` to include `stalkeren`:
```json
{
  "production": ["rekruter", "endersecho", "szkolenia", "stalkerlme", "stalkeren", "kontroler", "konklawe", "muteusz", "wydarzynier", "gary"],
  "development": ["stalkeren"]
}
```

Then run:
```bash
npm start
```

---

## 🔧 Configuration Guide

### Finding Discord IDs

1. Enable Developer Mode in Discord:
   - Settings → Advanced → Developer Mode

2. Get Guild ID:
   - Right-click server icon → Copy ID

3. Get Role IDs:
   - Server Settings → Roles → Right-click role → Copy ID

4. Get Channel IDs:
   - Right-click channel → Copy ID

### Server Configuration Explained

```json
{
  "YOUR_GUILD_ID": {
    // Display name for logging purposes
    "serverName": "Your Server Name",

    // Enable/disable bot for this server
    "enabled": true,

    // Role IDs that can use moderator commands
    "allowedPunishRoles": ["role_id_1", "role_id_2"],

    // Role given to users with 2+ points
    "punishmentRoleId": "role_id",

    // Role given to users with 3+ points (lottery ban)
    "lotteryBanRoleId": "role_id",

    // Target squad/clan roles to track
    "targetRoles": {
      "0": "role_id",
      "1": "role_id",
      "2": "role_id",
      "main": "role_id"
    },

    // Display names for each squad
    "roleDisplayNames": {
      "0": "🎮Squad⁰🎮",
      "1": "⚡Squad¹⚡",
      "2": "💥Squad²💥",
      "main": "🔥Main Squad🔥"
    },

    // Warning channels for each squad role
    "warningChannels": {
      "role_id_0": "channel_id_0",
      "role_id_1": "channel_id_1"
    },

    // Channels where /decode command is allowed
    "allowedDecodeChannels": ["channel_1", "channel_2"],

    // Channel for vacation requests
    "vacationChannelId": "channel_id",

    // Role assigned when requesting vacation
    "vacationRequestRoleId": "role_id"
  }
}
```

---

## 📊 Adding Multiple Servers

To add support for additional servers, simply add a new entry in `servers.json`:

```json
{
  "first_guild_id": {
    "serverName": "First Server",
    // ... configuration
  },
  "second_guild_id": {
    "serverName": "Second Server",
    // ... configuration
  },
  "third_guild_id": {
    "serverName": "Third Server",
    // ... configuration
  }
}
```

Each server operates independently with its own:
- Punishment points database
- Role configurations
- Warning channels
- Moderator permissions

---

## 🛠️ Troubleshooting

### Bot doesn't respond to commands

1. Check bot has proper intents enabled (Server Members, Message Content)
2. Ensure bot has proper permissions in channels
3. Verify server is configured in `servers.json`
4. Check logs for configuration warnings

### Commands show "Server not configured"

- Verify your Guild ID in `servers.json` matches your Discord server
- Ensure `"enabled": true` is set for the server
- Restart the bot after configuration changes

### OCR not detecting players

- Ensure screenshots are clear and high quality
- Check OCR debug logs with `/ocr-debug true`
- Verify processed images in `processed_ocr/` directory

### Permissions errors

- Ensure moderator role IDs in `allowedPunishRoles` are correct
- Verify bot has permission to manage roles
- Check bot role hierarchy (bot role must be higher than punishment roles)

---

## 📁 File Structure

```
StalkerEN/
├── config/
│   ├── config.js          # Main configuration & server loader
│   ├── messages.js        # Message templates (English)
│   └── servers.json       # Multi-server configuration
├── handlers/
│   └── interactionHandlers.js  # Command & interaction handlers
├── services/
│   ├── databaseService.js      # Database operations
│   ├── ocrService.js           # OCR image processing
│   ├── punishmentService.js    # Punishment logic
│   ├── reminderService.js      # Boss reminders
│   ├── vacationService.js      # Vacation management
│   ├── phaseService.js         # Phase 1 & 2 processing
│   ├── survivorService.js      # Build decoder
│   └── messageCleanupService.js
├── utils/
│   └── helpers.js         # Utility functions
├── data/                  # Database files (JSON)
├── index.js              # Main entry point
└── README.md             # This file
```

---

## 🔄 Differences from StalkerLME

| Feature | StalkerLME (Polish) | StalkerEN (English) |
|---------|---------------------|---------------------|
| Language | Polish | English |
| Server Support | Single server (env vars) | Multi-server (JSON config) |
| Configuration | Environment variables | `servers.json` file |
| Adding Servers | Requires code changes | Edit JSON file only |
| Role/Channel IDs | Hardcoded in .env | Per-server in config |

---

## 📝 Maintenance

### Weekly Tasks (Automatic)

- **Monday 00:00**: Automatic punishment point reset
- **Daily 02:00**: Temporary file cleanup

### Manual Tasks

- Review punishment point rankings
- Process Phase 1 & 2 screenshots
- Handle vacation requests
- Monitor OCR accuracy

---

## 🆘 Support

For issues or questions:

1. Check this README first
2. Review bot logs in console
3. Enable OCR debug: `/ocr-debug true`
4. Check `processed_ocr/` folder for OCR results
5. Create issue on GitHub repository

---

## 📄 License

ISC License - See main repository LICENSE file

---

<div align="center">

**StalkerEN - Multi-Server Punishment Bot**

Made with ❤️ for Survivor.io clans

[GitHub Repository](https://github.com/Thashar/Test)

</div>
