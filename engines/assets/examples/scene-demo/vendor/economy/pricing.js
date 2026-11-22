// Prices. One place decides what a thing costs, so the shop panel, the menus and the rules agree.
//   buy price  = value x shop.buy x scarcity x market events x (1 - standing discount) x (1 - bargain), at least 1
//   sell price = value x shop.sell x market events x (1 + standing discount) x (1 + bargain), rounded down
// `bargain` is the game's own hook (a charisma stat, a haggling skill): 0.1 = 10% better both ways.
// A shop never sells a thing for less than it pays for it, so buying and selling back in a
// circle can never make money.

import { unitValue } from './util.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** scarcity(def, base, line) -> price factor from how full the shelf is: 1 at the usual stock, more when low, less when overfull. */
export function scarcity(def, base, line) {
  if (!base || base.n === null || base.n <= 0 || line.n === null) return 1;
  const e = def.elasticity;
  return clamp(1 + e * ((base.n - line.n) / base.n), 1 - e / 2, 1 + e);
}

/** discountOf(def, meta) -> the standing discount (0..max) a regular customer has earned at this shop. */
export function discountOf(def, meta) {
  if (!def.standing) return 0;
  return Math.min(def.standing.max, Math.floor(meta.traded / def.standing.per) * def.standing.step);
}

/** eventFactor(modifiers, def, catalog, line, side) -> product of the market events that apply ('buy' or 'sell'). */
export function eventFactor(modifiers, def, catalog, line, side) {
  let f = 1;
  for (const m of modifiers) {
    if (m.shop && m.shop !== def.id) continue;
    if (side === 'sell') { if (!m.item && !m.tag) f *= m.sell; continue; }
    if (m.item && (!line || m.item !== line.id)) continue;
    if (m.tag && (!line || !catalog.get(line.id).tags.includes(m.tag))) continue;
    f *= m.buy;
  }
  return f;
}

/** bargainOf(fn, shopId) -> the game's bargaining share for this shop, kept between -0.5 and 0.5 (0 without a hook). */
export function bargainOf(fn, shopId) {
  if (typeof fn !== 'function') return 0;
  const v = Number(fn(shopId));
  return Number.isFinite(v) ? clamp(v, -0.5, 0.5) : 0;
}

/** sellFactor(def, meta, modifiers, catalog, bargain = 0) -> the shop-wide factor written into shop.sell. */
export function sellFactor(def, meta, modifiers, catalog, bargain = 0) {
  return def.sell * eventFactor(modifiers, def, catalog, null, 'sell') * (1 + discountOf(def, meta)) * (1 + bargain);
}

/** sellUnit(shop, catalog, stack, rate) -> what the shop pays for one unit, in the shop's currency (0 = it will not buy it). */
export function sellUnit(shop, catalog, stack, rate) {
  if (shop.accepts && !catalog.get(stack.id).tags.some((t) => shop.accepts.includes(t))) return 0;
  return Math.floor((unitValue(catalog, stack) / rate) * shop.sell + 1e-9);
}

/** buyUnit({ def, shop, meta, modifiers, catalog, rate, bargain }, index) -> what the player pays for one unit of a stock line. */
export function buyUnit(c, index) {
  const line = c.shop.stock[index];
  const base = c.def.stock[index];
  if (base && base.price !== null) return base.price;
  const f = scarcity(c.def, base, line) * eventFactor(c.modifiers, c.def, c.catalog, line, 'buy') * (1 - discountOf(c.def, c.meta)) * (1 - (c.bargain ?? 0));
  const price = Math.round((unitValue(c.catalog, line) / c.rate) * c.def.buy * f);
  return Math.max(1, price, sellUnit({ ...c.shop, accepts: null }, c.catalog, line, c.rate));
}
