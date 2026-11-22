// Shop definitions: what a game writes down for each merchant, checked once at start-up.
// The definition never changes during play; what changes (stock, the purse, prices) is the shop
// STATE, which has exactly the shape the inventory engine's shop panel reads.

import { isId, clone, checkNum } from './util.js';

const where = (id) => `createEconomy: shop "${id}"`;

function checkHours(hours, w) {
  if (hours === undefined || hours === null) return null;
  if (!Array.isArray(hours) || hours.length !== 2 || hours.some((h) => !(h >= 0 && h <= 24)) || hours[0] === hours[1]) {
    throw new Error(`${w}: hours must be [open, close] with two different hours from 0 to 24, got ${JSON.stringify(hours)}`);
  }
  return [hours[0], hours[1]];
}

function checkRestock(raw, w) {
  if (raw === false || raw === null) return null;
  const r = raw === undefined || raw === true ? {} : raw;
  if (typeof r !== 'object') throw new Error(`${w}: restock must be an object or false, got ${JSON.stringify(raw)}`);
  const at = r.at ?? null;
  if (at !== null && !(at >= 0 && at < 24)) throw new Error(`${w}: restock.at must be an hour from 0 to below 24, got ${at}`);
  const every = at !== null ? 24 : r.every ?? 24;
  if (!(every > 0) || !Number.isFinite(every)) throw new Error(`${w}: restock.every must be a number of game hours > 0, got ${every}`);
  const amount = r.amount ?? null;
  if (amount !== null && (!Number.isInteger(amount) || amount < 1)) throw new Error(`${w}: restock.amount must be an integer >= 1 or left out, got ${amount}`);
  const vary = r.vary ?? 0;
  if (!(vary >= 0 && vary <= 1)) throw new Error(`${w}: restock.vary must be from 0 to 1, got ${vary}`);
  return { every, at, amount, vary, clearSold: r.clearSold !== false, purse: r.purse !== false };
}

function checkStanding(raw, w) {
  if (raw === undefined || raw === null || raw === false) return null;
  const s = raw === true ? {} : raw;
  const per = s.per ?? 100; const step = s.step ?? 0.02; const max = s.max ?? 0.2;
  if (!(per > 0)) throw new Error(`${w}: standing.per must be > 0, got ${per}`);
  if (!(step >= 0 && step < 1) || !(max >= 0 && max < 1)) throw new Error(`${w}: standing.step and standing.max must be from 0 to below 1`);
  return { per, step, max };
}

/**
 * checkShops(catalog, shops, wallet) -> Map(id -> definition)
 * A shop: { id, name, currency, buy = 1, sell = 0.5, accepts, purse, keeps, hours, elasticity = 0.5,
 *           stock: [{ item, n, price, data }], restock: { every, at, amount, vary, clearSold, purse }, standing }
 */
export function checkShops(catalog, shops = [], wallet) {
  if (!Array.isArray(shops)) throw new Error('createEconomy: shops must be an array of { id, stock, ... }');
  const out = new Map();
  shops.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new Error(`createEconomy: shops[${i}] needs an "id"`);
    const w = where(raw.id);
    if (out.has(raw.id)) throw new Error(`createEconomy: two shops share the id "${raw.id}"`);
    if (!Array.isArray(raw.stock)) throw new Error(`${w}: stock must be an array of { item, n, price }`);
    const currency = raw.currency ?? wallet.primary;
    if (!wallet.has(currency)) throw new Error(`${w}: unknown currency "${currency}"`);
    const stock = raw.stock.map((line, j) => {
      if (!line || typeof line !== 'object') throw new Error(`${w}: stock[${j}] must be an object`);
      const out2 = { id: catalog.get(line.item ?? line.id).id, n: line.n ?? null, price: line.price ?? null };
      if (out2.n !== null && (!Number.isInteger(out2.n) || out2.n < 0)) throw new Error(`${w}: stock[${j}] n must be an integer >= 0 or left out (endless), got ${out2.n}`);
      if (out2.price !== null && (!Number.isInteger(out2.price) || out2.price < 0)) throw new Error(`${w}: stock[${j}] price must be an integer >= 0, got ${out2.price}`);
      if (line.data !== undefined && line.data !== null) {
        if (typeof line.data !== 'object' || Array.isArray(line.data)) throw new Error(`${w}: stock[${j}] data must be a plain object`);
        if (Object.keys(line.data).length) out2.data = clone(line.data);
      }
      return out2;
    });
    const accepts = raw.accepts ?? null;
    if (accepts !== null && (!Array.isArray(accepts) || accepts.some((t) => typeof t !== 'string'))) throw new Error(`${w}: accepts must be a list of tags or left out`);
    const purse = raw.purse ?? null;
    if (purse !== null && (!Number.isInteger(purse) || purse < 0)) throw new Error(`${w}: purse must be an integer >= 0 or left out (endless), got ${purse}`);
    const elasticity = raw.elasticity ?? 0.5;
    if (!(elasticity >= 0 && elasticity <= 1)) throw new Error(`${w}: elasticity must be from 0 to 1, got ${elasticity}`);
    out.set(raw.id, Object.freeze({
      id: raw.id, name: raw.name ?? raw.id, currency, stock,
      buy: checkNum(raw.buy ?? 1, 0, `${w}: buy`), sell: checkNum(raw.sell ?? 0.5, 0, `${w}: sell`),
      accepts, purse, keeps: raw.keeps !== false, hours: checkHours(raw.hours, w), elasticity,
      restock: checkRestock(raw.restock, w), standing: checkStanding(raw.standing, w),
    }));
  });
  return out;
}

/** freshShop(def) -> the shop state at the start of a game (the inventory engine's shop shape plus id and currency). */
export function freshShop(def) {
  return { id: def.id, currency: def.currency, stock: def.stock.map((l) => clone(l)), buy: def.buy, sell: def.sell, coins: def.purse, accepts: def.accepts ? def.accepts.slice() : null, keeps: def.keeps };
}
