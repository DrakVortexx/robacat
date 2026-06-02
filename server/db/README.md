# Player data layer (database-ready)

Player state uses **`PlayerDocument`** — a normalized shape that maps to SQL/NoSQL without refactors.

## Document shape

```json
{
  "id": "uuid",
  "username": "Player1",
  "money": 0,
  "rebirth": 0,
  "slotCount": 8,
  "activeServerId": "public",
  "slots": [
    { "slotIndex": 0, "cat": { "type": "tabby", "rebirth": 0 }, "padBalance": 0, "updatedAt": "..." }
  ],
  "cosmetics": [{ "id": "hat_vip", "equipped": false, "acquiredAt": "..." }],
  "meta": { "dataVersion": 1, "createdAt": "...", "updatedAt": "...", "lastSeenAt": "..." }
}
```

## Suggested tables

| Table | Purpose |
|-------|---------|
| `accounts` | Core row per player (`id`, `username`, `money`, `rebirth`, timestamps) |
| `account_slots` | One row per slot (`account_id`, `slot_index`, `cat_type`, `pad_balance`) |
| `account_cosmetics` | Owned cosmetics |
| `sessions` | Active WebSocket / room binding (optional) |

Use `playerStore.toSqlRows(doc)` for migration scripts.

## Swap storage backend

1. Implement adapter with `findByUsername`, `findById`, `insert`, `update`, `delete`, `listAll`.
2. `new PlayerStore(new PostgresAdapter(pool))` in `server.js`.

## Neon / PostgreSQL (production)

Set `DATABASE_URL` to your Neon connection string. The server uses **`PostgresAdapter`** automatically.

```bash
cp .env.example .env
# paste Neon connection string into DATABASE_URL
npm run db:migrate   # optional — tables also auto-create on start
npm start
```

Today without `DATABASE_URL`: **`MemoryAdapter`** (in-memory only).

## API

- `GET /api/players/export` — JSON export of all accounts (admin/backup).
