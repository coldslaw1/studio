// createStats: the character sheets of a game. One object holds every character's attributes,
// derived stats, resources, level, buffs and debuffs as plain JSON, advanced by step(dt).
import { buildRules, checkMods } from './rules.js';
import { createStatsState, checkStatsState, isStatsState, newSheet, sheetOf } from './state.js';
import { compute } from './sheet.js';
import { initResources, changeResource, settleResources, stepResources, resourceView, maxOf } from './resources.js';
import { applyEffect, removeEffect, dispel, stepEffects, effectView } from './effects.js';
import { addXp, setLevel, spendPoint, respec, grantUnlock } from './levels.js';
import { xpProgress } from './curve.js';
import { createLootTables } from './loot.js';
import { need, own, clone, names, isObject } from './util.js';

/**
 * createStats(options) -> stats
 * options (all optional):
 *   stats, resources, effects   { id: definition } laid over the built-ins (null removes one). See README.
 *   levels      { curve, maxLevel, pointsPerLevel, refill, unlocks, gainStat }
 *   templates   { goblin: { level, base: { maxHp: 12 }, xpReward: 8, loot: 'goblin', immune: [], tags: [] } }
 *   loot        { tables, knows, luckStat = 'luck', luckScale = 0.05 }   loot tables (see loot.js)
 *   rng         () => float in [0, 1). Needed for loot.
 *   builtins    false starts with no built-in stats, resources or effects
 *   state       wrap an existing stats state
 */
