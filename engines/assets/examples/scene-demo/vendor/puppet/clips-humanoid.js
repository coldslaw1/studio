// Motion for the standard humanoid rig. Cycles (idle, walk, run, fall, wave) are procedural:
// built from sines, so they scale and blend cleanly. One-shots (jump, land, attack, hurt, die)
// are keyframes with easing. Angles: rx > 0 swings a hanging limb forward; "out" lifts a limb
// away from the body on its own side.

const TAU = Math.PI * 2;

/** Mirror keys written for both sides: [t, rx, out, twist, ease?] becomes tracks for boneL and boneR. */
function sym(tracks, bone, keys) {
  tracks[`${bone}L`] = keys.map(([t, rx, out = 0, tw = 0, e]) => [t, rx, -out, tw, e]);
  tracks[`${bone}R`] = keys.map(([t, rx, out = 0, tw = 0, e]) => [t, rx, out, -tw, e]);
}

/** One walking or running leg: sets thigh, shin and foot of a side for a swing value s = sin, c = cos of its phase. */
function leg(w, side, s, c, g) {
  const lift = Math.max(0, c);
  const thigh = g.swing * s + g.raise * lift;
  const knee = -(g.stand + g.flex * lift ** 1.3);
  w.set(`thigh${side}`, thigh, 0, 0);
  w.set(`shin${side}`, knee, 0, 0);
  w.set(`foot${side}`, -(thigh + knee) * 0.75 - g.toe * Math.max(0, -s), 0, 0);
}

/**
 * The clip set for a humanoid of the given height.
 * @param {{height?:number}} [o]
 * @returns {Object<string,object>} Clip descriptions by name: idle, walk, run, jump, fall, land, attack, hurt, die, wave.
 */
