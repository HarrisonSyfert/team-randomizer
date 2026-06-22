const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 5050;
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const LOBBY_STORE_PATH = path.join(__dirname, 'data', 'lobbies.json');
const DRAFT_STORE_PATH = path.join(__dirname, 'data', 'drafts.json');
const SESSION_STORE_PATH = path.join(__dirname, 'data', 'sessions.json');
const DISCORD_BUTTON_PREFIX = 'trq';
const DRAFT_TURN_SECONDS = 90;
const SESSION_COOKIE_NAME = 'team_randomizer_session';
const DISCORD_GATEWAY_INTENTS = 512;
const oauthStates = new Set();
const discordGatewayState = {
  socket: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  lastSequence: null,
  botUserId: null,
};

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/auth/discord', (req, res) => {
  const { clientId, redirectUri } = getDiscordOAuthConfig();

  if (!clientId) {
    return res.status(400).send('DISCORD_CLIENT_ID is not configured.');
  }

  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });

  oauthStates.add(state);
  return res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { clientId, clientSecret, redirectUri } = getDiscordOAuthConfig();
  const { code, state } = req.query;

  if (!clientId || !clientSecret) {
    return res.status(400).send('Discord OAuth client ID or secret is not configured.');
  }

  if (!code || !state || !oauthStates.has(state)) {
    return res.status(400).send('Discord sign-in could not be verified.');
  }

  oauthStates.delete(state);

  try {
    const tokenResponse = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || tokenData.error || 'Discord token exchange failed.');
    }

    const userResponse = await fetch(`${DISCORD_API_BASE_URL}/users/@me`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });
    const userData = await userResponse.json().catch(() => ({}));

    if (!userResponse.ok) {
      throw new Error(userData.message || 'Discord user lookup failed.');
    }

    const session = saveSession({
      id: userData.id,
      username: userData.username,
      globalName: userData.global_name || userData.username,
      avatar: userData.avatar || null,
    });

    res.cookie(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return res.redirect('/');
  } catch (error) {
    return res.status(500).send(error.message || 'Discord sign-in failed.');
  }
});

app.get('/api/session', (req, res) => {
  return res.json({ user: getSessionUser(req) });
});

app.get('/api/config', (req, res) => {
  return res.json({ publicBaseUrl: getPublicBaseUrl() });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (sessionId) {
    const store = readSessionStore();
    store.sessions = store.sessions.filter((session) => session.id !== sessionId);
    writeSessionStore(store);
  }

  res.clearCookie(SESSION_COOKIE_NAME);
  return res.json({ ok: true });
});

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

function normalizeDiscordChannelId(channelId) {
  return String(channelId || '').trim();
}

function normalizeDiscordUserId(userId) {
  return String(userId || '').trim();
}

function getDiscordDisplayName(message) {
  return (
    message.member?.nick ||
    message.member?.user?.global_name ||
    message.author?.global_name ||
    message.author?.username ||
    ''
  );
}

async function fetchDiscordChannelMessages(channelId, limit) {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages?${params}`, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.message || 'Discord channel import failed.';
    throw new Error(`${message} (${response.status})`);
  }

  return Array.isArray(data) ? data : [];
}

function readLobbyStore() {
  try {
    return JSON.parse(fs.readFileSync(LOBBY_STORE_PATH, 'utf8'));
  } catch {
    return { lobbies: [] };
  }
}

function writeLobbyStore(store) {
  fs.mkdirSync(path.dirname(LOBBY_STORE_PATH), { recursive: true });
  fs.writeFileSync(LOBBY_STORE_PATH, JSON.stringify(store, null, 2));
}

function readSessionStore() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_STORE_PATH, 'utf8'));
  } catch {
    return { sessions: [] };
  }
}

function writeSessionStore(store) {
  fs.mkdirSync(path.dirname(SESSION_STORE_PATH), { recursive: true });
  fs.writeFileSync(SESSION_STORE_PATH, JSON.stringify(store, null, 2));
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...valueParts] = cookie.split('=');
        return [name, decodeURIComponent(valueParts.join('='))];
      })
  );
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    return null;
  }

  const store = readSessionStore();
  const session = store.sessions.find((item) => item.id === sessionId);

  return session?.user || null;
}

function saveSession(user) {
  const store = readSessionStore();
  const session = {
    id: crypto.randomUUID(),
    user,
    createdAt: new Date().toISOString(),
  };

  store.sessions = [...store.sessions.filter((item) => item.user?.id !== user.id), session];
  writeSessionStore(store);

  return session;
}

function getOAuthRedirectUri() {
  return process.env.DISCORD_OAUTH_REDIRECT_URI || `http://localhost:${port}/auth/discord/callback`;
}