export function createStats(options = {}) {
  const rules = buildRules(options);
  const lootOpt = options.loot ?? null;
  const loot = lootOpt ? createLootTables({ tables: lootOpt.tables, knows: lootOpt.knows }) : null;
  const luckStat = lootOpt?.luckStat ?? 'luck'; const luckScale = lootOpt?.luckScale ?? 0.05;
  for (const t of Object.values(rules.templates)) need(t.loot === null || loot?.has(t.loot), `createStats: template "${t.id}" drops from loot table "${t.loot}", which does not exist (tables: ${loot ? loot.ids().join(', ') : 'none, pass loot: { tables }'})`);
  let state = options.state ?? createStatsState();
  need(isStatsState(state), 'createStats: options.state is not a stats state (use createStatsState() or stats.toJSON())');
  const listeners = new Map(); let queue = []; let cache = new WeakMap();

  const sim = {
    rules, rng: options.rng ?? null,
    get state() { return state; },
    values(sheet) { let v = cache.get(sheet); if (!v) { v = compute(rules, sheet); cache.set(sheet, v); } return v; },
    emit(e) { queue.push(e); },
    touch(sheet, cause) { cache.delete(sheet); settleResources(sim, sheet, cause); queue.push({ type: 'change', id: sheet.id, cause }); },
  };
  /** Hand queued events to the listeners. Listeners may cause more events; those go out in the same flush. */
  function flush() {
    const sent = [];
    while (queue.length) {
      const batch = queue; queue = [];
      for (const e of batch) {
        sent.push(e);
        for (const key of [e.type, '*']) for (const fn of [...(listeners.get(key) ?? [])]) fn(e, stats);
      }
    }
    return sent;
  }
  let depth = 0;
  const act = (fn) => { depth += 1; try { return fn(); } finally { depth -= 1; if (depth === 0) flush(); } };
  const get = (id, fn) => sheetOf(state, id, fn);
  const stat = (name, fn) => { need(own(rules.stats, name), `stats.${fn}: no stat "${String(name)}" (stats: ${names(rules.stats)})`); return name; };
  const res = (name, fn) => { need(own(rules.resources, name), `stats.${fn}: no resource "${String(name)}" (resources: ${names(rules.resources)})`); return name; };
  const eff = (name, fn) => { need(own(rules.effects, name), `stats.${fn}: no effect "${String(name)}" (effects: ${names(rules.effects)})`); return rules.effects[name]; };
  const amount = (n, fn) => { need(Number.isFinite(n) && n >= 0, `stats.${fn}: amount must be a number >= 0, got ${n}`); return n; };

  const stats = {
    rules, loot,
    get state() { return state; },
    get rng() { return sim.rng; },

    /** add(id, options | templateName) -> the new sheet. options: { template, level, base, resources, points, xpReward, loot, immune, tags }. */
    add(id, o = {}) {
      need(typeof id === 'string' && id, `stats.add: id must be a non-empty string, got ${JSON.stringify(id)}`);
      need(!own(state.sheets, id), `stats.add: "${id}" already has a sheet (use stats.remove first, or stats.has to check)`);
      const opt = typeof o === 'string' ? { template: o } : o;
      need(isObject(opt), `stats.add: options must be an object or a template name, got ${JSON.stringify(o)}`);
      const t = opt.template ? rules.templates[opt.template] : null;
      need(!opt.template || t, `stats.add: no template "${opt.template}" (templates: ${names(rules.templates)})`);
      const sheet = newSheet(id, { template: t?.id ?? null, base: { ...(t?.base ?? {}), ...(opt.base ?? {}) }, xpReward: opt.xpReward ?? t?.xpReward ?? 0, loot: opt.loot ?? t?.loot ?? null, immune: [...(opt.immune ?? t?.immune ?? [])], tags: [...(opt.tags ?? t?.tags ?? [])], points: opt.points ?? 0 });
      for (const [name, v] of Object.entries(sheet.base)) { stat(name, 'add'); need(Number.isFinite(v), `stats.add: base.${name} must be a number, got ${JSON.stringify(v)}`); }
      need(sheet.loot === null || loot?.has(sheet.loot), `stats.add: no loot table "${sheet.loot}"`);
      const level = opt.level ?? t?.level ?? 1;
      need(Number.isInteger(level) && level >= 1 && level <= rules.levels.maxLevel, `stats.add: level must be from 1 to ${rules.levels.maxLevel}, got ${level}`);
      sheet.level = level; sheet.xp = rules.levels.totals[level];
      for (const [at, list] of Object.entries(rules.levels.unlocks)) if (Number(at) <= level) for (const n of list) if (!sheet.unlocked.includes(n)) sheet.unlocked.push(n);
      for (const name of Object.keys(opt.resources ?? {})) res(name, 'add');
      state.sheets[id] = sheet;
      initResources(sim, sheet, opt.resources);
      return act(() => { sim.emit({ type: 'add', id }); return sheet; });
    },
    remove(id) { if (!own(state.sheets, id)) return false; delete state.sheets[id]; act(() => sim.emit({ type: 'remove', id })); return true; },
    has: (id) => own(state.sheets, id),
    ids: () => Object.keys(state.sheets),
    sheet: (id) => get(id, 'sheet'),

    /** get(id, stat) -> the stat's value now, with every modifier and effect. all(id) -> { stat: value }. */
    get: (id, name) => sim.values(get(id, 'get'))[stat(name, 'get')],
    all: (id) => ({ ...sim.values(get(id, 'all')) }),
    /** breakdown(id, stat) -> { value, raw, base, spent, fromStats, fromLevel, add, inc, mult, sources } for tooltips. */
    breakdown: (id, name) => compute(rules, get(id, 'breakdown'), true)[stat(name, 'breakdown')],
    /** setBase(id, stat, value) changes a character's own starting number for a stat. */
    setBase(id, name, value) {
      const s = get(id, 'setBase'); stat(name, 'setBase');
      need(Number.isFinite(value), `stats.setBase: value must be a number, got ${JSON.stringify(value)}`);
      s.base[name] = value; act(() => sim.touch(s, 'base')); return stats;
    },
    /** setMods(id, source, mods) replaces the modifiers of one named source ('equipment', 'class'); null or [] removes them. */
    setMods(id, source, mods) {
      const s = get(id, 'setMods');
      need(typeof source === 'string' && source && !source.startsWith('effect:'), `stats.setMods: source must be a name like 'equipment', got ${JSON.stringify(source)}`);
      const clean = mods ? checkMods(mods, rules.stats, `stats.setMods("${source}")`) : [];
      if (JSON.stringify(clean) === JSON.stringify(s.mods[source] ?? [])) return stats;
      if (clean.length) s.mods[source] = clean; else delete s.mods[source];
      act(() => sim.touch(s, `mods:${source}`)); return stats;
    },
    mods: (id, source) => clone(get(id, 'mods').mods[source] ?? []),

    /** value(id, resource) -> the number now. resource(id, name) -> { id, label, value, max, ratio, regen }. */
    value: (id, name) => get(id, 'value').res[res(name, 'value')].v,
    resource: (id, name) => resourceView(sim, get(id, 'resource'), res(name, 'resource')),
    /** spend(id, resource, n) all or nothing: { ok: true, value } or { ok: false, reason: 'short', value }. */
    spend(id, name, n) {
      const s = get(id, 'spend'); res(name, 'spend'); amount(n, 'spend');
      if (s.res[name].v < n) return { ok: false, reason: 'short', value: s.res[name].v };
      return act(() => { changeResource(sim, s, name, -n, 'spend'); return { ok: true, value: s.res[name].v }; });
    },
    /** drain(id, resource, n, cause) takes up to n (damage). restore(...) gives up to n (healing). Both return the change that happened. */
    drain(id, name, n, cause = 'drain') { const s = get(id, 'drain'); res(name, 'drain'); amount(n, 'drain'); return act(() => -changeResource(sim, s, name, -n, cause)); },
    restore(id, name, n, cause = 'restore') { const s = get(id, 'restore'); res(name, 'restore'); amount(n, 'restore'); return act(() => changeResource(sim, s, name, n, cause)); },
    /** setValue(id, resource, n, cause) puts a resource at n (kept inside 0..max). fill(id, resource?) tops up one or all. */
    setValue(id, name, n, cause = 'set') { const s = get(id, 'setValue'); res(name, 'setValue'); amount(n, 'setValue'); return act(() => { changeResource(sim, s, name, n - s.res[name].v - s.res[name].frac, cause); return s.res[name].v; }); },
    fill(id, name) { const s = get(id, 'fill'); const list = name ? [res(name, 'fill')] : Object.keys(rules.resources); act(() => { for (const r of list) changeResource(sim, s, r, maxOf(sim, s, r), 'fill'); }); return stats; },

    /** addXp(id, amount, { source, raw }) -> { gained, level, levels }. progress(id) -> { level, xp, into, need, ratio, atMax, points }. */
    addXp(id, n, o) { const s = get(id, 'addXp'); return act(() => addXp(sim, s, n, o)); },
    level: (id) => get(id, 'level').level,
    progress(id) { const s = get(id, 'progress'); return { ...xpProgress(rules.levels.totals, rules.levels.maxLevel, s.xp), points: s.points }; },
    xpFor(level) { need(Number.isInteger(level) && level >= 1 && level <= rules.levels.maxLevel, `stats.xpFor: level must be from 1 to ${rules.levels.maxLevel}, got ${level}`); return rules.levels.totals[level]; },
    setLevel(id, level) { const s = get(id, 'setLevel'); act(() => setLevel(sim, s, level)); return stats; },
    spendPoint(id, name, n) { const s = get(id, 'spendPoint'); return act(() => spendPoint(sim, s, name, n)); },
    respec(id) { const s = get(id, 'respec'); return act(() => respec(sim, s)); },
    unlock(id, name) { const s = get(id, 'unlock'); return act(() => grantUnlock(sim, s, name)); },
    unlocked: (id, name) => get(id, 'unlocked').unlocked.includes(name),

    /** applyEffect(id, effect, { duration, stacks, source }) -> { ok, stacks, left, fresh } or { ok: false, reason: 'immune' }. */
    applyEffect(id, name, o) { const s = get(id, 'applyEffect'); const def = eff(name, 'applyEffect'); return act(() => applyEffect(sim, s, def, o)); },
    removeEffect(id, name) { const s = get(id, 'removeEffect'); eff(name, 'removeEffect'); return act(() => removeEffect(sim, s, name)); },
    hasEffect: (id, name) => get(id, 'hasEffect').effects.some((e) => e.id === name),
    effects: (id) => get(id, 'effects').effects.map((e) => effectView(sim, e)),
    /** dispel(id, { kind: 'debuff', tag: 'poison', limit }) -> ids removed. */
    dispel(id, o) { const s = get(id, 'dispel'); return act(() => dispel(sim, s, o)); },

    /** rollLoot(table, { for: id, luck, level, rng }) -> { items, coins, xp }. Luck and level come from the `for` character when given. */
    rollLoot(table, o = {}) {
      need(loot, 'stats.rollLoot: no loot tables. Pass loot: { tables } to createStats');
      const rng = o.rng ?? sim.rng;
      need(typeof rng === 'function', 'stats.rollLoot: needs a random number. Pass rng to createStats (core createRng(seed)) or to this call');
      const who = o.for ? get(o.for, 'rollLoot') : null;
      const luck = o.luck ?? (who && own(rules.stats, luckStat) ? Math.max(0, sim.values(who)[luckStat] * luckScale) : 0);
      return loot.roll(table, rng, { luck, level: o.level ?? who?.level ?? 1 });
    },
    /**
     * defeat(victim, by, { xp, rng }) -> { xp: { id: gained }, loot }   call when `victim` is beaten by `by` (an id or a list).
     * Shares the victim's xpReward between the winners, rolls its loot table with the first winner's luck at the victim's level,
     * adds any XP the loot holds, and emits 'defeat'. It does not remove the victim's sheet.
     */
    defeat(victim, by, o = {}) {
      const v = get(victim, 'defeat');
      const winners = (Array.isArray(by) ? by : by ? [by] : []).filter((id) => own(state.sheets, id));
      return act(() => {
        const drop = v.loot ? stats.rollLoot(v.loot, { for: winners[0], level: v.level, rng: o.rng }) : { items: [], coins: 0, xp: 0 };
        const total = (o.xp ?? v.xpReward) + drop.xp; const xp = {};
        for (const id of winners) xp[id] = addXp(sim, state.sheets[id], total / winners.length, { source: victim }).gained;
        sim.emit({ type: 'defeat', id: victim, by: winners, xp, loot: drop });
        return { xp, loot: drop };
      });
    },

    /** step(dt) advances effects and regeneration for every character. Returns the events of this step. */
    step(dt) {
      need(Number.isFinite(dt) && dt >= 0, `stats.step: dt must be seconds >= 0, got ${dt}`);
      depth += 1;
      try { state.time += dt; for (const s of Object.values(state.sheets)) { stepEffects(sim, s, dt); stepResources(sim, s, dt); } } finally { depth -= 1; }
      return depth === 0 ? flush() : [];
    },
    /** on(type, fn) listens for one event type or '*'. fn(event, stats). Returns a function that removes the listener. */
    on(type, fn) {
      need(typeof type === 'string' && typeof fn === 'function', `stats.on("${String(type)}"): pass an event name and a function`);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },

    /** view(id) -> plain data for a HUD or a character screen (a copy; change nothing through it). */
    view(id) {
      const s = get(id, 'view');
      const resources = {};
      for (const r of Object.keys(rules.resources)) resources[r] = resourceView(sim, s, r);
      return { id, template: s.template, level: s.level, xp: stats.progress(id), points: s.points, stats: stats.all(id), resources, effects: stats.effects(id), unlocked: [...s.unlocked], tags: [...s.tags] };
    },
    snapshot: () => Object.fromEntries(Object.keys(state.sheets).map((id) => [id, stats.view(id)])),
    toJSON: () => clone(state),
    /** load(data) replaces every sheet with a save made by toJSON(). Returns a list of problems (things the rules no longer know, dropped). */
    load(data) {
      const r = checkStatsState(data, rules);
      state = r.state; cache = new WeakMap(); queue = [];
      for (const s of Object.values(state.sheets)) { initResources(sim, s); settleResources(sim, s, 'load'); }
      queue = [];
      act(() => sim.emit({ type: 'load', problems: r.problems }));
      return r.problems;
    },
    setState(next) { need(isStatsState(next), 'stats.setState: not a stats state'); state = next; cache = new WeakMap(); return stats; },
  };
  return stats;
}
