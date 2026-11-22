// The engine's inner toolbox: how steps and triggers reach the game's world. Everything the
// outside can replace (the "drivers") goes through here, so steps.js never touches a game object
// directly. Made by createEvents; not part of the public API.
import { areaContains, areaCentre, areaAt } from './areas.js';
import { partOfHour } from './spec.js';
import { checkCondition } from './conditions.js';

/**
 * createToolbox(data, options, hooks) -> e
 * hooks: { emit(type, payload), unhandled(verb), notify(kind, value, payload) }
 */
export function createToolbox(data, options, hooks) {
  const drivers = options.drivers ?? {};
  const story = options.story ?? null;
  const clock = options.clock ?? null;
  const areas = data.areas ?? {};
  const given = options.actors ?? {};
  const find = typeof given === 'function' ? (id) => given(id) ?? null
    : given instanceof Map ? (id) => given.get(id) ?? null
      : typeof given.get === 'function' ? (id) => given.get(id) ?? null
        : (id) => given[id] ?? null;
  const playerName = data.player ?? 'player';
  // the file says "player"; the game may call that actor something else (the base's hero)
  const actor = (id) => find(id === playerName && options.playerId ? options.playerId : id);
  let vars = { ...(data.vars ?? {}) };
  const places = new Map(); // poi name -> Map(key -> { x, y })
  let scene = options.scene ?? null;

  const e = {
    data, story, clock, actions: options.actions ?? {}, player: data.player ?? 'player', api: null, stage: null,
    options: { walkSpeed: options.walkSpeed ?? 1.5, charsPerSecond: options.charsPerSecond ?? 45, personalSpace: options.personalSpace ?? 0.2 },
    emit: hooks.emit,
    actor,
    /** The actor, or an error that names the step and the missing id. */
    need(id, verb) {
      const a = actor(id) ?? drivers.summon?.(id) ?? null; // a sleeping resident of a streamed world can be woken for a scene
      if (!a) throw new Error(`events: step "${verb}" needs actor "${id}", but the game has no such actor right now`);
      return a;
    },
    isArea: (id) => typeof id === 'string' && Object.hasOwn(areas, id),
    area: (id) => areas[id],
    sequence(id) {
      const seq = data.sequences?.[id];
      if (!seq) throw new Error(`events.run: there is no sequence "${id}" (sequences: ${Object.keys(data.sequences ?? {}).join(', ') || 'none'})`);
      return seq;
    },
    /** { x, y } of a target: an area's centre, an actor, or a point. */
    point(target, verb) {
      if (target && typeof target === 'object') return { x: target.x, y: target.y };
      if (e.isArea(target)) {
        const all = e.shapes(target);
        if (!all.length) throw new Error(`events: step "${verb}" needs area "${target}", but ${areas[target].poi ? `no "${areas[target].poi}" place is loaded` : `it belongs to scene "${areas[target].scene}", not "${scene}"`}`);
        const p = actor(e.player); let best = null; let bestD = Infinity;
        for (const { shape } of all) { const c = areaCentre(shape); const d = p ? Math.hypot(c.x - p.x, c.y - p.y) : 0; if (d < bestD) { best = c; bestD = d; } }
        return best;
      }
      const a = e.need(target, verb);
      return { x: a.x, y: a.y };
    },
    /** Every concrete shape an area has right now: [{ key, shape }]. One for a fixed area, one per loaded place for a poi area, none in another scene. */
    shapes(id) {
      const area = areas[id];
      if (area.scene && area.scene !== scene) return [];
      if (!area.poi) return [{ key: '', shape: area }];
      return [...(places.get(area.poi) ?? [])].map(([key, place]) => ({ key, shape: areaAt(area, place) }));
    },
    /** Where `who` is inside `place`: '' for a fixed area or an actor in reach, the place's key for a poi area, null when outside. */
    insideKey(place, who, reach) {
      const subject = actor(who ?? e.player);
      if (!subject) return null;
      if (e.isArea(place)) { for (const { key, shape } of e.shapes(place)) if (areaContains(shape, subject.x, subject.y)) return key; return null; }
      const other = actor(place);
      return other && other !== subject && Math.hypot(other.x - subject.x, other.y - subject.y) <= (reach ?? 2) ? '' : null;
    },
    inside: (place, who, reach) => e.insideKey(place, who, reach) !== null,
    scene: () => scene,
    setScene(name) { const previous = scene; scene = name ?? null; return previous; },
    places,
    hour: () => (clock && typeof clock.hour === 'number' ? clock.hour : null),
    part: () => (clock ? (clock.part ?? (typeof clock.hour === 'number' ? partOfHour(clock.hour) : null)) : null),
    setHour(h) {
      if (clock && typeof clock.setHour === 'function') clock.setHour(h); else hooks.unhandled('setHour');
      hooks.timeJumped();
      hooks.emit('hour', { hour: h });
    },
    getVar(name) {
      if (Object.hasOwn(vars, name)) return vars[name];
      if (story) return story.getVar(name);
      throw new Error(`events: unknown variable "${name}" (vars: ${Object.keys(vars).join(', ') || 'none'})`);
    },
    setVar(name, value) {
      if (Object.hasOwn(vars, name)) {
        if (typeof value !== typeof vars[name]) throw new Error(`events.setVar: "${name}" is a ${typeof vars[name]}, got ${JSON.stringify(value)}`);
        const previous = vars[name];
        vars[name] = value;
        if (previous !== value) hooks.emit('varChanged', { name, value, previous });
      } else if (story) story.setVar(name, value);
      else throw new Error(`events.setVar: unknown variable "${name}" (vars: ${Object.keys(vars).join(', ') || 'none'})`);
    },
    vars: () => ({ ...vars }),
    loadVars(saved) { vars = { ...(data.vars ?? {}) }; for (const [k, v] of Object.entries(saved ?? {})) if (Object.hasOwn(vars, k) && typeof v === typeof vars[k]) vars[k] = v; },
    /** "Hello {name}" with variables filled in. Unknown names are left as they are. */
    text: (raw) => String(raw).replace(/\{([a-z][a-z0-9_]*)\}/g, (all, name) => { try { return String(e.getVar(name)); } catch { return all; } }),
    check: (c) => checkCondition(c, e),
    fired: (id) => hooks.fired(id) > 0,
    setEnabled: (id, on) => hooks.setEnabled(id, on),
    /** Where the game's own camera is now: the start and the end of every cutscene shot. */
    cameraNow() {
      const now = drivers.cameraNow?.();
      if (now) return { x: now.x, y: now.y, zoom: now.zoom ?? 1, yaw: now.yaw ?? null, pitch: now.pitch ?? null, height: now.height ?? null, distance: now.distance ?? null };
      const p = actor(e.player);
      return { x: p?.x ?? 0, y: p?.y ?? 0, zoom: 1, yaw: null, pitch: null, height: null, distance: null };
    },
    moveActor(a, x, y, id, teleport) {
      if (drivers.moveActor) drivers.moveActor(a, x, y, { id, teleport }); else { a.x = x; a.y = y; }
      if (teleport) hooks.emit('placed', { actor: id, x, y });
    },
    face(a, degrees, id) {
      if (drivers.face) drivers.face(a, degrees, { id }); else a.facing = degrees;
    },
    animate(id, clip) {
      if (drivers.animate) drivers.animate(actor(id), clip, { id }); else hooks.unhandled('animate');
      hooks.emit('animate', { actor: id, clip });
    },
    /** sound and music: hand to the driver when there is one, and always tell listeners. */
    drive(kind, payload) {
      if (drivers[kind]) drivers[kind](payload.name, payload); else hooks.unhandled(kind);
      hooks.emit(kind, payload);
    },
    quest(effect) {
      if (story) story.apply(effect); else if (drivers.quest) drivers.quest(effect); else hooks.unhandled('quest');
      hooks.emit('quest', { effect });
    },
    /** Open a conversation. Returns a function that is true while it is still open, or null when nothing can show it. */
    startDialogue(id) {
      hooks.emit('dialogue', { dialogue: id });
      if (drivers.dialogue) {
        const handle = drivers.dialogue(id);
        const active = typeof handle === 'function' ? handle : handle && typeof handle.active === 'function' ? () => handle.active() : null;
        if (!active) return null;
        let told = false;
        return () => { const on = !!active(); if (!on && !told && !story) { told = true; hooks.notify('dialogueEnded', id); } return on; };
      }
      if (story) { story.start(id); return () => story.view().active; }
      hooks.unhandled('dialogue');
      return null;
    },
  };
  return e;
}
