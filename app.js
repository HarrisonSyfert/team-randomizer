const wizard = document.getElementById('wizard');
const resetButton = document.getElementById('resetButton');
const themeToggleButton = document.getElementById('themeToggleButton');
const themeToggleIcon = document.getElementById('themeToggleIcon');
const SMART_PARSE_URL = '/api/parse-players';
const DISCORD_IMPORT_URL = '/api/discord-channel-players';
const DISCORD_LOBBIES_URL = '/api/discord-lobbies';
const CONFIG_URL = '/api/config';
const SESSION_URL = '/api/session';
const LOGOUT_URL = '/api/logout';
const DISCORD_AUTH_URL = '/auth/discord';
const DRAFTS_URL = '/api/drafts';
const THEME_STORAGE_KEY = 'teamRandomizerTheme';
const DISCORD_CHANNEL_STORAGE_KEY = 'teamRandomizerDiscordChannelId';
const DISCORD_LOBBY_STORAGE_KEY = 'teamRandomizerDiscordLobbyId';
const DISCORD_HOST_STORAGE_KEY = 'teamRandomizerDiscordHostUserId';
const SHARED_LOBBY_HOST_TOKEN_PREFIX = 'teamRandomizerLobbyHostToken:';
const SERVER_DRAFT_STORAGE_KEY = 'teamRandomizerServerDraftId';
const DRAFT_TURN_SECONDS = 90;
let draftTimerId = null;
let draftPollTimerId = null;
let lobbyPollTimerId = null;
let lobbyPublishTimerId = null;
let isApplyingSharedLobbyState = false;
const SUN_ICON = `
  <svg class="theme-icon" viewBox="0 0 24 24" focusable="false">
    <circle cx="12" cy="12" r="4.2"></circle>
    <path d="M12 2.8v2.4"></path>
    <path d="M12 18.8v2.4"></path>
    <path d="m4.2 4.2 1.7 1.7"></path>
    <path d="m18.1 18.1 1.7 1.7"></path>
    <path d="M2.8 12h2.4"></path>
    <path d="M18.8 12h2.4"></path>
    <path d="m4.2 19.8 1.7-1.7"></path>
    <path d="m18.1 5.9 1.7-1.7"></path>
  </svg>
`;
const MOON_ICON = `
  <svg class="theme-icon" viewBox="0 0 24 24" focusable="false">
    <path d="M20.1 14.4A7.8 7.8 0 0 1 9.6 3.9a8.8 8.8 0 1 0 10.5 10.5Z"></path>
    <path d="M16.8 4.2l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4.4-1.2Z"></path>
  </svg>
`;

const state = {
  step: 1,
  totalPlayers: '',
  playersPerTeam: '',
  teamCount: '',
  playerNames: [],
  teams: [],
  unassignedPlayers: [],
  sortMode: 'random',
  useCaptains: false,
  captains: [],
  assignmentPlayer: null,
  swapSource: null,
  warningAccepted: false,
  draft: {
    active: false,
    currentTeamIndex: 0,
    turnStartedAt: null,
    turnEndsAt: null,
  },
  discordChannelId: '',
  discordLobbyId: '',
  sharedLobbyHostToken: '',
  isSharedLobbyHost: false,
  discordLobby: null,
  discordHostUserId: '',
  sessionUser: null,
  playerDiscordIds: {},
  playerMeta: {},
  serverDraftId: '',
  serverDraft: null,
  publicBaseUrl: '',
};

function numberValue(value) {
  return Number.parseInt(value, 10);
}

function capacity() {
  return numberValue(state.playersPerTeam) * numberValue(state.teamCount);
}

function hasMissingPlayerWarning() {
  return numberValue(state.totalPlayers) < capacity();
}

function hasTooManyPlayersError() {
  return numberValue(state.totalPlayers) > capacity();
}

function getMissingPlayerCount() {
  return Math.max(capacity() - numberValue(state.totalPlayers), 0);
}

function shuffle(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function buildDefaultNames() {
  state.playerNames = Array.from({ length: numberValue(state.totalPlayers) }, (_, index) => `Player ${index + 1}`);
}

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still changes for this session if storage is unavailable.
  }
}

