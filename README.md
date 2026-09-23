# PringleBot

PringleBot is the Discord support bot for PringleSMP. It is designed to run locally, on Render, or in a container.

## Included

- Private support tickets with a dropdown + modal
- General support
- Ban appeals
- Media requests
- Mute appeals
- Lag-machine appeals
- Admin requests
- Shop-item requests
- Player reports
- Claim and close buttons
- Staff-only ticket management
- Add/remove ticket users
- Ticket transcripts sent to a private log channel
- Anti-spam protection for AI replies
- PringleAI with Groq and automatic fallback model
- AI replies in DMs, ticket owner messages, /ask, and direct mentions
- /server, /ping, /status and /help
- /announce
- /setai per-server switch
- Automatic setup of the staff role, ticket category and log channel
- Render health endpoint at /health
- GitHub Actions syntax check

## Setup

1. Install Node.js 24.17 or newer.
2. Download/clone this repository.
3. Run npm install.
4. Copy .env.example to .env.
5. Add your Discord bot token and Discord application/client ID.
6. Enable the Message Content Intent in the Discord Developer Portal because PringleBot reads message content for AI support.
7. Give the bot permission to manage channels, send messages, read message history, manage messages, embed links, attach files and use application commands.
8. Run npm start.
9. In your Discord server, run /setup.
10. Run /panel in the channel where you want the support panel.

## Environment

Required:
DISCORD_TOKEN
CLIENT_ID

Optional:
GUILD_ID - register commands to one test server instead of globally
GROQ_API_KEY - enables PringleAI
GROQ_MODEL - default: openai/gpt-oss-20b
GROQ_FALLBACK_MODEL - default: llama-3.3-70b-versatile
AI_ENABLED - default: true
SERVER_NAME - default: PringleSMP
MC_IP - default: pringlesmp.mcsh.io
MC_PORT - default: 19132
DISCORD_INVITE - default: https://discord.gg/5BSSkFeNfR
STAFF_ROLE_ID
TICKET_CATEGORY_ID
LOG_CHANNEL_ID
PORT - default: 10000

## Render

This repository includes render.yaml.

Set DISCORD_TOKEN, CLIENT_ID and GROQ_API_KEY as secret environment variables in Render. The included health endpoint listens on 0.0.0.0 and uses the Render PORT value.

Ticket channels remain open until the user or staff member closes them.

PringleBot stores per-server setup in data/guilds.json. Render web-service filesystems are ephemeral, so use the environment ID variables for durable configuration when needed.

## Important

Never commit your Discord bot token or Groq API key.

The bot cannot make moderation decisions or access private information through AI. Staff still control real punishments and account actions.

## Commands

Member:
 /help
 /ping
 /status
 /server
 /ask

Staff:
 /setup
 /panel
 /tickets
 /claim
 /close
 /add
 /remove
 /announce
 /setai
