// Public API of the combat engine. Games import from this file only.
export { createCombat } from './combat.js';
export { createCombatState, isCombatState, emptyInput, cleanInput, fighterView } from './state.js';
export { WEAPONS, SHIELDS, DAMAGE_TYPES, checkWeapon, checkMove, checkShield, movesFromClip } from './weapons.js';
export { THROWABLES, checkThrowable } from './throwables.js';
export { STATUSES, checkStatus } from './status.js';
export { createFactions } from './factions.js';
export { BRAINS, pickTarget, reachOf } from './ai.js';
export { aimAt, lob, predictArc } from './aim.js';
export { moveOutline, arcRange } from './hitbox.js';
export { dirOf, facingOf, angleDiff, boxAngle } from './util.js';
export { combatAnimator, bindPuppet } from './puppet.js';
export { loadoutFromInventory, syncFighter, throwFromInventory, pickupToInventory, landedToDrops } from './inventory.js';
export { SOUNDS, bindAudio } from './audio.js';
export { COMBAT_ACTIONS, isCombatAction, applyCombatAction, createCombatRules } from './net.js';
