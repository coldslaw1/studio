// Tooltip contents for the drawn panel, as plain data (so it is tested without
// a canvas): the item's name, rarity, stats compared with what is equipped,
// weight, price and description.

import { stackRarity, stackStats, unitValue } from './stack.js';
import { own } from './catalog.js';

/**
 * compareStats(inventory, stack) -> { slot, against, rows: [{ stat, value, diff }] } or null
 * For an equippable stack: its stats next to the item it would replace.
 * diff is this item minus the equipped one (0 when equal); with nothing
 * equipped, diff equals the value. Stats only the equipped item has are listed with value 0.
 */
export function compareStats(inv, stack) {
  const def = inv.catalog.get(stack.id);
  if (!def.equip) return null;
  const equip = inv.state.equip;
  const allowed = def.equip.filter((s) => own(equip, s));
  if (allowed.length === 0) return null;
  const slot = allowed.find((s) => !equip[s]) ?? allowed[0];
  const worn = equip[slot];
  const mine = stackStats(inv.catalog, stack);
  const theirs = worn ? stackStats(inv.catalog, worn) : {};
  const rows = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].map((stat) => ({
    stat, value: mine[stat] ?? 0, diff: (mine[stat] ?? 0) - (theirs[stat] ?? 0),
  }));
  return { slot, against: worn ? worn.id : null, rows };
}

const sign = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}`;

/**
 * tooltipFor(inventory, stack, options) -> { title, rarity, color, lines: [{ text, tone }] }
 *   options: { worn (the stack is equipped: no comparison), price (shop buy price), sell (shop sell price),
 *              symbol (the shop's currency sign after price and sell, default 'c'), hint }
 *   tone: 'dim' | 'good' | 'bad' | 'text' | 'accent'
 */
export function tooltipFor(inv, stack, options = {}) {
  const { catalog } = inv;
  const def = catalog.get(stack.id);
  const rarityName = stackRarity(catalog, stack);
  const rarity = catalog.rarity(rarityName);
  const lines = [{ text: rarity.label ?? rarityName, tone: rarity.order > 0 ? 'rarity' : 'dim' }]; // the plain rarity is not worth a colour
  const cmp = options.worn ? null : compareStats(inv, stack);
  if (cmp) {
    for (const r of cmp.rows) {
      const change = cmp.against && r.diff !== 0 ? `  (${sign(r.diff)})` : '';
      lines.push({ text: `${r.stat} ${sign(r.value)}${change}`, tone: !cmp.against ? 'text' : (r.diff > 0 ? 'good' : (r.diff < 0 ? 'bad' : 'text')) });
    }
    if (cmp.against) lines.push({ text: `vs ${catalog.get(cmp.against).name}`, tone: 'dim' });
  } else {
    for (const [stat, v] of Object.entries(stackStats(catalog, stack))) lines.push({ text: `${stat} ${sign(v)}`, tone: 'text' });
  }
  if (def.twoHanded) lines.push({ text: 'Two-handed', tone: 'dim' });
  if (def.description) lines.push({ text: def.description, tone: 'dim', wrap: true });
  const facts = [];
  if (def.weight > 0) facts.push(`Weight ${Math.round(def.weight * stack.n * 10) / 10}`);
  const symbol = options.symbol ?? 'c';
  if (options.price !== undefined) facts.push(`Buy ${options.price}${symbol}`);
  else if (options.sell !== undefined) facts.push(options.sell > 0 ? `Sell ${options.sell}${symbol}` : 'Cannot be sold here');
  else if (def.value > 0) facts.push(`Value ${unitValue(catalog, stack)}c`);
  if (facts.length) lines.push({ text: facts.join('   '), tone: 'dim' });
  if (options.hint) lines.push({ text: options.hint, tone: 'accent' });
  return { title: stack.n > 1 ? `${def.name} x${stack.n}` : def.name, rarity: rarityName, color: rarity.color, lines };
}
