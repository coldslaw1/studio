// studio-audio: generative sound for games. Effects, adaptive music, ambience
// and footsteps are all made in code from a few words and a seed. No audio files.
//
// CHEAT SHEET
//   import { createAudio, generateSound, generateScore } from './vendor/audio/index.js';
//   const audio = createAudio({ style: 'storybook' });   // once, at start-up
//   audio.define('door', generateSound({ describe: 'heavy wooden door creak', seed: 3 }));
//   audio.play('door');  audio.play('coin');             // generated, or a built-in from SFX_NAMES
//   audio.play('door', { at: { x: 300, y: 80 } });       // positional: follows audio.setListener(x, y)
//   audio.playMusic(generateScore({ style: 'storybook', seed: 7 }));
//   audio.setMusicState('combat');                       // calm, explore, danger, combat: no restart
//   audio.playAmbience('forest');  audio.step('grass');  // a place, and footsteps by surface
//   audio.update(dt);                                    // once per game step
// Sound starts after the player's first key press or tap (browser rule);
// createAudio handles that by itself. In Node tests audio is silent but
// audio.log and audio.count('coin') still record what was played.

// The order matters: tools that list an engine's exports show the first ones, so the
// functions a game needs most come first. (The scheduler, render queue and reverb are
// internal parts; import them from their own files if you need them.)
export { createAudio } from './audio.js';
export { createGenerator } from './generator.js';
export { generateSound, footstep } from './gen-sfx.js';
export { generateScore } from './score.js';
export { generateAmbience } from './ambience.js';
export { spatialize, DEFAULT_RANGE } from './spatial.js';
export { checkAudio } from './check.js';
export { renderStereo, renderSound } from './render.js';
export { renderScore, scoreSeconds, MUSIC_STATES } from './score.js';
export { renderAmbience, ambiencePlan, isAmbience, AMBIENCE_KINDS } from './ambience.js';
export { sfx, SFX_NAMES } from './sfx.js';
export { generateSong, MOODS, MOOD_NAMES } from './generate.js';
export { jingle, JINGLE_NAMES } from './jingles.js';
export { encodeWav } from './wav.js';
export { isSoundAsset, generateTakes } from './gen-sfx.js';
export { occlusion } from './spatial.js';
export { SPACES, SPACE_NAMES, spaceOf, impulseResponse, impulsePlan, applySpace, spaceSeconds } from './spaces.js';
export { describeWithModel } from './llm.js';
export { STEM_NAMES, intensityLevels } from './score.js';
export { SOUND_STYLES, SOUND_STYLE_NAMES, soundStyle, MATERIALS } from './palettes.js';
export { SOUND_KINDS, MATERIAL_NAMES, parseDescription } from './words.js';
export { SURFACE_NAMES } from './footsteps.js';
export { renderSong, songPlan, parseSong, songDuration, isSong } from './song.js';
export { isScore } from './audio-music.js';
export { INSTRUMENTS, DRUMS, INSTRUMENT_NAMES } from './instruments.js';
export { soundDuration, soundPlan } from './render.js';
export { soundLayers, addTone, limit, validateTone, TONE_DEFAULTS, WAVES } from './synth.js';
export { applyFx, validateFx, fxTail, FX_DEFAULTS } from './fx.js';
export { noteToFreq, noteToMidi, midiToFreq, midiToNote, isNote, scaleNotes, SCALES } from './notes.js';
export { createRng, hashSeed, pick } from './rng.js';
export { LIMITER } from './mix.js';
export { createSampleBank, readSamplePack, loadSamplePack, validateSamplePack, decodeWav } from './samples.js';
export { recordedMatch, renderRecorded, recordedPlan } from './recorded.js';
