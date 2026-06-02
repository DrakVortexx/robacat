# 🐱 Rob a Cat

Multiplayer economy game with a web launcher, Electron desktop launcher, Node.js backend, and separate game client.

**Repository:** [github.com/DrakVortexx/robacat](https://github.com/DrakVortexx/robacat)

## Project structure

```
browser.html      → Web launcher
app.html          → Electron desktop launcher
launcher.js       → Shared launcher logic
launcher.css      → Shared launcher styles
server.js         → Node.js + Express + WebSocket server
electron-main.js  → Optional Electron shell

game/
  game.html       → Game client
  game.js
  game.css
  assets/
  sounds/
```

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:3847/browser.html** in your browser.

| Entry point | URL |
|-------------|-----|
| Web launcher | http://localhost:3847/browser.html |
| Desktop launcher | http://localhost:3847/app.html |
| Game (after Play) | http://localhost:3847/game/game.html |

## Electron (optional)

```bash
npm install --save-dev electron
npm start          # terminal 1
npm run electron   # terminal 2 (add script below if needed)
```

Or run: `npx electron electron-main.js` while the server is running.

## How it works

1. **Launchers** (`browser.html` / `app.html`) — login, pick public or private server, connect via WebSocket, then redirect to the game.
2. **Server** (`server.js`) — authoritative economy: cat values, income ticks every 1s, pad balances, rebirth, rooms.
3. **Game** (`game/game.html`) — 8-slot base, green income pads, collect money, see other players live.

### Income formula

```
income = catValue × rebirthMultiplier × traitMultiplier
```

Pads accumulate income each second; click a pad to collect into your wallet.

### WebSocket events

| Client → Server | Server → Client |
|-----------------|-----------------|
| `joinServer` | `syncState` |
| `requestState` | `updateMoney` |
| `collectPad` | `spawnCat` |
| `actionUpdate` | `playerJoined` |

## Future-ready

Architecture supports cosmetics store, VIP servers, paid boosts, and live events without restructuring core folders.
