const express = require('express');
const cors = require('cors');
require('dotenv').config();

const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 5050;
const model = process.env.OPENAI_MODEL || 'gpt-5.5';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function parseJsonObject(value) {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1] : trimmed;

  return JSON.parse(jsonText);
}

function normalizePlayers(players, maxPlayers) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players
    .map((player) => String(player).trim())
    .filter(Boolean)
    .slice(0, maxPlayers);
}

app.post('/api/parse-players', async (req, res) => {
  const { text, maxPlayers, existingPlayers = [] } = req.body;
  const playerLimit = Number.parseInt(maxPlayers, 10);

  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({
      error: 'OPENAI_API_KEY is not configured on the local server.'
    });
  }

  if (typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'Text is required.' });
  }

  if (!Number.isInteger(playerLimit) || playerLimit < 1) {
    return res.status(400).json({ error: 'A valid maxPlayers value is required.' });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: [
            'You update a roster for a team randomizer app.',
            'Use the existing players as the current roster.',
            'Apply the user instruction to that roster.',
            'If the user asks to add names, append them without removing existing players.',
            'If the user asks to replace, swap, change out, remove, or drop a player, update the roster accordingly.',
            'Return only JSON in this exact shape: {"players":["Name One","Name Two"]}.',
            'Do not invent names.',
            'Preserve duplicate names when the instruction implies multiple different people may share the same name.',
            'Preserve normal capitalization for names.',
            'Ignore words that are instructions, team labels, filler, or not player names.',
            `Return at most ${playerLimit} names.`
          ].join(' ')
        },
        {
          role: 'user',
          content: [
            `Existing players: ${JSON.stringify(normalizePlayers(existingPlayers, playerLimit))}`,
            `Instruction: ${text}`
          ].join('\n')
        }
      ].map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')
    });
    const parsed = parseJsonObject(response.output_text || '{}');
    const players = normalizePlayers(parsed.players, playerLimit);

    return res.json({ players });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Smart player parsing failed.'
    });
  }
});

app.listen(port, () => {
  console.log(`Team Randomizer available at http://localhost:${port}`);
  console.log(`Smart Fill model: ${model}`);
});
