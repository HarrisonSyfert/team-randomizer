const wizard = document.getElementById('wizard');
const resetButton = document.getElementById('resetButton');
const themeToggleButton = document.getElementById('themeToggleButton');
const themeToggleIcon = document.getElementById('themeToggleIcon');
const SMART_PARSE_URL = 'http://localhost:5050/api/parse-players';
const THEME_STORAGE_KEY = 'teamRandomizerTheme';
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
}

function startManualSort() {
  state.sortMode = 'manual';
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
  state.captains = Array.from({ length: numberValue(state.teamCount) }, () => '');
  state.step = 8;
  render();
}

function startManualSortWithoutCaptains() {
  state.useCaptains = false;
  state.captains = [];
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
    players: [captain],
  }));
  state.unassignedPlayers = state.playerNames.filter((player) => !captainSet.has(player));
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
}

function renderStepShell({ title, copy, body, actions }) {
  wizard.innerHTML = `
    <section class="step-card">
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
  document.getElementById('clearNamesButton').addEventListener('click', () => {
    state.playerNames = Array.from({ length: numberValue(state.totalPlayers) }, () => '');
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

  renderStepShell({
    title: 'Pick team captains',
    copy: 'Click a player to make them the captain for the next team. Once every team has a captain, the draft board opens.',
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
      <div class="captain-picker">
        ${availablePlayers.map((player) => `
          <div class="captain-player-row">
            <span>${escapeHtml(player)}</span>
            <button class="make-captain-button" type="button" data-player="${escapeHtml(player)}">Make Captain</button>
          </div>
        `).join('')}
      </div>
    `,
    actions: `
      <button id="backButton" class="secondary-button" type="button">Back</button>
      <button id="clearCaptainsButton" class="secondary-button" type="button">Clear Captains</button>
    `,
  });

  document.querySelectorAll('.make-captain-button').forEach((button) => {
    button.addEventListener('click', () => assignCaptain(button.dataset.player));
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
}

function assignCaptain(player) {
  const nextCaptainIndex = state.captains.findIndex((captain) => !captain);

  if (nextCaptainIndex === -1) {
    return;
  }

  state.captains[nextCaptainIndex] = player;

  if (state.captains.every(Boolean)) {
    buildManualTeamsWithCaptains();
    state.step = 6;
  }

  render();
}

function renderTeamsStep() {
  const imbalance = getTeamImbalance();
  wizard.innerHTML = `
    <section class="step-card">
      <div>
        <h2 class="step-title">Teams are sorted</h2>
        <p class="step-copy">Reroll if the random sort feels unbalanced, or manually move a player below.</p>
      </div>
      ${imbalance > 1 ? '<div class="message warning">These teams are uneven. You can reroll or manually move players.</div>' : ''}
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
    state.step = 1;
    render();
  });
  document.getElementById('sortChoiceButton').addEventListener('click', () => {
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
}

function getTeamImbalance() {
  const sizes = state.teams.map((team) => team.players.length);
  return Math.max(...sizes) - Math.min(...sizes);
}

function renderMovePanel() {
  if (state.sortMode === 'manual') {
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
  return `
    <section class="unassigned-card">
      <div class="unassigned-header">
        <div>
          <h2>Unassigned Players</h2>
          <p>Draft players from here into teams. Full teams cannot receive more players.</p>
        </div>
        <span class="team-size">${state.unassignedPlayers.length} remaining</span>
      </div>
      <ul class="unassigned-list">
        ${state.unassignedPlayers.length === 0 ? '<li class="empty-slot">All players are assigned.</li>' : state.unassignedPlayers.map((player) => `
          <li class="player-row">
            <span>${escapeHtml(player)}</span>
            <button class="assign-player-button secondary-button" type="button" data-player="${escapeHtml(player)}">Assign</button>
          </li>
        `).join('')}
      </ul>
    </section>
  `;
}

function renderTeamCard(team) {
  const missingSlots = Math.max(numberValue(state.playersPerTeam) - team.players.length, 0);
  const emptySlots = Array.from({ length: missingSlots }, () => '<li class="empty-slot">Empty slot</li>').join('');

  return `
    <article class="team-card">
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
            <span>${team.captain === player ? '<span class="captain-crown" title="Team captain">♛</span>' : ''}${escapeHtml(player)}</span>
            <div class="player-actions">
              ${state.sortMode === 'manual' && team.captain !== player ? `<button class="swap-player-button secondary-button" type="button" data-team-id="${team.id}" data-player="${escapeHtml(player)}">Swap</button>` : ''}
              ${state.sortMode === 'manual' && team.captain !== player ? `<button class="unassign-player-button danger-button" type="button" data-team-id="${team.id}" data-player="${escapeHtml(player)}">Unassign</button>` : ''}
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
  render();
}

function unassignPlayer(teamId, player) {
  const team = state.teams.find((currentTeam) => currentTeam.id === teamId);

  if (!team || team.captain === player) {
    return;
  }

  team.players = team.players.filter((name) => name !== player);
  state.unassignedPlayers.push(player);
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
  render();
}

resetButton.addEventListener('click', () => {
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
  render();
});

themeToggleButton.addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';

  applyTheme(nextTheme);
  saveTheme(nextTheme);
});

initializeTheme();
render();
