// Multiplayer through the `net` engine (Parley). Inventory state is plain JSON,
// so it lives inside the room state; players send the actions from actions.js
// and the rules apply them on the server. Nothing is imported from net.
//
//   // rules.js
//   const inventories = createInventoryRules({ catalog, inventoryOf: (state, player) => state.inv[player.id] });
//   export default {
//     setup(ctx) { ... state.inv[p.id] = createInventoryState({ size: 12 }) ... },
//     onAction(state, player, action, ctx) {
//       if (inventories.onAction(state, player, action, ctx)) return;
//       // ... the game's own actions ...
//     },
//   };
//   // browser:  room.send({ type: 'inv.equip', from: 0 })

import { createInventory } from './inventory.js';
import { applyInventoryAction, isInventoryAction } from './actions.js';

/**
 * createInventoryRules(options) -> { handles(action), onAction(state, player, action, ctx), inventory(state, player) }
 *   catalog                                required
 *   inventoryOf(state, player)             required: returns that player's inventory state (from createInventoryState)
 *   crafting                               from createCrafting (enables 'inv.craft')
 *   station(state, player)                 name of the crafting station the player is at
 *   shops(state, player)                   { name: shop state } the player may trade with right now
 *   containers(state, player)              { name: container } the player may open right now (chests); used as bag names
 *   drops(state)                           the drops state (enables drop / pickup)
 *   position(state, player)                { x, y } of the player (needed for drop / pickup)
 *   reach = 48                             pickup distance
 *   onUse(state, player, result, ctx)      apply a used item's effect (result: { id, effect, consumed })
 * onAction returns false when the action is not an inventory action (handle it
 * yourself), true when it was applied. A refused action calls ctx.reject(reason),
 * so the sender's room.send() rejects with that reason and nothing changes.
 */
export function createInventoryRules(options = {}) {
  const { catalog, inventoryOf } = options;
  if (!catalog || typeof catalog.get !== 'function') throw new Error('createInventoryRules: options.catalog is required');
  if (typeof inventoryOf !== 'function') throw new Error('createInventoryRules: options.inventoryOf(state, player) is required');
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);

  function inventory(state, player) {
    const invState = inventoryOf(state, player);
    if (!invState) return null;
    const inv = createInventory({ catalog, state: invState });
    for (const [name, c] of Object.entries(call(options.containers, state, player) || {})) if (c) inv.attach(name, c);
    return inv;
  }

  return {
    handles: isInventoryAction,
    inventory,
    onAction(state, player, action, ctx) {
      if (!isInventoryAction(action)) return false;
      const inv = inventory(state, player);
      if (!inv) ctx.reject('no inventory');
      const result = applyInventoryAction(inv, action, {
        crafting: options.crafting,
        station: call(options.station, state, player),
        shops: call(options.shops, state, player),
        drops: call(options.drops, state),
        position: call(options.position, state, player),
        reach: options.reach,
        onUse: (r) => call(options.onUse, state, player, r, ctx),
      });
      if (!result.ok) ctx.reject(result.reason === 'bad-action' ? `bad action: ${result.message}` : result.reason);
      return true;
    },
  };
}
