// The events engine as a plugin of the base engine (studio-engines/base):
//   createBase({ plugins: [ ..., eventsPlugin({ data: eventsJson }) ] })
// A running cutscene takes the player's input through the base's focus stack: it pushes the layer
// 'cutscene' and reads only that layer's input, so gameplay under it hears nothing, in every view.
import { createEvents } from './events.js';
import { drawEventsOverlay } from './overlay.js';

/** Things a puppet character can do by name (the puppet engine's createCharacter methods). */
const CHARACTER_CALLS = ['attack', 'hurt', 'die', 'revive', 'wave'];

/**
 * eventsPlugin(options) -> plugin
 *   options.data      the events data (required)
 *   options.actions, storyData, walkSpeed, charsPerSecond, skipHold, inputActions   as in createEvents
 *   options.story     a dialogue story, when the game has no dialogue plugin
 *   options.drivers   replace any default driver (see README "Drivers")
 *   options.playerId  the player's actor id. Default 'hero' when the base's hero plugin is in, else the file's "player".
 *   options.sceneFrom 'view' or 'mode': the events' scene follows base.views.name or base.mode. Default: the game calls setScene.
 *   options.placeOf   (feature, chunk) => { poi, key, x, y } for the world plugin's points of interest. Default: tile centre.
 *   options.layer     the focus layer id. Default 'cutscene'.
 *   options.order     where in the 'sim' phase the engine updates. Default 50.
 *   options.draw      false: the game draws events.view() itself.
 *   options.promptKey label of the interact key in the hint (default 'E').   options.font  CSS font of the overlay.
 *   options.scale     real pixels per logical pixel of the canvas, a number or a function (base) => number, for HiDPI
 *                     canvases. Default: base.pixelRatio when the base has one, else 1.
 * base.plugin('events') -> { events, shot, busy, run(id), fire(id), notify(name, payload), setScene(name), addPlace(poi, key, at), removePlace(poi, key), save(), load(data) }
 * Bus: every engine event is re-published as 'events:<type>' (events:trigger, events:sequenceStarted,
 * events:sequenceEnded, events:cutscene, events:line, events:camera, events:animate, events:sound, events:music,
 * events:quest, events:event, events:hour, events:varChanged). 'events:camera' carries the wanted shot
 * { x, y, zoom, yaw, pitch, height, distance, actor, follow, pov, time }, or null when the camera is given back. An `emit` step whose name has a colon
 * ("ui:toast") is also sent under that very name. Every other bus event reaches triggers written as
 * { "when": { "event": "combat:kill" } }.
 */
