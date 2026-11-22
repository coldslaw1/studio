// In-process test harness. Runs a rules module in a real room without any
// sockets or timers, so `node --test` can check multiplayer rules directly.
import { createRoom } from './room.js';

/**
 * createTestRoom(game, { players = ['a', 'b'], seed = 1, options = {}, start = true })
 * `players` are ids (also used as names). Returns helpers:
 *   t.send(id, action)  -> { ok, error }     t.mustSend(id, action) throws on reject
 *   t.input(id, input)  t.tick(n = 1)        t.advance(seconds)
 *   t.join(id, { spectate })  t.leave(id)  t.disconnect(id)  t.reconnect(id)
 *   t.start()  t.restart()
 *   t.state  t.phase  t.result  t.players  t.events
 *   t.view(id)          the state as that player sees it (after game.view)
 *   t.received(id)      every message that player's client was sent
 */
export function createTestRoom(game, opts = {}) {
  const { players = ['a', 'b'], seed = 1, options = {}, start = true } = opts;
  const inbox = new Map();
  const room = createRoom({ code: 'TEST', game, options, seed, log: opts.log });
  const sender = (id) => {
    if (!inbox.has(id)) inbox.set(id, []);
    return (json) => inbox.get(id).push(JSON.parse(json));
  };
  const need = (r, what) => {
    if (!r.ok) throw new Error(`createTestRoom: ${what} failed: ${r.error}`);
    return r;
  };
  const t = {
    room,
    get state() { return room.state; },
    get phase() { return room.phase; },
    get result() { return room.result; },
    get players() { return room.players(); },
    get events() { return room.events; },
    get host() { return room.hostId; },
    join: (id, o) => room.join({ id, name: id, send: sender(id) }, o),
    leave: (id) => room.leave(id),
    disconnect: (id) => room.disconnect(id),
    reconnect: (id) => room.connect(id, sender(id)),
    start: () => need(room.start(), 'start'),
    restart: () => need(room.restart(), 'restart'),
    send: (id, action) => room.action(id, action),
    mustSend: (id, action) => need(room.action(id, action), `action ${JSON.stringify(action)} by ${id}`),
    input: (id, input) => room.setInput(id, input),
    tick(n = 1) {
      for (let i = 0; i < n; i++) room.step();
      return t;
    },
    advance(seconds) {
      return t.tick(Math.round(seconds * room.game.tickRate));
    },
    received: (id) => inbox.get(id) ?? [],
    view(id) {
      const states = t.received(id).filter((m) => m.t === 'state');
      return states.length ? states[states.length - 1].state : null;
    },
  };
  for (const id of players) need(t.join(id), `join ${id}`);
  if (start && room.phase === 'lobby') t.start();
  return t;
}
