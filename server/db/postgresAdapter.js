const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { normalizePlayer, touchUpdated } = require('./schema');
const { SLOT_COUNT, DATA_VERSION } = require('../config');

class PostgresAdapter {
  /**
   * @param {string} connectionString
   */
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech')
        ? { rejectUnauthorized: true }
        : undefined,
      max: 10,
    });
    this.ready = false;
  }

  async init() {
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await this.pool.query(sql);
    this.ready = true;
  }

  async _rowToDocument(accountRow, slotRows, cosmeticRows) {
    const slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row = slotRows.find((r) => r.slot_index === i);
      slots.push({
        slotIndex: i,
        cat: row?.cat_type
          ? { type: row.cat_type, rebirth: row.cat_rebirth ?? accountRow.rebirth }
          : null,
        padBalance: Number(row?.pad_balance ?? 0),
        updatedAt: row?.updated_at?.toISOString?.() ?? new Date().toISOString(),
      });
    }

    return {
      id: accountRow.id,
      username: accountRow.username,
      money: Number(accountRow.money),
      rebirth: accountRow.rebirth,
      slotCount: accountRow.slot_count,
      activeServerId: accountRow.active_server_id,
      position:
        accountRow.position_x != null
          ? { x: accountRow.position_x, z: accountRow.position_z }
          : null,
      slots,
      cosmetics: cosmeticRows.map((c) => ({
        id: c.cosmetic_id,
        equipped: c.equipped,
        acquiredAt: c.acquired_at.toISOString(),
      })),
      meta: {
        dataVersion: accountRow.data_version,
        createdAt: accountRow.created_at.toISOString(),
        updatedAt: accountRow.updated_at.toISOString(),
        lastSeenAt: accountRow.last_seen_at.toISOString(),
      },
    };
  }

  async _loadByAccountId(client, accountId) {
    const acc = await client.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
    if (!acc.rows[0]) return null;

    const slots = await client.query(
      'SELECT * FROM account_slots WHERE account_id = $1 ORDER BY slot_index',
      [accountId]
    );
    const cosmetics = await client.query(
      'SELECT * FROM account_cosmetics WHERE account_id = $1',
      [accountId]
    );

    return this._rowToDocument(acc.rows[0], slots.rows, cosmetics.rows);
  }

  async findByUsername(username) {
    const res = await this.pool.query(
      'SELECT id FROM accounts WHERE LOWER(username) = LOWER($1)',
      [username.trim()]
    );
    if (!res.rows[0]) return null;
    const client = await this.pool.connect();
    try {
      return await this._loadByAccountId(client, res.rows[0].id);
    } finally {
      client.release();
    }
  }

  async findById(id) {
    const client = await this.pool.connect();
    try {
      return await this._loadByAccountId(client, id);
    } finally {
      client.release();
    }
  }

  async insert(doc) {
    const normalized = normalizePlayer(doc);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this._upsertAccount(client, normalized);
      await this._upsertSlots(client, normalized);
      await this._upsertCosmetics(client, normalized);
      await client.query('COMMIT');
      return normalized;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async update(doc) {
    const normalized = touchUpdated(normalizePlayer(doc));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this._upsertAccount(client, normalized);
      await this._upsertSlots(client, normalized);
      await this._replaceCosmetics(client, normalized);
      await client.query('COMMIT');
      return normalized;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async _upsertAccount(client, doc) {
    const pos = doc.position || {};
    await client.query(
      `INSERT INTO accounts (
        id, username, money, rebirth, slot_count, active_server_id,
        data_version, position_x, position_z, created_at, updated_at, last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        money = EXCLUDED.money,
        rebirth = EXCLUDED.rebirth,
        slot_count = EXCLUDED.slot_count,
        active_server_id = EXCLUDED.active_server_id,
        data_version = EXCLUDED.data_version,
        position_x = EXCLUDED.position_x,
        position_z = EXCLUDED.position_z,
        updated_at = EXCLUDED.updated_at,
        last_seen_at = EXCLUDED.last_seen_at`,
      [
        doc.id,
        doc.username,
        doc.money,
        doc.rebirth,
        doc.slotCount,
        doc.activeServerId,
        doc.meta.dataVersion ?? DATA_VERSION,
        pos.x ?? null,
        pos.z ?? null,
        doc.meta.createdAt,
        doc.meta.updatedAt,
        doc.meta.lastSeenAt,
      ]
    );
  }

  async _upsertSlots(client, doc) {
    for (const slot of doc.slots) {
      await client.query(
        `INSERT INTO account_slots (
          account_id, slot_index, cat_type, cat_rebirth, pad_balance, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (account_id, slot_index) DO UPDATE SET
          cat_type = EXCLUDED.cat_type,
          cat_rebirth = EXCLUDED.cat_rebirth,
          pad_balance = EXCLUDED.pad_balance,
          updated_at = EXCLUDED.updated_at`,
        [
          doc.id,
          slot.slotIndex,
          slot.cat?.type ?? null,
          slot.cat?.rebirth ?? 0,
          slot.padBalance,
          slot.updatedAt,
        ]
      );
    }
  }

  async _upsertCosmetics(client, doc) {
    for (const c of doc.cosmetics) {
      await client.query(
        `INSERT INTO account_cosmetics (account_id, cosmetic_id, equipped, acquired_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_id, cosmetic_id) DO UPDATE SET
           equipped = EXCLUDED.equipped,
           acquired_at = EXCLUDED.acquired_at`,
        [doc.id, c.id, c.equipped, c.acquiredAt]
      );
    }
  }

  async _replaceCosmetics(client, doc) {
    await client.query('DELETE FROM account_cosmetics WHERE account_id = $1', [doc.id]);
    await this._upsertCosmetics(client, doc);
  }

  async delete(id) {
    await this.pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  }

  async listAll() {
    const res = await this.pool.query('SELECT id FROM accounts ORDER BY username');
    const docs = [];
    for (const row of res.rows) {
      const doc = await this.findById(row.id);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresAdapter };
