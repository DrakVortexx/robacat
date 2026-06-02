#!/usr/bin/env node
/**
 * Run database migrations against Neon/Postgres.
 * Usage: DATABASE_URL="postgresql://..." npm run db:migrate
 */
require('dotenv').config();
const { PostgresAdapter } = require('../server/db/postgresAdapter');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL in .env or your environment.');
    process.exit(1);
  }
  const adapter = new PostgresAdapter(url);
  await adapter.init();
  console.log('Migrations applied (accounts, account_slots, account_cosmetics).');
  await adapter.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
