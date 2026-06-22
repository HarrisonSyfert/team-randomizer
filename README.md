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
   PORT=5050
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
