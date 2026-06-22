# Team Randomizer

A browser-based team randomizer with Discord queueing, synced lobby viewing,
Smart Fill roster parsing, and locked captain drafting.

## Features

### Team Setup

- Set total players, players per team, and number of teams.
- Warns when team slots do not match player count.
- Supports random team generation.
- Supports manual team sorting.
- Supports light and dark theme.

### Player Entry

- Manual player name entry.
- Quick Add for pasted lists or simple instructions.
- Smart Fill using the OpenAI API through the local/server backend.
- Clear Names action.
- Duplicate-name review with automatic labels like `John(2)`.

### Discord Queue Lobby

- Host creates a Discord queue lobby from the Add Player Names screen.
- Bot posts a Discord message with:
  - Join Queue
  - Leave Queue
  - Open App
- Discord message includes the synced lobby URL.
- Queue stores Discord user IDs, display names, and avatar URLs.
- App can import queued players directly into the roster.
- App shows Discord avatars beside queued players, captains, draft pool players,
  and team members.
- Discord channel ID and host user ID fields are masked by default, with eye
  buttons to reveal them.

### Synced Lobby

- Host receives a private host token when creating a queue lobby.
- Host browser controls setup and publishes lobby state.
- Viewers open the shared `?lobby=...` URL and follow the host's current screen.
- Viewers start locked in view-only mode.
- Signed-in queued players can be recognized by Discord identity.
- The shared lobby banner shows:
  - host/viewer mode
  - join URL
  - copy join link button
  - current viewer/player permission status

### Captain Draft

- Host can select captains from Discord-queued players.
- Captains are mapped to Discord user IDs.
- Captains must sign in with Discord before they can pick.
- Server rejects picks unless the signed-in Discord user is the active captain.
- Draft turns rotate round-robin.
- Each captain gets 90 seconds per pick.
- If time expires, the server randomly drafts one available player for that
  captain, then advances to the next captain.
- Draft ends when all players are drafted or all teams are full.
- Shared lobby refreshes draft state so viewers and captains stay synced.

### Discord Bot Mention

Mention the bot in Discord to get:

- Create Team
- Recent Lobbies

Recent Lobbies returns lobbies created in the last 30 minutes.

## Local Setup

Install dependencies:

```powershell
npm.cmd install
```

Create `.env` from `.env.example` and fill in:

```text
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.5
DISCORD_BOT_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_application_client_id_here
DISCORD_CLIENT_SECRET=your_discord_application_client_secret_here
DISCORD_OAUTH_REDIRECT_URI=http://localhost:5050/auth/discord/callback
```

For Render or another public host, use the public URL:

```text
DISCORD_OAUTH_REDIRECT_URI=https://your-app-url/auth/discord/callback
```

Start the app:

```powershell
npm.cmd run start
```

Open:

```text
http://localhost:5050
```

## Discord Setup

1. Create a Discord application in the Discord Developer Portal.
2. Add a bot to the application.
3. Copy the bot token into `DISCORD_BOT_TOKEN`.
4. Copy the application client ID into `DISCORD_CLIENT_ID`.
5. Copy or reset the client secret and put it in `DISCORD_CLIENT_SECRET`.
6. Add the OAuth redirect URI in Discord Developer Portal under OAuth2.
7. Invite the bot to your server.
8. Give the bot these channel permissions:
   - View Channel
   - Read Message History
   - Send Messages
9. Enable Developer Mode in Discord to copy channel and user IDs.

## Normal Host Flow

1. Host opens the app.
2. Host enters setup:
   - total players
   - players per team
   - number of teams
3. Host enters Discord channel ID and host Discord user ID.
4. Host clicks Create Queue Lobby.
5. Bot posts Join Queue, Leave Queue, and Open App buttons in Discord.
6. Players click Join Queue in Discord.
7. Players open the app link and sign in with Discord if needed.
8. Host clicks Refresh Queue, then Use Queue Players.
9. Host chooses random teams or manual captain draft.

## Locked Captain Draft Flow

1. Host imports queued Discord players.
2. Host chooses manual sort.
3. Host chooses captains.
4. App creates a server-owned draft.
5. Captains open the shared lobby link.
6. Captains sign in with Discord.
7. Only the active captain can click Draft.
8. If a captain times out, a random player is drafted for them.
9. The board advances to the next captain.

## LAN Testing

If another person is on the same network, they cannot use your `localhost`.
They need your machine's local IP:

```text
http://YOUR_LOCAL_IP:5050
```

For example:

```text
http://10.31.121.148:5050
```

Use that same host in `DISCORD_OAUTH_REDIRECT_URI` for Discord sign-in:

```text
DISCORD_OAUTH_REDIRECT_URI=http://10.31.121.148:5050/auth/discord/callback
```

Add that exact redirect URI to the Discord Developer Portal.

## Render Deployment

Create a Render Web Service:

```text
Runtime: Node
Build Command: npm install
Start Command: npm run start
```

Set environment variables:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.5
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_OAUTH_REDIRECT_URI=https://your-render-service.onrender.com/auth/discord/callback
```

Do not set `PORT` on Render. Render provides it automatically.

Add the exact Render OAuth redirect URL to Discord Developer Portal.

## Data Storage

The app currently stores live state in local JSON files:

```text
data/lobbies.json
data/drafts.json
data/sessions.json
```

This is fine for local testing and early hosted testing. For production, move
these to persistent storage such as Postgres, SQLite with a persistent disk, or
another database.

## Useful Commands

Start locally:

```powershell
npm.cmd run start
```

Install dependencies:

```powershell
npm.cmd install
```

Check JavaScript syntax:

```powershell
node --check app.js
node --check server.js
```

## Troubleshooting

### Discord OAuth says invalid redirect URI

Make sure `DISCORD_OAUTH_REDIRECT_URI` exactly matches a redirect URI in the
Discord Developer Portal. The protocol, host, port, path, and trailing slash
must match exactly.

### Other users see localhost links

Set `DISCORD_OAUTH_REDIRECT_URI` to the public or LAN-accessible app URL. The
app uses that setting to generate shared join links.

### Bot does not respond to mentions

Check that the bot is online, the server is running, and the bot has Send
Messages permission in the channel.

### Captains cannot draft

Check that:

- the captain joined through the Discord queue
- the captain opened the shared lobby link
- the captain signed in with the same Discord account
- it is currently that captain's turn

### Viewers are out of sync

Refresh the shared lobby link. The app polls the server, but a refresh clears
stale browser state.
