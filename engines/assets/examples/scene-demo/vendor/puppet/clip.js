// Clips: one piece of motion with a length, either keyframes (plain JSON) or a function that
// writes angles for a phase from 0 to 1 (procedural motion such as a walk cycle).
import { ease, lerp } from './math.js';

const sortedEvents = (events, duration, who) => (events ?? []).map((e) => {
  const [t, name] = Array.isArray(e) ? e : [e.t, e.name];
  if (typeof t !== 'number' || t < 0 || t > duration || typeof name !== 'string') throw new Error(`${who}: bad event ${JSON.stringify(e)}; use [time in seconds within the clip, "name"]`);
  return [t, name];
}).sort((a, b) => a[0] - b[0]);

function compileTrack(keys, who) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error(`${who}: a track must be a non-empty list of [t, a, b, c, ease?]`);
  const out = keys.map((k) => {
    if (!Array.isArray(k) || k.length < 4 || k.slice(0, 4).some((v) => typeof v !== 'number')) throw new Error(`${who}: bad key ${JSON.stringify(k)}; use [t, a, b, c, ease?]`);
    return { t: k[0], v: [k[1], k[2], k[3]], ease: ease(k[4] ?? 'inOut') };
  });
  for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) throw new Error(`${who}: keys must be in time order`);
  return out;
}

function sampleTrack(track, t, out, o) {
  let i = 0;
  while (i < track.length - 1 && track[i + 1].t <= t) i++;
  const a = track[i];
  const b = track[i + 1];
  if (!b || t <= a.t) { out[o] = a.v[0]; out[o + 1] = a.v[1]; out[o + 2] = a.v[2]; return; }
  const k = b.ease((t - a.t) / (b.t - a.t || 1));
  for (let j = 0; j < 3; j++) out[o + j] = lerp(a.v[j], b.v[j], k);
}

/**
 * Prepare a clip for one rig (resolves bone names once).
 * @param {object} rig
 * @param {object} def
 * @param {string} [def.name]
 * @param {number} def.duration   Seconds for one pass.
 * @param {boolean} [def.loop]    Default true.
 * @param {Object<string,Array>} [def.tracks]  Keyframes: { boneName: [[t, rx, ry, rz, ease?], ...], root: [[t, x, y, z, ease?], ...] }.
 *   The ease name shapes the move INTO that key (default "inOut"). Looping clips should repeat the first key at t = duration.
 * @param {(u:number, w:object, params:object) => void} [def.sample]  Procedural clip: u is the phase 0..1; call
 *   w.set(bone, rx, ry, rz), w.add(bone, rx, ry, rz) and w.root(x, y, z).
 * @param {Array} [def.events]    [[t, "name"], ...]: fired when playback passes time t.
 * @param {object} [def.meta]     Free-form numbers for game code, e.g. { stride: 1.5 } (ground covered per pass).
 * @returns {{name:string, duration:number, loop:boolean, events:Array, meta:object, apply:Function, eventsBetween:Function}}
 */
export function bindClip(rig, def) {
  const who = `bindClip("${def?.name ?? '?'}")`;
  if (!def || !(def.duration > 0)) throw new Error(`${who}: "duration" must be a positive number of seconds, got ${def?.duration}`);
  if (!def.tracks && typeof def.sample !== 'function') throw new Error(`${who}: a clip needs "tracks" or a "sample" function`);
  const duration = def.duration;
  const loop = def.loop ?? true;
  const tracks = Object.entries(def.tracks ?? {}).map(([bone, keys]) => ({
    offset: bone === 'root' ? -1 : rig.boneIndex(bone, who) * 3,
    keys: compileTrack(keys, `${who} track "${bone}"`),
  }));
  let pose = null;
  const writer = {
    set(bone, rx = 0, ry = 0, rz = 0) { const o = rig.boneIndex(bone, who) * 3; pose.rot[o] = rx; pose.rot[o + 1] = ry; pose.rot[o + 2] = rz; return writer; },
    add(bone, rx = 0, ry = 0, rz = 0) { const o = rig.boneIndex(bone, who) * 3; pose.rot[o] += rx; pose.rot[o + 1] += ry; pose.rot[o + 2] += rz; return writer; },
    root(x = 0, y = 0, z = 0) { pose.root[0] = x; pose.root[1] = y; pose.root[2] = z; return writer; },
  };
  const events = sortedEvents(def.events, duration, who);
  return {
    name: def.name ?? 'clip',
    duration,
    loop,
    events,
    meta: { ...(def.meta ?? {}) },
    /** Write the clip's pose at time t (seconds) into `out`. Bones the clip does not mention are set to rest (0). */
    apply(out, t, params = {}) {
      out.rot.fill(0); out.root[0] = 0; out.root[1] = 0; out.root[2] = 0;
      const time = loop ? ((t % duration) + duration) % duration : Math.min(Math.max(t, 0), duration);
      for (const tr of tracks) {
        if (tr.offset < 0) sampleTrack(tr.keys, time, out.root, 0);
        else sampleTrack(tr.keys, time, out.rot, tr.offset);
      }
      if (def.sample) { pose = out; def.sample(time / duration, writer, params); pose = null; }
      return out;
    },
    /** Names of events passed while playback moved from time t0 to t1 (t1 >= t0, both unwrapped). `looping` defaults to the clip's own setting. */
    eventsBetween(t0, t1, looping = loop) {
      const out = [];
      if (!events.length || t1 <= t0) return out;
      if (!looping) {
        for (const [t, name] of events) if (t > t0 && t <= t1) out.push(name);
        if (t0 === 0) for (const [t, name] of events) if (t === 0) out.unshift(name);
        return out;
      }
      for (let lap = Math.floor(t0 / duration); lap * duration < t1; lap++) {
        for (const [t, name] of events) {
          const at = lap * duration + t;
          if ((at > t0 && at <= t1) || (at === 0 && t0 === 0)) out.push(name);
        }
      }
      return out;
    },
  };
}
