// Public API of the game core kit. Import everything from this file.
export { createGame, fitRect } from './game.js';
export { createLoop } from './loop.js';
export { createInput, attachInput, pollGamepad, classifyGesture, DEFAULT_ACTIONS } from './input.js';
export { createScenes } from './scenes.js';
export { createSaves, createMemoryStorage } from './saves.js';
export { createRng } from './rng.js';
