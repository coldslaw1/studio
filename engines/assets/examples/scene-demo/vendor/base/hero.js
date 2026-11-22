// The player's character, as a plugin that ships with the base: walking with the direction keys
// in whichever view shows (up is always "away from the camera"), running, bumping into scenery
// through the collision plugin, and a "use" key for whoever or whatever is nearest.
// It reads only the game layer's input, so the hero stands still under menus, the bag and dialogue.
//   plugins: [heroPlugin({ x: 36, y: 50, model: 'villager' })]

/**
 * heroPlugin(options) -> plugin (uses 'collision', 'puppet', 'combat')
 *   id        the actor's id (default 'hero'). Made at (x, y) unless an actor with that id is added by the game.
 *   x, y      where the hero starts (default 0, 0);  radius (default 0.3)
 *   model     a puppet model ('villager', 'knight', ...) to rig the hero with, when the puppet plugin is in
 *   speed     metres a second (default: the rig's walk speed, else 1.6);  runScale  default 2.6
 *   actions   { left, right, up, down, run, use } action names (defaults: those names; 'use' falls back to 'confirm')
 *   reach     metres within which "use" finds something (default 1.6)
 * base.plugin('hero') -> { actor, facing: { x, y }, nearest(), frozen }
 *   frozen = true stops the walking (a cutscene, a knock-down) without opening a modal.
 * An actor is usable when it has `use` (a function (base, actor)) or `usable: true`.
 * Bus: 'hero:use' { actor } when the player uses something, 'hero:moved' is not sent (read the actor).
 */
export function heroPlugin(options = {}) {
  return {
    name: 'hero',
    uses: ['collision', 'puppet', 'combat'],
    actions: { run: ['ShiftLeft', 'ShiftRight'], use: ['Space'] },
    install(base) {
      const id = options.id ?? 'hero';
      const names = { left: 'left', right: 'right', up: 'up', down: 'down', run: 'run', use: 'use', ...(options.actions ?? {}) };
      const actor = base.actors.get(id) ?? base.actors.add({ id, x: options.x ?? 0, y: options.y ?? 0, radius: options.radius ?? 0.3, kind: 'person', hero: true });
      if (options.model && base.has('puppet') && !base.plugin('puppet').has(actor)) base.plugin('puppet').rig(actor, options.model, options.rig ?? {});
      const facing = { x: 0, y: 1 };
      const reach = options.reach ?? 1.6;
      const api = {
        actor, facing, frozen: false,
        /** The nearest usable actor in reach, or null. */
        nearest: () => base.actors.near(actor.x, actor.y, reach, (a) => a !== actor && (typeof a.use === 'function' || a.usable === true)),
        save: () => ({ x: actor.x, y: actor.y, fx: facing.x, fy: facing.y }),
        load(d) { if (base.has('collision')) base.plugin('collision').teleport(actor, d.x, d.y); else { actor.x = d.x; actor.y = d.y; } facing.x = d.fx ?? 0; facing.y = d.fy ?? 1; },
      };
      base.on('sim', (dt) => {
        const input = base.input.game;
        const inFight = base.has('combat') && base.plugin('combat').has(id);
        if (!api.frozen && !inFight && actor.alive !== false) { // in a fight the combat plugin walks the hero, with the same keys
          const [gx, gy] = base.views.toGround(input.axis(names.left, names.right), input.axis(names.up, names.down));
          const size = Math.hypot(gx, gy);
          if (size > 0.01) {
            const speed = (options.speed ?? actor.character?.walkSpeed ?? 1.6) * (input.down(names.run) ? options.runScale ?? 2.6 : 1) * Math.min(1, size);
            const dx = gx / size * speed * dt; const dy = gy / size * speed * dt;
            if (base.has('collision')) base.plugin('collision').move(actor, dx, dy); else { actor.x += dx; actor.y += dy; }
            facing.x = gx / size; facing.y = gy / size;
          }
        }
        if (input.pressed(names.use) || (!base.input.has(names.use) && input.pressed('confirm'))) {
          const near = api.nearest();
          if (near) { base.bus.emit('hero:use', { actor: near }); near.use?.(base, near); }
        }
      }, { order: 0, owner: 'hero' });
      return api;
    },
  };
}
