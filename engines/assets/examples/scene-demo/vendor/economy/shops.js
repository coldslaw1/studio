// Shops and merchants: buying, selling, opening hours, restocking on the game clock, market
// events and regular-customer standing. Each shop's state has the inventory engine's shop shape
// ({ stock: [{ id, n, price, data? }], buy, sell, coins, accepts, keeps }), so the inventory's
// shop panel shows it unchanged.

import { fail, checkInt, sameItem, clone, hourOfDay, inHours, isId } from './util.js';
import { buyUnit, sellUnit, sellFactor, discountOf, bargainOf } from './pricing.js';

/**
 * createShops(ctx) -> the shop half of the economy (see createEconomy for the public calls).
 * ctx: { catalog, defs (Map), state, wallet, inventory(), emit, rand(), bargain(shopId) }
 */
export function createShops(ctx) {
  const { catalog, defs, state, wallet, emit } = ctx;
  const openNow = new Map();

  const def = (id, fn) => {
    const d = defs.get(id);
    if (!d) throw new Error(`${fn}: unknown shop "${String(id)}". Shops: ${[...defs.keys()].join(', ') || 'none'}`);
    return d;
  };
  const inv = (fn) => {
    const i = ctx.inventory();
    if (!i) throw new Error(`${fn}: no inventory is bound. Pass { inventory } to createEconomy or call economy.bind(inventory)`);
    return i;
  };
  const pricing = (d) => ({ def: d, shop: state.shops[d.id], meta: state.shopMeta[d.id], modifiers: state.modifiers, catalog, rate: wallet.rate(d.currency), bargain: bargainOf(ctx.bargain, d.id) });
  const hour = () => hourOfDay(state.clock);
  const freeSlot = (i) => Object.values(i.state.bags).some((b) => b.slots.includes(null));
  const lineOf = (shop, index, fn) => {
    if (!Number.isInteger(index) || index < 0 || index >= shop.stock.length) throw new Error(`${fn}: stock line must be an integer from 0 to ${shop.stock.length - 1}, got ${String(index)}`);
    return shop.stock[index];
  };

  const shops = {
    ids: () => [...defs.keys()],
    has: (id) => defs.has(id),
    def: (id) => def(id, 'economy.shopInfo'),
    state: (id) => { def(id, 'economy.shop'); return state.shops[id]; },
    isOpen: (id) => inHours(hour(), def(id, 'economy.isOpen').hours),
    opensIn(id) {
      const d = def(id, 'economy.opensIn');
      return inHours(hour(), d.hours) ? 0 : (d.hours[0] - hour() + 24) % 24;
    },
    discount: (id) => discountOf(def(id, 'economy.discount'), state.shopMeta[id]),
    bargain: (id) => bargainOf(ctx.bargain, def(id, 'economy.bargain').id),
    /** Write the current price into every stock line and the sell factor into the shop. */
    reprice(id) {
      for (const d of id === undefined ? defs.values() : [def(id, 'economy.reprice')]) {
        const c = pricing(d);
        c.shop.sell = sellFactor(d, c.meta, state.modifiers, catalog, c.bargain);
        c.shop.stock.forEach((line, i) => { line.price = buyUnit(c, i); });
      }
    },
    price(id, index) {
      def(id, 'economy.price');
      lineOf(state.shops[id], index, 'economy.price');
      shops.reprice(id);
      return state.shops[id].stock[index].price;
    },
    sellPrice(id, stack) {
      const d = def(id, 'economy.sellPrice');
      if (!stack || !catalog.has(stack.id)) throw new Error(`economy.sellPrice: expected a stack { id, n }, got ${JSON.stringify(stack)}`);
      shops.reprice(id);
      return sellUnit(state.shops[id], catalog, stack, wallet.rate(d.currency));
    },
    list(id) {
      const d = def(id, 'economy.stock');
      shops.reprice(id);
      return state.shops[id].stock.map((l, index) => ({
        index, id: l.id, name: catalog.get(l.id).name, n: l.n, price: l.price, currency: d.currency,
        usual: d.stock[index] ? d.stock[index].n : 0, soldOut: l.n === 0, ...(l.data ? { data: clone(l.data) } : {}),
      }));
    },
    buy(id, index, n = 1) {
      const d = def(id, 'economy.buy');
      const shop = state.shops[id];
      const line = lineOf(shop, index, 'economy.buy');
      checkInt(n, 1, 'economy.buy: count');
      const bag = inv('economy.buy');
      if (!shops.isOpen(id)) return fail('closed', { opensIn: shops.opensIn(id) });
      shops.reprice(id);
      if (line.n !== null && line.n < n) return fail('stock', { have: line.n });
      const cost = line.price * n;
      const cur = d.currency;
      if (wallet.balance(cur) < cost) return fail('coins', { cost, have: wallet.balance(cur), currency: cur });
      const main = cur === wallet.primary;
      const done = bag.transaction(() => {
        const r = bag.add(line.id, n, { data: line.data });
        if (r.left > 0) return fail(freeSlot(bag) ? 'too-heavy' : 'full');
        return main ? wallet.spend(cur, cost) : { ok: true };
      });
      if (!done.ok) return done;
      if (!main) wallet.spend(cur, cost);
      if (line.n !== null) line.n -= n;
      if (shop.coins !== null) shop.coins += cost;
      return traded(d, { type: 'buy', shop: id, id: line.id, n, cost, currency: cur }, cost);
    },
    sell(id, ref, n) {
      const d = def(id, 'economy.sell');
      const shop = state.shops[id];
      const bag = inv('economy.sell');
      if (!shops.isOpen(id)) return fail('closed', { opensIn: shops.opensIn(id) });
      const stack = bag.at(ref);
      if (!stack) return fail('empty');
      const count = n === undefined || n === null ? stack.n : checkInt(n, 1, 'economy.sell: count');
      if (count > stack.n) return fail('missing', { have: stack.n });
      shops.reprice(id);
      const cur = d.currency;
      const each = sellUnit(shop, catalog, stack, wallet.rate(cur));
      if (each <= 0) return fail('worthless');
      const gain = each * count;
      if (shop.coins !== null && shop.coins < gain) return fail('shop-coins', { have: shop.coins });
      const main = cur === wallet.primary;
      const done = bag.transaction(() => {
        const taken = bag.take(ref, count);
        if (!taken.ok) return taken;
        return main ? wallet.earn(cur, gain) : { ok: true };
      });
      if (!done.ok) return done;
      if (!main) wallet.earn(cur, gain);
      if (shop.coins !== null) shop.coins -= gain;
      if (shop.keeps) {
        const same = shop.stock.find((l) => sameItem(l, stack));
        if (same) { if (same.n !== null) same.n += count; } else shop.stock.push({ id: stack.id, n: count, price: null, ...(stack.data ? { data: clone(stack.data) } : {}) });
      }
      return traded(d, { type: 'sell', shop: id, id: stack.id, n: count, gain, currency: cur }, gain);
    },
    /** Put the shelves back: `times` restock periods at once. */
    restock(id, times = 1) {
      const d = def(id, 'economy.restock');
      const shop = state.shops[id];
      const r = d.restock ?? { amount: null, vary: 0, clearSold: true, purse: true };
      d.stock.forEach((base, i) => {
        if (base.n === null) return;
        const line = shop.stock[i];
        const target = r.vary ? Math.max(0, Math.round(base.n * (1 + (ctx.rand() * 2 - 1) * r.vary))) : base.n;
        if (line.n >= target) { if (r.clearSold) line.n = target; } else line.n = r.amount === null ? target : Math.min(target, line.n + r.amount * times);
      });
      if (r.clearSold) shop.stock.length = d.stock.length;
      if (r.purse && d.purse !== null) shop.coins = d.purse;
      shops.reprice(id);
      emit('restock', { shop: id, times });
    },
    addModifier(raw) {
      if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new Error(`economy.addModifier: needs an "id", got ${JSON.stringify(raw)}`);
      const m = { id: raw.id, shop: raw.shop ?? null, item: raw.item ?? null, tag: raw.tag ?? null, buy: raw.buy ?? 1, sell: raw.sell ?? 1, until: null };
      if (m.shop !== null) def(m.shop, 'economy.addModifier');
      if (m.item !== null) catalog.get(m.item);
      if (m.tag !== null && (typeof m.tag !== 'string' || !m.tag)) throw new Error(`economy.addModifier: tag must be a word, got ${JSON.stringify(m.tag)}`);
      for (const side of ['buy', 'sell']) if (!(m[side] > 0) || !Number.isFinite(m[side])) throw new Error(`economy.addModifier: ${side} must be a number > 0, got ${m[side]}`);
      if (m.sell !== 1 && (m.item || m.tag)) throw new Error('economy.addModifier: a "sell" factor applies to a whole shop; leave out item and tag, or use only "buy"');
      if (raw.hours !== undefined && raw.hours !== null) {
        if (!(raw.hours > 0)) throw new Error(`economy.addModifier: hours must be > 0, got ${raw.hours}`);
        m.until = state.now + raw.hours;
      }
      state.modifiers = state.modifiers.filter((x) => x.id !== m.id);
      state.modifiers.push(m);
      shops.reprice();
      emit('modifier', { id: m.id, active: true });
      return m;
    },
    removeModifier(id) {
      const before = state.modifiers.length;
      state.modifiers = state.modifiers.filter((m) => m.id !== id);
      if (state.modifiers.length === before) return false;
      shops.reprice();
      emit('modifier', { id, active: false });
      return true;
    },
    /** Called after the clock moved: end market events, restock, announce opening and closing. */
    update() {
      for (const m of state.modifiers.filter((x) => x.until !== null && x.until <= state.now)) shops.removeModifier(m.id);
      for (const d of defs.values()) {
        const meta = state.shopMeta[d.id];
        if (d.restock && meta.next !== null && state.now >= meta.next) {
          const times = 1 + Math.floor((state.now - meta.next) / d.restock.every);
          meta.next += times * d.restock.every;
          shops.restock(d.id, times);
        }
        const open = inHours(hour(), d.hours);
        if (openNow.has(d.id) && openNow.get(d.id) !== open) emit(open ? 'shopOpened' : 'shopClosed', { shop: d.id });
        openNow.set(d.id, open);
      }
    },
    /** Forget who was open (after a load or a jump of the clock, so no event fires for it). */
    resync() { for (const d of defs.values()) openNow.set(d.id, inHours(hour(), d.hours)); },
    firstRestock(d) {
      if (!d.restock) return null;
      if (d.restock.at === null) return state.now + d.restock.every;
      return state.now + (((d.restock.at - hour() + 24) % 24) || 24);
    },
  };

  function traded(d, event, amount) {
    state.shopMeta[d.id].traded += Math.round(amount * wallet.rate(d.currency));
    shops.reprice(d.id);
    emit('trade', event);
    return { ok: true, ...event };
  }
  return shops;
}
