/**
 * Player persistence layer — memory backend today, swap `MemoryAdapter` for Postgres/Mongo.
 */

const {
  createPlayerDocument,
  normalizePlayer,
  touchUpdated,
  toClientSnapshot,
  toSqlRows,
} = require('./schema');

class MemoryAdapter {
  constructor() {
    /** @type {Map<string, import('./schema').PlayerDocument>} id → doc */
    this.byId = new Map();
    /** @type {Map<string, string>} lowercase username → id */
    this.byUsername = new Map();
  }

  async findByUsername(username) {
    const id = this.byUsername.get(username.toLowerCase());
    if (!id) return null;
    return this.byId.get(id) || null;
  }

  async findById(id) {
    return this.byId.get(id) || null;
  }

  async insert(doc) {
    const normalized = normalizePlayer(doc);
    this.byId.set(normalized.id, normalized);
    this.byUsername.set(normalized.username.toLowerCase(), normalized.id);
    return normalized;
  }

  async update(doc) {
    const normalized = touchUpdated(normalizePlayer(doc));
    this.byId.set(normalized.id, normalized);
    this.byUsername.set(normalized.username.toLowerCase(), normalized.id);
    return normalized;
  }

  async delete(id) {
    const doc = this.byId.get(id);
    if (doc) this.byUsername.delete(doc.username.toLowerCase());
    this.byId.delete(id);
  }

  async listAll() {
    return [...this.byId.values()];
  }
}

class PlayerStore {
  /**
   * @param {import('./playerStore').MemoryAdapter} [adapter]
   */
  constructor(adapter = new MemoryAdapter()) {
    this.adapter = adapter;
    this._dirty = new Set();
    this._saveTimers = new Map();
  }

  async findOrCreate(username, { serverId = null } = {}) {
    let doc = await this.adapter.findByUsername(username);
    if (!doc) {
      doc = await this.adapter.insert(createPlayerDocument(username, { serverId }));
    } else {
      doc = normalizePlayer(doc);
      doc.activeServerId = serverId;
      doc = await this.adapter.update(doc);
    }
    return doc;
  }

  async save(doc) {
    return this.adapter.update(doc);
  }

  markDirty(playerId) {
    this._dirty.add(playerId);
  }

  scheduleSave(doc, debounceMs = 2000) {
    const id = doc.id;
    if (this._saveTimers.has(id)) clearTimeout(this._saveTimers.get(id));
    this._saveTimers.set(
      id,
      setTimeout(async () => {
        this._saveTimers.delete(id);
        await this.save(doc);
        this._dirty.delete(id);
      }, debounceMs)
    );
  }

  async flush(doc) {
    if (this._saveTimers.has(doc.id)) {
      clearTimeout(this._saveTimers.get(doc.id));
      this._saveTimers.delete(doc.id);
    }
    await this.save(doc);
    this._dirty.delete(doc.id);
  }

  toSnapshot(doc) {
    return toClientSnapshot(doc);
  }

  toSqlRows(doc) {
    return toSqlRows(doc);
  }

  /** Export all accounts (backup / migration script) */
  async exportAll() {
    const players = await this.adapter.listAll();
    return players.map((p) => ({
      document: p,
      sql: toSqlRows(p),
    }));
  }
}

module.exports = { PlayerStore, MemoryAdapter };
