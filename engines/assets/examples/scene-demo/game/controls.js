// The fighting controls of the combat engine's own demo, fitted to this game's keys, and the hotbar.
//   J or left click   attack; press again while a blow is landing to chain the combo
//                     (a sword chops, backhands and thrusts; a staff swats and spins)
//   K, H or right mouse   hold to block; raised just before a blow lands, it is a parry
//   L or N            dodge roll the way you walk (backward when standing); Space too, in a fight,
//                     when there is nothing to talk to or pick up
//   U                 throw an axe at the mouse (F does too when an enemy is near); walk over it to take it back
//   Z                 swap the weapon in hand
//   1 to 6, wheel     pick a hotbar slot. A weapon picked is the one in hand; food or tea picked is used with F.
// The hero faces the mouse's ground point while the mouse is the device in use (in first person:
// where you look), otherwise the way you walk. There is no lock-on.
// core's input has no mouse buttons or wheel, so this file listens for those on the canvas and
// turns them into values the scenes read once per tick.

/**
 * @param {object} game    The game (canvas, input).
 * @param {object} shared  { ui, items, sound }.
 * @returns {object} controls
 */
export function createControls(game, shared) {
  const { canvas, input } = game;
  const { ui, items } = shared;
  const SLOTS = items.inventory.hotbar().length;
  let wheel = 0; let right = false; let selected = 0; let touchGuard = 0; let tapAttack = false; let tapDodge = false;
  let zoom = null; // set by the scene: (steps) => void, the camera to zoom with Shift + wheel
  canvas.addEventListener('wheel', (e) => {
    if (ui.isOpen() || !e.deltaY) return; // menus scroll with the wheel themselves
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey) return; // Shift or Ctrl + wheel zooms: the camera engine reads it (attachCameraMouse wheelKeys 'held'), also when the browser reports it sideways
    wheel += e.deltaY > 0 ? 1 : -1;
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) right = true; });
  const release = (e) => { if (!e || e.button === 2 || e.type === 'blur') right = false; };
  globalThis.addEventListener('pointerup', release); globalThis.addEventListener('blur', release);

  // a phone has no J or K: three buttons, shown only on touch screens
  if ((globalThis.navigator?.maxTouchPoints ?? 0) > 0) {
    ui.hud
      .add({ id: 'touch-attack', type: 'button', label: 'Hit', anchor: 'bottom-right', onPress: () => { tapAttack = true; } })
      .add({ id: 'touch-guard', type: 'button', label: 'Guard', anchor: 'bottom-right', onPress: () => { touchGuard = 1.2; } })
      .add({ id: 'touch-dodge', type: 'button', label: 'Dodge', anchor: 'bottom-right', onPress: () => { tapDodge = true; } });
  }

  const name = (id) => (id ? items.catalog.get(id).name : 'empty');
  const controls = {
    /** The hotbar slot picked (0-based). */
    get selected() { return selected; },
    /** The item id in the picked slot, or null. */
    get held() { return items.inventory.hotbar()[selected] ?? null; },
    set zoom(fn) { zoom = fn; },
    /**
     * What the scene knows this tick, set before the fight's update:
     *   moving   true while the player walks (the hero then faces and rolls the way it walks)
     *   aimAt    a ground point the hero should face: the mouse's while the mouse is in use, or where
     *            first person looks; null = face the way it walks
     */
    now: { moving: false, aimAt: null },
    /** Pick a slot. A weapon or other gear in it is put on. */
    select(i, quiet = false) {
      selected = ((i % SLOTS) + SLOTS) % SLOTS;
      const id = controls.held;
      if (id && items.catalog.get(id).equip && !Object.values(items.inventory.equipment()).some((s) => s && s.id === id)) items.hud.quick(selected);
      if (!quiet) { ui.toast(`${selected + 1}: ${name(id)}`, 1.2); shared.sound.play('tick', { volume: 0.4 }); }
    },
    /** Use what is picked if it can be used (tea, an apple). Returns false when it cannot, so F can throw instead. */
    useHeld() {
      const id = controls.held;
      if (!id || !items.catalog.get(id).use || !items.inventory.has(id)) return false;
      items.hud.quick(selected);
      return true;
    },
    /** Once per tick, before the scene acts: number keys and the wheel pick slots. */
    update(dt) {
      for (let i = 0; i < SLOTS; i++) if (input.pressed(`slot${i + 1}`)) controls.select(i);
      if (wheel) { controls.select(selected + Math.sign(wheel)); wheel = 0; }
      if (touchGuard > 0) touchGuard -= dt;
    },
    /** True while a block is held: K, H, the right mouse button, or the touch button. */
    get guard() { return right || input.down('block') || touchGuard > 0; },
    /** True while an attack is asked for by key or touch button (clicks come in through `aim`). */
    takeAttack() { const t = tapAttack; tapAttack = false; return t || input.down('attack') || input.pressed('attack'); }, // pressed too: a quick tap can start and end between two ticks
    /** True on the tick a dodge was asked for. `spaceToo` says Space is not needed to talk or pick up. */
    takeDodge(spaceToo) { const t = tapDodge; tapDodge = false; return t || input.pressed('dodge') || (spaceToo && input.pressed('confirm')); },
    /**
     * Give the combat the hero's input for this tick, as the combat engine's demo does: the true walk
     * direction (the combat holds the facing through a swing and while guarding by itself), attack,
     * block and dodge as buttons, and a point to face when there is one.
     * @param {object} combat  The combat the hero is in.
     * @param {{x:number,y:number}} facing  The hero's walk direction on the ground (kept while standing).
     * @param {{x:number,y:number}|null} click  A ground point clicked this tick: an attack toward it. Or null.
     * @param {boolean} free  Space may dodge (nothing to talk to or pick up).
     * @returns {{dodging:boolean, attacked:boolean}}
     */
    drive(combat, facing, click, free) {
      const hero = combat.fighter('hero');
      const { moving, aimAt } = controls.now;
      const attack = controls.takeAttack() || !!click;
      const face = click ?? aimAt ?? null;
      // the dodge key always rolls; Space rolls only in a fight, and only when it is not needed to talk or pick up
      const dodge = hero.alive && controls.takeDodge(free && controls.nearestFoe(combat, 12) !== null);
      combat.input('hero', {
        moveX: moving ? facing.x : 0, moveY: moving ? facing.y : 0,
        attack, block: controls.guard, dodge,
        aimX: face ? face.x : null, aimY: face ? face.y : null,
      });
      return { dodging: hero.act.kind === 'dodge', attacked: attack };
    },
    /** The nearest living enemy of the hero within `reach` metres, or null. */
    nearestFoe(combat, reach) {
      const hero = combat.fighter('hero'); let best = null; let bestD = reach;
      for (const f of combat.fighters()) {
        if (f.id === 'hero' || !f.alive || !combat.hostile('hero', f.id)) continue;
        const d = Math.hypot(f.x - hero.x, f.y - hero.y);
        if (d < bestD) { best = f; bestD = d; }
      }
      return best;
    },
  };
  return controls;
}
