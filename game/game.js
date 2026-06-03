/**
 * Rob a Cat — 3D game client + WebSocket sync
 */
import { GameWorld3D } from './world3d.js';

const SESSION_KEY = 'rac_game_session';
const CAT_TYPES = ['tabby', 'siamese', 'persian', 'maine', 'shadow'];
const CAT_NAMES = {
  tabby: 'Tabby',
  siamese: 'Siamese',
  persian: 'Persian',
  maine: 'Maine Coon',
  shadow: 'Shadow Cat',
};

const $ = (id) => document.getElementById(id);

let ws = null;
let session = null;
let selfPlayer = null;
let allPlayers = [];
let world = null;

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatMoney(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.floor(n);
}

function showToast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function showError(msg) {
  $('loading').style.display = 'none';
  $('game')?.classList.remove('active');
  $('connect-error')?.classList.add('visible');
  $('error-message').textContent = msg;
}

function showGame() {
  $('loading').style.display = 'none';
  $('connect-error')?.classList.remove('visible');
  $('game')?.classList.add('active');
}

function exitToLauncher() {
  window.location.href = session?.exitTarget || '/browser.html';
}

function send(event, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, ...payload }));
  }
}

function findSelfInList(players) {
  if (!session?.username) return null;
  return players.find(
    (p) => p.username.toLowerCase() === session.username.toLowerCase()
  );
}

function updateHud() {
  if (!selfPlayer) return;
  $('hud-username').textContent = selfPlayer.username;
  $('hud-money').textContent = formatMoney(selfPlayer.money);
  $('hud-rebirth').textContent = String(selfPlayer.rebirth ?? 0);
  const serverLabel =
    session?.roomType === 'private'
      ? `Private · ${session.roomCode || '—'}`
      : 'Public';
  $('hud-server').textContent = serverLabel;
}

function renderPlayersList() {
  const list = $('players-list');
  if (!list) return;
  list.innerHTML = '';

  allPlayers.forEach((p) => {
    const card = document.createElement('div');
    card.className =
      'player-card' + (p.username === selfPlayer?.username ? ' self' : '');
    const d = document.createElement('div');
    d.textContent = p.username;
    card.innerHTML = `<span class="player-avatar">🐱</span><div class="player-info"><div class="player-name"></div><div class="player-money">${formatMoney(p.money)} · R${p.rebirth ?? 0}</div></div>`;
    card.querySelector('.player-name').appendChild(d);
    list.appendChild(card);
  });

  if (!allPlayers.length) {
    list.innerHTML = '<p class="empty-list">No other players</p>';
  }
}

function syncWorld() {
  if (!world || !selfPlayer) return;
  world.updateSelf(selfPlayer);
  world.updateOthers(allPlayers, selfPlayer.username);
}

function applySelfUpdate(data) {
  if (!selfPlayer) return;
  if (data.money !== undefined) selfPlayer.money = data.money;
  if (data.rebirth !== undefined) selfPlayer.rebirth = data.rebirth;
  if (data.padBalances) selfPlayer.padBalances = data.padBalances;
  if (data.cats) selfPlayer.cats = data.cats;
  if (data.collected) showToast(`Collected ${formatMoney(data.collected)}!`);
  updateHud();
  syncWorld();
}

function handleSyncState(data) {
  if (data.players) {
    allPlayers = data.players;
    const me = findSelfInList(allPlayers);
    if (me) selfPlayer = me;
  }
  if (data.self) selfPlayer = data.self;
  updateHud();
  syncWorld();
  renderPlayersList();
}

function initWorld() {
  const canvas = $('game-canvas');
  if (!canvas) return;
  world = new GameWorld3D(canvas);
  world.onPadClick = (slotIndex) => {
    const pads = selfPlayer?.padBalances || [];
    const bal = pads[slotIndex] ?? 0;
    if (bal > 0) send('collectPad', { slotIndex });
    else showToast('Nothing to collect yet');
  };
  
  // Cat pickup handler
  world.onCatPickup = (catType) => {
    showToast(`Picked up ${CAT_NAMES[catType]}!`);
  };
  
  // Cat placement handler
  world.onCatPlace = (slotIndex, catType) => {
    send('actionUpdate', { action: 'spawnCat', data: { slotIndex, catType } });
    showToast(`Placed ${CAT_NAMES[catType]} in slot!`);
  };
}

function connect() {
  session = loadSession();
  if (!session?.username || !session?.wsUrl) {
    showError('No game session. Return to the launcher and press Play.');
    return;
  }

  const serverType = session.roomType === 'private' ? 'private' : 'public';

  try {
    ws = new WebSocket(session.wsUrl);
  } catch {
    showError('Could not open WebSocket.');
    return;
  }

  const timeout = setTimeout(() => {
    showError('Connection timed out.');
    ws?.close();
  }, 12000);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        event: 'joinServer',
        username: session.username,
        password: session.password || '',
        serverType,
        roomCode: session.roomCode,
      })
    );
  };

  ws.onmessage = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }

    switch (data.event) {
      case 'joined':
        clearTimeout(timeout);
        selfPlayer = data.player;
        showGame();
        initWorld();
        updateHud();
        syncWorld();
        send('requestState');
        break;
      case 'syncState':
        handleSyncState(data);
        if (!$('game')?.classList.contains('active')) {
          showGame();
          initWorld();
        }
        break;
      case 'updateMoney':
        applySelfUpdate(data);
        break;
      case 'spawnCat':
      case 'playerJoined':
      case 'playerLeft':
      case 'playerMoved':
        send('requestState');
        break;
      case 'error':
        if (!selfPlayer) {
          clearTimeout(timeout);
          showError(data.message || 'Server error');
        } else {
          showToast(data.message || 'Error');
        }
        break;
    }
  };

  ws.onerror = () => {
    clearTimeout(timeout);
    if (!selfPlayer) showError('Connection failed.');
  };

  ws.onclose = () => {
    if (!selfPlayer) {
      clearTimeout(timeout);
      showError('Disconnected from server.');
    }
  };
}

function findEmptySlot() {
  if (!selfPlayer?.cats) return -1;
  for (let i = 0; i < 8; i++) {
    if (!selfPlayer.cats[i]?.cat) return i;
  }
  return -1;
}

function initActions() {
  $('btn-exit')?.addEventListener('click', exitToLauncher);
  $('btn-retry-exit')?.addEventListener('click', exitToLauncher);

  $('btn-rebirth')?.addEventListener('click', () => {
    const cost = 1000 * ((selfPlayer?.rebirth ?? 0) + 1);
    if (!confirm(`Rebirth for ${formatMoney(cost)}? (+25% income per level)`)) return;
    send('actionUpdate', { action: 'rebirth' });
  });
  
  // Send player position updates to server
  let lastPositionUpdate = 0;
  setInterval(() => {
    if (world && world.playerPosition) {
      const now = Date.now();
      if (now - lastPositionUpdate > 100) { // Update every 100ms
        send('playerMoved', {
          position: {
            x: world.playerPosition.x,
            y: world.playerPosition.y,
            z: world.playerPosition.z
          }
        });
        lastPositionUpdate = now;
      }
    }
  }, 100);
}

initActions();
connect();
