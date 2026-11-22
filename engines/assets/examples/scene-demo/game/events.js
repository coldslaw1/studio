// Scripted moments for the events engine: the hamlet quest's short opening, and a line at dusk.
// Plain JSON-compatible data (checked by tests/showcase.test.js with validateEvents).

/** Events data for createEvents. Coordinates are the hamlet's ground metres. */
export const EVENTS = {
  id: 'hamlet_events',
  player: 'player',
  scenes: ['play', 'world'], // the base's modes: the hamlet quest and the open world have different ground
  actors: ['guard'],
  vars: { seen_intro: false },
  areas: {
    well: { x: 44, y: 41, radius: 2.5, scene: 'play' },
    square: { x: 41, y: 45, radius: 2, scene: 'play' }, // the open ground by the well: the opening shot looks here (a shot aimed at the well itself puts the 3D camera under its roof)
    camp: { poi: 'camp', radius: 9, scene: 'world' }, // every camp the terrain makes, as its piece of the world streams in
  },
  triggers: [
    { id: 'dusk_bark', scene: 'play', when: { part: 'dusk' }, repeat: true, do: [{ say: '', text: 'The lamps are lit.', time: 2 }] },
    // the open world: once per camp, remembered in the save
    { id: 'find_camp', scene: 'world', when: { enter: 'camp' }, each: true, do: [{ sound: 'pickup' }, { say: '', text: 'A camp. Someone was here not long ago.', time: 2.5 }] },
  ],
  sequences: {
    // started by hand when a new hamlet quest begins from the title menu (hold Esc to skip)
    intro: { mode: 'cutscene', skippable: true, bars: true, steps: [
      { fade: 'out', time: 0 }, { camera: 'square', zoom: 2, time: 0 }, { fade: 'in', time: 1.2 },
      { say: '', text: 'The hamlet, early in the day.' },
      { camera: 'guard', yaw: 215, time: 2 }, { animate: 'guard', clip: 'wave', time: 1 }, // from inside the hamlet: at the first angle the gate's pillar hides the guard
      { say: 'Guard', text: 'Morning. Come and see me when you are ready.' },
      { animate: 'guard', clip: 'idle', time: 0.2 },
      { set: 'seen_intro', to: true },
    ] },
  },
};