export function eventsPlugin(options = {}) {
  return {
    name: 'events',
    requires: [],
    uses: ['dialogue', 'camera', 'puppet', 'audio', 'sky', 'ui', 'inventory', 'combat', 'world', 'hero'],
    settings: [],
    actions: { [options.inputActions?.interact ?? 'interact']: ['KeyE'] }, // the base binds it unless the game already did
    install(base) {
      if (!options.data || typeof options.data !== 'object') throw new Error(`eventsPlugin: options.data must be the events data object, got ${JSON.stringify(options.data)}`);
      const layer = options.layer ?? 'cutscene';
      const partner = (name) => (base.has(name) ? base.plugin(name) : null);
      const dialogue = partner('dialogue'); const camera = partner('camera'); const puppet = partner('puppet'); const audio = partner('audio');
      const world = partner('world')?.world ?? null;
      const interactKey = options.inputActions?.interact ?? 'interact';
      const hero = base.has('hero'); const useKey = options.inputActions?.use ?? 'use';
      const character = (actor, id) => puppet?.character?.(id) ?? actor?.character ?? null;
      const drivers = {
        animate(actor, clip, info) {
          const c = character(actor, info.id);
          if (!c) return;
          if (clip === 'idle') { if (typeof c.wave === 'function') c.wave(false); return; }
          if (CHARACTER_CALLS.includes(clip) && typeof c[clip] === 'function') { c[clip](); return; }
          if (clip !== 'walk') { try { c.animator?.play?.(clip); } catch { /* the rig has no such state: the bus event still goes out */ } }
        },
        face(actor, degrees) { actor.facing = degrees; },
        ...(dialogue && typeof dialogue.talk === 'function' ? {
          dialogue(id) { dialogue.talk(id); return () => (typeof dialogue.active === 'function' ? dialogue.active() : !!dialogue.active); },
        } : {}),
        ...(camera ? {
          cameraNow() { const c = camera.camera; return c ? { x: c.x, y: c.y, zoom: c.zoom, yaw: c.yaw, pitch: c.pitch, height: c.height, distance: c.distance } : null; },
        } : {}),
        ...(audio ? {
          sound(name, o) { audio.play?.(name, { volume: o.volume }); },
          music(name, o) { audio.music?.(name, { time: o.time }); },
        } : {}),
        ...(options.drivers ?? {}),
      };
      const events = createEvents(options.data, {
        actions: options.actions, storyData: options.storyData, walkSpeed: options.walkSpeed, charsPerSecond: options.charsPerSecond,
        skipHold: options.skipHold, inputActions: options.inputActions, personalSpace: options.personalSpace, validate: options.validate,
        actors: options.actors ?? base.actors,
        playerId: options.playerId ?? (base.has('hero') ? 'hero' : undefined),
        scene: options.scene,
        clock: options.clock ?? base.time,
        story: options.story ?? dialogue?.story ?? null,
        drivers,
      });

      events.on('*', (ev) => {
        if (ev.type === 'cutscene') { if (ev.active) base.focus.push({ id: layer, pausesSim: false, pointer: 'free', kind: 'cutscene' }); else base.focus.pop(layer); }
        if (ev.type === 'camera' && camera) { if (ev.release) camera.release?.(); else camera.shot?.({ x: ev.x, y: ev.y, zoom: ev.zoom, yaw: ev.yaw, pitch: ev.pitch, height: ev.height, distance: ev.distance, actor: ev.follow ? ev.actor : null, pov: ev.pov ?? null, time: ev.time }); }
        // the camera plugin's contract for 'events:camera': a wanted shot, or null to give the camera back
        base.bus.emit(`events:${ev.type}`, ev.type === 'camera' && ev.release ? null : ev);
        if (ev.type === 'event' && ev.name.includes(':') && !ev.name.startsWith('events:')) base.bus.emit(ev.name, ev.data ?? {});
      });
      base.bus.on('time:jump', () => events.timeJumped());
      base.bus.on('*', (payload, name) => { if (!name.startsWith('events:')) events.notify(name, payload); });

      // Open world: every point of interest the world streams in becomes a place for "poi" areas, and leaves with its chunk.
      const tile = world?.tileSize ?? 1;
      const placeOf = options.placeOf ?? ((f) => ({ poi: f.name, key: `${f.tx},${f.ty}`, x: (f.tx + 0.5) * tile, y: (f.ty + 0.5) * tile }));
      const eachFeature = (chunk, fn) => { for (const f of chunk?.features ?? []) { const p = placeOf(f, chunk); if (p) fn(p); } };
      base.bus.on('world:load', (chunk) => eachFeature(chunk, (p) => events.addPlace(p.poi, p.key, p)));
      base.bus.on('world:unload', (chunk) => eachFeature(chunk, (p) => events.removePlace(p.poi, p.key)));
      // Scenes: follow the showing view or the game's mode when asked to, else the game calls setScene itself.
      const known = (name) => !options.data.scenes || options.data.scenes.includes(name);
      const follow = (name) => { if (typeof name === 'string' && known(name)) events.setScene(name); };
      if (options.sceneFrom === 'view') { follow(base.views.name); base.bus.on('view:changed', (ev) => follow(ev.name)); }
      else if (options.sceneFrom === 'mode') { follow(base.mode); base.bus.on('mode:changed', (ev) => follow(ev.mode)); }
      else if (options.sceneFrom) throw new Error(`eventsPlugin: options.sceneFrom must be 'view' or 'mode', got ${JSON.stringify(options.sceneFrom)}`);

      base.on('sim', (dt) => {
        if (events.busy) events.cutsceneInput(base.input.for(layer), dt);
        else {
          // one interaction key per game: with the hero plugin its "use" key (Space) also fires interact triggers
          const game = base.input.game; const has = (name) => (base.input.has ? base.input.has(name) : true);
          const use = hero && (has(useKey) ? game.pressed(useKey) : game.pressed('confirm'));
          if (game.pressed(interactKey) || use || (!has(interactKey) && game.pressed('confirm'))) events.interact();
        }
        events.update(dt);
      }, { order: options.order ?? 50, owner: 'events' });
      if (options.draw !== false) {
        base.on('draw:overlay', (ctx) => {
          const tokens = base.style.tokens ?? {};
          drawEventsOverlay(ctx, events.view(), {
            width: base.width, height: base.height, palette: tokens.palette, font: options.font ?? (tokens.font?.ui && /\d/.test(tokens.font.ui) ? tokens.font.ui : undefined),
            promptKey: options.promptKey, scale: (typeof options.scale === 'function' ? options.scale(base) : options.scale) ?? base.pixelRatio ?? 1, toScreen: (x, y) => base.views.toScreen(x, y, 1.9),
          });
        }, { owner: 'events' });
      }
      return {
        events,
        get shot() { return events.shot; },
        get busy() { return events.busy; },
        run: (id) => events.run(id),
        fire: (id) => events.fire(id),
        notify: (name, payload) => events.notify(name, payload),
        setScene: (name) => events.setScene(name),
        addPlace: (poi, key, at) => events.addPlace(poi, key, at),
        removePlace: (poi, key) => events.removePlace(poi, key),
        save: () => events.save(),
        load: (data) => events.load(data),
      };
    },
  };
}