export function humanoidClips(o = {}) {
  const H = o.height ?? 1.8;
  const legLength = 0.455 * H;
  const walk = { swing: 26, raise: 6, stand: 6, flex: 48, toe: 14 };
  const run = { swing: 40, raise: 16, stand: 16, flex: 86, toe: 22 };

  const clips = {
    idle: {
      duration: 3.4,
      sample(u, w) {
        const b = Math.sin(u * TAU); const b2 = Math.sin(u * TAU * 2);
        w.root(0.004 * H * b2, 0, -0.004 * H * (1 + b));
        w.set('spine', 1 + b, 0, 0).set('chest', -1.5 - 1.5 * b, 0, 1.2 * b2).set('head', 1 + 0.8 * b, 0, -2.5 * b2);
        for (const [side, s] of [['L', 1], ['R', -1]]) {
          w.set(`arm${side}`, -2, -s * (7 + 1.5 * b), 0).set(`fore${side}`, 10 + 2 * b, 0, 0);
          w.set(`thigh${side}`, 1.5, -s * 3, s * 6).set(`shin${side}`, -3, 0, 0).set(`foot${side}`, 1.5, s * 3, 0);
        }
      },
    },
    walk: {
      duration: 0.92,
      meta: { stride: 4 * legLength * Math.sin(walk.swing * Math.PI / 180) },
      events: [[0.23, 'step'], [0.69, 'step']],
      sample(u, w) {
        const s = Math.sin(u * TAU); const c = Math.cos(u * TAU);
        w.root(0, 0, -0.02 * H * s * s);
        w.set('hips', 0, 0, -5 * s).set('spine', -3, 0, 4 * s).set('chest', -1, 0, 6 * s).set('head', 3, 0, -5 * s);
        leg(w, 'L', s, c, walk); leg(w, 'R', -s, -c, walk);
        w.set('armL', -24 * s, -6, 0).set('foreL', 16 - 10 * s, 0, 0);
        w.set('armR', 24 * s, 6, 0).set('foreR', 16 + 10 * s, 0, 0);
      },
    },
    run: {
      duration: 0.6,
      meta: { stride: 4 * legLength * Math.sin(run.swing * Math.PI / 180) * 1.3 },
      events: [[0.15, 'step'], [0.45, 'step']],
      sample(u, w) {
        const s = Math.sin(u * TAU); const c = Math.cos(u * TAU);
        w.root(0, 0, -0.035 * H * s * s + 0.015 * H);
        w.set('hips', -6, 0, -9 * s).set('spine', -8, 0, 7 * s).set('chest', -4, 0, 12 * s).set('head', 12, 0, -10 * s);
        leg(w, 'L', s, c, run); leg(w, 'R', -s, -c, run);
        w.set('armL', -44 * s, -9, 0).set('foreL', 78 - 14 * s, 0, 0);
        w.set('armR', 44 * s, 9, 0).set('foreR', 78 + 14 * s, 0, 0);
      },
    },
    fall: {
      duration: 0.7,
      sample(u, w) {
        const f = Math.sin(u * TAU);
        w.set('spine', -4, 0, 0).set('head', -6, 0, 0);
        w.set('armL', 20 + 6 * f, -(62 + 8 * f), 0).set('foreL', 24, 0, 0).set('armR', 20 - 6 * f, 62 - 8 * f, 0).set('foreR', 24, 0, 0);
        w.set('thighL', 26 + 5 * f, -5, 0).set('shinL', -42, 0, 0).set('footL', -18, 0, 0);
        w.set('thighR', -6 - 5 * f, 5, 0).set('shinR', -30, 0, 0).set('footR', -24, 0, 0);
      },
    },
    wave: {
      duration: 0.9,
      sample(u, w) {
        const f = Math.sin(u * TAU);
        w.set('chest', 0, -3, 0).set('head', 2, 5, 8);
        w.set('armL', 10, -128, 0).set('foreL', 0, 58 + 26 * f, 0).set('handL', 0, 12 * f, 0);
      },
    },
  };

  // ---- one-shots ----
  const jump = { root: [[0, 0, 0, -0.075 * H], [0.11, 0, 0, 0.01 * H, 'out'], [0.3, 0, 0, 0]], spine: [[0, -12, 0, 0], [0.11, 4, 0, 0, 'out'], [0.3, 0, 0, 0]], head: [[0, 8, 0, 0], [0.3, 4, 0, 0]] };
  sym(jump, 'thigh', [[0, 44], [0.11, -8, 0, 0, 'out'], [0.3, 8]]);
  sym(jump, 'shin', [[0, -78], [0.11, -4, 0, 0, 'out'], [0.3, -22]]);
  sym(jump, 'foot', [[0, 30], [0.11, -34, 0, 0, 'out'], [0.3, -20]]);
  sym(jump, 'arm', [[0, -38, 10], [0.13, 150, 14, 0, 'out'], [0.3, 120, 24]]);
  sym(jump, 'fore', [[0, 30], [0.13, 12], [0.3, 30]]);
  clips.jump = { duration: 0.3, loop: false, tracks: jump, events: [[0.08, 'jump']] };

  const land = { root: [[0, 0, 0, -0.03 * H], [0.07, 0, 0, -0.1 * H, 'out'], [0.3, 0, 0, 0, 'inOut']], spine: [[0, -6, 0, 0], [0.07, -20, 0, 0, 'out'], [0.3, 0, 0, 0]], head: [[0, 4, 0, 0], [0.07, 14, 0, 0], [0.3, 0, 0, 0]] };
  sym(land, 'thigh', [[0, 22], [0.07, 54, 4, 0, 'out'], [0.3, 2]]);
  sym(land, 'shin', [[0, -34], [0.07, -92, 0, 0, 'out'], [0.3, -3]]);
  sym(land, 'foot', [[0, 8], [0.07, 34, 0, 0, 'out'], [0.3, 1]]);
  sym(land, 'arm', [[0, 30, 40], [0.07, -24, 22, 0, 'out'], [0.3, -2, 7]]);
  sym(land, 'fore', [[0, 30], [0.07, 44], [0.3, 10]]);
  clips.land = { duration: 0.3, loop: false, tracks: land, events: [[0.02, 'land']] };

  // overhead chop with the right arm; "hit" marks the moment the blade comes down
  clips.attack = {
    duration: 0.5,
    loop: false,
    events: [[0.22, 'hit']],
    tracks: {
      chest: [[0, 0, 0, 0], [0.13, 6, 0, -20, 'out'], [0.24, -12, 0, 24, 'outCubic'], [0.5, 0, 0, 0]],
      head: [[0, 0, 0, 0], [0.13, -2, 0, 12], [0.24, 6, 0, -14], [0.5, 0, 0, 0]],
      armR: [[0, 0, 6, 0], [0.13, 172, 18, 0, 'out'], [0.24, 38, 4, 0, 'outCubic'], [0.34, 30, 4, 0], [0.5, 0, 6, 0]],
      foreR: [[0, 14, 0, 0], [0.13, 70, 0, 0, 'out'], [0.24, 8, 0, 0, 'outCubic'], [0.34, 12, 0, 0], [0.5, 14, 0, 0]],
      handR: [[0, 0, 0, 0], [0.13, 30, 0, 0], [0.24, -30, 0, 0, 'outCubic'], [0.5, 0, 0, 0]],
      armL: [[0, 0, -6, 0], [0.13, -18, -16, 0], [0.24, 22, -12, 0], [0.5, 0, -6, 0]],
      foreL: [[0, 14, 0, 0], [0.13, 40, 0, 0], [0.5, 14, 0, 0]],
    },
  };

  const hurt = { root: [[0, 0, 0, 0], [0.07, 0, 0.045 * H, -0.02 * H, 'out'], [0.36, 0, 0, 0]], spine: [[0, 0, 0, 0], [0.07, 16, 0, 0, 'out'], [0.36, 0, 0, 0]], chest: [[0, 0, 0, 0], [0.07, 10, 0, 10, 'out'], [0.36, 0, 0, 0]], head: [[0, 0, 0, 0], [0.07, 18, 0, -8, 'out'], [0.36, 0, 0, 0]] };
  sym(hurt, 'arm', [[0, 0, 7], [0.07, 30, 46, 0, 'out'], [0.36, 0, 7]]);
  sym(hurt, 'fore', [[0, 10], [0.07, 46], [0.36, 10]]);
  sym(hurt, 'thigh', [[0, 0], [0.07, 14, 4], [0.36, 0]]);
  sym(hurt, 'shin', [[0, -3], [0.07, -24], [0.36, -3]]);
  clips.hurt = { duration: 0.36, loop: false, tracks: hurt, events: [[0.01, 'hurt']] };

  // topple backward and lie still; the root drops as the body tips over
  const die = {
    root: [[0, 0, 0, 0], [0.25, 0, 0.05 * H, -0.06 * H, 'in'], [0.62, 0, 0.14 * H, -0.455 * H, 'in'], [0.74, 0, 0.14 * H, -0.43 * H, 'out'], [0.9, 0, 0.14 * H, -0.455 * H, 'in']],
    hips: [[0, 0, 0, 0], [0.25, 22, 0, 0, 'in'], [0.62, 90, 0, 0, 'in'], [0.74, 86, 0, 0, 'out'], [0.9, 90, 0, 0, 'in']],
    spine: [[0, 0, 0, 0], [0.25, 10, 0, 0], [0.62, -4, 0, 0], [0.9, 0, 0, 0]],
    head: [[0, 0, 0, 0], [0.25, 20, 0, 0], [0.62, -12, 0, 6], [0.9, -4, 0, 10]],
  };
  sym(die, 'arm', [[0, 0, 7], [0.25, 40, 40], [0.62, 16, 62, 0, 'in'], [0.9, 8, 58]]);
  sym(die, 'fore', [[0, 10], [0.25, 50], [0.62, 20], [0.9, 16]]);
  sym(die, 'thigh', [[0, 0], [0.25, 26, 4], [0.62, 10, 9, 0, 'in'], [0.9, 2, 9]]);
  sym(die, 'shin', [[0, -3], [0.25, -40], [0.62, -18, 0, 0, 'in'], [0.9, -6]]);
  sym(die, 'foot', [[0, 0], [0.62, -30], [0.9, -34]]);
  clips.die = { duration: 0.9, loop: false, tracks: die, events: [[0.62, 'thud']] };

  return clips;
}

