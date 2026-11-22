// The sky engine as a base plugin: it becomes THE clock of the day. Every view, the ai, the lamps
// and the music read base.time, and with this plugin base.time.now is the sky's full sample
// (sun and moon, light direction, colour and strength, sky and fog colours, lamps, stars).
//   plugins: [skyPlugin({ dayLength: 1200, startHour: 8 })]
import { createSky } from './sky.js';
import { createFirstPersonLink } from './firstperson.js';
import { createBakedLook, createBlendedOrbit, drawGrade } from './baked.js';

const SKY_EVENTS = ['sunrise', 'sunset', 'lampsOn', 'lampsOff', 'hour', 'day', 'part', 'moon'];
const HOLD = { day: 12.6, dusk: 18.5, night: 0.6, dawn: 6.4 };

/**
 * skyPlugin(options) -> plugin
 *   options: anything createSky takes (dayLength, startHour, sunrise, sunset, light, colors, moon ...).
 *   options.setting  false: do not add the "Time of day" setting. Default: added, with 'clock' (the day runs) and held times.
 *   options.times    which held times the setting offers, from 'dawn', 'day', 'dusk', 'night' (default all four). A game
 *                    whose pictures are baked for some times only can list those: times: ['day', 'dusk', 'night'].
 *                    (A time without a bake still shows properly: bakedLook fades and tints its neighbours into it.)
 * base.plugin('sky') -> { sky, hold(name), run(), firstPersonLink(o), bakedLook(o), blendedOrbit(o), drawGrade }
 *   The last four are the sky engine's joins for views (live 3D views, baked Kiln pictures).
 * Bus: 'sky:sunrise', 'sky:sunset', 'sky:lampsOn', 'sky:lampsOff', 'sky:hour', 'sky:day', 'sky:part', 'sky:moon'.
 * The hour is saved with the base's own part of the save; nothing else to do.
 */
export function skyPlugin(options = {}) {
  const { setting, times = ['dawn', 'day', 'dusk', 'night'], ...skyOptions } = options;
  if (!Array.isArray(times) || times.some((t) => !(t in HOLD))) throw new Error(`skyPlugin: "times" must list some of ${Object.keys(HOLD).join(', ')}, got ${JSON.stringify(times)}`);
  return {
    name: 'sky',
    settings: setting === false ? [] : [{ id: 'sky.time', label: 'Time of day', type: 'choice', value: 'clock', options: [{ value: 'clock', label: 'clock (the day runs)' }, ...times] }],
    install(base) {
      const sky = createSky(skyOptions);
      for (const name of SKY_EVENTS) { try { sky.on(name, (e) => base.bus.emit('sky:' + name, e)); } catch { /* not in this sky version */ } }
      // the clock the base steps: the sky itself, in the shape base.time asks for
      base.time.use({
        step: (dt) => { sky.step(dt); },
        get hour() { return sky.hour; }, get day() { return sky.day; }, get now() { return sky.now; },
        get rate() { return sky.rate; }, set rate(v) { sky.rate = v; },
        get config() { return sky.config; },
        setHour: (h) => { if (Math.abs(sky.hour - h) > 1e-6) sky.setHour(h); },
        save: () => sky.save(), load: (data) => sky.load(data),
      });
      const hold = (name) => {
        if (!(name in HOLD)) throw new Error(`sky.hold: expected one of ${Object.keys(HOLD).join(', ')}, got ${JSON.stringify(name)}`);
        base.time.hold(HOLD[name]);
        if (name === 'night') sky.setMoonPhase(0.5); // a held night is the baked one: full moon
      };
      const run = () => base.time.run();
      // a saved choice that this game no longer offers runs the clock, it never throws
      if (setting !== false) base.settings.watch('sky.time', (v) => (times.includes(v) ? hold(v) : run()));
      // the joins to the views, handed out here because a view plugin never imports the sky
      return { sky, hold, run, firstPersonLink: (o) => createFirstPersonLink(o), bakedLook: (o) => createBakedLook({ day: sky.config.day, ...o }), blendedOrbit: (o) => createBlendedOrbit(o), drawGrade };
    },
  };
}
