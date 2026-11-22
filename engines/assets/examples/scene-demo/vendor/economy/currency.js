// Currencies and the wallet. The first currency is the main one: every item `value` is counted in
// it, and when an inventory is bound its `coins` ARE the main balance (one truth, saved by the
// inventory). Other currencies (gems, tokens, favour) live in the economy's own state.

import { fail, isId, own, checkInt, checkNum } from './util.js';

/** The currency a game gets when it names none. */
export const DEFAULT_CURRENCIES = Object.freeze([{ id: 'coins', name: 'Coins', symbol: 'c' }]);

/**
 * checkCurrencies(list) -> [{ id, name, symbol, rate }]
 * `rate` is what one unit is worth in the main currency (the first in the list, rate 1).
 */
export function checkCurrencies(list = DEFAULT_CURRENCIES) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('createEconomy: currencies must be a non-empty array of { id, name, symbol, rate }');
  const seen = new Set();
  return list.map((raw, i) => {
    if (!raw || typeof raw !== 'object' || !isId(raw.id)) throw new Error(`createEconomy: currencies[${i}] needs an "id", got ${JSON.stringify(raw)}`);
    if (seen.has(raw.id)) throw new Error(`createEconomy: two currencies share the id "${raw.id}"`);
    seen.add(raw.id);
    const rate = i === 0 ? 1 : raw.rate ?? 1;
    if (i === 0 && raw.rate !== undefined && raw.rate !== 1) throw new Error(`createEconomy: the first currency ("${raw.id}") is the main one and its rate is always 1, got ${raw.rate}`);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error(`createEconomy: currency "${raw.id}" rate must be a number > 0, got ${rate}`);
    return Object.freeze({ id: raw.id, name: raw.name ?? raw.id, symbol: raw.symbol ?? raw.id[0], rate });
  });
}

/**
 * createWallet({ currencies, state, inventory, emit, exchangeFee }) -> wallet
 *   state      the economy state; other currencies are kept in state.wallet
 *   inventory  () => the bound inventory or null
 *   emit       (event, payload) => void
 * wallet:
 *   primary                 id of the main currency
 *   currencies()            [{ id, name, symbol, rate }]
 *   rate(id)                worth of one unit in the main currency
 *   balance(id = primary)   how much the player has
 *   earn(id, n)             -> { ok: true, balance }
 *   spend(id, n)            -> { ok: true, balance } or { ok: false, reason: 'coins', currency, need, have }
 *   convert(n, from, to)    -> how many `to` units `n` units of `from` are worth (not rounded)
 *   exchange(from, to, n, { fee })  -> { ok, paid, got }: change up to n units; only whole `to` units are bought and
 *                           paid for. Reasons 'coins' 'too-little'.
 *   format(n, id)           -> '12c'
 */
export function createWallet(o) {
  const { state, emit } = o;
  const defs = o.currencies;
  const byId = new Map(defs.map((c) => [c.id, c]));
  const primary = defs[0].id;
  const fee = checkNum(o.exchangeFee ?? 0, 0, 'createEconomy: exchangeFee');
  if (fee >= 1) throw new Error(`createEconomy: exchangeFee must be below 1, got ${fee}`);
  for (const c of defs) if (!own(state.wallet, c.id)) state.wallet[c.id] = 0;

  const def = (id, fn) => {
    const c = byId.get(id);
    if (!c) throw new Error(`${fn}: unknown currency "${String(id)}". Use one of: ${[...byId.keys()].join(', ')}`);
    return c;
  };
  const inInventory = (id) => id === primary && !!o.inventory();

  const wallet = {
    primary,
    has: (id) => byId.has(id),
    currencies: () => defs.slice(),
    rate: (id = primary) => def(id, 'economy.rate').rate,
    balance(id = primary) {
      def(id, 'economy.balance');
      return inInventory(id) ? o.inventory().coins : state.wallet[id];
    },
    earn(id, n) {
      def(id, 'economy.earn');
      checkInt(n, 0, 'economy.earn: amount');
      if (inInventory(id)) o.inventory().addCoins(n); else state.wallet[id] += n;
      if (n > 0) emit('wallet', { currency: id, change: n, balance: wallet.balance(id) });
      return { ok: true, balance: wallet.balance(id) };
    },
    spend(id, n) {
      def(id, 'economy.spend');
      checkInt(n, 0, 'economy.spend: amount');
      const have = wallet.balance(id);
      if (have < n) return fail('coins', { currency: id, need: n, have });
      if (inInventory(id)) o.inventory().spend(n); else state.wallet[id] -= n;
      if (n > 0) emit('wallet', { currency: id, change: -n, balance: wallet.balance(id) });
      return { ok: true, balance: wallet.balance(id) };
    },
    convert(n, from, to) {
      return (n * def(from, 'economy.convert').rate) / def(to, 'economy.convert').rate;
    },
    exchange(from, to, n, options = {}) {
      checkInt(n, 1, 'economy.exchange: amount');
      const cut = options.fee ?? fee;
      if (!(cut >= 0 && cut < 1)) throw new Error(`economy.exchange: fee must be from 0 to below 1, got ${cut}`);
      if (from === to) throw new Error(`economy.exchange: from and to are both "${from}"`);
      const each = def(to, 'economy.exchange').rate / (def(from, 'economy.exchange').rate * (1 - cut)); // `from` units for one `to` unit
      const got = Math.floor(n / each + 1e-9);
      if (wallet.balance(from) < n) return fail('coins', { currency: from, need: n, have: wallet.balance(from) });
      if (got < 1) return fail('too-little', { need: Math.ceil(each - 1e-9) });
      const paid = Math.min(n, Math.ceil(got * each - 1e-9)); // only what the whole units cost; the rest stays with the player
      wallet.spend(from, paid);
      wallet.earn(to, got);
      return { ok: true, from, to, paid, got };
    },
    format(n, id = primary) { return `${n}${def(id, 'economy.format').symbol}`; },
  };
  return wallet;
}
