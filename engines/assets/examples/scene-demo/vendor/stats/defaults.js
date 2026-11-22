// The built-in rule set: a small, ordinary role-playing sheet. createStats() starts from these;
// your own `stats`, `resources`, `effects` are laid over them by id (null removes a built-in),
// or pass `builtins: false` to start from nothing.

/**
 * Built-in stats. The five attributes (`attribute: true`, the ones a player puts level-up points into) are
 * Strength, Intelligence, Constitution, Dexterity and Charisma; everything else is worked out from them.
 */
export const STATS = Object.freeze({
  strength: { label: 'Strength', base: 5, min: 0, attribute: true },
  intelligence: { label: 'Intelligence', base: 5, min: 0, attribute: true },
  constitution: { label: 'Constitution', base: 5, min: 0, attribute: true },
  dexterity: { label: 'Dexterity', base: 5, min: 0, attribute: true },
  charisma: { label: 'Charisma', base: 5, min: 0, attribute: true },
  maxHp: { label: 'Max health', base: 10, per: { constitution: 2 }, perLevel: 2, min: 1, round: 'floor' },
  maxMana: { label: 'Max mana', base: 0, per: { intelligence: 2 }, min: 0, round: 'floor' },
  maxStamina: { label: 'Max stamina', base: 10, per: { constitution: 1 }, min: 0, round: 'floor' },
  hpRegen: { label: 'Health per second', base: 0 },
  manaRegen: { label: 'Mana per second', base: 0, per: { intelligence: 0.1 } },
  staminaRegen: { label: 'Stamina per second', base: 4 },
  attack: { label: 'Attack', base: 0, per: { strength: 0.5 }, min: 0 },
  defense: { label: 'Defense', base: 0, per: { constitution: 0.2 }, min: 0 },
  speed: { label: 'Speed', base: 2.8, per: { dexterity: 0.04 }, min: 0 },
  crit: { label: 'Critical chance', base: 0, per: { dexterity: 0.01 }, min: 0, max: 1 },
  luck: { label: 'Luck', base: -5, per: { charisma: 1 }, min: 0 }, // charisma above 5 is luck: better loot rolls
  xpGain: { label: 'XP gain', base: 1, min: 0 },
});

/** Built-in resources: numbers that are spent and come back. */
export const RESOURCES = Object.freeze({
  hp: { label: 'Health', max: 'maxHp', regen: 'hpRegen' },
  mana: { label: 'Mana', max: 'maxMana', regen: 'manaRegen' },
  stamina: { label: 'Stamina', max: 'maxStamina', regen: 'staminaRegen', regenDelay: 1 },
});

/** Built-in buffs and debuffs. */
export const EFFECTS = Object.freeze({
  might: { name: 'Might', kind: 'buff', duration: 30, mods: [{ stat: 'attack', inc: 0.25 }] },
  fortify: { name: 'Fortify', kind: 'buff', duration: 30, mods: [{ stat: 'defense', add: 3 }] },
  haste: { name: 'Haste', kind: 'buff', duration: 10, mods: [{ stat: 'speed', inc: 0.3 }] },
  bless: { name: 'Blessing', kind: 'buff', duration: 60, mods: [{ stat: 'luck', add: 5 }] },
  wellFed: { name: 'Well fed', kind: 'buff', duration: 120, mods: [{ stat: 'maxHp', add: 5 }, { stat: 'hpRegen', add: 0.2 }] },
  regen: { name: 'Regeneration', kind: 'buff', duration: 8, every: 1, change: { hp: 1 } },
  slow: { name: 'Slow', kind: 'debuff', duration: 6, mods: [{ stat: 'speed', mult: 0.6 }], tags: ['movement'] },
  weaken: { name: 'Weakness', kind: 'debuff', duration: 8, mods: [{ stat: 'attack', mult: 0.7 }], tags: ['curse'] },
  curse: { name: 'Curse', kind: 'debuff', duration: 20, mods: [{ stat: 'luck', add: -5 }, { stat: 'defense', mult: 0.8 }], tags: ['curse'] },
  poison: { name: 'Poison', kind: 'debuff', duration: 6, every: 1, change: { hp: -1 }, stacking: 'stack', maxStacks: 5, tags: ['poison'] },
  burn: { name: 'Burning', kind: 'debuff', duration: 3, every: 0.5, change: { hp: -1 }, tags: ['fire'] },
});

/** Built-in level rules: 50 XP for level 2, growing with level; 2 attribute points a level. */
export const LEVELS = Object.freeze({
  curve: { kind: 'power', base: 50, power: 1.5 },
  maxLevel: 30,
  pointsPerLevel: 2,
  refill: true,
  gainStat: 'xpGain',
  unlocks: {},
});