function getPublicBaseUrl() {
  try {
    return new URL(getOAuthRedirectUri()).origin;
  } catch {
    return `http://localhost:${port}`;
  }
}

function getDiscordOAuthConfig() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: getOAuthRedirectUri(),
  };
}

function readDraftStore() {
  try {
    return JSON.parse(fs.readFileSync(DRAFT_STORE_PATH, 'utf8'));
  } catch {
    return { drafts: [] };
  }
}

function writeDraftStore(store) {
  fs.mkdirSync(path.dirname(DRAFT_STORE_PATH), { recursive: true });
  fs.writeFileSync(DRAFT_STORE_PATH, JSON.stringify(store, null, 2));
}

function normalizeDraft(draft) {
  return {
    ...draft,
    teams: Array.isArray(draft.teams) ? draft.teams : [],
    unassignedPlayers: Array.isArray(draft.unassignedPlayers) ? draft.unassignedPlayers : [],
    playerMeta: normalizePlayerMeta(draft.playerMeta),
  };
}

function isDraftTeamFull(draft, team) {
  return team.players.length >= draft.playersPerTeam;
}

function isServerDraftComplete(draft) {
  return (
    draft.unassignedPlayers.length === 0 ||
    draft.teams.every((team) => isDraftTeamFull(draft, team))
  );
}

function getNextServerDraftTeamIndex(draft, currentIndex) {
  if (!draft.teams.length || draft.teams.every((team) => isDraftTeamFull(draft, team))) {
    return -1;
  }

  for (let offset = 1; offset <= draft.teams.length; offset += 1) {
    const teamIndex = (currentIndex + offset + draft.teams.length) % draft.teams.length;

    if (!isDraftTeamFull(draft, draft.teams[teamIndex])) {
      return teamIndex;
    }
  }

  return -1;
}

function startServerDraftTurn(draft, teamIndex, now = Date.now()) {
  if (teamIndex < 0 || isServerDraftComplete(draft)) {
    draft.status = 'complete';
    draft.turnEndsAt = null;
    return draft;
  }

  draft.status = 'active';
  draft.currentTeamIndex = teamIndex;
  draft.turnStartedAt = new Date(now).toISOString();
  draft.turnEndsAt = new Date(now + (draft.turnSeconds * 1000)).toISOString();

  return draft;
}

function pickRandomUnassignedPlayer(draft) {
  if (!draft.unassignedPlayers.length) {
    return '';
  }

  const randomIndex = Math.floor(Math.random() * draft.unassignedPlayers.length);
  const [player] = draft.unassignedPlayers.splice(randomIndex, 1);

  return player;
}

function autoDraftForExpiredTurn(draft) {
  const activeTeam = draft.teams[draft.currentTeamIndex];

  if (!activeTeam || isDraftTeamFull(draft, activeTeam) || !draft.unassignedPlayers.length) {
    return;
  }

  const player = pickRandomUnassignedPlayer(draft);

  if (player) {
    activeTeam.players.push(player);
  }
}

function advanceExpiredDraftTurns(draft) {
  const now = Date.now();

  while (draft.status === 'active' && draft.turnEndsAt && Date.parse(draft.turnEndsAt) <= now) {
    autoDraftForExpiredTurn(draft);

    if (isServerDraftComplete(draft)) {
      draft.status = 'complete';
      draft.turnEndsAt = null;
      break;
    }

    const nextIndex = getNextServerDraftTeamIndex(draft, draft.currentTeamIndex);
    startServerDraftTurn(draft, nextIndex, now);
  }

  if (draft.status === 'active' && isServerDraftComplete(draft)) {
    draft.status = 'complete';
    draft.turnEndsAt = null;
  }

  return draft;
}

