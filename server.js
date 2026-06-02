const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3847;
const TICK_MS = 1000;
const SLOT_COUNT = 8;

// ─── Economy config (server-authoritative) ───────────────────────────────────
const CAT_CATALOG = {
  tabby: { name: 'Tabby', value: 10, trait: 'none', traitMultiplier: 1 },
  siamese: { name: 'Siamese', value: 25, trait: 'lucky', traitMultiplier: 1.2 },
  persian: { name: 'Persian', value: 50, trait: 'royal', traitMultiplier: 1.5 },
  maine: { name: 'Maine Coon', value: 100, trait: 'giant', traitMultiplier: 1.8 },
  shadow: { name: 'Shadow Cat', value: 250, trait: 'stealth', traitMultiplier: 2 },
};

const REBIRTH_MULTIPLIER_BASE = 1;
const REBIRTH_MULTIPLIER_STEP = 0.25;

function rebirthMultiplier(rebirth) {
  return REBIRTH_MULTIPLIER_BASE + rebirth * REBIRTH_MULTIPLIER_STEP;
}

function calcIncome(cat) {
  if (!cat) return 0;
  const def = CAT_CATALOG[cat.type] || CAT_CATALOG.tabby;
  return Math.floor(def.value * rebirthMultiplier(cat.rebirth ?? 0) * def.traitMultiplier);
}

function defaultSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    index: i,
    cat: i === 0 ? { type: 'tabby', rebirth: 0 } : null,
    padBalance: 0,
  }));
}

function createPlayer(username, serverId) {
  return {
    id: `${serverId}:${username}:${Date.now()}`,
    username,
    money: 0,
    rebirth: 0,
    slots: SLOT_COUNT,
    cats: defaultSlots(),
    cosmetics: [],
    serverId,
    padBalances: Array(SLOT_COUNT).fill(0),
  };
}

function playerSnapshot(p) {
  return {
    id: p.id,
    username: p.username,
    money: p.money,
    rebirth: p.rebirth,
    slots: p.slots,
    cats: p.cats,
    cosmetics: p.cosmetics,
    serverId: p.serverId,
    padBalances: p.padBalances,
  };
}

// ─── Room manager ────────────────────────────────────────────────────────────
const rooms = new Map(); // roomId -> { type, code?, players: Map<ws, player> }

function getOrCreatePublicRoom() {
  const id = 'public';
  if (!rooms.has(id)) {
    rooms.set(id, { id, type: 'public', code: null, players: new Map() });
  }
  return rooms.get(id);
}

function getOrCreatePrivateRoom(code) {
  const id = `private:${code.toUpperCase()}`;
  if (!rooms.has(id)) {
    rooms.set(id, { id, type: 'private', code: code.toUpperCase(), players: new Map() });
  }
  return rooms.get(id);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── Express static ──────────────────────────────────────────────────────────
const app = express();

app.get('/', (_req, res) => {
  res.redirect('/browser.html');
});

app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map(); // ws -> { player, room }

function broadcastRoom(room, event, payload, excludeWs = null) {
  const msg = JSON.stringify({ event, ...payload });
  for (const [ws] of room.players) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function send(ws, event, payload = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ event, ...payload }));
  }
}

function syncRoom(room) {
  const players = [];
  for (const [, player] of room.players) {
    players.push(playerSnapshot(player));
  }
  broadcastRoom(room, 'syncState', { players, serverTime: Date.now() });
}

function removeClient(ws) {
  const meta = clients.get(ws);
  if (!meta) return;
  const { room, player } = meta;
  if (room && player) {
    room.players.delete(ws);
    broadcastRoom(room, 'playerLeft', { username: player.username });
    syncRoom(room);
    if (room.type === 'private' && room.players.size === 0) {
      rooms.delete(room.id);
    }
  }
  clients.delete(ws);
}

// ─── Tick loop (income generation) ───────────────────────────────────────────
setInterval(() => {
  for (const room of rooms.values()) {
    let changed = false;
    for (const [, player] of room.players) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const slot = player.cats[i];
        if (slot && slot.cat) {
          const income = calcIncome(slot.cat);
          player.padBalances[i] = (player.padBalances[i] || 0) + income;
          slot.padBalance = player.padBalances[i];
          changed = true;
        }
      }
    }
    if (changed && room.players.size > 0) {
      for (const [ws, player] of room.players) {
        send(ws, 'updateMoney', {
          money: player.money,
          padBalances: player.padBalances,
          cats: player.cats,
        });
      }
    }
  }
}, TICK_MS);

