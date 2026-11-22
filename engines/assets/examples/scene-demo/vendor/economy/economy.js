// createEconomy: currencies, shops and merchants, crafting stations, all driven by the game clock.
// It builds on the inventory engine without importing it: the catalog and the inventory are
// passed in, and every shop's state has the shape the inventory's shop panel reads.

import { checkCatalog, hashSeed, nextRandom, checkNum } from './util.js';
import { checkCurrencies, createWallet } from './currency.js';
import { checkShops, freshShop } from './shop-defs.js';
import { createShops } from './shops.js';
import { checkRecipes, checkStations } from './recipes.js';
import { createCrafting } from './crafting.js';
import { saveEconomy, loadEconomy } from './save.js';
import { createActions } from './actions.js';

/** Every event createEconomy sends through economy.on(event, fn). */
export const ECONOMY_EVENTS = Object.freeze(['trade', 'restock', 'modifier', 'shopOpened', 'shopClosed', 'wallet', 'learned', 'craftStarted', 'craftDone', 'collected', 'craftCancelled', 'load']);

/**
 * createEconomy(options) -> economy
 *   catalog      required: the inventory engine's catalog (item `value` is the price in the main currency)
 *   inventory    the player's inventory (or call economy.bind(inventory) later)
 *   currencies   [{ id, name, symbol, rate }], first = main. Default one currency, 'coins'
 *   exchangeFee  share kept when changing money, 0 to below 1. Default 0
 *   shops        [{ id, name, stock, buy, sell, purse, accepts, hours, restock, elasticity, standing, currency }]
 *   recipes      [{ id, inputs, tools, outputs, station, time, coins, locked }]
 *   stations     [{ id, kind, name, queue, speed }]
 *   startHour    hour of the day when the game starts. Default 8
 *   bargain      (shopId) => share: the game's haggling hook. 0.1 = buy 10% cheaper and sell 10% dearer; negative = worse
 *   seed         number or string for restock variation and output chances. Default 1
 * The full list of calls is in README.md.
 */