function publicDraft(draft) {
  const updatedDraft = advanceExpiredDraftTurns(normalizeDraft(draft));

  return {
    id: updatedDraft.id,
    status: updatedDraft.status,
    teams: updatedDraft.teams,
    unassignedPlayers: updatedDraft.unassignedPlayers,
    playerMeta: updatedDraft.playerMeta,
    playersPerTeam: updatedDraft.playersPerTeam,
    currentTeamIndex: updatedDraft.currentTeamIndex,
    turnStartedAt: updatedDraft.turnStartedAt,
    turnEndsAt: updatedDraft.turnEndsAt,
    turnSeconds: updatedDraft.turnSeconds,
    createdAt: updatedDraft.createdAt,
    updatedAt: updatedDraft.updatedAt,
  };
}

function normalizePlayerMeta(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([name, meta]) => [
      name,
      {
        userId: normalizeDiscordUserId(meta?.userId),
        avatarUrl: String(meta?.avatarUrl || ''),
      },
    ])
  );
}

function findDraft(draftId) {
  const store = readDraftStore();
  const draft = store.drafts.find((item) => item.id === draftId);

  return draft ? normalizeDraft(draft) : null;
}

function updateDraft(draftId, updater) {
  const store = readDraftStore();
  const draftIndex = store.drafts.findIndex((item) => item.id === draftId);

  if (draftIndex < 0) {
    return null;
  }

  const nextDraft = normalizeDraft(updater(advanceExpiredDraftTurns(normalizeDraft(store.drafts[draftIndex]))));
  nextDraft.updatedAt = new Date().toISOString();
  store.drafts[draftIndex] = nextDraft;
  writeDraftStore(store);

  return nextDraft;
}

function normalizeLobby(lobby) {
  return {
    ...lobby,
    players: Array.isArray(lobby.players) ? lobby.players : [],
  };
}

function findLobby(lobbyId) {
  const store = readLobbyStore();
  const lobby = store.lobbies.find((item) => item.id === lobbyId);

  return lobby ? normalizeLobby(lobby) : null;
}

function updateLobby(lobbyId, updater) {
  const store = readLobbyStore();
  const lobbyIndex = store.lobbies.findIndex((item) => item.id === lobbyId);

  if (lobbyIndex < 0) {
    return null;
  }

  const nextLobby = normalizeLobby(updater(normalizeLobby(store.lobbies[lobbyIndex])));
  store.lobbies[lobbyIndex] = nextLobby;
  writeLobbyStore(store);

  return nextLobby;
}

function getDiscordInteractionName(interaction) {
  return (
    interaction.member?.nick ||
    interaction.member?.user?.global_name ||
    interaction.user?.global_name ||
    interaction.member?.user?.username ||
    interaction.user?.username ||
    'Discord Player'
  );
}

