/**
 * Database-ready document shapes for Rob a Cat.
 * Maps 1:1 to future tables: accounts, slots, cosmetics, sessions.
 *
 * Suggested SQL (example):
 *   accounts(id, username UNIQUE, money, rebirth, slot_count, data_version, created_at, updated_at, last_seen_at)
 *   account_slots(account_id, slot_index, cat_type, cat_rebirth, pad_balance)
 *   account_cosmetics(account_id, cosmetic_id, equipped, acquired_at)
 */

const { SLOT_COUNT, DATA_VERSION } = require('../config');
const { randomUUID } = require('crypto');

/**
 * @typedef {Object} CatRecord
 * @property {string|null} type
 * @property {number} rebirth
 */

/**
 * @typedef {Object} SlotRecord
 * @property {number} slotIndex
 * @property {CatRecord|null} cat
 * @property {number} padBalance
 * @property {string} updatedAt ISO-8601
 */

/**
 * @typedef {Object} CosmeticRecord
 * @property {string} id
 * @property {boolean} equipped
 * @property {string} acquiredAt
 */

/**
 * @typedef {Object} PlayerDocument
 * @property {string} id UUID — primary key (accounts.id)
 * @property {string} username UNIQUE key for login
 * @property {number} money
 * @property {number} rebirth
 * @property {number} slotCount
 * @property {string|null} activeServerId room id while online
 * @property {SlotRecord[]} slots
 * @property {CosmeticRecord[]} cosmetics
 * @property {Object} meta
 */

function nowIso() {
  return new Date().toISOString();
}

function defaultSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, slotIndex) => ({
    slotIndex,
    cat: slotIndex === 0 ? { type: 'tabby', rebirth: 0 } : null,
    padBalance: 0,
    updatedAt: nowIso(),
  }));
}

function createPlayerDocument(username, { serverId = null } = {}) {
  const ts = nowIso();
  return {
    id: randomUUID(),
    username: username.trim().slice(0, 20),
    money: 0,
    rebirth: 0,
    slotCount: SLOT_COUNT,
    activeServerId: serverId,
    slots: defaultSlots(),
    cosmetics: [],
    meta: {
      dataVersion: DATA_VERSION,
      createdAt: ts,
      updatedAt: ts,
      lastSeenAt: ts,
    },
  };
}

/** Normalize legacy in-memory shape → PlayerDocument */
function normalizePlayer(input) {
  if (input?.meta?.dataVersion) return touchUpdated(input);

  const slots = [];
  const legacyCats = input.cats || [];
  const padBalances = input.padBalances || [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const legacy = legacyCats[i];
    slots.push({
      slotIndex: i,
      cat: legacy?.cat
        ? { type: legacy.cat.type, rebirth: legacy.cat.rebirth ?? input.rebirth ?? 0 }
        : null,
      padBalance: padBalances[i] ?? legacy?.padBalance ?? 0,
      updatedAt: nowIso(),
    });
  }

  return touchUpdated({
    id: input.id || randomUUID(),
    username: input.username,
    money: input.money ?? 0,
    rebirth: input.rebirth ?? 0,
    slotCount: input.slots ?? SLOT_COUNT,
    activeServerId: input.serverId ?? input.activeServerId ?? null,
    slots,
    cosmetics: (input.cosmetics || []).map((c) =>
      typeof c === 'string'
        ? { id: c, equipped: false, acquiredAt: nowIso() }
        : c
    ),
    meta: input.meta || {
      dataVersion: DATA_VERSION,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    },
  });
}

function touchUpdated(doc) {
  const ts = nowIso();
  return {
    ...doc,
    meta: {
      ...doc.meta,
      updatedAt: ts,
      lastSeenAt: ts,
    },
  };
}

/** Wire/sync format for WebSocket clients (backward compatible) */
function toClientSnapshot(doc) {
  const padBalances = doc.slots.map((s) => s.padBalance);
  const cats = doc.slots.map((s) => ({
    index: s.slotIndex,
    cat: s.cat ? { type: s.cat.type, rebirth: s.cat.rebirth } : null,
    padBalance: s.padBalance,
  }));

  return {
    id: doc.id,
    username: doc.username,
    money: doc.money,
    rebirth: doc.rebirth,
    slots: doc.slotCount,
    cats,
    padBalances,
    cosmetics: doc.cosmetics,
    serverId: doc.activeServerId,
    position: doc.position || null,
  };
}

/**
 * Flat rows for SQL bulk upsert (example adapter output).
 */
function toSqlRows(doc) {
  return {
    account: {
      id: doc.id,
      username: doc.username,
      money: doc.money,
      rebirth: doc.rebirth,
      slot_count: doc.slotCount,
      active_server_id: doc.activeServerId,
      data_version: doc.meta.dataVersion,
      created_at: doc.meta.createdAt,
      updated_at: doc.meta.updatedAt,
      last_seen_at: doc.meta.lastSeenAt,
    },
    slots: doc.slots.map((s) => ({
      account_id: doc.id,
      slot_index: s.slotIndex,
      cat_type: s.cat?.type ?? null,
      cat_rebirth: s.cat?.rebirth ?? 0,
      pad_balance: s.padBalance,
      updated_at: s.updatedAt,
    })),
    cosmetics: doc.cosmetics.map((c) => ({
      account_id: doc.id,
      cosmetic_id: c.id,
      equipped: c.equipped,
      acquired_at: c.acquiredAt,
    })),
  };
}

module.exports = {
  SCHEMA: {
    tables: ['accounts', 'account_slots', 'account_cosmetics', 'rooms', 'sessions'],
    DATA_VERSION,
  },
  createPlayerDocument,
  normalizePlayer,
  touchUpdated,
  toClientSnapshot,
  toSqlRows,
  nowIso,
};