/**
 * A ready state machine for humanoids, for createAnimator. Parameters the game sets:
 * speed (0 = still, 1 = walking, `runAt` = running), grounded (boolean), vz (vertical speed),
 * dead (boolean), rate (playback speed, default 1). Triggers: "attack", "hurt". Layer "upper" also has "wave".
 * @param {{height?:number, runAt?:number}} [o]  runAt: the `speed` value that means full run (default 2.6).
 */
export function humanoidAnimator(o = {}) {
  const runAt = o.runAt ?? 2.6;
  const alive = ['move', 'jump', 'fall', 'land', 'hurt'];
  return {
    clips: humanoidClips(o),
    params: { speed: 0, grounded: true, vz: 0, dead: false, rate: 1 },
    initial: 'move',
    states: {
      move: { blend: { param: 'speed', points: [[0, 'idle'], [1, 'walk'], [runAt, 'run']] }, speed: { param: 'rate' } },
      jump: { clip: 'jump' },
      fall: { clip: 'fall' },
      land: { clip: 'land', next: 'move', fade: 0.14 },
      hurt: { clip: 'hurt', next: 'move', fade: 0.12 },
      die: { clip: 'die' },
    },
    transitions: [
      { from: alive, to: 'die', when: { param: 'dead' }, fade: 0.1 },
      { from: 'die', to: 'move', when: { param: 'dead', eq: false }, fade: 0.45 },
      { from: ['move', 'jump', 'fall', 'land'], to: 'hurt', when: { trigger: 'hurt' }, fade: 0.05 },
      { from: ['move', 'land'], to: 'jump', when: { all: [{ param: 'grounded', eq: false }, { param: 'vz', gt: 0 }] }, fade: 0.06 },
      { from: ['move', 'land', 'hurt'], to: 'fall', when: { all: [{ param: 'grounded', eq: false }, { param: 'vz', lte: 0 }] }, fade: 0.18 },
      { from: 'jump', to: 'fall', when: { all: [{ param: 'vz', lte: 0 }, { after: 0.1 }] }, fade: 0.22 },
      { from: ['jump', 'fall'], to: 'land', when: { all: [{ param: 'grounded', eq: true }, { after: 0.05 }] }, fade: 0.05 },
    ],
    layers: [{
      name: 'upper',
      mask: ['chest'],
      initial: 'none',
      states: { none: {}, attack: { clip: 'attack', next: 'none', fade: 0.16 }, wave: { clip: 'wave' } },
      transitions: [
        { from: ['attack', 'wave'], to: 'none', when: { param: 'dead' }, fade: 0.1 },
        { from: ['none', 'wave'], to: 'attack', when: { all: [{ trigger: 'attack' }, { not: { param: 'dead' } }] }, fade: 0.05 },
      ],
    }],
  };
}