function getDiscordAvatarUrl(user) {
  if (!user?.id) {
    return '';
  }

  if (user.avatar) {
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=64`;
  }

  const discriminator = Number.parseInt(user.discriminator || '0', 10);
  const fallbackIndex = Number.isInteger(discriminator) && discriminator > 0
    ? discriminator % 5
    : Number(BigInt(user.id) >> 22n) % 6;

  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

function publicLobby(lobby) {
  return {
    id: lobby.id,
    channelId: lobby.channelId,
    messageId: lobby.messageId || null,
    totalPlayers: lobby.totalPlayers,
    playersPerTeam: lobby.playersPerTeam,
    teamCount: lobby.teamCount,
    hostUserId: lobby.hostUserId || '',
    status: lobby.status,
    players: lobby.players,
    appState: lobby.appState || null,
    createdAt: lobby.createdAt,
    updatedAt: lobby.updatedAt,
  };
}

function buildLobbyMessage(lobby) {
  const playerCount = lobby.players.length;
  const hostMention = lobby.hostUserId ? `<@${lobby.hostUserId}>` : 'The host';
  const appJoinUrl = `${getPublicBaseUrl()}/?lobby=${lobby.id}`;
  const roster = lobby.players
    .map((player, index) => `${index + 1}. ${player.displayName}`)
    .join('\n');
  const queueText = roster || 'No players queued yet.';
  const statusLine = lobby.status === 'open'
    ? 'Click Join Queue to be added. Click Leave Queue to remove yourself.'
    : 'This queue is closed.';

  return {
    content: [
      `${hostMention} opened a Team Randomizer queue.`,
      `The queue is ${lobby.status}.`,
      `${playerCount}/${lobby.totalPlayers} players queued for ${lobby.teamCount} team(s) of ${lobby.playersPerTeam}.`,
      statusLine,
      `Open the synced draft room: ${appJoinUrl}`,
      '',
      queueText,
    ].join('\n'),
    allowed_mentions: lobby.hostUserId ? { users: [lobby.hostUserId] } : { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Join Queue',
            custom_id: `${DISCORD_BUTTON_PREFIX}:join:${lobby.id}`,
            disabled: lobby.status !== 'open' || playerCount >= lobby.totalPlayers,
          },
          {
            type: 2,
            style: 4,
            label: 'Leave Queue',
            custom_id: `${DISCORD_BUTTON_PREFIX}:leave:${lobby.id}`,
            disabled: lobby.status !== 'open',
          },
          {
            type: 2,
            style: 5,
            label: 'Open App',
            url: appJoinUrl,
          },
        ],
      },
    ],
  };
}

function getAppHomeUrl() {
  return getPublicBaseUrl();
}

function getLobbyJoinUrl(lobbyId) {
  return `${getPublicBaseUrl()}/?lobby=${lobbyId}`;
}

function buildTeamPromptMessage() {
  return {
    content: 'Want to start a Team Randomizer lobby or jump into one created recently?',
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Create Team',
            url: getAppHomeUrl(),
          },
          {
            type: 2,
            style: 2,
            label: 'Recent Lobbies',
            custom_id: `${DISCORD_BUTTON_PREFIX}:recent`,
          },
        ],
      },
    ],
  };
}

function getRecentLobbies(minutes = 30) {
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const store = readLobbyStore();

  return store.lobbies
    .filter((lobby) => Date.parse(lobby.createdAt || 0) >= cutoff)
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .slice(0, 5)
    .map(normalizeLobby);
}

function formatRecentLobbyList(lobbies) {
  if (!lobbies.length) {
    return `No lobbies were created in the last 30 minutes.\nCreate one here: ${getAppHomeUrl()}`;
  }

  return [
    'Lobbies created in the last 30 minutes:',
    ...lobbies.map((lobby, index) => {
      const playerCount = lobby.players.length;
      return `${index + 1}. ${playerCount}/${lobby.totalPlayers} queued - ${getLobbyJoinUrl(lobby.id)}`;
    }),
  ].join('\n');
}

async function discordRequest(pathname, options = {}) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.message || 'Discord request failed.';
    throw new Error(`${message} (${response.status})`);
  }

  return data;
}

async function createDiscordLobbyMessage(lobby) {
  return discordRequest(`/channels/${lobby.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(buildLobbyMessage(lobby)),
  });
}

async function updateDiscordLobbyMessage(lobby) {
  if (!lobby.messageId) {
    return;
  }

  await discordRequest(`/channels/${lobby.channelId}/messages/${lobby.messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(buildLobbyMessage(lobby)),
  });
}

async function respondToDiscordInteraction(interaction, content) {
  await fetch(`${DISCORD_API_BASE_URL}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 4,
      data: {
        content,
        flags: 64,
      },
    }),
  });
}

async function handleRecentLobbyInteraction(interaction) {
  const customId = interaction.data?.custom_id || '';

  if (customId !== `${DISCORD_BUTTON_PREFIX}:recent`) {
    return false;
  }

  await respondToDiscordInteraction(interaction, formatRecentLobbyList(getRecentLobbies(30)));
  return true;
}

