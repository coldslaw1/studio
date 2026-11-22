// Factions and reputation. Who is hostile to whom starts from a fixed table (the same options as the
// combat engine's createFactions) and can then be shifted by standing: a number from -1 to 1 between
// two factions that deeds move up and down. The standing table is plain JSON and lives in the ai state.
import { need, clamp, q, sortedKeys } from './util.js';

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const BASE = { friendly: 0.7, neutral: 0, hostile: -0.7 };

/**
 * createSocial(options, standing) -> social
 *   allies, neutral, hostile   lists of [factionA, factionB] pairs (as in combat's createFactions)
 *   other = 'hostile'          relation of two different factions that are not listed
 *   hostileBelow = -0.4, friendlyAbove = 0.4   standing thresholds
 *   ripple = 0.5               share of a standing change passed on to the faction's allies (and, reversed, its enemies)
 *   friendlyFire = 0, neutralFire = 0   share of damage friends and neutrals take (read by combat through scale())
 *   standing                   the plain { 'a|b': number } table to read and write (default: a new one)
 * social: { standing, relation(a, b), hostile(a, b), friendly(a, b), standingOf(a, b), addStanding(a, b, delta, ripple?),
 *   setStanding(a, b, value), use(table), scale(source, target, via) }
 * It has the shape combat's `factions` option accepts, so one object can serve both engines.
 */
export function createSocial(options = {}, standing = {}) {
  const table = new Map();
  for (const [name, rel] of [['allies', 'friendly'], ['neutral', 'neutral'], ['hostile', 'hostile']]) {
    for (const pair of options[name] || []) {
      need(Array.isArray(pair) && pair.length === 2 && pair.every((p) => typeof p === 'string'), `createAi: factions.${name} must be a list of [factionA, factionB] pairs, got ${JSON.stringify(pair)}`);
      table.set(key(pair[0], pair[1]), rel);
    }
  }
  const other = options.other ?? 'hostile';
  need(other in BASE, `createAi: factions.other must be hostile, neutral or friendly, got "${String(other)}"`);
  const hostileBelow = options.hostileBelow ?? -0.4;
  const friendlyAbove = options.friendlyAbove ?? 0.4;
  const ripple = options.ripple ?? 0.5;
  const fire = (v) => { const n = v && typeof v === 'object' ? 0 : v ?? 0; need(n >= 0 && n <= 1, `createAi: factions friendlyFire / neutralFire must be 0..1, got ${String(v)}`); return n; };
  const friendlyFire = fire(options.friendlyFire); const neutralFire = fire(options.neutralFire);
  const base = (a, b) => table.get(key(a, b)) ?? (a === b ? 'friendly' : other);

  const social = {
    standing,
    /** use(table) swaps the standing table (after loading a save). */
    use(next) { social.standing = next; return social; },
    /** standingOf(a, b) -> -1..1. Before any deed it is the fixed relation: 0.7 friendly, 0 neutral, -0.7 hostile. */
    standingOf(a, b) {
      const v = social.standing[key(a, b)];
      return v === undefined ? BASE[base(a, b)] : v;
    },
    /** relation(a, b) -> 'friendly' | 'neutral' | 'hostile' for two faction names. */
    relation(a, b) {
      const v = social.standing[key(a, b)];
      if (v === undefined) return base(a, b);
      return v <= hostileBelow ? 'hostile' : v >= friendlyAbove ? 'friendly' : 'neutral';
    },
    hostile: (a, b) => social.relation(a, b) === 'hostile',
    friendly: (a, b) => social.relation(a, b) === 'friendly',
    setStanding(a, b, value) {
      need(typeof a === 'string' && typeof b === 'string' && a !== b, `social.setStanding: need two different faction names, got ${String(a)}, ${String(b)}`);
      need(Number.isFinite(value), `social.setStanding: value must be a number, got ${String(value)}`);
      social.standing[key(a, b)] = q(clamp(value, -1, 1));
      return social;
    },
    /**
     * addStanding(a, b, delta, spread = true) -> [{ a, b, value, was, relation, wasRelation }] for every pair that changed.
     * With spread, factions fixed as allies of b move the same way by `ripple`, and its fixed enemies the other way.
     */
    addStanding(a, b, delta, spread = true) {
      need(Number.isFinite(delta), `social.addStanding: delta must be a number, got ${String(delta)}`);
      const out = [];
      const move = (x, y, d) => {
        if (x === y || d === 0) return;
        const was = social.standingOf(x, y); const wasRelation = social.relation(x, y);
        social.setStanding(x, y, was + d);
        out.push({ a: x, b: y, value: social.standingOf(x, y), was, relation: social.relation(x, y), wasRelation });
      };
      move(a, b, delta);
      if (spread && ripple > 0) {
        for (const k of [...table.keys()].sort()) {
          const [p, r] = k.split('|');
          const third = p === b ? r : r === b ? p : null;
          if (!third || third === a) continue;
          const rel = table.get(k);
          if (rel === 'friendly') move(a, third, delta * ripple);
          else if (rel === 'hostile') move(a, third, -delta * ripple);
        }
      }
      return out;
    },
    /** scale(source, target, via) -> damage multiplier, for the combat engine (source and target have id and faction). */
    scale(source, target, via = 'melee') {
      if (!source || via === 'status') return 1;
      if (source.id === target.id) return 0;
      const rel = social.relation(source.faction, target.faction);
      return rel === 'hostile' ? 1 : rel === 'friendly' ? friendlyFire : neutralFire;
    },
  };
  return social;
}

/**
 * relate(agent, otherId, delta) -> the new personal feeling of one agent toward someone (-1..1), kept in
 * agent.rel. Personal feelings sit on top of faction standing: a villager can like one bandit.
 */
export function relate(agent, otherId, delta) {
  const v = q(clamp((agent.rel[otherId] || 0) + delta, -1, 1));
  if (v === 0) delete agent.rel[otherId]; else agent.rel[otherId] = v;
  return v;
}

/** friendsOf(agent, least = 0.3) -> ids the agent likes at least that much, best first (ties by id). */
export function friendsOf(agent, least = 0.3) {
  return sortedKeys(agent.rel).filter((id) => agent.rel[id] >= least).sort((a, b) => agent.rel[b] - agent.rel[a] || (a < b ? -1 : 1));
}
