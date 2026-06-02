/**
 * Rob a Cat — Game Client
 * Connects to server.js, syncs economy, 8-slot base with green pads
 */
(function () {
  const SESSION_KEY = 'rac_game_session';

  const CAT_DISPLAY = {
    tabby: { emoji: '🐱', name: 'Tabby' },
    siamese: { emoji: '🐈', name: 'Siamese' },
    persian: { emoji: '😺', name: 'Persian' },
    maine: { emoji: '🦁', name: 'Maine Coon' },
    shadow: { emoji: '🐈‍⬛', name: 'Shadow Cat' },
  };

  const CAT_TYPES = ['tabby', 'siamese', 'persian', 'maine', 'shadow'];
  const SLOT_COUNT = 8;

  const $ = (id) => document.getElementById(id);

  let ws = null;
  let session = null;
  let selfPlayer = null;
  let allPlayers = [];

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
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
    const err = $('connect-error');
    err.classList.add('visible');
    $('error-message').textContent = msg;
  }

  function showGame() {
    $('loading').style.display = 'none';
    $('connect-error')?.classList.remove('visible');
    $('game')?.classList.add('active');
  }

  function exitToLauncher() {
    const target = session?.exitTarget || '/browser.html';
    window.location.href = target;
  }

  function send(event, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
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

  function renderPlayers() {
    const list = $('players-list');
    if (!list) return;
    list.innerHTML = '';

    allPlayers.forEach((p) => {
      const card = document.createElement('div');
      card.className =
        'player-card' +
        (p.username === selfPlayer?.username ? ' self' : '');
      card.innerHTML = `
        <span class="player-avatar">🐱</span>
        <div class="player-info">
          <div class="player-name">${escapeHtml(p.username)}</div>
          <div class="player-money">${formatMoney(p.money)} · R${p.rebirth ?? 0}</div>
        </div>
      `;
      list.appendChild(card);
    });

    if (allPlayers.length === 0) {
      list.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No other players</p>';
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function getCatDisplay(type) {
    return CAT_DISPLAY[type] || CAT_DISPLAY.tabby;
  }

  function estimateIncome(cat) {
    if (!cat) return 0;
    const base = { tabby: 10, siamese: 25, persian: 50, maine: 100, shadow: 250 };
    const mult = { tabby: 1, siamese: 1.2, persian: 1.5, maine: 1.8, shadow: 2 };
    const reb = 1 + (cat.rebirth ?? 0) * 0.25;
    return Math.floor((base[cat.type] || 10) * reb * (mult[cat.type] || 1));
  }

  function renderSlots() {
    const grid = $('slots-grid');
    if (!grid || !selfPlayer) return;
    grid.innerHTML = '';

    const cats = selfPlayer.cats || [];
    const pads = selfPlayer.padBalances || [];

    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = cats[i];
      const cat = slot?.cat;
      const padBal = pads[i] || 0;
      const display = cat ? getCatDisplay(cat.type) : null;
      const income = cat ? estimateIncome(cat) : 0;

      const card = document.createElement('div');
      card.className = 'slot-card';

      const catZone = document.createElement('div');
      catZone.className = 'cat-zone';
      if (cat) {
        catZone.innerHTML = `
          <span class="cat-emoji">${display.emoji}</span>
          <span class="cat-name">${display.name}</span>
          <span class="cat-income">+${formatMoney(income)}/s</span>
        `;
      } else {
        catZone.innerHTML = '<span class="cat-empty">Empty Slot</span>';
      }

      const padZone = document.createElement('div');
      padZone.className = 'pad-zone' + (cat ? '' : ' empty');
      padZone.innerHTML = `
        <div class="pad-label">Income Pad</div>
        <div class="pad-amount">${formatMoney(padBal)}</div>
        <div class="pad-hint">${cat && padBal > 0 ? 'Click to collect' : 'Waiting…'}</div>
      `;

      if (cat && padBal > 0) {
        padZone.addEventListener('click', () => {
          send('collectPad', { slotIndex: i });
        });
      }

      card.appendChild(catZone);
      card.appendChild(padZone);
      grid.appendChild(card);
    }
  }

  function applySelfUpdate(data) {
    if (!selfPlayer) return;
    if (data.money !== undefined) selfPlayer.money = data.money;
    if (data.rebirth !== undefined) selfPlayer.rebirth = data.rebirth;
    if (data.padBalances) selfPlayer.padBalances = data.padBalances;
    if (data.cats) selfPlayer.cats = data.cats;
    if (data.collected) {
      showToast(`Collected ${formatMoney(data.collected)}!`);
    }
    updateHud();
    renderSlots();
  }

  function handleSyncState(data) {
    if (data.players) {
      allPlayers = data.players;
      const me = findSelfInList(allPlayers);
      if (me) selfPlayer = me;
    }
    if (data.self) selfPlayer = data.self;
    updateHud();
    renderSlots();
    renderPlayers();
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
          updateHud();
          renderSlots();
          send('requestState');
          break;

        case 'syncState':
          handleSyncState(data);
          if (!document.getElementById('game')?.classList.contains('active')) {
            showGame();
          }
          break;

        case 'updateMoney':
          applySelfUpdate(data);
          break;

        case 'spawnCat':
          if (data.username === selfPlayer?.username) {
            send('requestState');
          }
          break;

        case 'playerJoined':
        case 'playerLeft':
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
      if (!selfPlayer) showError('Connection failed. Run: npm start');
    };

    ws.onclose = () => {
      if (!selfPlayer) {
        clearTimeout(timeout);
        showError('Disconnected from server.');
      }
    };
  }

  function findEmptySlot() {
    if (!selfPlayer?.cats) return 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!selfPlayer.cats[i]?.cat) return i;
    }
    return -1;
  }

  function initActions() {
    $('btn-exit')?.addEventListener('click', exitToLauncher);
    $('btn-retry-exit')?.addEventListener('click', exitToLauncher);

    $('btn-add-cat')?.addEventListener('click', () => {
      const idx = findEmptySlot();
      if (idx < 0) {
        showToast('All slots full!');
        return;
      }
      const type = CAT_TYPES[Math.floor(Math.random() * CAT_TYPES.length)];
      send('actionUpdate', {
        action: 'spawnCat',
        data: { slotIndex: idx, catType: type },
      });
      showToast(`Spawned ${getCatDisplay(type).name}!`);
    });

    $('btn-rebirth')?.addEventListener('click', () => {
      const cost = 1000 * ((selfPlayer?.rebirth ?? 0) + 1);
      if (!confirm(`Rebirth for ${formatMoney(cost)}? (+25% income per level)`)) return;
      send('actionUpdate', { action: 'rebirth' });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initActions();
    connect();
  });
})();