async function handleQueueInteraction(interaction) {
  const customId = interaction.data?.custom_id || '';
  const match = customId.match(/^trq:(join|leave):(.+)$/);

  if (!match) {
    return;
  }

  const [, action, lobbyId] = match;
  const user = interaction.member?.user || interaction.user || {};
  const userId = user.id;
  const displayName = getDiscordInteractionName(interaction).trim();
  const avatarUrl = getDiscordAvatarUrl(user);
  let responseMessage = 'That queue is no longer available.';
  let nextLobby = null;

  if (!userId) {
    await respondToDiscordInteraction(interaction, 'Discord did not include your user ID.');
    return;
  }

  nextLobby = updateLobby(lobbyId, (lobby) => {
    const existingPlayerIndex = lobby.players.findIndex((player) => player.userId === userId);

    if (lobby.status !== 'open') {
      responseMessage = 'This queue is closed.';
      return lobby;
    }

    if (action === 'join') {
      if (existingPlayerIndex >= 0) {
        lobby.players[existingPlayerIndex].displayName = displayName;
        lobby.players[existingPlayerIndex].avatarUrl = avatarUrl;
        responseMessage = 'You are already in the queue.';
        return { ...lobby, updatedAt: new Date().toISOString() };
      }

      if (lobby.players.length >= lobby.totalPlayers) {
        responseMessage = 'This queue is already full.';
        return lobby;
      }

      lobby.players.push({
        userId,
        displayName,
        avatarUrl,
        joinedAt: new Date().toISOString(),
      });
      responseMessage = 'You joined the queue.';
      return { ...lobby, updatedAt: new Date().toISOString() };
    }

    if (existingPlayerIndex < 0) {
      responseMessage = 'You were not in the queue.';
      return lobby;
    }

    lobby.players.splice(existingPlayerIndex, 1);
    responseMessage = 'You left the queue.';
    return { ...lobby, updatedAt: new Date().toISOString() };
  });

  await respondToDiscordInteraction(interaction, responseMessage);

  if (nextLobby) {
    updateDiscordLobbyMessage(nextLobby).catch((error) => {
      console.error('Discord lobby message update failed:', error.message);
    });
  }
}