function getSavedDiscordChannelId() {
  try {
    return localStorage.getItem(DISCORD_CHANNEL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveDiscordChannelId(channelId) {
  try {
    localStorage.setItem(DISCORD_CHANNEL_STORAGE_KEY, channelId);
  } catch {
    // Discord import still works for this session if storage is unavailable.
  }
}

function getSavedDiscordLobbyId() {
  try {
    return localStorage.getItem(DISCORD_LOBBY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveDiscordLobbyId(lobbyId) {
  try {
    if (lobbyId) {
      localStorage.setItem(DISCORD_LOBBY_STORAGE_KEY, lobbyId);
    } else {
      localStorage.removeItem(DISCORD_LOBBY_STORAGE_KEY);
    }
  } catch {
    // Queue controls still work for this session if storage is unavailable.
  }
}

function getSavedDiscordHostUserId() {
  try {
    return localStorage.getItem(DISCORD_HOST_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveDiscordHostUserId(userId) {
  try {
    localStorage.setItem(DISCORD_HOST_STORAGE_KEY, userId);
  } catch {
    // Queue creation still works for this session if storage is unavailable.
  }
}

function getSavedServerDraftId() {
  try {
    return localStorage.getItem(SERVER_DRAFT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveServerDraftId(draftId) {
  try {
    if (draftId) {
      localStorage.setItem(SERVER_DRAFT_STORAGE_KEY, draftId);
    } else {
      localStorage.removeItem(SERVER_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Shared draft links still work for this session if storage is unavailable.
  }
}

function getSavedSharedLobbyHostToken(lobbyId) {
  try {
    return localStorage.getItem(`${SHARED_LOBBY_HOST_TOKEN_PREFIX}${lobbyId}`) || '';
  } catch {
    return '';
  }
}

function saveSharedLobbyHostToken(lobbyId, hostToken) {
  try {
    localStorage.setItem(`${SHARED_LOBBY_HOST_TOKEN_PREFIX}${lobbyId}`, hostToken);
  } catch {
    // Viewers can still watch; this only affects host recovery after reload.
  }
}

function getShareLobbyIdFromUrl() {
  return new URLSearchParams(window.location.search).get('lobby') || '';
}

function getSharedLobbyUrl(lobbyId, draftId = state.serverDraftId || state.serverDraft?.id || '') {
  const baseUrl = state.publicBaseUrl || window.location.origin;
  const params = new URLSearchParams({ lobby: lobbyId });

  if (draftId) {
    params.set('draft', draftId);
  }

  return `${baseUrl}${window.location.pathname}?${params.toString()}`;
}

function updateBrowserSharedLobbyUrl(draftId = state.serverDraftId || state.serverDraft?.id || '') {
  if (!state.discordLobbyId) {
    return;
  }

  window.history.replaceState(null, '', getSharedLobbyUrl(state.discordLobbyId, draftId));
}

function isSharedLobbyViewer() {
  return Boolean(state.discordLobbyId && !state.isSharedLobbyHost);
}

function hasHostOverrideAccess() {
  return Boolean(state.discordLobbyId && state.sharedLobbyHostToken);
}

function renderSharedLobbyBanner() {
  if (!state.discordLobbyId) {
    return '';
  }

  const label = state.isSharedLobbyHost ? 'Hosting synced lobby' : 'Viewing synced lobby';
  const url = getSharedLobbyUrl(state.discordLobbyId);
  const queuedPlayer = getCurrentQueuedPlayer();
  const roleLabel = state.isSharedLobbyHost
    ? 'Host controls are enabled in this browser.'
    : queuedPlayer
      ? `Signed in as queued player: ${queuedPlayer.displayName}`
      : state.sessionUser
        ? 'Signed in, but this Discord account is not in the queue.'
        : 'Viewing only. Sign in with Discord to unlock player or captain permissions.';

  return `
    <div class="shared-lobby-banner">
      <span>${label}</span>
      <code>${escapeHtml(url)}</code>
      <button id="copyLobbyLinkButton" class="secondary-button" type="button" data-url="${escapeHtml(url)}">Copy Join Link</button>
      <small>${escapeHtml(roleLabel)}</small>
      ${!state.sessionUser && !state.isSharedLobbyHost ? `<a class="button-link secondary-button" href="${DISCORD_AUTH_URL}">Sign In with Discord</a>` : ''}
    </div>
  `;
}

function getCurrentQueuedPlayer() {
  if (!state.sessionUser || !state.discordLobby?.players) {
    return null;
  }

  return state.discordLobby.players.find((player) => player.userId === state.sessionUser.id) || null;
}

function getShareableAppState() {
  const sharedDiscordLobby = state.discordLobby
    ? {
      ...state.discordLobby,
      appState: null,
    }
    : null;

  return {
    step: state.step,
    totalPlayers: state.totalPlayers,
    playersPerTeam: state.playersPerTeam,
    teamCount: state.teamCount,
    playerNames: state.playerNames,
    teams: state.teams,
    unassignedPlayers: state.unassignedPlayers,
    sortMode: state.sortMode,
    useCaptains: state.useCaptains,
    captains: state.captains,
    warningAccepted: state.warningAccepted,
    discordLobbyId: state.discordLobbyId,
    discordLobby: sharedDiscordLobby,
    playerDiscordIds: state.playerDiscordIds,
    playerMeta: state.playerMeta,
    serverDraftId: state.serverDraftId,
    serverDraft: state.serverDraft,
    draft: state.draft,
  };
}

function applyShareableAppState(appState) {
  if (!appState) {
    return;
  }

  isApplyingSharedLobbyState = true;
  Object.assign(state, {
    step: appState.step || 1,
    totalPlayers: appState.totalPlayers || '',
    playersPerTeam: appState.playersPerTeam || '',
    teamCount: appState.teamCount || '',
    playerNames: Array.isArray(appState.playerNames) ? appState.playerNames : [],
    teams: Array.isArray(appState.teams) ? appState.teams : [],
    unassignedPlayers: Array.isArray(appState.unassignedPlayers) ? appState.unassignedPlayers : [],
    sortMode: appState.sortMode || 'random',
    useCaptains: Boolean(appState.useCaptains),
    captains: Array.isArray(appState.captains) ? appState.captains : [],
    warningAccepted: Boolean(appState.warningAccepted),
    discordLobbyId: appState.discordLobbyId || state.discordLobbyId,
    discordLobby: appState.discordLobby || state.discordLobby,
    playerDiscordIds: appState.playerDiscordIds || {},
    playerMeta: appState.playerMeta || {},
    serverDraftId: appState.serverDraftId || '',
    serverDraft: appState.serverDraft || null,
    draft: appState.draft || state.draft,
  });
  isApplyingSharedLobbyState = false;

  if (appState.serverDraftId) {
    updateBrowserSharedLobbyUrl(appState.serverDraftId);
  }
}

function getPlayerMeta(name) {
  return state.playerMeta[name] || {};
}

function renderPlayerIdentity(name, options = {}) {
  const meta = getPlayerMeta(name);
  const crown = options.captain ? '<span class="captain-crown" title="Team captain">♛</span>' : '';
  const avatar = meta.avatarUrl
    ? `<img class="player-avatar" src="${escapeHtml(meta.avatarUrl)}" alt="" />`
    : '<span class="player-avatar player-avatar-fallback" aria-hidden="true"></span>';

  return `
    <span class="player-identity">
      ${avatar}
      <span>${crown}${escapeHtml(name)}</span>
    </span>
  `;
}

function renderEyeIcon() {
  return `
    <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

function applyTheme(theme) {
  const isDarkTheme = theme === 'dark';

  document.body.classList.toggle('dark-theme', isDarkTheme);
  themeToggleButton.setAttribute('aria-pressed', String(isDarkTheme));
  themeToggleButton.setAttribute('aria-label', isDarkTheme ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggleIcon.innerHTML = isDarkTheme ? MOON_ICON : SUN_ICON;
}

function initializeTheme() {
  const savedTheme = getSavedTheme();
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

  applyTheme(initialTheme);
}

function initializeSavedSettings() {
  const sharedLobbyId = getShareLobbyIdFromUrl();

  state.discordChannelId = getSavedDiscordChannelId();
  state.discordLobbyId = sharedLobbyId;
  state.sharedLobbyHostToken = sharedLobbyId ? getSavedSharedLobbyHostToken(sharedLobbyId) : '';
  state.isSharedLobbyHost = Boolean(sharedLobbyId && state.sharedLobbyHostToken);
  state.discordHostUserId = getSavedDiscordHostUserId();
  state.serverDraftId = new URLSearchParams(window.location.search).get('draft') || getSavedServerDraftId();
}

function parseQuickAddNames(value) {
  const normalized = value
    .replace(/^(can|could)\s+(you|we)\s+add\s+/i, '')
    .replace(/^can you\s+/i, '')
    .replace(/^add\s+/i, '')
    .replace(/^please\s+add\s+/i, '')
    .replace(/^players?\s*:/i, '')
    .replace(/^the\s+players?\s+/i, '')
    .replace(/^we\s+have\s+/i, '')
    .replace(/\s+playing\s+tonight\.?$/i, '')
    .replace(/\s+as\s+well\.?$/i, '')
    .replace(/\s+for\s+tonight\.?$/i, '')
    .replace(/\s+to\s+the\s+list\.?$/i, '')
    .replace(/\s+is\s+leaving\s+.*$/i, '')
    .replace(/\band\b/gi, ',');

  return normalized
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .map((name) => name.replace(/^the\s+players?\s+/i, '').trim())
    .filter(Boolean);
}

function getCurrentRoster() {
  return state.playerNames.map((name) => name.trim()).filter(Boolean);
}

function isDefaultPlayerName(name) {
  return /^Player \d+$/i.test(String(name).trim());
}

function getEnteredRoster() {
  return state.playerNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => !isDefaultPlayerName(name));
}

function cleanRosterNames(names) {
  return names
    .map((name) => String(name).trim())
    .filter(Boolean);
}

function applyRoster(names) {
  const totalPlayers = numberValue(state.totalPlayers);
  const cleanNames = cleanRosterNames(names).slice(0, totalPlayers);
  const nextNames = Array.from({ length: totalPlayers }, (_, index) => cleanNames[index] || '');

  state.playerNames = nextNames;
}

function applyRosterWithDuplicateReview(names) {
  const resolvedNames = resolveDuplicateNames(cleanRosterNames(names));

  if (!resolvedNames) {
    showInlineError('Please rename one of the duplicate players before continuing.');
    return false;
  }

  applyRoster(resolvedNames);
  return true;
}

function applyRosterInstruction(value) {
  const existingPlayers = getEnteredRoster();
  const replaceMatch = value.match(/(?:change\s+out|swap\s+out|replace)\s+(.+?)\s+(?:for|with)\s+(.+?)(?:,|\.|$)/i);

  if (replaceMatch) {
    const oldName = replaceMatch[1].trim();
    const newName = replaceMatch[2]
      .replace(/\s+is\s+.*$/i, '')
      .replace(/\s+because\s+.*$/i, '')
      .trim();
    const updatedPlayers = existingPlayers.map((player) => (
      player.toLowerCase() === oldName.toLowerCase() ? newName : player
    ));

    if (!updatedPlayers.some((player) => player.toLowerCase() === newName.toLowerCase())) {
      updatedPlayers.push(newName);
    }

    return cleanRosterNames(updatedPlayers);
  }

  const additions = parseQuickAddNames(value);
  return cleanRosterNames([...existingPlayers, ...additions]);
}

function resolveDuplicateNames(names) {
  const counts = new Map();
  const duplicateNames = new Set();

  names.forEach((name) => {
    const key = name.toLowerCase();
    const nextCount = (counts.get(key) || 0) + 1;

    counts.set(key, nextCount);

    if (nextCount > 1) {
      duplicateNames.add(key);
    }
  });

  if (duplicateNames.size === 0) {
    return names;
  }

  const duplicateLabels = [...duplicateNames]
    .map((key) => names.find((name) => name.toLowerCase() === key))
    .join(', ');
  const shouldKeepDuplicates = window.confirm(
    `Duplicate player name found: ${duplicateLabels}.\n\nAre these different people? If yes, the app will label them like John, John(2), John(3).`
  );

  if (!shouldKeepDuplicates) {
    return null;
  }

  const seen = new Map();

  return names.map((name) => {
    const key = name.toLowerCase();
    const nextCount = (seen.get(key) || 0) + 1;

    seen.set(key, nextCount);

    return nextCount === 1 ? name : `${name}(${nextCount})`;
  });
}

async function parseNamesWithAi(value) {
  const response = await fetch(SMART_PARSE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: value,
      maxPlayers: numberValue(state.totalPlayers),
      existingPlayers: getEnteredRoster(),
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Smart Fill failed.');
  }

  return Array.isArray(data.players) ? data.players : [];
}

async function importPlayersFromDiscord(channelId) {
  const response = await fetch(DISCORD_IMPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channelId,
      maxPlayers: numberValue(state.totalPlayers),
      messageLimit: 100,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Discord import failed.');
  }

  return Array.isArray(data.players) ? data.players : [];
}

async function createDiscordLobby(channelId) {
  const response = await fetch(DISCORD_LOBBIES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channelId,
      totalPlayers: numberValue(state.totalPlayers),
      playersPerTeam: numberValue(state.playersPerTeam),
      teamCount: numberValue(state.teamCount),
      hostUserId: state.discordHostUserId,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Discord queue could not be created.');
  }

  return data;
}

async function fetchDiscordLobby(lobbyId) {
  const response = await fetch(`${DISCORD_LOBBIES_URL}/${encodeURIComponent(lobbyId)}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Discord queue could not be loaded.');
  }

  return data.lobby;
}

async function closeDiscordLobby(lobbyId) {
  const response = await fetch(`${DISCORD_LOBBIES_URL}/${encodeURIComponent(lobbyId)}/close`, {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Discord queue could not be closed.');
  }

  return data.lobby;
}

async function publishSharedLobbyState() {
  if (!state.isSharedLobbyHost || !state.discordLobbyId || !state.sharedLobbyHostToken || isApplyingSharedLobbyState) {
    return;
  }

  const response = await fetch(`${DISCORD_LOBBIES_URL}/${encodeURIComponent(state.discordLobbyId)}/state`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hostToken: state.sharedLobbyHostToken,
      appState: getShareableAppState(),
    }),
  });

  if (!response.ok) {
    throw new Error('Lobby sync failed.');
  }
}

function scheduleSharedLobbyPublish() {
  if (!state.isSharedLobbyHost || isApplyingSharedLobbyState) {
    return;
  }

  window.clearTimeout(lobbyPublishTimerId);
  lobbyPublishTimerId = window.setTimeout(() => {
    publishSharedLobbyState().catch(() => {});
  }, 250);
}

function startSharedLobbyPolling() {
  stopSharedLobbyPolling();

  if (!state.discordLobbyId || state.isSharedLobbyHost) {
    return;
  }

  lobbyPollTimerId = window.setInterval(async () => {
    try {
      const lobby = await fetchDiscordLobby(state.discordLobbyId);
      applyShareableAppState(lobby.appState);
      state.discordLobby = {
        ...lobby,
        appState: null,
      };
      await refreshAuthoritativeDraftState();
      render();
    } catch {
      stopSharedLobbyPolling();
    }
  }, 1000);
}

function stopSharedLobbyPolling() {
  if (lobbyPollTimerId) {
    window.clearInterval(lobbyPollTimerId);
    lobbyPollTimerId = null;
  }
}

async function fetchSession() {
  const response = await fetch(SESSION_URL);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Session could not be loaded.');
  }

  return data.user || null;
}

async function fetchConfig() {
  const response = await fetch(CONFIG_URL);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {};
  }

  return data;
}

async function logoutDiscord() {
  await fetch(LOGOUT_URL, { method: 'POST' });
  state.sessionUser = null;
  render();
}

async function createServerDraft() {
  const response = await fetch(DRAFTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      teams: state.teams.map((team) => ({
        ...team,
        captainUserId: team.captainUserId || state.playerDiscordIds[team.captain] || '',
        captainAvatarUrl: team.captainAvatarUrl || getPlayerMeta(team.captain).avatarUrl || '',
      })),
      unassignedPlayers: state.unassignedPlayers,
      playersPerTeam: numberValue(state.playersPerTeam),
      playerMeta: state.playerMeta,
      lobbyId: state.discordLobbyId,
      hostToken: state.sharedLobbyHostToken,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Draft could not be created.');
  }

  return data.draft;
}

async function fetchServerDraft(draftId) {
  const response = await fetch(`${DRAFTS_URL}/${encodeURIComponent(draftId)}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Draft could not be loaded.');
  }

  return data.draft;
}

async function submitServerDraftPick(player) {
  const response = await fetch(`${DRAFTS_URL}/${encodeURIComponent(state.serverDraftId)}/pick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      player,
      lobbyId: state.discordLobbyId,
      hostToken: hasHostOverrideAccess() ? state.sharedLobbyHostToken : '',
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (data.draft) {
      syncServerDraftToState(data.draft);
    }

    throw new Error(data.error || 'Draft pick was rejected.');
  }

  return data.draft;
}

async function syncSharedLobbyDraft(draft) {
  if (!state.discordLobbyId || !draft?.id) {
    return;
  }

  const response = await fetch(`${DISCORD_LOBBIES_URL}/${encodeURIComponent(state.discordLobbyId)}/sync-draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      draftId: draft.id,
      hostToken: state.sharedLobbyHostToken,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (response.ok && data.lobby) {
    state.discordLobby = {
      ...data.lobby,
      appState: null,
    };
    updateBrowserSharedLobbyUrl(draft.id);
  }
}

async function refreshAuthoritativeDraftState(options = {}) {
  const draftId = state.serverDraftId || state.serverDraft?.id;

  if (!draftId) {
    return null;
  }

  const draft = await fetchServerDraft(draftId);

  syncServerDraftToState(draft);

  if (options.syncLobby) {
    await syncSharedLobbyDraft(draft);
  }

  return draft;
}

async function syncHostCorrection() {
  if (!state.isSharedLobbyHost || isCaptainDraftActive()) {
    return;
  }

  await publishSharedLobbyState().catch(() => {});
}

function randomizeTeams() {
  const players = shuffle(state.playerNames.filter(Boolean));
  const teams = Array.from({ length: numberValue(state.teamCount) }, (_, index) => ({
    id: index + 1,
    name: `Team ${index + 1}`,
    captain: null,
    players: [],
  }));

  players.forEach((player, index) => {
    const teamIndex = index % teams.length;
    teams[teamIndex].players.push(player);
  });

  state.teams = teams;
  state.unassignedPlayers = [];
  resetDraftState();
}

function startManualSort() {
  state.sortMode = 'manual';
  resetDraftState();
  state.teams = Array.from({ length: numberValue(state.teamCount) }, (_, index) => ({
    id: index + 1,
    name: `Team ${index + 1}`,
    captain: null,
    players: [],
  }));
  state.unassignedPlayers = [...state.playerNames];
}

function startManualSortWithCaptains() {
  state.sortMode = 'manual';
  state.useCaptains = true;
  resetDraftState();
  state.captains = Array.from({ length: numberValue(state.teamCount) }, () => '');
  state.step = 8;
  render();
}

function startManualSortWithoutCaptains() {
  state.useCaptains = false;
  state.captains = [];
  resetDraftState();
  startManualSort();
  state.step = 6;
  render();
}

function buildManualTeamsWithCaptains() {
  const captains = state.captains.map((captain) => captain.trim());
  const captainSet = new Set(captains);

  state.teams = captains.map((captain, index) => ({
    id: index + 1,
    name: `${captain}'s Team`,
    captain,
    captainUserId: state.playerDiscordIds[captain] || '',
    captainAvatarUrl: getPlayerMeta(captain).avatarUrl || '',
    players: [captain],
  }));
  state.unassignedPlayers = state.playerNames.filter((player) => !captainSet.has(player));
}

function resetDraftState() {
  stopDraftTimer();
  stopDraftPolling();
  state.draft = {
    active: false,
    currentTeamIndex: 0,
    turnStartedAt: null,
    turnEndsAt: null,
  };
}

function syncServerDraftToState(draft) {
  state.serverDraft = draft;
  state.serverDraftId = draft.id;
  state.sortMode = 'manual';
  state.useCaptains = true;
  state.teams = draft.teams;
  state.unassignedPlayers = draft.unassignedPlayers;
  state.playersPerTeam = String(draft.playersPerTeam);
  state.teamCount = String(draft.teams.length);
  state.totalPlayers = String(draft.teams.reduce((total, team) => total + team.players.length, 0) + draft.unassignedPlayers.length);
  state.playerNames = [
    ...draft.teams.flatMap((team) => team.players),
    ...draft.unassignedPlayers,
  ];
  state.captains = draft.teams.map((team) => team.captain);
  state.playerMeta = draft.playerMeta || {};
  state.playerDiscordIds = Object.fromEntries(
    Object.entries(state.playerMeta)
      .filter(([, meta]) => meta.userId)
      .map(([name, meta]) => [name, meta.userId])
  );
  state.draft = {
    active: draft.status === 'active',
    currentTeamIndex: draft.currentTeamIndex,
    turnStartedAt: draft.turnStartedAt ? Date.parse(draft.turnStartedAt) : null,
    turnEndsAt: draft.turnEndsAt ? Date.parse(draft.turnEndsAt) : null,
  };
  state.step = 6;
  saveServerDraftId(draft.id);
  startDraftTimer();
  startDraftPolling();
}

function startDraftPolling() {
  stopDraftPolling();

  if (!state.serverDraftId) {
    return;
  }

  draftPollTimerId = window.setInterval(async () => {
    try {
      const draft = await fetchServerDraft(state.serverDraftId);
      syncServerDraftToState(draft);
      render();
    } catch {
      stopDraftPolling();
    }
  }, 5000);
}

function stopDraftPolling() {
  if (draftPollTimerId) {
    window.clearInterval(draftPollTimerId);
    draftPollTimerId = null;
  }
}

function startCaptainDraft() {
  state.draft = {
    active: true,
    currentTeamIndex: getNextDraftTeamIndex(-1),
    turnStartedAt: Date.now(),
    turnEndsAt: Date.now() + (DRAFT_TURN_SECONDS * 1000),
  };
  startDraftTimer();
}

function startDraftTimer() {
  stopDraftTimer();
  draftTimerId = window.setInterval(handleDraftTimerTick, 1000);
}

function stopDraftTimer() {
  if (draftTimerId) {
    window.clearInterval(draftTimerId);
    draftTimerId = null;
  }
}

function isCaptainDraftActive() {
  return state.sortMode === 'manual' && state.useCaptains && state.draft.active;
}

function isTeamFull(team) {
  return team.players.length >= numberValue(state.playersPerTeam);
}

function isDraftComplete() {
  return (
    !state.unassignedPlayers.length ||
    state.teams.every((team) => isTeamFull(team))
  );
}

function getNextDraftTeamIndex(currentIndex) {
  if (!state.teams.length || state.teams.every((team) => isTeamFull(team))) {
    return -1;
  }

  for (let offset = 1; offset <= state.teams.length; offset += 1) {
    const teamIndex = (currentIndex + offset + state.teams.length) % state.teams.length;

    if (!isTeamFull(state.teams[teamIndex])) {
      return teamIndex;
    }
  }

  return -1;
}

function beginDraftTurn(teamIndex) {
  if (teamIndex < 0 || isDraftComplete()) {
    state.draft.active = false;
    stopDraftTimer();
    return;
  }

  state.draft.currentTeamIndex = teamIndex;
  state.draft.turnStartedAt = Date.now();
  state.draft.turnEndsAt = Date.now() + (DRAFT_TURN_SECONDS * 1000);
  startDraftTimer();
}

function advanceDraftTurn() {
  beginDraftTurn(getNextDraftTeamIndex(state.draft.currentTeamIndex));
}

function getDraftSecondsRemaining() {
  if (!isCaptainDraftActive() || !state.draft.turnEndsAt) {
    return 0;
  }

  return Math.max(Math.ceil((state.draft.turnEndsAt - Date.now()) / 1000), 0);
}

function formatDraftTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function handleDraftTimerTick() {
  if (!isCaptainDraftActive()) {
    stopDraftTimer();
    return;
  }

  if (isDraftComplete()) {
    state.draft.active = false;
    stopDraftTimer();
    render();
    return;
  }

  if (getDraftSecondsRemaining() <= 0) {
    if (state.serverDraftId) {
      fetchServerDraft(state.serverDraftId)
        .then(async (draft) => {
          syncServerDraftToState(draft);
          await syncSharedLobbyDraft(draft);
          render();
        })
        .catch(() => {});
      return;
    }

    advanceDraftTurn();
    render();
    return;
  }

  const timer = document.getElementById('draftTimerValue');

  if (timer) {
    timer.textContent = formatDraftTime(getDraftSecondsRemaining());
  }
}

function render() {
  if (state.step === 1) renderTotalPlayersStep();
  if (state.step === 2) renderPlayersPerTeamStep();
  if (state.step === 3) renderTeamCountStep();
  if (state.step === 4) renderPlayerNamesStep();
  if (state.step === 5) renderReadyStep();
  if (state.step === 6) renderTeamsStep();
  if (state.step === 7) renderCaptainQuestionStep();
  if (state.step === 8) renderCaptainSelectionStep();
  bindSharedLobbyActions();
  applySharedViewerLocks();
  scheduleSharedLobbyPublish();
}

function applySharedViewerLocks() {
  if (!isSharedLobbyViewer()) {
    return;
  }

  const draftAllowed = canCurrentUserDraft();

  wizard.querySelectorAll('input, textarea, select').forEach((control) => {
    control.disabled = true;
  });
  wizard.querySelectorAll('button').forEach((button) => {
    if (button.id === 'discordLogoutButton') {
      return;
    }

    if (draftAllowed && button.classList.contains('assign-player-button')) {
      return;
    }

    button.disabled = true;
  });
}

function bindSharedLobbyActions() {
  const copyButton = document.getElementById('copyLobbyLinkButton');

  if (!copyButton) {
    return;
  }

  copyButton.addEventListener('click', async () => {
    const url = copyButton.dataset.url;

    try {
      await navigator.clipboard.writeText(url);
      copyButton.textContent = 'Copied';
    } catch {
      window.prompt('Copy join link', url);
    }
  });
}

function renderStepShell({ title, copy, body, actions }) {
  wizard.innerHTML = `
    <section class="step-card">
      ${renderSharedLobbyBanner()}
      <div>
        <h2 class="step-title">${title}</h2>
        <p class="step-copy">${copy}</p>
      </div>
      ${body}
      <div class="button-row">${actions}</div>
    </section>
  `;
}

function bindEnterToButton(buttonId) {
  wizard.onkeydown = (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    const button = document.getElementById(buttonId);

    if (!button || button.disabled) {
      return;
    }

    event.preventDefault();
    button.click();
  };
}

function renderTotalPlayersStep() {
  renderStepShell({
    title: 'How many players do you want?',
    copy: 'Start with the total number of people who should be sorted into teams.',
    body: `
      <label>
        Number of players
        <input id="totalPlayers" type="number" min="1" value="${state.totalPlayers}" autofocus />
      </label>
    `,
    actions: state.playerNames.length > 0
      ? `
        <button id="backButton" class="secondary-button" type="button">Back</button>
        <button id="nextButton" type="button">Next</button>
      `
      : '<button id="nextButton" type="button">Next</button>',
  });

  document.getElementById('totalPlayers').addEventListener('input', (event) => {
    state.totalPlayers = event.target.value;
  });
  const backButton = document.getElementById('backButton');

  if (backButton) {
    backButton.addEventListener('click', () => {
      state.step = 5;
      render();
    });
  }
  document.getElementById('nextButton').addEventListener('click', () => {
    if (numberValue(state.totalPlayers) > 0) {
      state.step = 2;
      render();
    }
  });
  bindEnterToButton('nextButton');
}

function renderPlayersPerTeamStep() {
  renderStepShell({
    title: 'How many players per team?',
    copy: 'This is the ideal team size. The app will warn you if there are not enough players to fill every team.',
    body: `
      <label>
        Players per team
        <input id="playersPerTeam" type="number" min="1" value="${state.playersPerTeam}" autofocus />
      </label>
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="nextButton" type="button">Next</button>
    `,
  });

  document.getElementById('playersPerTeam').addEventListener('input', (event) => {
    state.playersPerTeam = event.target.value;
  });
  document.getElementById('backButton').addEventListener('click', () => {
    state.step = 1;
    render();
  });
  document.getElementById('nextButton').addEventListener('click', () => {
    if (numberValue(state.playersPerTeam) > 0) {
      state.step = 3;
      render();
    }
  });
  bindEnterToButton('nextButton');
}

function renderTeamCountStep() {
  const body = `
    <label>
      Number of teams
      <input id="teamCount" type="number" min="1" value="${state.teamCount}" autofocus />
    </label>
    ${renderTeamMathMessage()}
  `;

  renderStepShell({
    title: 'How many teams?',
    copy: 'Choose the number of teams you want to create.',
    body,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="nextButton" type="button">Next</button>
    `,
  });

  document.getElementById('teamCount').addEventListener('input', (event) => {
    state.teamCount = event.target.value;
    render();
  });
  document.getElementById('backButton').addEventListener('click', () => {
    state.step = 2;
    render();
  });
  document.getElementById('nextButton').addEventListener('click', () => {
    if (numberValue(state.teamCount) > 0 && !hasTooManyPlayersError()) {
      buildDefaultNames();
      state.step = 4;
      render();
    }
  });
  bindEnterToButton('nextButton');
}

function renderTeamMathMessage() {
  if (!numberValue(state.teamCount)) {
    return '';
  }

  if (hasTooManyPlayersError()) {
    return `<div class="message error">You have ${state.totalPlayers} players, but only ${capacity()} team slots. Increase teams or players per team before continuing.</div>`;
  }

  if (hasMissingPlayerWarning()) {
    return `<div class="message warning">Warning: ${getMissingPlayerCount()} team slot(s) will be empty. You can continue, but one or more teams may be missing a player.</div>`;
  }

  return '<div class="message success">Nice. Your team slots match the number of players.</div>';
}

function renderPlayerNamesStep() {
  const queuedPlayers = state.discordLobby?.players || [];
  const queueStatus = state.discordLobby
    ? `
      <div class="discord-queue-status">
        <div>
          <strong>${queuedPlayers.length}/${state.discordLobby.totalPlayers} queued</strong>
          <span>${state.discordLobby.status === 'open' ? 'Queue open' : 'Queue closed'}</span>
        </div>
        ${queuedPlayers.length > 0 ? `
          <ol>
            ${queuedPlayers.map((player) => `
              <li>
                <span class="player-identity">
                  ${player.avatarUrl ? `<img class="player-avatar" src="${escapeHtml(player.avatarUrl)}" alt="" />` : '<span class="player-avatar player-avatar-fallback" aria-hidden="true"></span>'}
                  <span>${escapeHtml(player.displayName)}</span>
                </span>
              </li>
            `).join('')}
          </ol>
        ` : '<p>No one has joined the queue yet.</p>'}
      </div>
    `
    : '';

  renderStepShell({
    title: 'Add player names',
    copy: 'Fill in each player slot. You can keep the default names if you just want a quick test.',
    body: `
      <div class="quick-add-card">
        <label>
          Quick add players
          <textarea id="quickAddPlayers" placeholder="Example: add Harrison, Jake, Sarah, Chris"></textarea>
        </label>
        <div class="button-row">
          <button id="applyQuickAddButton" type="button">Fill Names</button>
          <button id="smartFillButton" class="secondary-button" type="button">Smart Fill</button>
          <button id="clearNamesButton" class="secondary-button" type="button">Clear Names</button>
        </div>
        <p class="quick-add-help">Fill Names uses local parsing. Smart Fill uses the local AI server when it is running.</p>
      </div>
      <div class="quick-add-card">
        <label>
          Discord channel ID
          <span class="masked-input-row">
            <input
              id="discordChannelId"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              value="${escapeHtml(state.discordChannelId)}"
              placeholder="Example: 123456789012345678"
            />
            <button class="icon-button toggle-sensitive-button" type="button" data-target-input="discordChannelId" aria-label="Show Discord channel ID">
              ${renderEyeIcon()}
            </button>
          </span>
        </label>
        <label>
          Host Discord user ID
          <span class="masked-input-row">
            <input
              id="discordHostUserId"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              value="${escapeHtml(state.discordHostUserId)}"
              placeholder="Example: 123456789012345678"
            />
            <button class="icon-button toggle-sensitive-button" type="button" data-target-input="discordHostUserId" aria-label="Show host Discord user ID">
              ${renderEyeIcon()}
            </button>
          </span>
        </label>
        <div class="button-row">
          <button id="createDiscordLobbyButton" type="button">Create Queue Lobby</button>
          <button id="refreshDiscordLobbyButton" class="secondary-button" type="button" ${state.discordLobbyId ? '' : 'disabled'}>Refresh Queue</button>
          <button id="useDiscordLobbyButton" class="secondary-button" type="button" ${queuedPlayers.length > 0 ? '' : 'disabled'}>Use Queue Players</button>
          <button id="closeDiscordLobbyButton" class="danger-button" type="button" ${state.discordLobby?.status === 'open' ? '' : 'disabled'}>Close Queue</button>
          <button id="importDiscordButton" class="secondary-button" type="button">Import Recent Posters</button>
        </div>
        <p class="quick-add-help">Create Queue Lobby posts Join/Leave buttons in Discord. Import Recent Posters is the older fallback.</p>
        ${queueStatus}
      </div>
      <div class="player-name-grid">
        ${state.playerNames.map((name, index) => `
          <label class="player-name-field">
            <span>Player ${index + 1}</span>
            <input
              class="player-name-input"
              type="text"
              value="${escapeHtml(name)}"
              data-player-index="${index}"
              placeholder="Enter player name"
              maxlength="40"
            />
          </label>
        `).join('')}
      </div>
      ${hasMissingPlayerWarning() && !state.warningAccepted ? `<div class="message warning">This setup leaves ${getMissingPlayerCount()} empty slot(s). Continue only if you are okay with a team potentially missing a player.</div>` : ''}
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="nextButton" type="button">${hasMissingPlayerWarning() && !state.warningAccepted ? 'Bypass Warning and Continue' : 'Continue'}</button>
    `,
  });

  document.querySelectorAll('.player-name-input').forEach((input) => {
    input.addEventListener('input', (event) => {
      const index = numberValue(event.target.dataset.playerIndex);
      state.playerNames[index] = event.target.value;
    });
  });
  document.querySelectorAll('.toggle-sensitive-button').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.targetInput);
      const isHidden = input.type === 'password';

      input.type = isHidden ? 'text' : 'password';
      button.setAttribute('aria-label', `${isHidden ? 'Hide' : 'Show'} ${input.id === 'discordChannelId' ? 'Discord channel ID' : 'host Discord user ID'}`);
    });
  });
  document.getElementById('discordChannelId').addEventListener('input', (event) => {
    state.discordChannelId = event.target.value;
    saveDiscordChannelId(state.discordChannelId.trim());
  });
  document.getElementById('discordHostUserId').addEventListener('input', (event) => {
    state.discordHostUserId = event.target.value;
    saveDiscordHostUserId(state.discordHostUserId.trim());
  });
  document.getElementById('createDiscordLobbyButton').addEventListener('click', async () => {
    const createButton = document.getElementById('createDiscordLobbyButton');
    const channelId = document.getElementById('discordChannelId').value.trim();
    const hostUserId = document.getElementById('discordHostUserId').value.trim();

    state.discordChannelId = channelId;
    state.discordHostUserId = hostUserId;
    saveDiscordChannelId(channelId);
    saveDiscordHostUserId(hostUserId);

    if (!channelId) {
      showInlineError('Paste a Discord channel ID before creating a queue lobby.');
      return;
    }

    if (!hostUserId) {
      showInlineError('Paste the host Discord user ID before creating a queue lobby.');
      return;
    }

    try {
      createButton.disabled = true;
      createButton.textContent = 'Creating...';
      const { lobby, hostToken } = await createDiscordLobby(channelId);

      state.discordLobbyId = lobby.id;
      state.discordLobby = lobby;
      state.sharedLobbyHostToken = hostToken;
      state.isSharedLobbyHost = true;
      saveDiscordLobbyId(lobby.id);
      saveSharedLobbyHostToken(lobby.id, hostToken);
      window.history.replaceState(null, '', `?lobby=${encodeURIComponent(lobby.id)}`);
      await publishSharedLobbyState();
      render();
    } catch (error) {
      showInlineError(`Discord queue could not be created: ${error.message}`);
    } finally {
      const currentCreateButton = document.getElementById('createDiscordLobbyButton');

      if (currentCreateButton) {
        currentCreateButton.disabled = false;
        currentCreateButton.textContent = 'Create Queue Lobby';
      }
    }
  });
  document.getElementById('refreshDiscordLobbyButton').addEventListener('click', async () => {
    const refreshButton = document.getElementById('refreshDiscordLobbyButton');

    if (!state.discordLobbyId) {
      showInlineError('Create a Discord queue lobby first.');
      return;
    }

    try {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Refreshing...';
      state.discordLobby = await fetchDiscordLobby(state.discordLobbyId);
      render();
    } catch (error) {
      showInlineError(`Discord queue could not be refreshed: ${error.message}`);
    } finally {
      const currentRefreshButton = document.getElementById('refreshDiscordLobbyButton');

      if (currentRefreshButton) {
        currentRefreshButton.disabled = false;
        currentRefreshButton.textContent = 'Refresh Queue';
      }
    }
  });
  document.getElementById('useDiscordLobbyButton').addEventListener('click', () => {
    const queuePlayers = state.discordLobby?.players || [];
    const nameCounts = new Map();
    const playerDiscordIds = {};
    const playerMeta = {};
    const names = queuePlayers.map((player) => {
      const baseName = player.displayName;
      const key = baseName.toLowerCase();
      const nextCount = (nameCounts.get(key) || 0) + 1;
      const displayName = nextCount === 1 ? baseName : `${baseName}(${nextCount})`;

      nameCounts.set(key, nextCount);
      playerDiscordIds[displayName] = player.userId;
      playerMeta[displayName] = {
        userId: player.userId,
        avatarUrl: player.avatarUrl || '',
      };

      return displayName;
    });

    if (names.length === 0) {
      showInlineError('No players are queued yet.');
      return;
    }

    if (applyRosterWithDuplicateReview(names)) {
      state.playerDiscordIds = playerDiscordIds;
      state.playerMeta = playerMeta;
      render();
    }
  });
  document.getElementById('closeDiscordLobbyButton').addEventListener('click', async () => {
    const closeButton = document.getElementById('closeDiscordLobbyButton');

    if (!state.discordLobbyId) {
      showInlineError('Create a Discord queue lobby first.');
      return;
    }

    try {
      closeButton.disabled = true;
      closeButton.textContent = 'Closing...';
      state.discordLobby = await closeDiscordLobby(state.discordLobbyId);
      render();
    } catch (error) {
      showInlineError(`Discord queue could not be closed: ${error.message}`);
    } finally {
      const currentCloseButton = document.getElementById('closeDiscordLobbyButton');

      if (currentCloseButton) {
        currentCloseButton.disabled = false;
        currentCloseButton.textContent = 'Close Queue';
      }
    }
  });
  document.getElementById('applyQuickAddButton').addEventListener('click', () => {
    const names = applyRosterInstruction(document.getElementById('quickAddPlayers').value);

    if (names.length === 0) {
      showInlineError('Type or paste at least one player name first.');
      return;
    }

    if (applyRosterWithDuplicateReview(names)) {
      render();
    }
  });
  document.getElementById('smartFillButton').addEventListener('click', async () => {
    const quickAddText = document.getElementById('quickAddPlayers').value;
    const smartFillButton = document.getElementById('smartFillButton');

    if (!quickAddText.trim()) {
      showInlineError('Type or paste player names before using Smart Fill.');
      return;
    }

    try {
      smartFillButton.disabled = true;
      smartFillButton.textContent = 'Thinking...';
      const names = await parseNamesWithAi(quickAddText);

      if (names.length === 0) {
        throw new Error('Smart Fill did not find any player names.');
      }

      if (applyRosterWithDuplicateReview(names)) {
        render();
      }
    } catch (error) {
      const fallbackNames = applyRosterInstruction(quickAddText);

      if (fallbackNames.length > 0) {
        if (applyRosterWithDuplicateReview(fallbackNames)) {
          render();
          showInlineError(`Smart Fill could not use AI, so local parsing was used instead. ${error.message}`);
        }
        return;
      }

      showInlineError(`Smart Fill could not use AI: ${error.message}`);
    } finally {
      const currentSmartFillButton = document.getElementById('smartFillButton');

      if (currentSmartFillButton) {
        currentSmartFillButton.disabled = false;
        currentSmartFillButton.textContent = 'Smart Fill';
      }
    }
  });
  document.getElementById('importDiscordButton').addEventListener('click', async () => {
    const importButton = document.getElementById('importDiscordButton');
    const channelId = document.getElementById('discordChannelId').value.trim();

    state.discordChannelId = channelId;
    saveDiscordChannelId(channelId);

    if (!channelId) {
      showInlineError('Paste a Discord channel ID before importing.');
      return;
    }

    try {
      importButton.disabled = true;
      importButton.textContent = 'Importing...';
      const names = await importPlayersFromDiscord(channelId);

      if (names.length === 0) {
        throw new Error('No recent Discord posters were found in that channel.');
      }

      if (applyRosterWithDuplicateReview(names)) {
        render();
      }
    } catch (error) {
      showInlineError(`Discord import failed: ${error.message}`);
    } finally {
      const currentImportButton = document.getElementById('importDiscordButton');

      if (currentImportButton) {
        currentImportButton.disabled = false;
        currentImportButton.textContent = 'Import Recent Posters';
      }
    }
  });
  document.getElementById('clearNamesButton').addEventListener('click', () => {
    state.playerNames = Array.from({ length: numberValue(state.totalPlayers) }, () => '');
    state.playerDiscordIds = {};
    state.playerMeta = {};
    render();
  });
  document.getElementById('backButton').addEventListener('click', () => {
    state.warningAccepted = false;
    state.step = 3;
    render();
  });
  document.getElementById('nextButton').addEventListener('click', () => {
    const names = state.playerNames.map((name) => name.trim());
    const missingNames = names.some((name) => !name);

    if (missingNames) {
      showInlineError('Please fill in every player name before continuing.');
      return;
    }

    const resolvedNames = resolveDuplicateNames(names);

    if (!resolvedNames) {
      showInlineError('Please rename one of the duplicate players before continuing.');
      return;
    }

    state.playerNames = resolvedNames;
    state.warningAccepted = true;
    state.step = 5;
    render();
  });
  bindEnterToButton('nextButton');
}

function showInlineError(message) {
  const existingError = wizard.querySelector('.inline-error');

  if (existingError) {
    existingError.remove();
  }

  wizard.querySelector('.step-card').insertAdjacentHTML('beforeend', `<div class="message error inline-error">${message}</div>`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderReadyStep() {
  renderStepShell({
    title: 'How do you want to sort teams?',
    copy: 'Choose random sorting for quick teams, or manual sorting if captains are drafting players.',
    body: `
      <div class="summary-grid">
        <div class="summary-card"><span>Players</span><strong>${state.totalPlayers}</strong></div>
        <div class="summary-card"><span>Players per team</span><strong>${state.playersPerTeam}</strong></div>
        <div class="summary-card"><span>Teams</span><strong>${state.teamCount}</strong></div>
      </div>
      ${hasMissingPlayerWarning() ? `<div class="message warning">You accepted the warning: ${getMissingPlayerCount()} team slot(s) may be empty.</div>` : ''}
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="randomSortButton" type="button">Randomly Sort</button>
      <button id="manualSortButton" type="button">Manually Sort</button>
    `,
  });

  document.getElementById('backButton').addEventListener('click', () => {
    state.step = 4;
    render();
  });
  document.getElementById('randomSortButton').addEventListener('click', () => {
    state.sortMode = 'random';
    randomizeTeams();
    state.step = 6;
    render();
  });
  document.getElementById('manualSortButton').addEventListener('click', () => {
    state.sortMode = 'manual';
    state.step = 7;
    render();
  });
  bindEnterToButton('randomSortButton');
}

function renderCaptainQuestionStep() {
  renderStepShell({
    title: 'Use team captains?',
    copy: 'If captains are drafting, pick a captain for each team first. Their teams will be named automatically.',
    body: `
      <div class="message">
        Example: if Harrison is selected as a captain, that team becomes Harrison's Team.
      </div>
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="yesCaptainsButton" type="button">Yes, Pick Captains</button>
      <button id="noCaptainsButton" class="secondary-button" type="button">No Captains</button>
    `,
  });

  document.getElementById('backButton').addEventListener('click', () => {
    state.step = 5;
    render();
  });
  document.getElementById('yesCaptainsButton').addEventListener('click', startManualSortWithCaptains);
  document.getElementById('noCaptainsButton').addEventListener('click', startManualSortWithoutCaptains);
  bindEnterToButton('yesCaptainsButton');
}

function renderCaptainSelectionStep() {
  const selectedCaptains = new Set(state.captains.filter(Boolean));
  const nextTeamNumber = state.captains.findIndex((captain) => !captain) + 1;
  const availablePlayers = state.playerNames.filter((player) => !selectedCaptains.has(player));
  const captainsComplete = state.captains.length > 0 && state.captains.every(Boolean);
  const manualCaptainCount = state.captains.filter((captain) => captain && !state.playerDiscordIds[captain]).length;

  renderStepShell({
    title: 'Pick team captains',
    copy: 'Click a player to make them the captain for the next team. Once every team has a captain, start the draft.',
    body: `
      <div class="captain-progress">
        ${state.captains.map((captain, index) => `
          <div class="captain-slot ${captain ? 'filled' : ''}">
            <span>Team ${index + 1}</span>
            <strong>${captain ? `${escapeHtml(captain)}'s Team` : 'Needs captain'}</strong>
          </div>
        `).join('')}
      </div>
      ${nextTeamNumber > 0 ? `<div class="message">Selecting captain for Team ${nextTeamNumber}</div>` : ''}
      ${captainsComplete ? '<div class="message success">All captains are selected. Start the draft when ready.</div>' : ''}
      ${captainsComplete && manualCaptainCount > 0 ? `<div class="message warning">${manualCaptainCount} captain(s) are not linked to Discord. Host override will allow the host to make those picks.</div>` : ''}
      <div class="captain-picker">
        ${availablePlayers.map((player) => `
          <div class="captain-player-row">
            ${renderPlayerIdentity(player)}
            <button class="make-captain-button" type="button" data-player="${escapeHtml(player)}">Make Captain</button>
          </div>
        `).join('')}
      </div>
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="clearCaptainsButton" class="secondary-button" type="button">Clear Captains</button>
      ${captainsComplete ? '<button id="startDraftButton" type="button">Start Draft</button>' : ''}
    `,
  });

  document.querySelectorAll('.make-captain-button').forEach((button) => {
    button.addEventListener('click', () => {
      assignCaptain(button.dataset.player).catch((error) => {
        showInlineError(error.message || 'Captain draft could not be started.');
      });
    });
  });
  document.getElementById('backButton').addEventListener('click', () => {
    state.captains = [];
    state.step = 7;
    render();
  });
  document.getElementById('clearCaptainsButton').addEventListener('click', () => {
    state.captains = Array.from({ length: numberValue(state.teamCount) }, () => '');
    render();
  });
  const startDraftButton = document.getElementById('startDraftButton');

  if (startDraftButton) {
    startDraftButton.addEventListener('click', () => {
      startLockedCaptainDraft().catch((error) => {
        showInlineError(error.message || 'Captain draft could not be started.');
      });
    });
  }
}

function assignCaptain(player) {
  const nextCaptainIndex = state.captains.findIndex((captain) => !captain);

  if (nextCaptainIndex === -1) {
    return;
  }

  state.captains[nextCaptainIndex] = player;
  render();
}

async function startLockedCaptainDraft() {
  if (!state.captains.every(Boolean)) {
    showInlineError('Pick every captain before starting the draft.');
    return;
  }

  buildManualTeamsWithCaptains();
  const draft = await createServerDraft();

  syncServerDraftToState(draft);
  state.step = 6;
  await syncSharedLobbyDraft(draft);
  render();
}

function renderTeamsStep() {
  const imbalance = getTeamImbalance();
  const draftActive = isCaptainDraftActive();
  const draftComplete = state.sortMode === 'manual' && state.useCaptains && !draftActive && isDraftComplete();
  wizard.innerHTML = `
    <section class="step-card">
      ${renderSharedLobbyBanner()}
      <div>
        <h2 class="step-title">${draftActive ? 'Captain Draft' : 'Teams are sorted'}</h2>
        <p class="step-copy">${draftActive ? 'Captains draft one player at a time. Each turn lasts 90 seconds.' : 'Reroll if the random sort feels unbalanced, or manually move a player below.'}</p>
      </div>
      ${imbalance > 1 ? '<div class="message warning">These teams are uneven. You can reroll or manually move players.</div>' : ''}
      ${draftActive ? renderDraftStatus() : ''}
      ${draftComplete ? '<div class="message success">Draft complete. All available players have been drafted or every team is full.</div>' : ''}
      <div class="button-row">
        ${state.sortMode === 'random' ? '<button id="rerollButton" type="button">Reroll Teams</button>' : ''}
        <button id="sortChoiceButton" class="secondary-button" type="button">Back to Sort Choice</button>
        <button id="setupButton" class="secondary-button" type="button">Edit Setup</button>
      </div>
      ${state.sortMode === 'manual' ? renderUnassignedPool() : ''}
      ${renderMovePanel()}
      <div class="teams-layout">
        ${state.teams.map(renderTeamCard).join('')}
      </div>
      ${state.assignmentPlayer ? renderAssignmentModal() : ''}
      ${state.swapSource ? renderSwapModal() : ''}
    </section>
  `;

  if (state.sortMode === 'random') {
    document.getElementById('rerollButton').addEventListener('click', () => {
      randomizeTeams();
      render();
    });
  }
  document.getElementById('setupButton').addEventListener('click', () => {
    resetDraftState();
    state.step = 1;
    render();
  });
  document.getElementById('sortChoiceButton').addEventListener('click', () => {
    resetDraftState();
    state.step = 5;
    render();
  });
  const moveButton = document.getElementById('moveButton');

  if (moveButton) {
    moveButton.addEventListener('click', moveSelectedPlayer);
  }
  document.querySelectorAll('.team-name-input').forEach((input) => {
    input.addEventListener('input', (event) => {
      const team = state.teams.find((currentTeam) => currentTeam.id === numberValue(event.target.dataset.teamId));

      if (team) {
        team.name = event.target.value;
        updateMoveOptions();
      }
    });
  });
  document.querySelectorAll('.assign-player-button').forEach((button) => {
    button.addEventListener('click', () => {
      if (isCaptainDraftActive()) {
        draftPlayerToActiveTeam(button.dataset.player).catch((error) => {
          showInlineError(error.message || 'Draft pick failed.');
        });
        return;
      }

      state.assignmentPlayer = button.dataset.player;
      render();
    });
  });
  document.querySelectorAll('.unassign-player-button').forEach((button) => {
    button.addEventListener('click', () => unassignPlayer(numberValue(button.dataset.teamId), button.dataset.player));
  });
  document.querySelectorAll('.swap-player-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.swapSource = {
        teamId: numberValue(button.dataset.teamId),
        player: button.dataset.player,
      };
      render();
    });
  });
  const cancelSwapButton = document.getElementById('cancelSwapButton');
  const confirmSwapButton = document.getElementById('confirmSwapButton');
  const cancelAssignmentButton = document.getElementById('cancelAssignmentButton');

  document.querySelectorAll('.assign-to-team-button').forEach((button) => {
    button.addEventListener('click', () => assignUnassignedPlayerToTeam(numberValue(button.dataset.teamId)));
  });

  if (cancelAssignmentButton) {
    cancelAssignmentButton.addEventListener('click', () => {
      state.assignmentPlayer = null;
      render();
    });
  }

  if (cancelSwapButton) {
    cancelSwapButton.addEventListener('click', () => {
      state.swapSource = null;
      render();
    });
  }

  if (confirmSwapButton) {
    confirmSwapButton.addEventListener('click', confirmSwap);
    bindEnterToButton('confirmSwapButton');
  }
  const discordLogoutButton = document.getElementById('discordLogoutButton');

  if (discordLogoutButton) {
    discordLogoutButton.addEventListener('click', logoutDiscord);
  }
}

function getTeamImbalance() {
  const sizes = state.teams.map((team) => team.players.length);
  return Math.max(...sizes) - Math.min(...sizes);
}

function renderDraftStatus() {
  const activeTeam = state.teams[state.draft.currentTeamIndex];
  const userLabel = state.sessionUser
    ? `Signed in as ${state.sessionUser.globalName || state.sessionUser.username}`
    : state.isSharedLobbyHost
      ? 'Host override enabled'
      : 'Captains must sign in to pick';
  const draftLink = state.serverDraftId ? `${window.location.origin}${window.location.pathname}?draft=${state.serverDraftId}` : '';

  if (!activeTeam) {
    return '';
  }

  return `
    <div class="auth-strip">
      <span>${escapeHtml(userLabel)}</span>
      <div class="button-row">
        ${state.sessionUser ? '<button id="discordLogoutButton" class="secondary-button" type="button">Sign Out</button>' : `<a class="button-link secondary-button" href="${DISCORD_AUTH_URL}">Sign In with Discord</a>`}
      </div>
    </div>
    <section class="draft-status">
      <div>
        <span>On the clock</span>
        <strong>${escapeHtml(activeTeam.captain || activeTeam.name)}</strong>
      </div>
      <div>
        <span>Time left</span>
        <strong id="draftTimerValue">${formatDraftTime(getDraftSecondsRemaining())}</strong>
      </div>
      <div>
        <span>Drafting for</span>
        <strong>${escapeHtml(activeTeam.name)}</strong>
      </div>
    </section>
    ${draftLink ? `<div class="message"><strong>Draft link:</strong> ${escapeHtml(draftLink)}</div>` : ''}
  `;
}

function canCurrentUserDraft() {
  if (!isCaptainDraftActive()) {
    return false;
  }

  if (hasHostOverrideAccess()) {
    return true;
  }

  if (!state.sessionUser) {
    return false;
  }

  const activeTeam = state.teams[state.draft.currentTeamIndex];

  return Boolean(activeTeam && activeTeam.captainUserId === state.sessionUser.id);
}

function renderMovePanel() {
  const canUseMovePanel = state.sortMode !== 'manual' || (state.isSharedLobbyHost && !isCaptainDraftActive());

  if (!canUseMovePanel) {
    return '';
  }

  const options = state.teams.flatMap((team) => (
    team.players.map((player) => `<option value="${team.id}::${player}">${escapeHtml(player)} (${escapeHtml(team.name)})</option>`)
  )).join('');
  const teamOptions = state.teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');

  return `
    <div class="move-panel">
      <label>
        Player to move
        <select id="playerToMove">${options}</select>
      </label>
      <label>
        Move to team
        <select id="targetTeam">${teamOptions}</select>
      </label>
      <button id="moveButton" type="button">Move Player</button>
    </div>
  `;
}

function renderUnassignedPool() {
  const draftActive = isCaptainDraftActive();
  const activeTeam = state.teams[state.draft.currentTeamIndex];
  const draftAllowed = canCurrentUserDraft();
  return `
    <section class="unassigned-card">
      <div class="unassigned-header">
        <div>
          <h2>Unassigned Players</h2>
          <p>${draftActive ? `${activeTeam?.captain || activeTeam?.name || 'Captain'} is choosing now.` : 'Draft players from here into teams. Full teams cannot receive more players.'}</p>
        </div>
        <span class="team-size">${state.unassignedPlayers.length} remaining</span>
      </div>
      <ul class="unassigned-list">
        ${state.unassignedPlayers.length === 0 ? '<li class="empty-slot">All players are assigned.</li>' : state.unassignedPlayers.map((player) => `
          <li class="player-row">
            ${renderPlayerIdentity(player)}
            <button class="assign-player-button secondary-button" type="button" data-player="${escapeHtml(player)}" ${draftActive && !draftAllowed ? 'disabled' : ''}>${draftActive ? 'Draft' : 'Assign'}</button>
          </li>
        `).join('')}
      </ul>
    </section>
  `;
}

function renderTeamCard(team) {
  const missingSlots = Math.max(numberValue(state.playersPerTeam) - team.players.length, 0);
  const emptySlots = Array.from({ length: missingSlots }, () => '<li class="empty-slot">Empty slot</li>').join('');
  const draftActive = isCaptainDraftActive();
  const canManuallyEditPlayers = state.sortMode === 'manual' && (!state.useCaptains || (state.isSharedLobbyHost && !draftActive));
  const isActiveDraftTeam = draftActive && state.teams[state.draft.currentTeamIndex]?.id === team.id;

  return `
    <article class="team-card ${isActiveDraftTeam ? 'draft-active-team' : ''}">
      <div class="team-header">
        <label class="team-name-label">
          <span>Team name</span>
          <input
            class="team-name-input"
            type="text"
            value="${escapeHtml(team.name)}"
            data-team-id="${team.id}"
            maxlength="40"
          />
        </label>
        <span class="team-size">${team.players.length}/${state.playersPerTeam}</span>
      </div>
      <ul class="team-list">
        ${team.players.map((player) => `
          <li class="player-row">
            ${renderPlayerIdentity(player, { captain: team.captain === player })}
            <div class="player-actions">
              ${canManuallyEditPlayers && team.captain !== player ? `<button class="swap-player-button secondary-button" type="button" data-team-id="${team.id}" data-player="${escapeHtml(player)}">Swap</button>` : ''}
              ${canManuallyEditPlayers && team.captain !== player ? `<button class="unassign-player-button danger-button" type="button" data-team-id="${team.id}" data-player="${escapeHtml(player)}">Unassign</button>` : ''}
            </div>
          </li>
        `).join('')}
        ${emptySlots}
      </ul>
    </article>
  `;
}

function renderAssignmentModal() {
  const openTeams = state.teams.filter((team) => team.players.length < numberValue(state.playersPerTeam));

  return `
    <div class="modal-backdrop">
      <section class="swap-modal">
        <h2>Assign ${escapeHtml(state.assignmentPlayer)}</h2>
        <p>Choose which team should draft this player. Full teams are unavailable.</p>
        <div class="team-pick-grid">
          ${openTeams.map((team) => `
            <button class="assign-to-team-button team-pick-button" type="button" data-team-id="${team.id}">
              <span>${escapeHtml(team.name)}</span>
              <small>${team.players.length}/${state.playersPerTeam} players</small>
            </button>
          `).join('')}
        </div>
        ${openTeams.length === 0 ? '<div class="message warning">All teams are full. Move a player to Unassigned before drafting anyone else.</div>' : ''}
        <div class="button-row">
          <button id="cancelAssignmentButton" class="secondary-button" type="button">Cancel</button>
        </div>
      </section>
    </div>
  `;
}

async function draftPlayerToActiveTeam(player) {
  if (!isCaptainDraftActive()) {
    return;
  }

  if (state.serverDraftId) {
    const draft = await submitServerDraftPick(player);
    syncServerDraftToState(draft);
    await syncSharedLobbyDraft(draft);
    render();
    return;
  }

  const activeTeam = state.teams[state.draft.currentTeamIndex];

  if (!activeTeam || isTeamFull(activeTeam) || !state.unassignedPlayers.includes(player)) {
    return;
  }

  activeTeam.players.push(player);
  state.unassignedPlayers = state.unassignedPlayers.filter((name) => name !== player);

  if (isDraftComplete()) {
    state.draft.active = false;
    stopDraftTimer();
  } else {
    advanceDraftTurn();
  }

  render();
}

function renderSwapModal() {
  const sourceTeam = state.teams.find((team) => team.id === state.swapSource.teamId);
  const targetOptions = state.teams.flatMap((team) => (
    team.id === state.swapSource.teamId
      ? []
      : team.players
        .filter((player) => team.captain !== player)
        .map((player) => `<option value="${team.id}::${escapeHtml(player)}">${escapeHtml(player)} (${escapeHtml(team.name)})</option>`)
  )).join('');

  return `
    <div class="modal-backdrop">
      <section class="swap-modal">
        <h2>Swap ${escapeHtml(state.swapSource.player)}</h2>
        <p>Choose a player from another team to swap with. This keeps both teams at the same size.</p>
        <div class="message">
          Moving from ${escapeHtml(sourceTeam.name)}
        </div>
        <label>
          Swap with
          <select id="swapTargetPlayer">
            ${targetOptions || '<option value="">No other team players available</option>'}
          </select>
        </label>
        <div class="button-row">
          <button id="confirmSwapButton" type="button" ${targetOptions ? '' : 'disabled'}>Swap Players</button>
          <button id="cancelSwapButton" class="secondary-button" type="button">Cancel</button>
        </div>
      </section>
    </div>
  `;
}

function assignUnassignedPlayerToTeam(targetTeamId) {
  const targetTeam = state.teams.find((team) => team.id === targetTeamId);

  if (!targetTeam || targetTeam.players.length >= numberValue(state.playersPerTeam)) {
    return;
  }

  targetTeam.players.push(state.assignmentPlayer);
  state.unassignedPlayers = state.unassignedPlayers.filter((name) => name !== state.assignmentPlayer);
  state.assignmentPlayer = null;
  syncHostCorrection();
  render();
}

function unassignPlayer(teamId, player) {
  const team = state.teams.find((currentTeam) => currentTeam.id === teamId);

  if (!team || team.captain === player) {
    return;
  }

  team.players = team.players.filter((name) => name !== player);
  state.unassignedPlayers.push(player);
  syncHostCorrection();
  render();
}

function confirmSwap() {
  const targetValue = document.getElementById('swapTargetPlayer').value;

  if (!targetValue) {
    return;
  }

  const [targetTeamIdRaw, targetPlayer] = targetValue.split('::');
  const sourceTeam = state.teams.find((team) => team.id === state.swapSource.teamId);
  const targetTeam = state.teams.find((team) => team.id === numberValue(targetTeamIdRaw));

  if (!sourceTeam || !targetTeam || sourceTeam.captain === state.swapSource.player || targetTeam.captain === targetPlayer) {
    return;
  }

  sourceTeam.players = sourceTeam.players.map((player) => (
    player === state.swapSource.player ? targetPlayer : player
  ));
  targetTeam.players = targetTeam.players.map((player) => (
    player === targetPlayer ? state.swapSource.player : player
  ));
  state.swapSource = null;
  syncHostCorrection();
  render();
}

function updateMoveOptions() {
  const playerSelect = document.getElementById('playerToMove');
  const targetTeamSelect = document.getElementById('targetTeam');

  if (!playerSelect || !targetTeamSelect) {
    return;
  }

  playerSelect.innerHTML = state.teams.flatMap((team) => (
    team.players.map((player) => `<option value="${team.id}::${player}">${player} (${escapeHtml(team.name)})</option>`)
  )).join('');
  targetTeamSelect.innerHTML = state.teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
}

function moveSelectedPlayer() {
  const [fromTeamId, player] = document.getElementById('playerToMove').value.split('::');
  const targetTeamId = document.getElementById('targetTeam').value;
  const fromTeam = state.teams.find((team) => team.id === numberValue(fromTeamId));
  const targetTeam = state.teams.find((team) => team.id === numberValue(targetTeamId));

  if (!fromTeam || !targetTeam || fromTeam.id === targetTeam.id) {
    return;
  }

  fromTeam.players = fromTeam.players.filter((name) => name !== player);
  targetTeam.players.push(player);
  syncHostCorrection();
  render();
}

resetButton.addEventListener('click', () => {
  resetDraftState();
  state.step = 1;
  state.totalPlayers = '';
  state.playersPerTeam = '';
  state.teamCount = '';
  state.playerNames = [];
  state.teams = [];
  state.unassignedPlayers = [];
  state.sortMode = 'random';
  state.useCaptains = false;
  state.captains = [];
  state.assignmentPlayer = null;
  state.swapSource = null;
  state.warningAccepted = false;
  state.playerDiscordIds = {};
  state.serverDraftId = '';
  state.serverDraft = null;
  saveServerDraftId('');
  render();
});

themeToggleButton.addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';

  applyTheme(nextTheme);
  saveTheme(nextTheme);
});

async function initializeApp() {
  initializeTheme();
  initializeSavedSettings();

  try {
    const config = await fetchConfig();
    state.publicBaseUrl = config.publicBaseUrl || '';
  } catch {
    state.publicBaseUrl = '';
  }

  try {
    state.sessionUser = await fetchSession();
  } catch {
    state.sessionUser = null;
  }

  if (state.discordLobbyId) {
    try {
      const lobby = await fetchDiscordLobby(state.discordLobbyId);

      if (lobby.appState) {
        applyShareableAppState(lobby.appState);
      }

      state.discordLobby = {
        ...lobby,
        appState: null,
      };

      if (!state.isSharedLobbyHost) {
        startSharedLobbyPolling();
      }
    } catch {
      state.discordLobbyId = '';
      state.sharedLobbyHostToken = '';
      state.isSharedLobbyHost = false;
    }
  }

  if (state.serverDraftId) {
    try {
      const draft = await fetchServerDraft(state.serverDraftId);
      syncServerDraftToState(draft);
    } catch {
      saveServerDraftId('');
      state.serverDraftId = '';
      state.serverDraft = null;
    }
  }

  render();
}

initializeApp();
