// One object that makes every kind of sound in one style, for a game that
// wants its whole soundscape to match: createGenerator({ style: 'crypt', seed: 7 }).

import { generateSound, footstep } from './gen-sfx.js';
import { generateScore } from './score.js';
import { generateAmbience } from './ambience.js';
import { soundStyle } from './palettes.js';

/**
 * createGenerator({ style, seed }?) -> { style, seed, sound, footstep, ambience, score }
 *   style: one of SOUND_STYLE_NAMES (default 'storybook')     seed: the game's seed (default 1)
 *   gen.sound('heavy wooden door creak', { seed }?)  -> generateSound in this style
 *   gen.footstep('stone', { seed, weight }?)         -> footstep in this style
 *   gen.ambience('forest', { seed, seconds }?)       -> generateAmbience in this style
 *   gen.score({ seed, bars, bpm }?)                  -> generateScore in this style
 * A call without its own seed uses the generator's, so one game seed gives one repeatable soundscape.
 */
export function createGenerator(options = {}) {
  const { style = 'storybook', seed = 1 } = options;
  soundStyle(style, 'createGenerator');
  return {
    style, seed,
    sound: (describe, o = {}) => generateSound({ seed, ...o, describe, style }),
    footstep: (surface, o = {}) => footstep(surface, { seed, ...o, style }),
    ambience: (describe, o = {}) => generateAmbience({ seed, ...o, describe, style }),
    score: (o = {}) => generateScore({ seed, ...o, style }),
  };
}
