module.exports = {
  PORT: process.env.PORT || 3847,
  HOST: process.env.HOST || '0.0.0.0',
  TICK_MS: 1000,
  SLOT_COUNT: 8,
  DATA_VERSION: 1,
  PERSIST_ON_DISCONNECT: true,
  PERSIST_DEBOUNCE_MS: 2000,
};
