/**
 * Shared launcher logic for browser.html and app.html
 */
(function () {
  const STORAGE_USER = 'rac_username';
  const STORAGE_SETTINGS = 'rac_settings';
  const SESSION_GAME = 'rac_game_session';

  const screens = {
    login: document.getElementById('screen-login'),
    menu: document.getElementById('screen-menu'),
    servers: document.getElementById('screen-servers'),
    cosmetics: document.getElementById('screen-cosmetics'),
    settings: document.getElementById('screen-settings'),
  };

  const els = {
    usernameInput: document.getElementById('username-input'),
    loginBtn: document.getElementById('login-btn'),
    displayName: document.getElementById('display-name'),
    status: document.getElementById('connection-status'),
    privateCode: document.getElementById('private-code'),
    generateCode: document.getElementById('generate-code'),
    playPublic: document.getElementById('play-public'),
    playPrivate: document.getElementById('play-private'),
    errorBox: document.getElementById('error-box'),
  };

  let ws = null;
  let username = localStorage.getItem(STORAGE_USER) || '';
  const isElectron = document.body.dataset.launcher === 'electron';
  const gameExitTarget = isElectron ? '/app.html' : '/browser.html';

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function showScreen(name) {
    Object.values(screens).forEach((s) => s?.classList.remove('active'));
    screens[name]?.classList.add('active');
    hideError();
  }

  function showError(msg) {
    if (!els.errorBox) return;
    els.errorBox.textContent = msg;
    els.errorBox.hidden = false;
  }

  function hideError() {
    if (els.errorBox) {
      els.errorBox.hidden = true;
      els.errorBox.textContent = '';
    }
  }

  function setStatus(text, type = '') {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = 'status ' + type;
  }

  function closeWs() {
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      ws = null;
    }
  }

  function saveSession(roomData) {
    sessionStorage.setItem(
      SESSION_GAME,
      JSON.stringify({
        username,
        wsUrl: getWsUrl(),
        roomId: roomData.roomId,
        roomType: roomData.roomType,
        roomCode: roomData.roomCode,
        exitTarget: gameExitTarget,
        joinedAt: Date.now(),
      })
    );
  }

  function connectAndJoin(serverType, roomCode) {
    hideError();
    setStatus('Connecting…', 'pending');
    closeWs();

    return new Promise((resolve, reject) => {
      const url = getWsUrl();
      let settled = false;

      const fail = (msg) => {
        if (settled) return;
        settled = true;
        closeWs();
        setStatus('Disconnected', 'error');
        showError(msg);
        reject(new Error(msg));
      };

      try {
        ws = new WebSocket(url);
      } catch (e) {
        fail('Could not open WebSocket connection.');
        return;
      }

      const timeout = setTimeout(() => {
        fail('Connection timed out. Is the server running?');
      }, 10000);

      ws.onopen = () => {
        setStatus('Joining server…', 'pending');
        ws.send(
          JSON.stringify({
            event: 'joinServer',
            username,
            serverType,
            roomCode: roomCode || undefined,
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

        if (data.event === 'error') {
          clearTimeout(timeout);
          fail(data.message || 'Server rejected connection');
          return;
        }

        if (data.event === 'joined') {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          setStatus('Connected!', 'ok');
          saveSession({
            roomId: data.roomId,
            roomType: data.roomType,
            roomCode: data.roomCode,
          });
          resolve(data);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        fail('Connection failed. Start the server with: npm start');
      };

      ws.onclose = () => {
        if (!settled) {
          clearTimeout(timeout);
          fail('Connection closed unexpectedly.');
        }
      };
    });
  }

  async function enterGame(serverType, roomCode) {
    try {
      await connectAndJoin(serverType, roomCode);
      closeWs();
      window.location.href = '/game/game.html';
    } catch {
      /* error already shown */
    }
  }

  function initLogin() {
    if (username && els.usernameInput) {
      els.usernameInput.value = username;
    }

    els.loginBtn?.addEventListener('click', () => {
      const name = els.usernameInput?.value.trim();
      if (!name || name.length < 2) {
        showError('Enter a username (2+ characters).');
        return;
      }
      username = name;
      localStorage.setItem(STORAGE_USER, username);
      if (els.displayName) els.displayName.textContent = username;
      showScreen('menu');
      hideError();
    });

    if (username.length >= 2) {
      if (els.displayName) els.displayName.textContent = username;
      showScreen('menu');
    } else {
      showScreen('login');
    }
  }

  function initMenu() {
    document.getElementById('btn-play')?.addEventListener('click', () => showScreen('servers'));
    document.getElementById('btn-cosmetics')?.addEventListener('click', () => showScreen('cosmetics'));
    document.getElementById('btn-settings')?.addEventListener('click', () => showScreen('settings'));
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_USER);
      username = '';
      showScreen('login');
    });

    document.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.back || 'menu';
        showScreen(target);
      });
    });
  }

  function initServers() {
    els.playPublic?.addEventListener('click', () => enterGame('public'));

    els.playPrivate?.addEventListener('click', () => {
      const code = els.privateCode?.value.trim();
      if (!code || code.length < 4) {
        showError('Enter a private room code (4+ characters).');
        return;
      }
      enterGame('private', code);
    });

    els.generateCode?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/private-code', { method: 'POST' });
        const data = await res.json();
        if (els.privateCode) els.privateCode.value = data.code;
      } catch {
        showError('Could not generate code. Is the server running?');
      }
    });
  }

  function initSettings() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || '{}');
    const vol = document.getElementById('setting-volume');
    const sfx = document.getElementById('setting-sfx');
    if (vol) vol.value = saved.volume ?? 80;
    if (sfx) sfx.value = saved.sfx ?? 80;

    document.getElementById('save-settings')?.addEventListener('click', () => {
      localStorage.setItem(
        STORAGE_SETTINGS,
        JSON.stringify({
          volume: Number(vol?.value ?? 80),
          sfx: Number(sfx?.value ?? 80),
        })
      );
      showScreen('menu');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initMenu();
    initServers();
    initSettings();
  });
})();
