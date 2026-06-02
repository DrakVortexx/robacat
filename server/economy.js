const CAT_CATALOG = {
  tabby: { name: 'Tabby', value: 10, trait: 'none', traitMultiplier: 1 },
  siamese: { name: 'Siamese', value: 25, trait: 'lucky', traitMultiplier: 1.2 },
  persian: { name: 'Persian', value: 50, trait: 'royal', traitMultiplier: 1.5 },
  maine: { name: 'Maine Coon', value: 100, trait: 'giant', traitMultiplier: 1.8 },
  shadow: { name: 'Shadow Cat', value: 250, trait: 'stealth', traitMultiplier: 2 },
};

const REBIRTH_MULTIPLIER_BASE = 1;
const REBIRTH_MULTIPLIER_STEP = 0.25;

function rebirthMultiplier(rebirth) {
  return REBIRTH_MULTIPLIER_BASE + rebirth * REBIRTH_MULTIPLIER_STEP;
}

function calcIncome(cat) {
  if (!cat?.type) return 0;
  const def = CAT_CATALOG[cat.type] || CAT_CATALOG.tabby;
  const reb = cat.rebirth ?? 0;
  return Math.floor(def.value * rebirthMultiplier(reb) * def.traitMultiplier);
}

function rebirthCost(rebirthLevel) {
  return 1000 * (rebirthLevel + 1);
}

module.exports = {
  CAT_CATALOG,
  rebirthMultiplier,
  calcIncome,
  rebirthCost,
};
