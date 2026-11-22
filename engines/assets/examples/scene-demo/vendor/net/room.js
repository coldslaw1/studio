// The room core: one match of one game. Pure logic with no sockets and no
// timers, so the server and the test harness share exactly the same behavior.
import { createRng } from './rng.js';
import { normalizeGame, cleanRoomName } from './protocol.js';

const REJECT = Symbol('reject');

/**
 * createRoom({ code, name, gameName, game, options, seed, isPrivate, onEmpty, onPhase, log })
 * Returns a room object. Members are added with room.join({ id, name, send }).
 * `send` is a function taking one JSON string (or null while disconnected).
 */
export function createRoom(config) {
  const game = normalizeGame(config.game);
  const log = config.log ?? (() => {});
  const members = new Map();
  let joinCounter = 0;
  let pendingEvents = [];
  let pendingEnd;
  let rng = createRng(config.seed ?? 1);
  let matches = 0;

  const room = {
    code: config.code ?? 'TEST',
    name: cleanRoomName(config.name, 'Room ' + (config.code ?? 'TEST')),
    gameName: config.gameName ?? game.name ?? 'game',
    game,
    options: config.options ?? {},
    isPrivate: Boolean(config.isPrivate),
    phase: 'lobby', // lobby -> playing -> ended
    state: null,
    result: null,
    hostId: null,
    tick: 0,
    inputs: {},
    events: [], // every event ever emitted (handy in tests)
    members,
    join, leave, connect, disconnect, start, restart, action, setInput, step, setReady,
    players, meta, close, sendState,
  };

  function seated() {
    return [...members.values()].filter((m) => m.seat !== null).sort((a, b) => a.seat - b.seat);
  }
  function pub(m) {
    return { id: m.id, name: m.name, seat: m.seat, connected: m.connected };
  }
  /** players() lists seated players as { id, name, seat, connected }. */
  function players() {
    return seated().map(pub);
  }
  function freeSeat() {
    const used = new Set(seated().map((m) => m.seat));
    for (let i = 0; i < game.maxPlayers; i++) if (!used.has(i)) return i;
    return null;
  }

  function ctx() {
    return {
      players: players(),
      options: room.options,
      rng,
      inputs: room.inputs,
      tick: room.tick,
      time: game.tickRate ? room.tick / game.tickRate : 0,
      emit(name, data = null, to = null) {
        pendingEvents.push({ name, data, to });
      },
      end(result = {}) {
        pendingEnd = result;
      },
      reject(message) {
        const err = new Error(String(message));
        err[REJECT] = true;
        throw err;
      },
    };
  }

  function post(m, obj) {
    if (m.connected && m.send) m.send(JSON.stringify(obj));
  }
  /** meta(id) is the lobby-level description of the room sent to one member. */
  function meta(id) {
    const m = members.get(id);
    return {
      t: 'room',
      code: room.code,
      name: room.name,
      game: room.gameName,
      phase: room.phase,
      host: room.hostId,
      isPrivate: room.isPrivate,
      tickRate: game.tickRate,
      snapshotEvery: game.snapshotEvery,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      requireReady: game.requireReady,
      options: room.options,
      result: room.result,
      players: seated().map((p) => ({ ...pub(p), ready: p.id === room.hostId || p.ready })),
      spectators: members.size - seated().length,
      you: m ? pub(m) : null,
    };
  }
  function sendMeta() {
    for (const m of members.values()) post(m, meta(m.id));
  }
  /** sendState(force) sends each member its view; unchanged views are skipped. */
  function sendState(force = false) {
    if (room.state === null) return;
    let shared = null;
    for (const m of members.values()) {
      if (!m.connected || !m.send) continue;
      let json;
      if (game.view) {
        json = JSON.stringify(game.view(room.state, m.seat === null ? null : pub(m)) ?? null);
      } else {
        json = shared ??= JSON.stringify(room.state);
      }
      if (!force && json === m.lastJson) continue;
      m.lastJson = json;
      m.send(`{"t":"state","tick":${room.tick},"state":${json}}`);
    }
  }
  function flush() {
    const events = pendingEvents;
    pendingEvents = [];
    for (const e of events) {
      room.events.push(e);
      for (const m of members.values()) {
        if (e.to === null || e.to === m.id) post(m, { t: 'event', name: e.name, data: e.data });
      }
    }
    if (pendingEnd !== undefined) {
      room.result = pendingEnd;
      pendingEnd = undefined;
      setPhase('ended');
    }
  }
  function setPhase(phase) {
    room.phase = phase;
    sendMeta();
    if (config.onPhase) config.onPhase(room);
  }
  function begin() {
    const before = { phase: room.phase, state: room.state, result: room.result };
    rng = createRng((config.seed ?? 1) + matches * 7919);
    room.tick = 0;
    room.inputs = {};
    pendingEvents = [];
    pendingEnd = undefined;
    try {
      const state = game.setup(ctx());
      if (state === undefined || state === null) {
        throw new Error('setup(ctx) must return the starting state object');
      }
      room.state = state;
    } catch (err) {
      log(`setup failed in ${room.code}: ${err.stack ?? err.message}`);
      Object.assign(room, before);
      pendingEvents = [];
      pendingEnd = undefined;
      return { ok: false, error: 'setup failed: ' + err.message };
    }
    matches++;
    room.result = null;
    for (const m of members.values()) m.ready = false;
    for (const m of members.values()) m.lastJson = null;
    setPhase('playing');
    flush();
    sendState(true);
    return { ok: true };
  }
  function pickHost() {
    if (members.has(room.hostId)) return;
    const all = [...members.values()].sort((a, b) => a.order - b.order);
    const next = all.find((m) => m.seat !== null && m.connected) ?? all.find((m) => m.connected) ?? all[0];
    room.hostId = next ? next.id : null;
  }
  function maybeAutoStart() {
    if (game.autoStart && room.phase === 'lobby' && seated().length >= game.minPlayers) begin();
  }

  /** join({ id, name, send }, { spectate }) adds a member. Returns { ok } or { ok:false, error }. */
  function join(player, { spectate = false } = {}) {
    if (members.has(player.id)) return connect(player.id, player.send);
    const m = {
      id: player.id, name: player.name, send: player.send ?? null, connected: true,
      seat: null, wantsSeat: !spectate, order: joinCounter++, lastJson: null, ready: false,
    };
    const seat = spectate ? null : freeSeat();
    const lateJoin = room.phase === 'playing';
    if (seat !== null && (!lateJoin || game.onJoin)) m.seat = seat;
    if (m.seat === null && !game.spectators) {
      return { ok: false, error: lateJoin ? 'game already started' : 'room is full' };
    }
    members.set(m.id, m);
    if (lateJoin && m.seat !== null) {
      try {
        const r = game.onJoin(room.state, pub(m), ctx());
        if (r !== undefined) room.state = r;
      } catch (err) {
        log(`onJoin failed in ${room.code}: ${err.message}`);
        m.seat = null;
      }
    }
    pickHost();
    sendMeta();
    flush();
    if (room.state !== null) sendState();
    maybeAutoStart();
    return { ok: true };
  }

  /** connect(id, send) reattaches a member after a dropped connection. */
  function connect(id, send) {
    const m = members.get(id);
    if (!m) return { ok: false, error: 'not in this room' };
    m.send = send ?? null;
    m.connected = true;
    m.lastJson = null;
    sendMeta();
    sendState();
    return { ok: true };
  }

  /** disconnect(id) marks a member offline but keeps the seat. */
  function disconnect(id) {
    const m = members.get(id);
    if (!m) return;
    m.connected = false;
    m.send = null;
    delete room.inputs[id];
    sendMeta();
  }

  /** leave(id) removes a member for good and frees the seat. */
  function leave(id) {
    const m = members.get(id);
    if (!m) return;
    members.delete(id);
    delete room.inputs[id];
    if (m.seat !== null && room.phase === 'playing' && game.onLeave) {
      try {
        const r = game.onLeave(room.state, pub(m), ctx());
        if (r !== undefined) room.state = r;
      } catch (err) {
        log(`onLeave failed in ${room.code}: ${err.message}`);
      }
    }
    if (room.hostId === id) room.hostId = null;
    pickHost();
    if (members.size === 0 || (room.phase === 'playing' && seated().length === 0)) return close('empty');
    sendMeta();
    flush();
    sendState();
  }

  /** close(reason) ends the room and tells everyone still in it. */
  function close(reason = 'closed') {
    for (const m of members.values()) post(m, { t: 'closed', reason });
    members.clear();
    room.phase = 'ended';
    if (config.onPhase) config.onPhase(room);
    if (config.onEmpty) config.onEmpty(room);
  }

  /** start(byId) moves lobby -> playing. Only the host may start. */
  function start(byId = room.hostId) {
    if (room.phase !== 'lobby') return { ok: false, error: 'game already started' };
    if (byId !== room.hostId) return { ok: false, error: 'only the host can start' };
    if (seated().length < game.minPlayers) {
      return { ok: false, error: `need at least ${game.minPlayers} players` };
    }
    const waiting = notReady();
    if (waiting) return { ok: false, error: `waiting for ${waiting.name} to be ready` };
    return begin();
  }

  /** In games with requireReady, the first seated player (other than the host) who is not ready. */
  function notReady() {
    return game.requireReady ? seated().find((m) => m.id !== room.hostId && !m.ready) ?? null : null;
  }

  /** setReady(id, on) marks a seated player ready (or not) while the room waits to start. */
  function setReady(id, on = true) {
    const m = members.get(id);
    if (!m || m.seat === null) return { ok: false, error: 'spectators cannot be ready' };
    if (room.phase === 'playing') return { ok: false, error: 'game already started' };
    m.ready = Boolean(on);
    sendMeta();
    return { ok: true };
  }

  /** restart(byId) starts a fresh match after one has ended. Host only. */
  function restart(byId = room.hostId) {
    if (room.phase !== 'ended') return { ok: false, error: 'game is not over' };
    if (byId !== room.hostId) return { ok: false, error: 'only the host can restart' };
    for (const m of [...members.values()].sort((a, b) => a.order - b.order)) {
      if (m.seat === null && m.wantsSeat) m.seat = freeSeat();
    }
    if (seated().length < game.minPlayers) {
      return { ok: false, error: `need at least ${game.minPlayers} players` };
    }
    const waiting = notReady();
    if (waiting) return { ok: false, error: `waiting for ${waiting.name} to be ready` };
    return begin();
  }

  /** action(id, action) runs the game's onAction. A throw rolls the state back. */
  function action(id, act) {
    const m = members.get(id);
    if (!m || m.seat === null) return { ok: false, error: 'spectators cannot act' };
    if (room.phase !== 'playing') return { ok: false, error: 'game is not running' };
    if (!game.onAction) return { ok: false, error: 'this game has no actions' };
    const backup = structuredClone(room.state);
    try {
      const r = game.onAction(room.state, pub(m), act, ctx());
      if (r !== undefined) room.state = r;
    } catch (err) {
      room.state = backup;
      pendingEvents = [];
      pendingEnd = undefined;
      if (!err[REJECT]) log(`onAction crashed in ${room.code}: ${err.stack ?? err.message}`);
      return { ok: false, error: err[REJECT] ? err.message : 'rule error: ' + err.message };
    }
    flush();
    sendState();
    return { ok: true };
  }

  /** setInput(id, input) stores a player's latest held input for the next tick. */
  function setInput(id, input) {
    const m = members.get(id);
    if (m && m.seat !== null) room.inputs[id] = input;
  }

  /** step() advances a real-time game by one fixed tick of 1 / tickRate seconds. */
  function step() {
    if (room.phase !== 'playing' || !game.tickRate) return;
    room.tick++;
    try {
      const r = game.tick(room.state, 1 / game.tickRate, ctx());
      if (r !== undefined) room.state = r;
    } catch (err) {
      log(`tick crashed in ${room.code}: ${err.stack ?? err.message}`);
      pendingEvents = [];
      pendingEnd = { error: 'tick crashed: ' + err.message };
    }
    const ending = pendingEnd !== undefined;
    flush();
    if (ending || room.tick % game.snapshotEvery === 0) sendState();
  }

  return room;
}
