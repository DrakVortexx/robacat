const { SLOT_COUNT } = require('./config');
const { CAT_CATALOG, calcIncome, rebirthCost } = require('./economy');
const { touchUpdated, nowIso } = require('./db/schema');

function getSlot(doc, index) {
  return doc.slots.find((s) => s.slotIndex === index);
}

function tickIncome(doc) {
  let changed = false;
  for (const slot of doc.slots) {
    if (slot.cat?.type) {
      const income = calcIncome(slot.cat);
      slot.padBalance += income;
      slot.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed ? touchUpdated(doc) : doc;
}

function collectPad(doc, slotIndex) {
  const slot = getSlot(doc, slotIndex);
  if (!slot || slot.padBalance <= 0) return { doc, collected: 0 };

  const collected = slot.padBalance;
  doc.money += collected;
  slot.padBalance = 0;
  slot.updatedAt = nowIso();
  return { doc: touchUpdated(doc), collected, slotIndex };
}

function spawnCat(doc, slotIndex, catType) {
  const idx = Number(slotIndex);
  if (idx < 0 || idx >= SLOT_COUNT) return doc;

  const type = catType && CAT_CATALOG[catType] ? catType : 'tabby';
  const slot = getSlot(doc, idx);
  if (!slot) return doc;

  slot.cat = { type, rebirth: doc.rebirth };
  slot.updatedAt = nowIso();
  return touchUpdated(doc);
}

function doRebirth(doc) {
  const cost = rebirthCost(doc.rebirth);
  if (doc.money < cost) return { doc, error: `Need $${cost} to rebirth` };

  doc.money -= cost;
  doc.rebirth += 1;
  for (const slot of doc.slots) {
    if (slot.cat) slot.cat.rebirth = doc.rebirth;
  }
  return { doc: touchUpdated(doc) };
}

function isUsernameTakenInRoom(room, username, excludeDocId = null) {
  for (const [, p] of room.players) {
    if (excludeDocId && p.id === excludeDocId) continue;
    if (p.username.toLowerCase() === username.toLowerCase()) return true;
  }
  return false;
}

module.exports = {
  tickIncome,
  collectPad,
  spawnCat,
  doRebirth,
  isUsernameTakenInRoom,
};
