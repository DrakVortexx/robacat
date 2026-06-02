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

## Electron desktop (movable shell)

Use **`electron-shell/`** — a separate folder you can copy out of this repo. It builds a desktop app that iframes `https://robacatd.onrender.com/app.html` (no local server required).

```bash
cd electron-shell
npm install
npm start              # dev window
npm run dist:mac       # Universal macOS .dmg
```

See `electron-shell/README.md` for details.

Legacy local dev: `electron-main.js` at repo root (loads localhost while `npm start` runs).

## How it works

1. **Launchers** (`browser.html` / `app.html`) — login, pick public or private server, connect via WebSocket, then redirect to the game.
2. **Server** (`server.js`) — authoritative economy: cat values, income ticks every 1s, pad balances, rebirth, rooms.
3. **Game** (`game/game.html`) — **3D** base (Three.js), 8 slots, green income pads (click in 3D), orbit camera, other players’ bases around you.

### Player data (database-ready)

Server data lives in `server/db/`:

- **`PlayerDocument`** — normalized JSON per account (UUID, slots, cosmetics, timestamps)
- **`PlayerStore`** — memory backend today; swap for Postgres/Mongo via adapter
- **`schema.sql`** — example PostgreSQL tables
- **`GET /api/players/export`** — export all accounts for backup/migration

Progress **persists by username** — uses **Neon PostgreSQL** when `DATABASE_URL` is set, otherwise in-memory.

### Connect Neon (manual)

1. Create a project at [neon.tech](https://neon.tech) (not Google).
2. Copy the **production branch** connection string (`postgresql://...?sslmode=require`).
3. Local — create `.env` from `.env.example` and paste:

   ```bash
   cp .env.example .env
   # edit .env → DATABASE_URL=postgresql://...
   npm install
   npm run db:migrate
   npm start
   ```

4. **Render** — Web Service → **Environment** → add `DATABASE_URL` with the same string → redeploy.

5. Verify: `GET /api/health` should show `"database": "postgres"`.

Tables are created automatically on startup (`server/db/schema.sql`).

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

## Deploy on Render (Node.js Web Service)

This app is a single Node process: Express serves the static site and WebSockets run on the same port (required for Render).

### Option A — Dashboard

1. Push latest code to [github.com/DrakVortexx/robacat](https://github.com/DrakVortexx/robacat).
2. In [Render](https://render.com), **New → Web Service**.
3. Connect the `robacat` repo.
4. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/api/health`
5. Deploy. Open `https://YOUR-SERVICE.onrender.com/browser.html`.

WebSockets use `wss://` automatically when the site is served over HTTPS (launchers use `location.host`).

### Option B — Blueprint (`render.yaml`)

1. **New → Blueprint** in Render.
2. Select this repo — Render reads `render.yaml` and creates the web service.

### Render notes

| Topic | Detail |
|--------|--------|
| **Port** | Render sets `PORT`; `server.js` already uses it. |
| **Electron** | Desktop `app.html` must load your Render URL (not localhost) unless you run the server locally. |
| **Free tier** | Service sleeps after ~15 min idle; first visit may take ~1 min to wake. WebSocket players disconnect on sleep. |
| **Player data** | Stored in memory only — resets on redeploy or instance restart. Use a database later for persistence. |

## Future-ready

Architecture supports cosmetics store, VIP servers, paid boosts, and live events without restructuring core folders.
