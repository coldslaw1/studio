// How the inventory screens carry out an action: applied at once to the local
// inventory, or handed to the game's `send` (multiplayer: room.send), which may
// answer with a promise. Shared by the menu screens and the drawn panel.

import { applyInventoryAction } from './actions.js';

/**
 * createSender({ inventory, send, env, onResult, toast, reasons, after }) -> sender
 *   sender.act(action, done)   send one action; done(result) runs when the answer is in
 *   sender.busy                true while a promise from `send` is still open (new actions are ignored)
 *   env()      -> the env object for applyInventoryAction
 *   toast(text)   shows a refusal;  reasons: { reason: text }
 *   onResult(action, result)   the game's hook;  after()   redraw hook, runs last
 */
export function createSender(o) {
  let busy = false;
  const sender = {
    get busy() { return busy; },
    act(action, done) {
      if (busy) return;
      const finish = (result) => {
        busy = false;
        if (typeof done === 'function') done(result);
        if (!result.ok && typeof o.toast === 'function') o.toast(o.reasons[result.reason] ?? String(result.reason));
        if (typeof o.onResult === 'function') o.onResult(action, result);
        if (typeof o.after === 'function') o.after(action, result);
      };
      busy = true; // also keeps 'change' listeners from redrawing half-way
      let out;
      try {
        out = typeof o.send === 'function' ? o.send(action) : applyInventoryAction(o.inventory, action, o.env());
      } catch (err) { busy = false; throw err; }
      if (out && typeof out.then === 'function') {
        out.then((r) => (r && typeof r.ok === 'boolean' ? r : { ok: true }), (err) => ({ ok: false, reason: err && err.message })).then(finish);
      } else finish(out && typeof out.ok === 'boolean' ? out : { ok: true });
    },
  };
  return sender;
}
