// Shops: a stock list with prices. The shop is plain JSON state:
//   { stock: [{ id, n: number | null, price: number | null, data? }], buy, sell, coins, accepts, keeps }
// n: null means the shop never runs out. A sold-out line stays in the list
// with n: 0, so line numbers never shift under a menu or a network action.

import { checkCount, checkData, sameItem, unitValue, stackRarity, clone } from './stack.js';

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

/**
 * createShop(options) -> shop state
 *   catalog     required (used to check the stock)
 *   stock       [{ item, n = null (endless), price (default: from the item's value), data }]
 *   buy = 1     the player pays value * buy (at least 1 coin)
 *   sell = 0.5  the player gets value * sell, rounded down
 *   coins       the shop's own money, null = endless
 *   accepts     tags the shop buys, null = anything
 *   keeps       true (default): items sold to the shop join its stock
 */
export function createShop(options = {}) {
  const { catalog } = options;
  if (!catalog || typeof catalog.get !== 'function') throw new Error('createShop: options.catalog is required');
  if (!Array.isArray(options.stock)) throw new Error('createShop: options.stock must be an array of { item, n, price }');
  const num = (v, name, min) => {
    if (!(v >= min && Number.isFinite(v))) throw new Error(`createShop: ${name} must be a number >= ${min}, got ${v}`);
    return v;
  };
  const stock = options.stock.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`createShop: stock[${i}] must be an object`);
    const line = { id: catalog.get(raw.item ?? raw.id).id, n: raw.n ?? null, price: raw.price ?? null };
    if (line.n !== null && (!Number.isInteger(line.n) || line.n < 0)) throw new Error(`createShop: stock[${i}] n must be an integer >= 0 or null`);
    if (line.price !== null && (!Number.isInteger(line.price) || line.price < 0)) throw new Error(`createShop: stock[${i}] price must be an integer >= 0`);
    const data = checkData(raw.data, 'createShop');
    if (data) line.data = data;
    return line;
  });
  const coins = options.coins ?? null;
  if (coins !== null && (!Number.isInteger(coins) || coins < 0)) throw new Error(`createShop: coins must be an integer >= 0 or null, got ${coins}`);
  const accepts = options.accepts ?? null;
  if (accepts !== null && (!Array.isArray(accepts) || accepts.some((t) => typeof t !== 'string'))) throw new Error('createShop: accepts must be a list of tags or null');
  return { stock, buy: num(options.buy ?? 1, 'buy', 0), sell: num(options.sell ?? 0.5, 'sell', 0), coins, accepts, keeps: options.keeps !== false };
}

function line(shop, index, fn) {
  if (!shop || !Array.isArray(shop.stock)) throw new Error(`${fn}: expected a shop (from createShop)`);
  if (!Number.isInteger(index) || index < 0 || index >= shop.stock.length) throw new Error(`${fn}: stock line must be an integer from 0 to ${shop.stock.length - 1}, got ${String(index)}`);
  return shop.stock[index];
}

/** buyPrice(shop, catalog, index) -> coins the player pays for one unit of a stock line. */
export function buyPrice(shop, catalog, index) {
  const l = line(shop, index, 'buyPrice');
  return l.price ?? Math.max(1, Math.round(unitValue(catalog, l) * shop.buy));
}

/** sellPrice(shop, catalog, stack) -> coins the player gets for one unit (0 = the shop will not buy it). */
export function sellPrice(shop, catalog, stack) {
  if (shop.accepts && !catalog.get(stack.id).tags.some((t) => shop.accepts.includes(t))) return 0;
  return Math.floor(unitValue(catalog, stack) * shop.sell + 1e-9);
}

/** shopList(shop, catalog) -> [{ index, id, name, n, price, rarity, soldOut }] for menus. */
export function shopList(shop, catalog) {
  return shop.stock.map((l, index) => ({
    index, id: l.id, name: catalog.get(l.id).name, n: l.n, price: buyPrice(shop, catalog, index),
    rarity: stackRarity(catalog, l), soldOut: l.n === 0,
  }));
}

