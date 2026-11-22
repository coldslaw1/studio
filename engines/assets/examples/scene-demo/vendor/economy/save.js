// Saving and loading the economy. The save is plain JSON. Loading never trusts it: anything that
// does not fit the game's shops, recipes and items any more is repaired or dropped, and the
// list of repairs is returned (empty when the save was clean).

import { clone, own, isId } from './util.js';
import { freshShop } from './shop-defs.js';

/** Version of the save data. */
export const ECONOMY_SAVE_VERSION = 1;

const int = (v, min = 0) => Number.isInteger(v) && v >= min;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

function stackOf(raw, catalog) {
  if (!raw || typeof raw !== 'object' || !catalog.has(raw.id) || !int(raw.n, 1)) return null;
  const stack = { id: raw.id, n: raw.n };
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) && Object.keys(raw.data).length) stack.data = clone(raw.data);
  return stack;
}

/** saveEconomy(state) -> a plain copy of everything that changes during play. */
export function saveEconomy(state) {
  return clone({ v: ECONOMY_SAVE_VERSION, now: state.now, clock: state.clock, rng: state.rng, wallet: state.wallet, known: state.known,
    modifiers: state.modifiers, shops: state.shops, shopMeta: state.shopMeta, stations: state.stations });
}

/**
 * loadEconomy(c, data) -> problems: string[]
 * c: { state, catalog, shopDefs, recipes, wallet, firstRestock(def) }. The shop state objects keep
 * their identity (an open shop panel keeps showing the right shop).
 */
export function loadEconomy(c, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`economy.load: expected the object economy.save() returned, got ${JSON.stringify(data)?.slice(0, 80)}`);
  if (data.v > ECONOMY_SAVE_VERSION) throw new Error(`economy.load: this save is version ${data.v}, newer than this engine understands (${ECONOMY_SAVE_VERSION})`);
  const { state, catalog } = c;
  const problems = [];
  const note = (text) => { problems.push(text); };

  state.now = num(data.now) && data.now >= 0 ? data.now : (note('now reset'), 0);
  if (num(data.clock)) state.clock = data.clock; else note('clock kept');
  if (Number.isInteger(data.rng)) state.rng = data.rng | 0; else note('random seed kept');
  for (const cur of c.wallet.currencies()) {
    const v = data.wallet?.[cur.id];
    state.wallet[cur.id] = int(v) ? v : (v === undefined ? 0 : (note(`balance of ${cur.id} reset`), 0));
  }
  state.known = [...new Set((Array.isArray(data.known) ? data.known : []).filter((id) => c.recipes.has(id) || (note(`unknown recipe ${id} forgotten`), false)))];
  state.modifiers = (Array.isArray(data.modifiers) ? data.modifiers : []).filter((m) => {
    const ok = m && isId(m.id) && m.buy > 0 && m.sell > 0 && (m.shop === null || c.shopDefs.has(m.shop)) && (m.item === null || catalog.has(m.item)) && (m.until === null || num(m.until));
    if (!ok) note(`market event ${m && m.id} dropped`);
    return ok;
  }).map((m) => ({ id: m.id, shop: m.shop ?? null, item: m.item ?? null, tag: typeof m.tag === 'string' ? m.tag : null, buy: m.buy, sell: m.sell, until: m.until ?? null }));

  for (const def of c.shopDefs.values()) {
    const fresh = freshShop(def);
    const saved = data.shops?.[def.id];
    if (saved && Array.isArray(saved.stock)) {
      fresh.stock.forEach((line, i) => {
        const was = saved.stock[i];
        if (line.n === null) return;
        if (was && was.id === line.id && int(was.n)) line.n = was.n; else note(`shop ${def.id}: line ${i} restocked`);
      });
      for (const extra of saved.stock.slice(def.stock.length)) {
        const stack = extra && int(extra.n) ? stackOf({ ...extra, n: Math.max(1, extra.n) }, catalog) : null;
        if (stack) fresh.stock.push({ id: stack.id, n: extra.n, price: null, ...(stack.data ? { data: stack.data } : {}) }); else note(`shop ${def.id}: an unknown item was removed`);
      }
      if (def.purse !== null) fresh.coins = int(saved.coins) ? saved.coins : (note(`shop ${def.id}: purse reset`), def.purse);
    } else if (data.shops && !own(data.shops, def.id)) note(`shop ${def.id} is new`);
    const shop = state.shops[def.id];
    for (const key of Object.keys(shop)) delete shop[key];
    Object.assign(shop, fresh);
    const meta = data.shopMeta?.[def.id];
    state.shopMeta[def.id] = {
      next: def.restock ? (meta && num(meta.next) ? meta.next : c.firstRestock(def)) : null,
      traded: meta && num(meta.traded) && meta.traded >= 0 ? meta.traded : 0,
    };
  }

  state.stations = {};
  for (const [id, saved] of Object.entries(data.stations && typeof data.stations === 'object' ? data.stations : {})) {
    if (!isId(id) || !saved || typeof saved !== 'object') { note(`station ${id} dropped`); continue; }
    const jobs = [];
    for (const job of Array.isArray(saved.jobs) ? saved.jobs : []) {
      const r = job && c.recipes.get(job.recipe);
      if (!r || r.time <= 0 || !int(job.left, 1)) { note(`station ${id}: a job for ${job && job.recipe} was dropped`); continue; }
      const units = Array.from({ length: job.left }, (_, u) => (Array.isArray(job.units?.[u]) ? job.units[u].map((s) => stackOf(s, catalog)).filter(Boolean) : []));
      jobs.push({ recipe: r.id, left: job.left, progress: num(job.progress) ? Math.min(Math.max(0, job.progress), r.time) : 0, units });
    }
    const tray = (Array.isArray(saved.tray) ? saved.tray : []).map((s) => stackOf(s, catalog) ?? (note(`station ${id}: an unknown item was removed`), null)).filter(Boolean);
    state.stations[id] = { jobs, tray };
  }
  return problems;
}
