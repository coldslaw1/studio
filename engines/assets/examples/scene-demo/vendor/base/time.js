// Game time: one hour of the day for the whole game. The base steps it once per tick (never while
// a menu pauses the game), and every plugin reads the same value: views, lamps, the ai, the music.
// By itself this is a plain 24-hour clock. The sky plugin replaces the source with the sky engine,
// which adds the sun, the moon and the light; everything else keeps reading base.time.

const PARTS = [[5, 'night'], [8, 'dawn'], [17, 'day'], [20, 'dusk'], [24, 'night']];
/** 'night', 'dawn', 'day' or 'dusk' for an hour 0..24. */
export function partOfHour(hour) { for (const [end, name] of PARTS) if (hour < end) return name; return 'night'; }

/** A plain day clock: the default source of base.time. */
export function createDayClock(options = {}) {
  const dayLength = options.dayLength ?? 1200; // real seconds per game day
  if (!(dayLength > 0)) throw new Error(`createDayClock: dayLength must be > 0 seconds, got ${dayLength}`);
  let hour = (((options.startHour ?? 8) % 24) + 24) % 24; let day = 0;
  const clock = {
    rate: 1,
    get hour() { return hour; }, get day() { return day; },
    get now() { return { hour, day, part: partOfHour(hour) }; },
    get config() { return { dayLength, startHour: options.startHour ?? 8 }; },
    step(dt) { hour += (dt * clock.rate * 24) / dayLength; while (hour >= 24) { hour -= 24; day += 1; } },
    setHour(h) { if (!(h >= 0 && h < 24)) throw new Error(`time.setHour: expected an hour from 0 to 24, got ${h}`); if (h < hour) day += 1; hour = h; },
    save() { return { hour, day, rate: clock.rate }; },
    load(data) { hour = data.hour ?? hour; day = data.day ?? day; clock.rate = data.rate ?? 1; },
  };
  return clock;
}

/**
 * createTime(options) -> time
 *   options.source   a clock: { step(dt), hour, now, setHour(h), rate, save(), load(data) }. Default createDayClock(options).
 *   options.bus      optional bus: 'time:part' { part, previous } when night turns to dawn and so on,
 *                    'time:jump' { hour } after setHour, a load or a new source.
 * time:
 *   hour, part, now, day   read these anywhere; `now` is the source's own sample (the sky's light when the sky plugin is in)
 *   raw               the source's sample before any modifier
 *   modify(fn, { order })   lay something over the sample everyone reads: fn(sample) returns the sample to show (the
 *                     weather dims the sun this way). Return a different object, reused between calls; never change `sample`. Returns a remover.
 *   step(dt)          the base calls this once per tick. Do not call it from a plugin.
 *   setHour(h)        jump to an hour
 *   rate              1 = the day runs, 0 = it stands still
 *   hold(hour)        stop the day at an hour;  run() lets it go on
 *   use(source, { keepHour })   replace the clock (the sky plugin does). The new clock's own hour counts, unless keepHour is true.
 *   source            the clock in use
 *   save(), load(data)
 */
export function createTime(options = {}) {
  const { bus = null } = options;
  let source = options.source ?? createDayClock(options);
  let part = partOfHour(source.hour);
  const modifiers = [];
  const sync = () => {
    const next = source.now?.part ?? partOfHour(source.hour);
    if (next !== part) { const previous = part; part = next; bus?.emit('time:part', { part, previous }); }
  };
  const jumped = () => { sync(); bus?.emit('time:jump', { hour: source.hour }); };
  const time = {
    get source() { return source; },
    get hour() { return source.hour; },
    get day() { return source.day ?? 0; },
    get part() { return part; },
    get now() { let sample = source.now; for (const m of modifiers) sample = m.fn(sample) ?? sample; return sample; },
    get raw() { return source.now; },
    modify(fn, o = {}) {
      if (typeof fn !== 'function') throw new Error('time.modify: expected a function (sample) => sample');
      const entry = { fn, order: o.order ?? 0 };
      modifiers.push(entry); modifiers.sort((a, b) => a.order - b.order);
      return () => { const i = modifiers.indexOf(entry); if (i >= 0) modifiers.splice(i, 1); };
    },
    get rate() { return source.rate; }, set rate(v) { if (!(v >= 0)) throw new Error(`time.rate: expected a number >= 0, got ${v}`); source.rate = v; },
    step(dt) { source.step(dt); sync(); },
    setHour(h) { if (!(h >= 0 && h < 24)) throw new Error(`time.setHour: expected an hour from 0 to 24, got ${h}`); source.setHour(h); jumped(); },
    hold(h) { time.rate = 0; if (h !== undefined) time.setHour(h); },
    run() { time.rate = 1; },
    use(next, o = {}) {
      for (const m of ['step', 'setHour']) if (typeof next?.[m] !== 'function') throw new Error(`time.use: a clock needs ${m}(), got ${typeof next?.[m]}`);
      const hour = source.hour; const rate = source.rate;
      source = next;
      if (o.keepHour) { if (Math.abs(source.hour - hour) > 1e-6) source.setHour(hour); source.rate = rate; }
      jumped();
    },
    save() { return source.save ? source.save() : { hour: source.hour }; },
    load(data) { if (source.load) source.load(data); else if (data?.hour !== undefined) source.setHour(data.hour); jumped(); },
  };
  return time;
}
