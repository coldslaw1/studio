// Small joins to other engines. Each takes the other engine's object; nothing is imported.

/**
 * Keep the ai engine's hour of the day on the sky's. Call sync() once per update, before ai.step.
 * Give createAi the same dayLength as the sky: the ai's own clock then keeps time between syncs and
 * for agents that sleep far away, and sync() only corrects it after a jump (sky.setHour, a bed, a load)
 * or a change of sky.rate.
 * @param {object} sky  From createSky.
 * @param {object} ai   From the ai engine's createAi (anything with `hour` and setHour(h)).
 * @param {{tolerance?:number}} [o]  Hours the two may differ before the ai is set (default 0.02, about a game minute).
 * @returns {{sync:() => boolean, corrections:number, matched:boolean}}  sync returns true when it had to set the ai's hour.
 */
export function bindAi(sky, ai, o = {}) {
  if (!sky || typeof sky.step !== 'function' || !sky.now) throw new Error('bindAi: the first argument must be a sky from createSky');
  if (!ai || typeof ai.setHour !== 'function') throw new Error('bindAi: the second argument must be an ai from createAi (it needs setHour)');
  const tolerance = o.tolerance ?? 0.02;
  const link = {
    /** False when the ai was made with another dayLength than the sky: it still follows, but sync() corrects it all the time and far-away agents catch up at the ai's own pace. */
    matched: ai.config?.dayLength === undefined || Math.abs(ai.config.dayLength - sky.config.dayLength) < 1e-6,
    corrections: 0,
    sync() {
      const gap = ((sky.now.hour - ai.hour) % 24 + 36) % 24 - 12;
      if (gap > -tolerance && gap < tolerance) return false;
      ai.setHour(sky.now.hour); link.corrections++;
      return true;
    },
  };
  link.sync();
  return link;
}

/**
 * The settings of a sky that fit a Kiln scene: its "light" (the noon sun passes through it) and the
 * daytime colours of its "shading". Spread into createSky: createSky({ ...skyOptionsOfScene(scene), dayLength: 900 }).
 */
export function skyOptionsOfScene(scene) {
  if (!scene || typeof scene !== 'object') throw new Error(`skyOptionsOfScene: expected a Kiln scene, got ${JSON.stringify(scene)}`);
  const sh = typeof scene.shading === 'object' && scene.shading !== null ? scene.shading : {};
  const out = { colors: { sun: sh.sun ?? '#fff2d6', sky: sh.sky ?? '#a8bce8' } };
  if (Array.isArray(scene.light)) out.light = scene.light.slice(0, 3);
  return out;
}

/**
 * The value for a Kiln scene's "time" key that bakes a picture in the light of a sample:
 * scene.time = kilnTime(sky.at(seconds)). For Kiln's named times use 'dawn', 'day', 'dusk', 'night' as before.
 */
export function kilnTime(sample) {
  return Math.round(sample.kilnHour * 100) / 100 % 24;
}
