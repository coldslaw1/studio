// Bridge to the combat engine. Nothing is imported: you pass the combat object in.
// Who owns what while they are bound:
//   - the sheet owns attack, defense, max health, speed and resistances; they are pushed to the fighter on every change
//   - the fighter owns live health during a fight; the sheet's health follows it after every hit, heal, death and revive
//   - health changed through the stats engine (a potion, poison, a level-up refill) is passed on to the fighter
//   - a fighter's death gives its XP reward and loot to the killer (stats.defeat)
import { need, own } from './util.js';

const DEFAULT_NAMES = { attack: 'attack', defense: 'defense', maxHp: 'maxHp', speed: 'speed' };

/**
 * combatStats(stats, id, options) -> { hp, maxHp, attack, defense, speed, resist }   the numbers for combat.addFighter:
 *   combat.addFighter('hero', { faction: 'player', x: 0, y: 0, weapon: 'sword', ...combatStats(stats, 'hero') });
 * options: stats { attack, defense, maxHp, speed } (stat names; null leaves one out), hp ('hp'), resistPrefix ('resist.'),
 *          speedScale (1; pass combat's `unit` in a pixel game).
 */
export function combatStats(stats, id, options = {}) {
  const map = { ...DEFAULT_NAMES, ...(options.stats ?? {}) };
  const prefix = options.resistPrefix ?? 'resist.';
  const all = stats.all(id); const out = { resist: {} };
  for (const key of ['attack', 'defense', 'maxHp', 'speed']) if (map[key] && own(all, map[key])) out[key] = all[map[key]];
  if (out.speed !== undefined) out.speed *= options.speedScale ?? 1;
  if (out.maxHp !== undefined) out.maxHp = Math.max(1, out.maxHp);
  for (const [name, v] of Object.entries(all)) if (name.startsWith(prefix)) out.resist[name.slice(prefix.length)] = v;
  const hp = options.hp ?? 'hp';
  if (own(stats.rules.resources, hp)) { const r = stats.sheet(id).res[hp]; out.hp = r.v + r.frac; }
  return out;
}

/**
 * bindCombat(stats, combat, options) -> link
 * options (all optional): the combatStats options, plus
 *   sheetOf(fighterId) -> sheet id, fighterOf(sheetId) -> fighter id   when the two use different ids (default: the same id)
 *   xp   false stops the automatic stats.defeat(victim, killer) on a death
 * link: { push(fighterId?), pull(fighterId?), check(), stop() }
 *   push copies sheet -> fighter (all fighters when no id is given); done for you at bind, on every stat change and after stats.load.
 *   pull copies the fighter's health -> sheet; done for you after combat events.
 *   check pushes every fighter that joined the fight since the last look (combat has no "fighter added" event). It runs
 *   by itself whenever combat reports anything; call it once per tick after combat.step (the base plugin does), or call
 *   push(id) right after combat.addFighter, when a late fighter must have its numbers before its first event.
 * A fighter without a sheet, or a sheet without a fighter, is simply left alone.
 */
export function bindCombat(stats, combat, options = {}) {
  need(combat && typeof combat.setStats === 'function' && typeof combat.on === 'function' && typeof combat.fighter === 'function', 'bindCombat: pass a combat object (createCombat(...)) as the second argument');
  const hp = options.hp ?? 'hp';
  const hasHp = own(stats.rules.resources, hp);
  const sheetOf = options.sheetOf ?? ((fid) => fid);
  const fighterOf = options.fighterOf ?? ((sid) => sid);
  const pair = (fid) => { const sid = sheetOf(fid); return sid && combat.has(fid) && stats.has(sid) ? sid : null; };
  let busy = false; // true while this bridge itself is writing, so its own echoes are ignored
  const quiet = (fn) => { if (busy) return; busy = true; try { fn(); } finally { busy = false; } };
  const exact = (sid) => { const r = stats.sheet(sid).res[hp]; return r.v + r.frac; };

  function pull(fid) {
    if (fid === undefined) { for (const f of combat.fighters()) pull(f.id); return; }
    const sid = pair(fid);
    if (!sid || !hasHp) return;
    const f = combat.fighter(fid);
    if (Math.abs(exact(sid) - f.hp) > 1e-6) quiet(() => stats.setValue(sid, hp, Math.max(0, f.hp), 'combat'));
  }
  function pushStats(fid, sid) {
    const s = combatStats(stats, sid, options);
    combat.setStats(fid, { attack: s.attack, defense: s.defense, maxHp: s.maxHp, speed: s.speed, resist: s.resist });
  }
  /** Sheet health -> fighter. `revive` lets a dead fighter stand up when the sheet says it has health (bind and load only). */
  function pushHp(fid, sid, revive) {
    if (!hasHp) return;
    const f = combat.fighter(fid); const want = exact(sid);
    if (!f.alive) { if (revive && want > 0) combat.revive(fid, want); return; }
    if (want <= 0) combat.kill(fid);
    else if (want > f.hp + 1e-6) combat.heal(fid, want - f.hp);
    else if (want < f.hp - 1e-6) combat.damage(fid, f.hp - want, { type: 'true', via: 'status' });
  }
  function push(fid) {
    if (fid === undefined) { for (const f of combat.fighters()) push(f.id); return; }
    const sid = pair(fid);
    if (!sid) return;
    quiet(() => { pushStats(fid, sid); pushHp(fid, sid, true); });
    pull(fid);
  }

  const seen = new Map(); // fighter id -> the fighter object last pushed
  /** Push the fighters that are new since the last look (also one that left and came back); forget the ones that left. Returns the new ids. */
  function check() {
    const now = new Set(); const fresh = [];
    for (const f of combat.fighters()) { now.add(f.id); if (seen.get(f.id) !== f) { seen.set(f.id, f); fresh.push(f.id); } }
    for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
    for (const id of fresh) push(id);
    return fresh;
  }

  const offs = [
    combat.on('*', () => { if (!busy) check(); }),
    stats.on('change', (e) => { const fid = fighterOf(e.id); if (fid && pair(fid) === e.id) quiet(() => pushStats(fid, e.id)); }), // the sheet already keeps its own health under its max
    stats.on('resource', (e) => {
      if (busy || e.resource !== hp || e.cause === 'combat') return;
      const fid = fighterOf(e.id);
      if (!fid || pair(fid) !== e.id) return;
      quiet(() => pushHp(fid, e.id, false));
      pull(fid); // the fighter has the last word (a dead fighter is not healed, damage may be changed by a status)
    }),
    stats.on('add', (e) => { const fid = fighterOf(e.id); if (fid) push(fid); }),
    stats.on('load', () => push()),
    combat.on('hit', (e) => pull(e.target)),
    combat.on('heal', (e) => pull(e.id)),
    combat.on('revive', (e) => pull(e.id)),
    combat.on('death', (e) => {
      pull(e.id);
      const victim = sheetOf(e.id);
      if (options.xp === false || !victim || !stats.has(victim)) return;
      const killer = e.by ? sheetOf(e.by) : null;
      stats.defeat(victim, killer && killer !== victim && stats.has(killer) ? killer : []);
    }),
  ];
  check();
  return { push, pull, check, stop() { for (const off of offs.splice(0)) off(); } };
}