// ─── WebSocket handlers ──────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  clients.set(ws, { player: null, room: null });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      send(ws, 'error', { message: 'Invalid message format' });
      return;
    }

    const { event, ...payload } = data;

    switch (event) {
      case 'joinServer':
        handleJoinServer(ws, payload);
        break;
      case 'requestState':
        handleRequestState(ws);
        break;
      case 'collectPad':
        handleCollectPad(ws, payload);
        break;
      case 'actionUpdate':
        handleActionUpdate(ws, payload);
        break;
      default:
        send(ws, 'error', { message: `Unknown event: ${event}` });
    }
  });

  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});

function handleJoinServer(ws, { username, serverType, roomCode }) {
  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    send(ws, 'error', { message: 'Username must be at least 2 characters' });
    return;
  }

  const name = username.trim().slice(0, 20);
  let room;

  if (serverType === 'private') {
    if (!roomCode || roomCode.length < 4) {
      send(ws, 'error', { message: 'Private server requires a room code (4+ chars)' });
      return;
    }
    room = getOrCreatePrivateRoom(roomCode);
  } else {
    room = getOrCreatePublicRoom();
  }

  for (const [, p] of room.players) {
    if (p.username.toLowerCase() === name.toLowerCase()) {
      send(ws, 'error', { message: 'Username already taken in this server' });
      return;
    }
  }

  const player = createPlayer(name, room.id);
  room.players.set(ws, player);
  clients.set(ws, { player, room });

  send(ws, 'joined', {
    roomId: room.id,
    roomType: room.type,
    roomCode: room.code,
    player: playerSnapshot(player),
  });

  broadcastRoom(room, 'playerJoined', { player: playerSnapshot(player) }, ws);
  syncRoom(room);
}

function handleRequestState(ws) {
  const meta = clients.get(ws);
  if (!meta?.room) {
    send(ws, 'error', { message: 'Not in a server' });
    return;
  }
  syncRoom(meta.room);
  send(ws, 'syncState', {
    players: [...meta.room.players.values()].map(playerSnapshot),
    self: meta.player ? playerSnapshot(meta.player) : null,
    serverTime: Date.now(),
  });
}

function handleCollectPad(ws, { slotIndex }) {
  const meta = clients.get(ws);
  if (!meta?.player || !meta.room) {
    send(ws, 'error', { message: 'Not in a server' });
    return;
  }

  const idx = Number(slotIndex);
  if (idx < 0 || idx >= SLOT_COUNT) {
    send(ws, 'error', { message: 'Invalid slot' });
    return;
  }

  const player = meta.player;
  const amount = player.padBalances[idx] || 0;
  if (amount <= 0) return;

  player.money += amount;
  player.padBalances[idx] = 0;
  if (player.cats[idx]) {
    player.cats[idx].padBalance = 0;
  }

  send(ws, 'updateMoney', {
    money: player.money,
    padBalances: player.padBalances,
    collected: amount,
    slotIndex: idx,
  });

  broadcastRoom(meta.room, 'syncState', {
    players: [...meta.room.players.values()].map(playerSnapshot),
    serverTime: Date.now(),
  });
}

function handleActionUpdate(ws, { action, data }) {
  const meta = clients.get(ws);
  if (!meta?.player || !meta.room) return;

  const player = meta.player;

  switch (action) {
    case 'spawnCat': {
      const { slotIndex, catType } = data || {};
      const idx = Number(slotIndex);
      if (idx < 0 || idx >= SLOT_COUNT) return;
      const type = catType && CAT_CATALOG[catType] ? catType : 'tabby';
      player.cats[idx] = {
        index: idx,
        cat: { type, rebirth: player.rebirth },
        padBalance: player.padBalances[idx] || 0,
      };
      broadcastRoom(meta.room, 'spawnCat', {
        username: player.username,
        slotIndex: idx,
        cat: player.cats[idx],
      });
      syncRoom(meta.room);
      break;
    }
    case 'rebirth': {
      const cost = 1000 * (player.rebirth + 1);
      if (player.money < cost) {
        send(ws, 'error', { message: `Need $${cost} to rebirth` });
        return;
      }
      player.money -= cost;
      player.rebirth += 1;
      for (const slot of player.cats) {
        if (slot?.cat) slot.cat.rebirth = player.rebirth;
      }
      send(ws, 'updateMoney', {
        money: player.money,
        rebirth: player.rebirth,
        padBalances: player.padBalances,
      });
      syncRoom(meta.room);
      break;
    }
    default:
      break;
  }
}

// Health check for launchers
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, players: clients.size, rooms: rooms.size });
});

app.post('/api/private-code', (_req, res) => {
  const code = generateRoomCode();
  getOrCreatePrivateRoom(code);
  res.json({ code });
});

const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Rob a Cat server listening on ${HOST}:${PORT}`);
});
