// Small hooks to the other engines: audio (agents hear the game's sounds, and make their own), puppet
// (bodies play what the mind is doing), dialogue (talking to an NPC) and the ui kit (barks on screen).
// Each takes the other engine's object and uses only its documented calls; nothing is imported.
import { need } from './util.js';

/**
 * bindAudio(ai, audio, options) -> { play(sound, opts), dispose() }
 *   Use link.play in place of audio.play for sounds that happen at a place: it plays the sound AND lets
 *   agents in earshot hear it. opts: the audio engine's own (`at: { x, y }`, volume, ...) plus `loud`
 *   (how far agents hear it, game units; default options.loud = 12 metres) and `by` (who made it).
 *   options.sounds maps ai events to sound names, e.g. { aggro: 'growl', attack: 'swing', death: 'thud' }:
 *   those are then played at the agent's position.
 */
export function bindAudio(ai, audio, options = {}) {
  need(audio && typeof audio.play === 'function', 'bindAudio: audio must have play(sound, opts)');
  const loud = options.loud ?? 12 * ai.config.unit;
  const map = options.sounds || {};
  const offs = Object.keys(map).sort().map((type) => ai.on(type, (e) => {
    const a = ai.has(e.id) ? ai.get(e.id) : null;
    const x = e.x ?? a?.x; const y = e.y ?? a?.y;
    audio.play(map[type], Number.isFinite(x) && Number.isFinite(y) ? { at: { x, y } } : {});
  }));
  return {
    play(sound, opts = {}) {
      const { loud: l, by, kind, ...rest } = opts;
      if (rest.at && Number.isFinite(rest.at.x) && Number.isFinite(rest.at.y)) ai.sound({ x: rest.at.x, y: rest.at.y, loud: l ?? loud, kind: kind ?? 'noise', by: by ?? null });
      return audio.play(sound, rest);
    },
    dispose() { for (const off of offs) off(); },
  };
}

/**
 * bindPuppet(ai, id, character) -> { update(dt), dispose() }
 *   Drives a puppet engine character from an agent: update(dt) feeds it the agent's position and facing
 *   (walking and running follow by themselves), and the agent's attacks, wounds, death and conversations
 *   trigger character.attack(), .hurt(), .die() and .wave().
 */
export function bindPuppet(ai, id, character) {
  need(character && typeof character.update === 'function', 'bindPuppet: character must come from the puppet engine\'s createCharacter');
  const mine = (fn) => (e) => { if (e.id === id) fn(e); };
  const offs = [
    ai.on('anim', mine((e) => { if (e.anim === 'attack' || e.anim === 'charge') character.attack?.(); })),
    ai.on('hurt', mine(() => character.hurt?.())),
    ai.on('death', mine(() => character.die?.())),
    ai.on('talk', mine(() => character.wave?.(true))),
    ai.on('talkEnd', mine(() => character.wave?.(false))),
  ];
  return {
    update(dt) {
      if (!ai.has(id)) return [];
      const a = ai.get(id);
      return character.update(dt, { x: a.x, y: a.y, facing: a.facing, grounded: true });
    },
    dispose() { for (const off of offs) off(); },
  };
}

/**
 * bindDialogue(ai, story, options) -> { talk(agentId, withId), dispose() }
 *   talk() asks the agent to stop and listen (ai.talk) and opens its dialogue in the dialogue engine's
 *   story (story.start); when the story reports 'dialogueEnded' the agent goes back to its day.
 *   Returns { ok, dialogue, view } (view is the story's first line), or { ok: false, reason }.
 *   options.fallback: dialogue id for agents that have none.
 */
export function bindDialogue(ai, story, options = {}) {
  need(story && typeof story.start === 'function' && typeof story.on === 'function', 'bindDialogue: story must come from the dialogue engine\'s createStory');
  let talking = null;
  const off = story.on('dialogueEnded', () => { if (talking && ai.has(talking)) ai.endTalk(talking); talking = null; });
  return {
    talk(agentId, withId) {
      const r = ai.talk(agentId, withId);
      if (!r.ok) return r;
      const dialogue = r.dialogue ?? options.fallback ?? null;
      if (!dialogue) { ai.endTalk(agentId); return { ok: false, reason: 'nothing to say', dialogue: null }; }
      talking = agentId;
      return { ok: true, dialogue, view: story.start(dialogue) };
    },
    dispose() { if (typeof off === 'function') off(); },
  };
}

/**
 * bindBarks(ai, show, options) -> dispose(). Shows barks on screen. `show` is the ui kit (its toast is
 * used) or your own function (event) => void for speech bubbles. options.near: { x, y, radius } getter
 * `() => ({ x, y, radius })` so only barks within earshot of the player are shown.
 */
export function bindBarks(ai, show, options = {}) {
  const fn = typeof show === 'function' ? show : show && typeof show.toast === 'function' ? (e) => show.toast(e.text, options.seconds ?? 2) : null;
  need(fn, 'bindBarks: second argument must be a function (event) => void or a ui with toast(text, seconds)');
  return ai.on('bark', (e) => {
    if (options.near) { const n = options.near(); if (n && (e.x - n.x) * (e.x - n.x) + (e.y - n.y) * (e.y - n.y) > n.radius * n.radius) return; }
    fn(e);
  });
}