/**
 * buyFromShop(shop, inventory, index, n = 1) -> { ok, id, n, cost } or { ok: false, reason }
 * reasons: 'stock' (not enough left) 'coins' 'full' 'too-heavy'. Nothing changes on failure.
 */
export function buyFromShop(shop, inv, index, n = 1) {
  const l = line(shop, index, 'buyFromShop');
  checkCount(n, 'buyFromShop');
  if (l.n !== null && l.n < n) return fail('stock', { have: l.n });
  const cost = buyPrice(shop, inv.catalog, index) * n;
  if (inv.coins < cost) return fail('coins', { cost, have: inv.coins });
  return inv.transaction(() => {
    inv.spend(cost);
    const r = inv.add(l.id, n, { data: l.data });
    if (r.left > 0) return fail(Object.values(inv.state.bags).some((b) => b.slots.includes(null)) ? 'too-heavy' : 'full');
    if (l.n !== null) l.n -= n;
    if (shop.coins !== null) shop.coins += cost;
    return { ok: true, id: l.id, n, cost };
  }, [shop]);
}

/**
 * sellToShop(shop, inventory, ref, n) -> { ok, id, n, gain } or { ok: false, reason }
 * ref: the slot to sell from (number, { bag, index } or { equip }). n defaults to the whole stack.
 * reasons: 'empty' 'missing' 'worthless' (the shop will not buy it) 'shop-coins'
 */
export function sellToShop(shop, inv, ref, n) {
  if (!shop || !Array.isArray(shop.stock)) throw new Error('sellToShop: expected a shop (from createShop)');
  const stack = inv.at(ref);
  if (!stack) return fail('empty');
  const count = n === undefined || n === null ? stack.n : checkCount(n, 'sellToShop');
  if (count > stack.n) return fail('missing', { have: stack.n });
  const each = sellPrice(shop, inv.catalog, stack);
  if (each <= 0) return fail('worthless');
  const gain = each * count;
  if (shop.coins !== null && shop.coins < gain) return fail('shop-coins', { have: shop.coins });
  return inv.transaction(() => {
    const taken = inv.take(ref, count, 'sell');
    if (!taken.ok) return taken;
    inv.addCoins(gain);
    if (shop.coins !== null) shop.coins -= gain;
    if (shop.keeps) {
      const same = shop.stock.find((l) => sameItem(l, stack));
      if (same) { if (same.n !== null) same.n += count; } else shop.stock.push({ ...clone(stack), n: count, price: null });
    }
    return { ok: true, id: stack.id, n: count, gain };
  }, [shop]);
}

/**
 * shopMoney(inventory, shop, hook) -> { symbol, balance, coins, name, sellPrice(stack) }
 * How the screens show a shop's prices. Without a hook every shop trades in the inventory's
 * coins: symbol 'c', balance inventory.coins. A game with more currencies passes the screens
 * `money: (shop) => ({ symbol: 'g', balance: 12, sellPrice: (stack) => 3 })` (the economy
 * engine's economy.money does exactly this); it may return nothing for a plain coin shop.
 * `shop` is null outside a shop. `coins: false` hides the coin icon beside the balance.
 */
export function shopMoney(inv, shop, hook) {
  const plain = { symbol: 'c', balance: inv.coins, coins: true, name: 'Coins', sellPrice: (stack) => (shop ? sellPrice(shop, inv.catalog, stack) : 0) };
  const own = typeof hook === 'function' ? hook(shop ?? null) : null;
  if (!own || typeof own !== 'object') return plain;
  const symbol = typeof own.symbol === 'string' ? own.symbol : 'c';
  return {
    symbol, balance: Number.isFinite(own.balance) ? own.balance : inv.coins, coins: own.coins ?? symbol === 'c', name: own.name ?? (symbol === 'c' ? 'Coins' : symbol),
    sellPrice: typeof own.sellPrice === 'function' ? (stack) => own.sellPrice(stack) : plain.sellPrice,
  };
}