async function handleBotMention(message) {
  if (!discordGatewayState.botUserId || message.author?.bot) {
    return;
  }

  const mentionedBot = message.mentions?.some((user) => user.id === discordGatewayState.botUserId);

  if (!mentionedBot) {
    return;
  }

  await discordRequest(`/channels/${message.channel_id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      ...buildTeamPromptMessage(),
      message_reference: {
        message_id: message.id,
        channel_id: message.channel_id,
        guild_id: message.guild_id,
        fail_if_not_exists: false,
      },
    }),
  });
}

function scheduleDiscordReconnect() {
  if (discordGatewayState.reconnectTimer || !process.env.DISCORD_BOT_TOKEN) {
    return;
  }

  discordGatewayState.reconnectTimer = setTimeout(() => {
    discordGatewayState.reconnectTimer = null;
    connectDiscordGateway().catch((error) => {
      console.error('Discord Gateway reconnect failed:', error.message);
      scheduleDiscordReconnect();
    });
  }, 5000);
}

function stopDiscordHeartbeat() {
  if (discordGatewayState.heartbeatTimer) {
    clearInterval(discordGatewayState.heartbeatTimer);
    discordGatewayState.heartbeatTimer = null;
  }
}

async function connectDiscordGateway() {
  if (!process.env.DISCORD_BOT_TOKEN || typeof WebSocket === 'undefined') {
    return;
  }

  if (discordGatewayState.socket && discordGatewayState.socket.readyState <= 1) {
    return;
  }

  const gateway = await discordRequest('/gateway/bot');
  const socket = new WebSocket(`${gateway.url}/?v=10&encoding=json`);

  discordGatewayState.socket = socket;

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);

    if (payload.s) {
      discordGatewayState.lastSequence = payload.s;
    }

    if (payload.op === 10) {
      stopDiscordHeartbeat();
      discordGatewayState.heartbeatTimer = setInterval(() => {
        socket.send(JSON.stringify({ op: 1, d: discordGatewayState.lastSequence }));
      }, payload.d.heartbeat_interval);
      socket.send(JSON.stringify({
        op: 2,
        d: {
          token: process.env.DISCORD_BOT_TOKEN,
          intents: DISCORD_GATEWAY_INTENTS,
          properties: {
            os: process.platform,
            browser: 'team-randomizer',
            device: 'team-randomizer',
          },
        },
      }));
    }

    if (payload.op === 0 && payload.t === 'INTERACTION_CREATE') {
      handleRecentLobbyInteraction(payload.d).then((handled) => {
        if (!handled) {
          return handleQueueInteraction(payload.d);
        }

        return null;
      }).catch((error) => {
        console.error('Discord interaction failed:', error.message);
      });
    }

    if (payload.op === 0 && payload.t === 'READY') {
      discordGatewayState.botUserId = payload.d.user?.id || null;
    }

    if (payload.op === 0 && payload.t === 'MESSAGE_CREATE') {
      handleBotMention(payload.d).catch((error) => {
        console.error('Discord mention response failed:', error.message);
      });
    }

    if (payload.op === 7) {
      socket.close();
    }
  });

  socket.addEventListener('close', () => {
    stopDiscordHeartbeat();
    scheduleDiscordReconnect();
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
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

app.post('/api/discord-channel-players', async (req, res) => {
  const { channelId, maxPlayers, messageLimit = 100 } = req.body;
  const normalizedChannelId = normalizeDiscordChannelId(channelId);
  const playerLimit = Number.parseInt(maxPlayers, 10);
  const requestedMessageLimit = Number.parseInt(messageLimit, 10);
  const discordMessageLimit = Number.isInteger(requestedMessageLimit)
    ? Math.min(Math.max(requestedMessageLimit, 1), 100)
    : 100;

  if (!process.env.DISCORD_BOT_TOKEN) {
    return res.status(400).json({
      error: 'DISCORD_BOT_TOKEN is not configured on the local server.'
    });
  }

  if (!/^\d{17,20}$/.test(normalizedChannelId)) {
    return res.status(400).json({ error: 'A valid Discord channel ID is required.' });
  }

  if (!Number.isInteger(playerLimit) || playerLimit < 1) {
    return res.status(400).json({ error: 'A valid maxPlayers value is required.' });
  }

  try {
    const messages = await fetchDiscordChannelMessages(normalizedChannelId, discordMessageLimit);
    const seenUserIds = new Set();
    const players = [];

    messages
      .slice()
      .reverse()
      .forEach((message) => {
        if (!message.author?.id || message.author.bot || seenUserIds.has(message.author.id)) {
          return;
        }

        const displayName = getDiscordDisplayName(message).trim();

        if (!displayName) {
          return;
        }

        seenUserIds.add(message.author.id);
        players.push(displayName);
      });

    return res.json({
      players: normalizePlayers(players, playerLimit),
      scannedMessages: messages.length
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Discord channel import failed.'
    });
  }
});

app.post('/api/discord-lobbies', async (req, res) => {
  const { channelId, totalPlayers, playersPerTeam, teamCount, hostUserId } = req.body;
  const normalizedChannelId = normalizeDiscordChannelId(channelId);
  const normalizedHostUserId = normalizeDiscordUserId(hostUserId);
  const parsedTotalPlayers = Number.parseInt(totalPlayers, 10);
  const parsedPlayersPerTeam = Number.parseInt(playersPerTeam, 10);
  const parsedTeamCount = Number.parseInt(teamCount, 10);

  if (!process.env.DISCORD_BOT_TOKEN) {
    return res.status(400).json({
      error: 'DISCORD_BOT_TOKEN is not configured on the local server.'
    });
  }

  if (!/^\d{17,20}$/.test(normalizedChannelId)) {
    return res.status(400).json({ error: 'A valid Discord channel ID is required.' });
  }

  if (!/^\d{17,20}$/.test(normalizedHostUserId)) {
    return res.status(400).json({ error: 'A valid host Discord user ID is required.' });
  }

  if (!Number.isInteger(parsedTotalPlayers) || parsedTotalPlayers < 1) {
    return res.status(400).json({ error: 'A valid totalPlayers value is required.' });
  }

  if (!Number.isInteger(parsedPlayersPerTeam) || parsedPlayersPerTeam < 1) {
    return res.status(400).json({ error: 'A valid playersPerTeam value is required.' });
  }

  if (!Number.isInteger(parsedTeamCount) || parsedTeamCount < 1) {
    return res.status(400).json({ error: 'A valid teamCount value is required.' });
  }

  try {
    const now = new Date().toISOString();
    const lobby = {
      id: crypto.randomUUID(),
      hostToken: crypto.randomUUID(),
      channelId: normalizedChannelId,
      hostUserId: normalizedHostUserId,
      messageId: null,
      totalPlayers: parsedTotalPlayers,
      playersPerTeam: parsedPlayersPerTeam,
      teamCount: parsedTeamCount,
      status: 'open',
      players: [],
      appState: null,
      createdAt: now,
      updatedAt: now,
    };
    const message = await createDiscordLobbyMessage(lobby);
    const store = readLobbyStore();
    const savedLobby = {
      ...lobby,
      messageId: message.id,
    };

    store.lobbies.push(savedLobby);
    writeLobbyStore(store);

    return res.json({ lobby: publicLobby(savedLobby), hostToken: savedLobby.hostToken });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Discord queue lobby could not be created.'
    });
  }
});

app.get('/api/discord-lobbies/:lobbyId', (req, res) => {
  const lobby = findLobby(req.params.lobbyId);

  if (!lobby) {
    return res.status(404).json({ error: 'Discord queue lobby was not found.' });
  }

  return res.json({ lobby: publicLobby(lobby) });
});

app.patch('/api/discord-lobbies/:lobbyId/state', (req, res) => {
  const { hostToken, appState } = req.body;
  const lobby = updateLobby(req.params.lobbyId, (currentLobby) => {
    if (!currentLobby.hostToken || currentLobby.hostToken !== hostToken) {
      return currentLobby;
    }

    return {
      ...currentLobby,
      appState,
      updatedAt: new Date().toISOString(),
    };
  });

  if (!lobby) {
    return res.status(404).json({ error: 'Discord queue lobby was not found.' });
  }

  if (!lobby.hostToken || lobby.hostToken !== hostToken) {
    return res.status(403).json({ error: 'Only the host can sync this lobby.' });
  }

  return res.json({ lobby: publicLobby(lobby) });
});

app.post('/api/discord-lobbies/:lobbyId/sync-draft', (req, res) => {
  const { draftId } = req.body;
  const draft = updateDraft(draftId, (currentDraft) => currentDraft);

  if (!draft) {
    return res.status(404).json({ error: 'Draft was not found.' });
  }

  const publicDraftState = publicDraft(draft);
  const lobby = updateLobby(req.params.lobbyId, (currentLobby) => {
    const currentAppState = currentLobby.appState || {};

    if (currentAppState.serverDraftId && currentAppState.serverDraftId !== draftId) {
      return currentLobby;
    }

    return {
      ...currentLobby,
      appState: {
        ...currentAppState,
        step: 6,
        sortMode: 'manual',
        useCaptains: true,
        teams: publicDraftState.teams,
        unassignedPlayers: publicDraftState.unassignedPlayers,
        captains: publicDraftState.teams.map((team) => team.captain),
        playerMeta: publicDraftState.playerMeta,
        serverDraftId: publicDraftState.id,
        serverDraft: publicDraftState,
        draft: {
          active: publicDraftState.status === 'active',
          currentTeamIndex: publicDraftState.currentTeamIndex,
          turnStartedAt: publicDraftState.turnStartedAt ? Date.parse(publicDraftState.turnStartedAt) : null,
          turnEndsAt: publicDraftState.turnEndsAt ? Date.parse(publicDraftState.turnEndsAt) : null,
        },
      },
      updatedAt: new Date().toISOString(),
    };
  });

  if (!lobby) {
    return res.status(404).json({ error: 'Discord queue lobby was not found.' });
  }

  return res.json({ lobby: publicLobby(lobby), draft: publicDraftState });
});

app.post('/api/discord-lobbies/:lobbyId/close', async (req, res) => {
  const lobby = updateLobby(req.params.lobbyId, (currentLobby) => ({
    ...currentLobby,
    status: 'closed',
    updatedAt: new Date().toISOString(),
  }));

  if (!lobby) {
    return res.status(404).json({ error: 'Discord queue lobby was not found.' });
  }

  try {
    await updateDiscordLobbyMessage(lobby);
    return res.json({ lobby: publicLobby(lobby) });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Discord queue lobby could not be closed.'
    });
  }
});

app.post('/api/drafts', (req, res) => {
  const { teams, unassignedPlayers, playersPerTeam, playerMeta = {}, lobbyId = '', hostToken = '' } = req.body;
  const parsedPlayersPerTeam = Number.parseInt(playersPerTeam, 10);
  const normalizedPlayerMeta = normalizePlayerMeta(playerMeta);

  if (!Array.isArray(teams) || teams.length === 0) {
    return res.status(400).json({ error: 'Draft teams are required.' });
  }

  if (!Array.isArray(unassignedPlayers)) {
    return res.status(400).json({ error: 'Draft unassigned players are required.' });
  }

  if (!Number.isInteger(parsedPlayersPerTeam) || parsedPlayersPerTeam < 1) {
    return res.status(400).json({ error: 'A valid playersPerTeam value is required.' });
  }

  const normalizedTeams = teams.map((team, index) => ({
    id: Number.parseInt(team.id, 10) || index + 1,
    name: String(team.name || `Team ${index + 1}`).trim(),
    captain: String(team.captain || '').trim(),
    captainUserId: normalizeDiscordUserId(team.captainUserId),
    captainAvatarUrl: String(team.captainAvatarUrl || normalizedPlayerMeta[team.captain]?.avatarUrl || ''),
    players: normalizePlayers(team.players, parsedPlayersPerTeam),
  }));
  const lobby = lobbyId ? findLobby(lobbyId) : null;
  const verifiedHostToken = Boolean(lobby && lobby.hostToken && lobby.hostToken === hostToken);

  const now = Date.now();
  const draft = {
    id: crypto.randomUUID(),
    status: 'active',
    teams: normalizedTeams,
    unassignedPlayers: normalizePlayers(unassignedPlayers, 500),
    playerMeta: normalizedPlayerMeta,
    lobbyId,
    hostToken: verifiedHostToken ? hostToken : '',
    playersPerTeam: parsedPlayersPerTeam,
    currentTeamIndex: 0,
    turnStartedAt: null,
    turnEndsAt: null,
    turnSeconds: DRAFT_TURN_SECONDS,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const store = readDraftStore();

  startServerDraftTurn(draft, getNextServerDraftTeamIndex(draft, -1), now);
  store.drafts.push(draft);
  writeDraftStore(store);

  return res.json({ draft: publicDraft(draft) });
});

app.get('/api/drafts/:draftId', (req, res) => {
  const draft = updateDraft(req.params.draftId, (currentDraft) => currentDraft);

  if (!draft) {
    return res.status(404).json({ error: 'Draft was not found.' });
  }

  return res.json({ draft: publicDraft(draft) });
});

app.post('/api/drafts/:draftId/pick', (req, res) => {
  const user = getSessionUser(req);
  const player = String(req.body.player || '').trim();
  const hostToken = String(req.body.hostToken || '');

  if (!player) {
    return res.status(400).json({ error: 'A player is required.' });
  }

  let rejectedError = null;
  const draft = updateDraft(req.params.draftId, (currentDraft) => {
    if (currentDraft.status !== 'active') {
      rejectedError = 'This draft is no longer active.';
      return currentDraft;
    }

    const activeTeam = currentDraft.teams[currentDraft.currentTeamIndex];
    const isHostOverride = Boolean(currentDraft.hostToken && currentDraft.hostToken === hostToken);

    if (!activeTeam) {
      rejectedError = 'No captain is currently on the clock.';
      return currentDraft;
    }

    if (!isHostOverride && !user) {
      rejectedError = 'Sign in with Discord before drafting.';
      return currentDraft;
    }

    if (!isHostOverride && (!activeTeam.captainUserId || activeTeam.captainUserId !== user.id)) {
      rejectedError = `${activeTeam.captain} is on the clock.`;
      return currentDraft;
    }

    if (isDraftTeamFull(currentDraft, activeTeam)) {
      rejectedError = 'This team is already full.';
      return currentDraft;
    }

    if (!currentDraft.unassignedPlayers.includes(player)) {
      rejectedError = 'That player is no longer available.';
      return currentDraft;
    }

    activeTeam.players.push(player);
    currentDraft.unassignedPlayers = currentDraft.unassignedPlayers.filter((name) => name !== player);

    if (isServerDraftComplete(currentDraft)) {
      currentDraft.status = 'complete';
      currentDraft.turnEndsAt = null;
    } else {
      startServerDraftTurn(currentDraft, getNextServerDraftTeamIndex(currentDraft, currentDraft.currentTeamIndex));
    }

    return currentDraft;
  });

  if (!draft) {
    return res.status(404).json({ error: 'Draft was not found.' });
  }

  if (rejectedError) {
    return res.status(403).json({ error: rejectedError, draft: publicDraft(draft) });
  }

  return res.json({ draft: publicDraft(draft) });
});

app.listen(port, () => {
  console.log(`Team Randomizer available at http://localhost:${port}`);
  console.log(`Smart Fill model: ${model}`);
});

connectDiscordGateway().catch((error) => {
  console.error('Discord Gateway connection failed:', error.message);
});
