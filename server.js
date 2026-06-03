const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const { PORT, HOST, TICK_MS, SLOT_COUNT } = require('./server/config');
const { rooms, getOrCreatePublicRoom, getOrCreatePrivateRoom, generateRoomCode } = require('./server/rooms');
const { tickIncome, collectPad, spawnCat, doRebirth, isUsernameTakenInRoom } = require('./server/playerLogic');
const { CAT_CATALOG, rebirthCost } = require('./server/economy');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'browser.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game', 'game.html'));
});

// Player data storage (in-memory for now)
const players = new Map();

// User password storage (in-memory for now, will be replaced with Neon DB)
const userPasswords = new Map();

// Server tick loop for income generation
setInterval(() => {
  for (const [roomId, room] of rooms) {
    for (const [ws, player] of room.players) {
      if (player.doc) {
        const updated = tickIncome(player.doc);
        if (updated !== player.doc) {
          player.doc = updated;
          
          // Send update to player
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              event: 'updateMoney',
              money: player.doc.money,
              padBalances: player.doc.slots.map(s => s.padBalance)
            }));
          }
        }
      }
    }
  }
}, TICK_MS);

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPlayer = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      switch (message.event) {
        case 'joinServer': {
          const { username, password, serverType, roomCode } = message;
          
          // Validate password
          if (!password || password.length < 4) {
            ws.send(JSON.stringify({
              event: 'error',
              message: 'Password must be at least 4 characters'
            }));
            return;
          }
          
          // Check if user exists and verify password
          if (userPasswords.has(username)) {
            const storedPassword = userPasswords.get(username);
            if (storedPassword !== password) {
              ws.send(JSON.stringify({
                event: 'error',
                message: 'Incorrect password'
              }));
              return;
            }
          } else {
            // New user - store password
            userPasswords.set(username, password);
          }
          
          // Get or create room
          if (serverType === 'private' && roomCode) {
            currentRoom = getOrCreatePrivateRoom(roomCode);
          } else {
            currentRoom = getOrCreatePublicRoom();
          }
          
          // Check if username is taken in this room
          if (isUsernameTakenInRoom(currentRoom, username)) {
            ws.send(JSON.stringify({
              event: 'error',
              message: 'Username already taken in this room'
            }));
            return;
          }
          
          // Create player document
          const playerDoc = {
            id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            username,
            money: 100,
            rebirth: 0,
            slots: Array.from({ length: SLOT_COUNT }, (_, i) => ({
              slotIndex: i,
              cat: null,
              padBalance: 0,
              updatedAt: new Date().toISOString()
            })),
            cosmetics: {},
            serverId: currentRoom.id
          };
          
          currentPlayer = { ws, doc: playerDoc };
          currentRoom.players.set(ws, currentPlayer);
          players.set(ws, currentPlayer);
          
          // Send joined event
          ws.send(JSON.stringify({
            event: 'joined',
            player: {
              id: playerDoc.id,
              username: playerDoc.username,
              money: playerDoc.money,
              rebirth: playerDoc.rebirth,
              cats: playerDoc.slots.map(s => ({ cat: s.cat, padBalance: s.padBalance })),
              padBalances: playerDoc.slots.map(s => s.padBalance)
            }
          }));
          
          // Notify other players
          broadcastToRoom(currentRoom, {
            event: 'playerJoined',
            player: {
              id: playerDoc.id,
              username: playerDoc.username,
              money: playerDoc.money,
              rebirth: playerDoc.rebirth
            }
          }, ws);
          
          console.log(`Player ${username} joined ${currentRoom.id}`);
          break;
        }
        
        case 'requestState': {
          if (!currentRoom || !currentPlayer) return;
          
          const playersList = [];
          for (const [pWs, p] of currentRoom.players) {
            playersList.push({
              id: p.doc.id,
              username: p.doc.username,
              money: p.doc.money,
              rebirth: p.doc.rebirth,
              cats: p.doc.slots.map(s => ({ cat: s.cat, padBalance: s.padBalance })),
              padBalances: p.doc.slots.map(s => s.padBalance)
            });
          }
          
          ws.send(JSON.stringify({
            event: 'syncState',
            players: playersList,
            self: {
              id: currentPlayer.doc.id,
              username: currentPlayer.doc.username,
              money: currentPlayer.doc.money,
              rebirth: currentPlayer.doc.rebirth,
              cats: currentPlayer.doc.slots.map(s => ({ cat: s.cat, padBalance: s.padBalance })),
              padBalances: currentPlayer.doc.slots.map(s => s.padBalance)
            }
          }));
          break;
        }
        
        case 'collectPad': {
          if (!currentPlayer) return;
          const { slotIndex } = message;
          const result = collectPad(currentPlayer.doc, slotIndex);
          
          if (result.collected > 0) {
            currentPlayer.doc = result.doc;
            ws.send(JSON.stringify({
              event: 'updateMoney',
              money: currentPlayer.doc.money,
              padBalances: currentPlayer.doc.slots.map(s => s.padBalance),
              collected: result.collected
            }));
          }
          break;
        }
        
        case 'actionUpdate': {
          if (!currentPlayer) return;
          const { action, data } = message;
          
          if (action === 'spawnCat') {
            const { slotIndex, catType } = data;
            currentPlayer.doc = spawnCat(currentPlayer.doc, slotIndex, catType);
            ws.send(JSON.stringify({
              event: 'updateMoney',
              money: currentPlayer.doc.money,
              cats: currentPlayer.doc.slots.map(s => ({ cat: s.cat, padBalance: s.padBalance })),
              padBalances: currentPlayer.doc.slots.map(s => s.padBalance)
            }));
          } else if (action === 'rebirth') {
            const result = doRebirth(currentPlayer.doc);
            if (result.error) {
              ws.send(JSON.stringify({
                event: 'error',
                message: result.error
              }));
            } else {
              currentPlayer.doc = result.doc;
              ws.send(JSON.stringify({
                event: 'updateMoney',
                money: currentPlayer.doc.money,
                rebirth: currentPlayer.doc.rebirth,
                cats: currentPlayer.doc.slots.map(s => ({ cat: s.cat, padBalance: s.padBalance })),
                padBalances: currentPlayer.doc.slots.map(s => s.padBalance)
              }));
            }
          }
          break;
        }
        
        case 'playerMoved': {
          if (!currentPlayer) return;
          const { position } = message;
          // Store player position for multiplayer sync
          currentPlayer.position = position;
          
          // Broadcast to other players
          broadcastToRoom(currentRoom, {
            event: 'playerMoved',
            playerId: currentPlayer.doc.id,
            position
          }, ws);
          break;
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  ws.on('close', () => {
    if (currentRoom && currentPlayer) {
      currentRoom.players.delete(ws);
      players.delete(ws);
      
      // Notify other players
      broadcastToRoom(currentRoom, {
        event: 'playerLeft',
        playerId: currentPlayer.doc.id,
        username: currentPlayer.doc.username
      });
      
      console.log(`Player ${currentPlayer.doc.username} disconnected`);
      
      // Clean up empty rooms (except public)
      if (currentRoom.type !== 'public' && currentRoom.players.size === 0) {
        rooms.delete(currentRoom.id);
        console.log(`Room ${currentRoom.id} closed`);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function broadcastToRoom(room, message, excludeWs = null) {
  const data = JSON.stringify(message);
  for (const [ws, player] of room.players) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`🐱 Rob a Cat server running on http://${HOST}:${PORT}`);
  console.log(`🎮 Game client: http://${HOST}:${PORT}/game`);
  console.log(`🌐 Web launcher: http://${HOST}:${PORT}`);
});
