require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const { PORT, HOST, TICK_MS, PERSIST_ON_DISCONNECT, PERSIST_DEBOUNCE_MS } = require('./server/config');
const { createPlayerStore } = require('./server/db/createStore');
const { rooms, getOrCreatePublicRoom, getOrCreatePrivateRoom, generateRoomCode } = require('./server/rooms');
const { tickIncome, collectPad, spawnCat, doRebirth, isUsernameTakenInRoom } = require('./server/playerLogic');

/** @type {import('./server/db/playerStore').PlayerStore} */
let playerStore;
let dbBackend = 'memory';
const clients = new Map(); // ws → { doc, room }

const app = express();

app.get('/', (_req, res) => {
  res.redirect('/browser.html');
});

app.use(express.static(path.join(__dirname)));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    database: dbBackend,
    players: clients.size,
    rooms: rooms.size,
  });
});

/** Database-ready export (for future backup / admin) */
app.get('/api/players/export', async (_req, res) => {
  const data = await playerStore.exportAll();
  res.json({ count: data.length, players: data });
});

app.post('/api/private-code', (_req, res) => {
  const code = generateRoomCode();
  getOrCreatePrivateRoom(code);
  res.json({ code });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function send(ws, event, payload = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ event, ...payload }));
  }
}

function broadcastRoom(room, event, payload, excludeWs = null) {
  const msg = JSON.stringify({ event, ...payload });
  for (const [ws] of room.players) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(msg);
  }
}

function syncRoom(room) {
  const players = [];
  for (const [, doc] of room.players) {
    players.push(playerStore.toSnapshot(doc));
  }
  broadcastRoom(room, 'syncState', { players, serverTime: Date.now() });
}

function persist(doc) {
  playerStore.scheduleSave(doc, PERSIST_DEBOUNCE_MS);
}

async function persistNow(doc) {
  await playerStore.flush(doc);
}

function removeClient(ws) {
  const meta = clients.get(ws);
  if (!meta) return;

  const { room, doc } = meta;
  if (room && doc) {
    room.players.delete(ws);
    doc.activeServerId = null;
    if (PERSIST_ON_DISCONNECT) persistNow(doc).catch(console.error);
    broadcastRoom(room, 'playerLeft', { username: doc.username });
    syncRoom(room);
    if (room.type === 'private' && room.players.size === 0) {
      rooms.delete(room.id);
    }
  }
  clients.delete(ws);
}

function startIncomeTick() {
  setInterval(() => {
    if (!playerStore) return;
    for (const room of rooms.values()) {
      let changed = false;
      for (const [ws, doc] of room.players) {
        const updated = tickIncome(doc);
        if (updated !== doc) {
          room.players.set(ws, updated);
          changed = true;
          persist(updated);
        }
      }
      if (changed && room.players.size > 0) {
        for (const [ws, doc] of room.players) {
          send(ws, 'updateMoney', {
            money: doc.money,
            padBalances: doc.slots.map((s) => s.padBalance),
            cats: doc.slots.map((s) => ({
              index: s.slotIndex,
              cat: s.cat,
              padBalance: s.padBalance,
            })),
          });
        }
      }
    }
  }, TICK_MS);
}

wss.on('connection', (ws) => {
  clients.set(ws, { doc: null, room: null });

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

async function handleJoinServer(ws, { username, serverType, roomCode }) {
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

  if (isUsernameTakenInRoom(room, name)) {
    send(ws, 'error', { message: 'Username already taken in this server' });
    return;
  }

  try {
    const doc = await playerStore.findOrCreate(name, { serverId: room.id });
    doc.activeServerId = room.id;
    doc.position = doc.position || { x: 0, z: 0 };

    room.players.set(ws, doc);
    clients.set(ws, { doc, room });
    await persistNow(doc);

    send(ws, 'joined', {
      roomId: room.id,
      roomType: room.type,
      roomCode: room.code,
      player: playerStore.toSnapshot(doc),
    });

    broadcastRoom(room, 'playerJoined', { player: playerStore.toSnapshot(doc) }, ws);
    syncRoom(room);
  } catch (err) {
    console.error('joinServer', err);
    send(ws, 'error', { message: 'Failed to load player data' });
  }
}

function handleRequestState(ws) {
  const meta = clients.get(ws);
  if (!meta?.room) {
    send(ws, 'error', { message: 'Not in a server' });
    return;
  }
  syncRoom(meta.room);
  send(ws, 'syncState', {
    players: [...meta.room.players.values()].map((d) => playerStore.toSnapshot(d)),
    self: meta.doc ? playerStore.toSnapshot(meta.doc) : null,
    serverTime: Date.now(),
  });
}

function handleCollectPad(ws, { slotIndex }) {
  const meta = clients.get(ws);
  if (!meta?.doc || !meta.room) {
    send(ws, 'error', { message: 'Not in a server' });
    return;
  }

  const idx = Number(slotIndex);
  const { doc, collected } = collectPad(meta.doc, idx);
  if (collected <= 0) return;

  meta.doc = doc;
  meta.room.players.set(ws, doc);
  persist(doc);

  send(ws, 'updateMoney', {
    money: doc.money,
    padBalances: doc.slots.map((s) => s.padBalance),
    collected,
    slotIndex: idx,
  });

  broadcastRoom(meta.room, 'syncState', {
    players: [...meta.room.players.values()].map((d) => playerStore.toSnapshot(d)),
    serverTime: Date.now(),
  });
}

function handleActionUpdate(ws, { action, data }) {
  const meta = clients.get(ws);
  if (!meta?.doc || !meta.room) return;

  let doc = meta.doc;

  switch (action) {
    case 'spawnCat': {
      doc = spawnCat(doc, data?.slotIndex, data?.catType);
      meta.doc = doc;
      meta.room.players.set(ws, doc);
      persist(doc);
      broadcastRoom(meta.room, 'spawnCat', {
        username: doc.username,
        slotIndex: data?.slotIndex,
      });
      syncRoom(meta.room);
      break;
    }
    case 'rebirth': {
      const result = doRebirth(doc);
      if (result.error) {
        send(ws, 'error', { message: result.error });
        return;
      }
      doc = result.doc;
      meta.doc = doc;
      meta.room.players.set(ws, doc);
      persist(doc);
      send(ws, 'updateMoney', {
        money: doc.money,
        rebirth: doc.rebirth,
        padBalances: doc.slots.map((s) => s.padBalance),
      });
      syncRoom(meta.room);
      break;
    }
    case 'setPosition': {
      doc.position = { x: data.x, z: data.z };
      meta.doc = doc;
      meta.room.players.set(ws, doc);
      broadcastRoom(meta.room, 'playerMoved', {
        username: doc.username,
        position: doc.position,
      });
      break;
    }
    default:
      break;
  }
}

async function start() {
  const created = await createPlayerStore();
  playerStore = created.store;
  dbBackend = created.backend;
  startIncomeTick();

  server.listen(PORT, HOST, () => {
    console.log(`Rob a Cat server listening on ${HOST}:${PORT} (db: ${dbBackend})`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
