// Group tactics. Every step the agents fighting the same target are planned together: who stands
// where (surround, flank, keep a bow's distance) and who may strike now. Limiting how many attack at
// once is what makes a pack feel like a pack instead of a pile: the rest circle and wait their turn.
import { dist, q } from './util.js';

const TWO_PI = Math.PI * 2;
const wrap = (a) => { let r = a % TWO_PI; if (r < 0) r += TWO_PI; return r; };

// offsets from the target's front for a flanking group, in the order slots are filled
const FLANK = [0, 140, -140, 180, 95, -95, 50, -50].map((d) => d * Math.PI / 180);

/**
 * slotAngles(tactic, count, base) -> list of angles (radians, around the target) for `count` fighters.
 *   'surround': evenly spaced, starting at `base`.   'flank': one in front at `base`, the rest behind and beside.
 */
export function slotAngles(tactic, count, base) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(wrap(tactic === 'flank' ? base + (i < FLANK.length ? FLANK[i] : (i * 2.399963)) : base + i * TWO_PI / count));
  }
  return out;
}

function openSpot(ctx, x, y, tx, ty) {
  const { grid } = ctx;
  if (!grid || grid.openAt(x, y)) return [q(x), q(y)];
  const p = grid.nearestOpen(x, y, 3);
  return p ? [q(p[0]), q(p[1])] : [q(tx), q(ty)];
}

function planGroup(ctx, members, target) {
  const lead = members[0];
  const tactic = lead.tactic;
  const melee = []; const ranged = [];
  for (const m of members) (m.attack.style === 'ranged' ? ranged : melee).push(m);

  // melee: slots on a ring just inside reach
  const slotted = melee.filter((m) => m.attack.style === 'melee' && (tactic === 'surround' || tactic === 'flank'));
  for (const m of melee) { m.combat.slotX = null; m.combat.slotY = null; }
  if (slotted.length > 1) {
    let nearest = slotted[0]; let nd = Infinity;
    for (const m of slotted) { const d = dist(m.x, m.y, target.x, target.y); if (d < nd) { nd = d; nearest = m; } }
    // a flank is built around where the target is looking (so the others end up behind it); with no
    // facing known, around the fighter that is already closest
    const toNearest = Math.atan2(nearest.y - target.y, nearest.x - target.x);
    const base = tactic === 'flank' && Number.isFinite(target.facing) ? (target.facing - 90) * Math.PI / 180 : toNearest;
    const angles = slotAngles(tactic, slotted.length, base).map((a) => wrap(a - base)).sort((a, b) => a - b);
    const order = slotted.map((m) => ({ m, a: wrap(Math.atan2(m.y - target.y, m.x - target.x) - base) })).sort((p, r) => p.a - r.a || (p.m.id < r.m.id ? -1 : 1));
    // slot 0 (the front) goes to whoever is nearest in angle; the others keep their order around the ring
    let shift = 0; let bestOff = Infinity;
    order.forEach((o, i) => { const off = Math.min(o.a, TWO_PI - o.a); if (off < bestOff) { bestOff = off; shift = i; } });
    for (let i = 0; i < order.length; i++) {
      const m = order[(i + shift) % order.length].m;
      const a = angles[i] + base;
      const r = m.attack.range * 0.8 + (target.radius || 0);
      const p = openSpot(ctx, target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, target.x, target.y);
      m.combat.slotX = p[0]; m.combat.slotY = p[1];
    }
  }

  // ranged: hold at the preferred distance on their own side, sliding round for a clear shot
  for (const m of ranged) {
    const keep = m.attack.keep || m.attack.range * 0.7;
    const a0 = Math.atan2(m.y - target.y, m.x - target.x);
    let spot = null;
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const x = target.x + Math.cos(a0 + turn) * keep; const y = target.y + Math.sin(a0 + turn) * keep;
      if (ctx.grid && !ctx.grid.openAt(x, y)) continue;
      if (!ctx.los(x, y, target.x, target.y)) continue;
      spot = [q(x), q(y)];
      break;
    }
    if (!spot) spot = openSpot(ctx, target.x + Math.cos(a0) * keep, target.y + Math.sin(a0) * keep, target.x, target.y);
    m.combat.slotX = spot[0]; m.combat.slotY = spot[1];
  }

  // attack tokens: who may start a strike now
  const free = tactic === 'swarm' || tactic === 'none';
  for (const list of [melee, ranged]) {
    const max = free ? list.length : Math.min(list.length, ctx.cfg.attackers);
    const striking = (m) => m.combat.state === 'telegraph' || m.combat.state === 'attack' || m.combat.state === 'charge';
    let used = 0;
    for (const m of list) { if (striking(m)) { m.combat.token = true; used++; } else m.combat.token = false; }
    const waiting = list.filter((m) => !striking(m) && m.combat.state !== 'cooldown').sort((a, b) => a.combat.last - b.combat.last || (a.id < b.id ? -1 : 1));
    for (const m of waiting) { if (used >= max) break; m.combat.token = true; used++; }
  }
}

/**
 * planTactics(ctx, fighters) sets combat.slotX / slotY (where to stand; null = go straight in) and
 * combat.token (may start an attack) on every fighter. `fighters` are the agents that have a target,
 * sorted by id. Agents in the same squad (or, without a squad, of the same faction) that share a
 * target are planned as one group, led by the lowest id.
 */
export function planTactics(ctx, fighters) {
  const groups = new Map();
  for (const a of fighters) {
    const key = `${a.squad ?? `~${a.faction}`}>${a.target}`;
    const g = groups.get(key);
    if (g) g.push(a); else groups.set(key, [a]);
  }
  for (const key of [...groups.keys()].sort()) {
    const members = groups.get(key);
    const target = ctx.actor(members[0].target);
    if (!target) { for (const m of members) { m.combat.token = false; m.combat.slotX = null; m.combat.slotY = null; } continue; }
    planGroup(ctx, members, target);
  }
}
