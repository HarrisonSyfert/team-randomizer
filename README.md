# Team Randomizer

A browser-based team randomizer and manual draft board.

## Basic Launch

You can still open `index.html` directly for the non-AI features.

## Smart Fill Launch

Smart Fill uses the OpenAI API through a local backend server so your API key is
not placed in browser code.

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create `.env` from `.env.example` and add your API key:

   ```text
   OPENAI_API_KEY=your_api_key_here
   OPENAI_MODEL=gpt-5.5
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   PORT=5050
   DISCORD_CLIENT_ID=your_discord_application_client_id_here
   DISCORD_CLIENT_SECRET=your_discord_application_client_secret_here
   DISCORD_OAUTH_REDIRECT_URI=http://localhost:5050/auth/discord/callback
   ```

3. Start the local server:

   ```powershell
   npm.cmd run start
   ```

4. Open:

   ```text
   http://localhost:5050
   ```

If Smart Fill fails or the API key is missing, use the normal Fill Names button.

## Discord Import

Discord features use the local backend server so your bot token is not placed in
browser code. Keep the local server running while a queue is open so the bot can
receive Join and Leave button clicks.

1. Create a Discord application and bot in the Discord Developer Portal.
2. Add the bot token to `.env` as `DISCORD_BOT_TOKEN`.
3. Add the app client ID and client secret to `.env` for Discord sign-in.
4. In the Discord Developer Portal, add this OAuth redirect URL:
   `http://localhost:5050/auth/discord/callback`.
5. Invite the bot to your server and give it View Channel and Read Message
   History access in the target text channel.
6. In Discord, enable Developer Mode, right-click the text channel, and copy the
   channel ID.
7. Right-click the host user and copy their user ID.
8. Start the local server, paste the channel ID into the app, and click Import
   Recent Posters.

For a cleaner signup flow, create a Discord queue lobby from the app instead.
The bot posts Join Queue and Leave Queue buttons in the selected channel. Players
click the button, the queue is saved locally, and the host can refresh the queue
and use those players as the roster. The queue message mentions the host user ID
entered in the app. Locked captain drafts require captains to sign in with
Discord before they can submit picks.
