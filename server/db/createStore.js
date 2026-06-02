const { PlayerStore, MemoryAdapter } = require('./playerStore');
const { PostgresAdapter } = require('./postgresAdapter');

/**
 * @returns {Promise<{ store: import('./playerStore').PlayerStore, backend: string }>}
 */
async function createPlayerStore() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const adapter = new PostgresAdapter(url);
    await adapter.init();
    console.log('Database: Neon/PostgreSQL connected');
    return { store: new PlayerStore(adapter), backend: 'postgres' };
  }

  console.log('Database: in-memory (set DATABASE_URL for Neon PostgreSQL)');
  return { store: new PlayerStore(new MemoryAdapter()), backend: 'memory' };
}

module.exports = { createPlayerStore };
