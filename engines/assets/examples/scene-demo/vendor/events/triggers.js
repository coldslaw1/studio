// Triggers: watches the world and says which triggers fire this update.
//   presence   enter, leave, inside        (not looked at while a cutscene has the screen)
//   time       hour, part
//   told       start, scene, event, quest and dialogue news, sequenceEnded   (queued by notify)
//   asked      interact                    (the player presses the interact key)
import { areaCentre } from './areas.js';
import { WHEN } from './spec.js';

const PRESENCE = ['enter', 'leave', 'inside'];
const kindOf = (t) => Object.keys(t.when).find((k) => Object.hasOwn(WHEN, k));

/**
 * createTriggers(list, e) -> triggers
 * e: the engine's toolbox (check, insideKey, shapes, hour, part, scene, player, actor, isArea)
 *   update(dt, control)  -> [{ trigger, key }] that fire now, in file order. control = false while a cutscene
 *                        runs. key names the place of a poi area the player is in ('' otherwise).
 *   notify(kind, value, payload)   news for told triggers; they fire on the next update
 *   interactable()       -> { trigger, key, distance, x, y } nearest interact trigger in reach, or null
 *   fire(trigger, key)   mark as fired (the engine calls this)
 *   setEnabled(id, on), isEnabled(id), fired(id) -> times fired, get(id), timeJumped(), sceneChanged()
 *   save() / load(data) / reset()
 */
export function createTriggers(list, e) {
  const byId = new Map(list.map((t) => [t.id, t]));
  let state; let started; let lastHour; let lastPart; let news;
  const reset = () => {
    state = new Map(list.map((t) => [t.id, { enabled: t.enabled !== false, fired: 0, cool: 0, was: null, stay: 0, latched: false, keys: new Set() }]));
    started = false; lastHour = null; lastPart = null; news = [];
  };
  reset();
  const need = (id, who) => { if (!byId.has(id)) throw new Error(`${who}: there is no trigger "${id}" (triggers: ${[...byId.keys()].join(', ') || 'none'})`); return state.get(id); };
  const inScene = (t) => !t.scene || t.scene === e.scene();
  // "each": true fires once for every place of a poi area; otherwise once in all, unless repeat
  const canFire = (t, st, key = '') => st.enabled && inScene(t) && (t.each ? !st.keys.has(key) : (t.repeat === true || st.fired === 0)) && st.cool <= 0 && (!t.if || e.check(t.if));
  const matches = (match, payload) => !match || Object.entries(match).every(([k, v]) => payload?.[k] === v);
  /** Did the clock pass `h` going forward from `from` to `to`? Jumps backward never count. */
  const crossed = (from, to, h) => {
    const step = (to - from + 24) % 24;
    if (step === 0 || step > 12) return false;
    const until = (h - from + 24) % 24;
    return until > 0 && until <= step;
  };

  const triggers = {
    update(dt, control = true) {
      const fires = [];
      const hour = e.hour(); const part = e.part();
      const told = news; news = [];
      if (!started) told.push({ kind: 'start', value: true });
      for (const t of list) {
        const st = state.get(t.id); const kind = kindOf(t); const value = t.when[kind];
        if (st.cool > 0) st.cool = Math.max(0, st.cool - dt);
        let hit = false; let key = '';
        if (PRESENCE.includes(kind)) {
          if (!control) continue;
          if (!inScene(t)) { st.was = null; st.stay = 0; st.latched = false; continue; }
          const now = e.insideKey(value, t.when.who ?? e.player, t.when.reach); // null outside, else which place
          if (kind === 'enter') { hit = now !== null && now !== st.was; key = now ?? ''; }
          else if (kind === 'leave') { hit = now === null && st.was !== null; key = st.was ?? ''; }
          else {
            if (now !== st.was) { st.stay = 0; st.latched = false; }
            if (now !== null) st.stay += dt;
            hit = now !== null && !st.latched && st.stay >= (t.when.for ?? 0); key = now ?? '';
            if (hit) st.latched = true;
          }
          st.was = now;
        } else if (kind === 'hour') hit = hour !== null && lastHour !== null && crossed(lastHour, hour, value);
        else if (kind === 'part') hit = part !== null && lastPart !== null && part !== lastPart && part === value;
        else if (kind !== 'interact') hit = told.some((n) => n.kind === kind && n.value === value && matches(t.when.match, n.payload));
        if (hit && canFire(t, st, key)) fires.push({ trigger: t, key });
      }
      started = true; lastHour = hour; lastPart = part;
      return fires;
    },
    notify(kind, value, payload) { news.push({ kind, value, payload }); },
    /** The clock was set by hand: do not treat the jump as hours passing. */
    timeJumped() { lastHour = e.hour(); lastPart = e.part(); },
    interactable() {
      const player = e.actor(e.player);
      if (!player) return null;
      let best = null;
      for (const t of list) {
        if (!('interact' in t.when) || !inScene(t)) continue;
        const place = t.when.interact; let spot; let key = '';
        if (e.isArea(place)) {
          key = e.insideKey(place, e.player);
          if (key === null) continue;
          spot = areaCentre(e.shapes(place).find((s) => s.key === key).shape);
        } else {
          spot = e.actor(place);
          if (!spot || spot.hidden || Math.hypot(spot.x - player.x, spot.y - player.y) > (t.when.reach ?? 1.5)) continue;
        }
        if (!canFire(t, state.get(t.id), key)) continue;
        const distance = Math.hypot(spot.x - player.x, spot.y - player.y);
        if (!best || distance < best.distance) best = { trigger: t, key, distance, x: spot.x, y: spot.y };
      }
      return best;
    },
    fire(t, key = '') { const st = state.get(t.id); st.fired += 1; st.cool = t.cooldown ?? 0; if (t.each) st.keys.add(key); },
    get(id) { return byId.get(id) ?? null; },
    setEnabled(id, on) { need(id, on ? 'events.enable' : 'events.disable').enabled = !!on; },
    isEnabled(id) { return need(id, 'events.isEnabled').enabled; },
    fired(id) { return need(id, 'events.fired').fired; },
    save() {
      const out = { started, t: {} };
      for (const [id, st] of state) out.t[id] = { f: st.fired, e: st.enabled, w: st.was, c: st.cool, ...(st.keys.size ? { k: [...st.keys] } : {}) };
      return out;
    },
    load(data) {
      reset();
      started = !!data?.started;
      for (const [id, s] of Object.entries(data?.t ?? {})) {
        const st = state.get(id);
        const was = s.w === true ? '' : s.w === false || s.w === undefined ? null : s.w; // version 1 kept true / false
        if (st) Object.assign(st, { fired: s.f ?? 0, enabled: s.e !== false, was, cool: s.c ?? 0, latched: was !== null, keys: new Set(s.k ?? []) });
      }
    },
    reset,
  };
  return triggers;
}