export function createEconomy(options = {}) {
  const catalog = checkCatalog(options.catalog, 'createEconomy');
  const startHour = checkNum(options.startHour ?? 8, 0, 'createEconomy: startHour');
  const state = { now: 0, clock: startHour, rng: hashSeed(options.seed ?? 1), wallet: {}, known: [], modifiers: [], shops: {}, shopMeta: {}, stations: {} };
  let inventory = null;
  let bargain = options.bargain ?? null;
  if (bargain !== null && typeof bargain !== 'function') throw new Error(`createEconomy: bargain must be a function (shopId) => share, got ${typeof bargain}`);
  const listeners = new Map(ECONOMY_EVENTS.map((e) => [e, new Set()]));
  const emit = (event, payload) => { for (const fn of [...listeners.get(event)]) fn(payload, event); };
  const getInventory = () => inventory;

  const wallet = createWallet({ currencies: checkCurrencies(options.currencies), state, inventory: getInventory, emit, exchangeFee: options.exchangeFee });
  const shopDefs = checkShops(catalog, options.shops, wallet);
  const recipes = checkRecipes(catalog, options.recipes, wallet);
  const stations = checkStations(options.stations);
  const shops = createShops({ catalog, defs: shopDefs, state, wallet, inventory: getInventory, emit, rand: () => nextRandom(state), bargain: (id) => (typeof bargain === 'function' ? bargain(id) : 0) });
  const crafting = createCrafting({ catalog, recipes, stations, state, wallet, inventory: getInventory, emit });
  for (const def of shopDefs.values()) {
    state.shops[def.id] = freshShop(def);
    state.shopMeta[def.id] = { next: shops.firstRestock(def), traded: 0 };
  }
  shops.reprice();
  shops.resync();

  function moved(hours) {
    if (hours > 0) { state.now += hours; crafting.update(hours); }
    shops.update();
  }

  const economy = {
    catalog,
    get state() { return state; },
    get inventory() { return inventory; },
    bind(next) {
      if (next !== null && (!next || typeof next.transaction !== 'function' || typeof next.add !== 'function')) throw new Error('economy.bind: expected an inventory (from the inventory engine\'s createInventory) or null');
      inventory = next;
      return economy;
    },

    // --- the clock (game hours) ---
    get now() { return state.now; },
    get hour() { return ((state.clock % 24) + 24) % 24; },
    get day() { return Math.floor(state.clock / 24); },
    /** Tell the economy what time it is: hours since the game began (day * 24 + hour). Going back in time moves nothing. */
    setTime(hours) {
      checkNum(hours, 0, 'economy.setTime: hours');
      const passed = hours - state.clock;
      state.clock = hours;
      if (passed < 0) shops.resync();
      moved(Math.max(0, passed));
    },
    /** Let `hours` game hours pass (games without a day clock, sleeping, tests). */
    advance(hours) {
      checkNum(hours, 0, 'economy.advance: hours');
      state.clock += hours;
      moved(hours);
    },

    // --- money ---
    primary: wallet.primary,
    currencies: wallet.currencies,
    balance: wallet.balance,
    earn: wallet.earn,
    spend: wallet.spend,
    convert: wallet.convert,
    exchange: wallet.exchange,
    format: wallet.format,

    // --- shops and merchants ---
    shopIds: shops.ids,
    hasShop: shops.has,
    shop: shops.state,
    shopInfo(id) {
      const d = shops.def(id);
      const meta = state.shopMeta[id];
      return { id, name: d.name, currency: d.currency, open: shops.isOpen(id), opensIn: shops.opensIn(id), hours: d.hours ? d.hours.slice() : null,
        coins: state.shops[id].coins, restockIn: meta.next === null ? null : Math.max(0, meta.next - state.now), traded: meta.traded, discount: shops.discount(id), bargain: shops.bargain(id) };
    },
    /**
     * money(shop) -> { symbol, name, balance, coins, sellPrice(stack) } for a shop state or id: what the
     * inventory screens need to label prices in the shop's own currency (their `money` option). null for no shop.
     */
    money(shop) {
      const id = typeof shop === 'string' ? shop : shop?.id;
      if (!shops.has(id)) return null;
      const cur = wallet.currencies().find((c) => c.id === shops.def(id).currency);
      return { symbol: cur.symbol, name: cur.name, balance: wallet.balance(cur.id), coins: cur.id === wallet.primary,
        sellPrice: (stack) => (stack && catalog.has(stack.id) ? shops.sellPrice(id, stack) : 0) };
    },
    /** { id: shop state } of every shop: what the inventory screens take as env.shops. */
    get shops() { return state.shops; },
    stock: shops.list,
    price: shops.price,
    sellPrice: shops.sellPrice,
    isOpen: shops.isOpen,
    buy: shops.buy,
    sell: shops.sell,
    restock: (id) => shops.restock(id, 1),
    reprice: shops.reprice,
    /** The bargaining share in use at a shop (from the `bargain` hook, kept between -0.5 and 0.5). */
    bargain: shops.bargain,
    /** Replace the bargaining hook: (shopId) => share, or null for none. Prices follow at once. */
    setBargain(fn) {
      if (fn !== null && typeof fn !== 'function') throw new Error(`economy.setBargain: expected a function (shopId) => share or null, got ${typeof fn}`);
      bargain = fn;
      shops.reprice();
      return economy;
    },
    addModifier: shops.addModifier,
    removeModifier: shops.removeModifier,
    modifiers: () => state.modifiers.map((m) => ({ ...m, hoursLeft: m.until === null ? null : Math.max(0, m.until - state.now) })),

    // --- crafting ---
    recipe: crafting.recipe,
    hasRecipe: crafting.hasRecipe,
    recipeIds: crafting.recipeIds,
    recipes: crafting.list,
    knows: crafting.knows,
    learn: crafting.learn,
    canCraft: crafting.check,
    craft: crafting.craft,
    collect: crafting.collect,
    cancel: crafting.cancel,
    station: crafting.station,
    stationIds: crafting.stationIds,

    // --- events, saves, play-tests ---
    on(event, fn) {
      if (!listeners.has(event)) throw new Error(`economy.on: unknown event "${String(event)}". Use one of: ${ECONOMY_EVENTS.join(', ')}`);
      if (typeof fn !== 'function') throw new Error('economy.on: listener must be a function');
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    save: () => saveEconomy(state),
    load(data) {
      const problems = loadEconomy({ state, catalog, shopDefs, recipes, wallet, firstRestock: shops.firstRestock }, data);
      shops.reprice();
      shops.resync();
      emit('load', { problems });
      return problems;
    },
    saveTo(store, key = 'economy') {
      if (!store || typeof store.set !== 'function') throw new Error('economy.saveTo: expected a store with get(key) and set(key, value)');
      store.set(key, economy.save());
    },
    restoreFrom(store, key = 'economy') {
      if (!store || typeof store.get !== 'function') throw new Error('economy.restoreFrom: expected a store with get(key) and set(key, value)');
      const data = store.get(key);
      if (!data || typeof data !== 'object') return { loaded: false, problems: [] };
      return { loaded: true, problems: economy.load(data) };
    },
    snapshot() {
      const wal = {};
      for (const c of wallet.currencies()) wal[c.id] = wallet.balance(c.id);
      const shopsOut = {};
      for (const id of shops.ids()) {
        const info = economy.shopInfo(id);
        shopsOut[id] = { open: info.open, coins: info.coins, restockIn: info.restockIn, discount: info.discount, lines: shops.list(id).map(({ id: item, n, price }) => ({ id: item, n, price })) };
      }
      const stationsOut = {};
      for (const id of crafting.stationIds()) {
        const s = crafting.station(id);
        stationsOut[id] = { jobs: s.jobs.map(({ recipe, left, eta }) => ({ recipe, left, eta })), tray: s.tray.map(({ id: item, n }) => ({ id: item, n })) };
      }
      return { hour: economy.hour, day: economy.day, now: state.now, wallet: wal, shops: shopsOut, stations: stationsOut, known: state.known.slice(), modifiers: state.modifiers.map((m) => m.id) };
    },
  };
  Object.assign(economy, createActions(economy));
  if (options.inventory) economy.bind(options.inventory);
  return economy;
}
