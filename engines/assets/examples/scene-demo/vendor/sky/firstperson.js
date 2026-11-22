// Joins the sky to a world of the first-person engine (studio-engines/firstperson, createFpWorld),
// which also draws the orbit view: every frame the world's light, sky colours, haze and lamps are set
// from the sky's sample, so the picture follows the hour without being rebuilt. It only writes
// numbers into the world the caller hands over; this file imports nothing from that engine.
//
// What it costs: about thirty number writes a frame. Cast shadows are the one expensive part: they
// are worked out again (world.relight, a few milliseconds) only when the light has moved by
// `relightDegrees`, which with a 20 minute day is once every several seconds.
const DEG = 180 / Math.PI;

/**
 * @param {object} [o]
 * @param {number} [o.relightDegrees]  How far the light may move before shadows are cast again (default 2.5).
 * @param {number} [o.fog]             The scene's atmosphere.fog, 0..1 (default 0): distance then fades into the fog colour.
 * @param {number} [o.lampPower]       Strength of a lamp object when it is fully dark (default 1.25, Kiln's).
 * @returns {{apply:Function, adopt:Function, stats:object}}
 */
export function createFirstPersonLink(o = {}) {
  const relightDegrees = o.relightDegrees ?? 2.5;
  const fog = o.fog ?? 0;
  const lampPower = o.lampPower ?? 1.25;
  if (!(relightDegrees > 0)) throw new Error(`createFirstPersonLink: "relightDegrees" must be above 0, got ${JSON.stringify(o.relightDegrees)}`);
  const minDot = Math.cos(relightDegrees / DEG);
  const known = new WeakMap(); // world -> what this link keeps about it
  const stats = { relights: 0, lastRelightMs: 0, lampsLit: 0 };
  const clock = o.now ?? (() => (globalThis.performance ? globalThis.performance.now() : 0));

  /**
   * Tell the link about a world's lamps (optional; apply() adopts a world it has not seen with steady = all).
   * Build the world with every lamp in it (for a Kiln scene: sceneFirstPersonWorld({ ...scene, time: 'night' })),
   * then say how many of the first ones always burn (the scene's own "lights"); the rest are lamp
   * objects, lit by the sky when it gets dark and gone from the work by day.
   * @param {object} world  From createFpWorld.
   * @param {{steady?:number}} [opts]  How many of world.lamps burn day and night (default: all of them).
   */
  function adopt(world, opts = {}) {
    if (!world || !world.light || !Array.isArray(world.light.dir) || !world.sky) throw new Error('firstPersonLink: expected a world from createFpWorld');
    const all = world.lamps ?? [];
    const steady = Math.min(all.length, opts.steady ?? all.length);
    if (!(Number.isInteger(steady) && steady >= 0)) throw new Error(`firstPersonLink.adopt: "steady" must be a whole number, 0 or more, got ${JSON.stringify(opts.steady)}`);
    const st = { all, steadyOnly: all.slice(0, steady), steady, lit: [0, 0, 0], asked: false };
    known.set(world, st);
    return st;
  }

  /**
   * Light a world for a sample of the sky. Call it each frame before view.render with whichever
   * world is being drawn (the open world hands out a new one near page edges: pass that one).
   * @param {object} world   From createFpWorld.
   * @param {object} sample  sky.now.
   * @returns {boolean} true when shadows were cast again this call
   */
  function apply(world, sample) {
    const st = known.get(world) ?? adopt(world);
    const lt = world.light; const L = sample.light;
    // light colours: the world keeps them times their strength
    for (let c = 0; c < 3; c++) { lt.sun[c] = L.color[c] * L.power; lt.sky[c] = sample.fill.color[c] * sample.fill.power; }
    // the backdrop and what distance fades into (0..255 there)
    const sk = world.sky; const top = sample.skyTop; const bot = sample.skyBottom; const stars = sample.stars;
    const glow = fog > 0 ? 0.35 + 0.65 * Math.min(1, sample.fill.power + L.power * 0.4) : 0;
    for (let c = 0; c < 3; c++) {
      sk.top[c] = top[c] * 255; sk.horizon[c] = bot[c] * 255;
      const pale = bot[c] + (1 - bot[c]) * 0.5; // by day the specks are faint, a little lighter than the sky
      sk.fg[c] = Math.round((pale + (1 - pale) * stars) * 255); // at night they are stars
      world.hazeColor[c] = fog > 0 ? sample.fogColor[c] * glow * 255 : bot[c] * 255;
    }
    // lamps: lamp objects burn as strongly as it is dark; by day they are not in the list at all
    const dark = sample.lamps;
    if (st.all.length > st.steady) {
      if (dark > 0.02) {
        for (let i = st.steady; i < st.all.length; i++) st.all[i].power = lampPower * dark;
        world.lamps = st.all;
      } else world.lamps = st.steadyOnly;
    }
    stats.lampsLit = world.lamps ? world.lamps.length : 0;
    // direction: the lit sides follow every frame; cast shadows only when it has moved enough
    const d = lt.dir; const n = L.dir;
    const moved = !st.asked || st.lit[0] * n[0] + st.lit[1] * n[1] + st.lit[2] * n[2] < minDot;
    if (!moved) { d[0] = n[0]; d[1] = n[1]; d[2] = n[2]; return false; }
    st.asked = true; st.lit[0] = n[0]; st.lit[1] = n[1]; st.lit[2] = n[2];
    if (typeof world.relight !== 'function') { d[0] = n[0]; d[1] = n[1]; d[2] = n[2]; return false; } // an engine without relight: shadows stay as built
    const t0 = clock();
    world.relight(n);
    stats.lastRelightMs = clock() - t0; stats.relights++;
    return true;
  }

  return { apply, adopt, stats };
}
