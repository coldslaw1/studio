// Browser client. Also runs under Node 22+ (global WebSocket), which the tests use.
import { PROTOCOL } from './protocol.js';

const BACKOFF = [250, 500, 1000, 2000, 3000];

/** lerp(a, b, t) blends two numbers; use it with room.smooth(). */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

function memoryStore() {
  const data = new Map();
  return { get: (k) => data.get(k), set: (k, v) => void data.set(k, v) };
}
function listeners() {
  const fns = new Set();
  return {
    add(fn) { fns.add(fn); return () => fns.delete(fn); },
    fire(...args) { for (const fn of [...fns]) fn(...args); },
  };
}

/**
 * createClient({ name, game, url, store, pingMs = 5000, WebSocket, location, timers, now })
 * Everything is optional in a browser: `game` defaults to the first folder of
 * the page URL and `url` to ws://<this host>/ws. `store` ({ get, set }) keeps the
 * session token so a page reload can reclaim the seat.
 * Returns a client: connect(), createRoom(), joinRoom(), listRooms(), onStatus(), close(),
 * and the fields status, playerId, name, latency, room.
 */
export function createClient(opts = {}) {
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  const loc = opts.location ?? globalThis.location;
  const timers = opts.timers ?? globalThis;
  const now = opts.now ?? (() => performance.now());
  const store = opts.store ?? memoryStore();
  const pingMs = opts.pingMs ?? 5000;
  const game = opts.game ?? (loc ? loc.pathname.split('/').filter(Boolean)[0] : undefined);
  if (!game) throw new Error('createClient: option "game" is required outside a browser page');
  const url = opts.url ?? (loc ? `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws` : undefined);
  if (!url) throw new Error('createClient: option "url" is required outside a browser page');
  if (!WS) throw new Error('createClient: no WebSocket available; pass options.WebSocket');
  const sessionKey = 'net.session.' + game;

  let ws = null;
  let nextId = 1;
  let attempts = 0;
  let everConnected = false;
  let stopped = false;
  let lastHeard = 0;
  let pingTimer = null;
  let retryTimer = null;
  let ready = null; // { resolve, reject } for connect()
  let awaitingRoom = false;
  const pending = new Map();
  const statusL = listeners();

  const client = {
    game, url, status: 'idle', playerId: null, name: opts.name ?? null, latency: null, room: null,
    connect, createRoom, joinRoom, listRooms, close,
    /** onStatus(fn) calls fn('connected' | 'reconnecting' | 'closed'). Returns an unsubscribe function. */
    onStatus: statusL.add,
  };

  function setStatus(s) {
    if (client.status === s) return;
    client.status = s;
    statusL.fire(s);
  }
  function raw(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function request(obj) {
    if (client.status !== 'connected') return Promise.reject(new Error('net: not connected'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      raw({ ...obj, id });
    });
  }
  function failPending(reason) {
    for (const p of pending.values()) p.reject(new Error(reason));
    pending.clear();
  }

  function makeRoom(code) {
    const stateL = listeners(), roomL = listeners(), eventL = listeners(), closedL = listeners();
    let prev = null, next = null, elapsed = 0, lastInput;
    const room = {
      code, meta: null, state: null, tick: 0, closed: false,
      get phase() { return room.meta?.phase ?? 'lobby'; },
      get players() { return room.meta?.players ?? []; },
      get me() { return room.meta?.you ?? null; },
      get isHost() { return Boolean(room.meta) && room.meta.host === client.playerId; },
      get result() { return room.meta?.result ?? null; },
      /** onState(fn) calls fn(state, room) on every new state (and at once if one exists). */
      onState(fn) { if (room.state !== null) fn(room.state, room); return stateL.add(fn); },
      /** onRoom(fn) calls fn(meta, room) when players, phase, host or result change. */
      onRoom(fn) { if (room.meta) fn(room.meta, room); return roomL.add(fn); },
      /** onEvent(fn) calls fn(name, data) for events the rules emitted with ctx.emit. */
      onEvent: eventL.add,
      /** onClosed(fn) calls fn(reason) when this room is gone for this client. */
      onClosed: closedL.add,
      /** send(action) sends a discrete move. Resolves when accepted, rejects with the rule's message. */
      send: (action) => request({ t: 'action', action }),
      /** input(value) sets the held input for real-time games. Only changes are sent. */
      input(value) {
        const json = JSON.stringify(value);
        if (json === lastInput) return;
        lastInput = json;
        raw({ t: 'input', input: value });
      },
      get name() { return room.meta?.name ?? ''; },
      /** ready(on) tells the room this player is ready (games with requireReady need everyone ready to start). */
      ready: (on = true) => request({ t: 'ready', ready: Boolean(on) }),
      start: () => request({ t: 'start' }),
      restart: () => request({ t: 'restart' }),
      leave() {
        const p = request({ t: 'leave' }).catch(() => {});
        room._close('left');
        return p;
      },
      /** update(dt) advances snapshot blending by dt seconds. Call it from the game's update. */
      update(dt) { elapsed += dt; },
      /** smooth() returns { prev, next, alpha } to blend the last two states of a real-time game. */
      smooth() {
        const m = room.meta;
        const interval = m && m.tickRate ? m.snapshotEvery / m.tickRate : 0;
        const alpha = interval ? Math.min(1, elapsed / interval) : 1;
        return { prev: prev ?? next, next, alpha };
      },
      _state(msg) {
        prev = next;
        next = msg.state;
        elapsed = 0;
        room.state = msg.state;
        room.tick = msg.tick;
        stateL.fire(room.state, room);
      },
      _meta(msg) { room.meta = msg; roomL.fire(msg, room); },
      _event(msg) { eventL.fire(msg.name, msg.data); },
      _resend() { if (lastInput !== undefined) raw({ t: 'input', input: JSON.parse(lastInput) }); },
      _close(reason) {
        if (room.closed) return;
        room.closed = true;
        if (client.room === room) client.room = null;
        closedL.fire(reason);
      },
    };
    return room;
  }

  function onMessage(msg) {
    lastHeard = now();
    const room = client.room;
    switch (msg.t) {
      case 'welcome': {
        if (msg.protocol !== PROTOCOL) {
          stopped = true;
          ready?.reject(new Error(`net: protocol mismatch (server ${msg.protocol}, client ${PROTOCOL}); vendor net again`));
          ready = null;
          return ws.close();
        }
        store.set(sessionKey, msg.session);
        client.playerId = msg.playerId;
        client.name = msg.name;
        attempts = 0;
        everConnected = true;
        if (room && room.code !== msg.room) room._close('lost');
        setStatus('connected');
        raw({ t: 'ping', c: now() });
        if (msg.room) awaitingRoom = true;
        else { ready?.resolve(client); ready = null; }
        return;
      }
      case 'room': {
        let r = room;
        if (!r || r.code !== msg.code) {
          if (r) r._close('left');
          r = client.room = makeRoom(msg.code);
        }
        r._meta(msg);
        if (awaitingRoom) {
          awaitingRoom = false;
          r._resend();
          ready?.resolve(client);
          ready = null;
        }
        return;
      }
      case 'state': return void room?._state(msg);
      case 'event': return void room?._event(msg);
      case 'closed':
        if (msg.reason === 'replaced') stopped = true;
        return void room?._close(msg.reason);
      case 'ack': {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        return msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error ?? 'rejected'));
      }
      case 'pong':
        client.latency = now() - msg.c;
        return;
    }
  }

  function open() {
    ws = new WS(`${url}${url.includes('?') ? '&' : '?'}game=${encodeURIComponent(game)}`);
    const sock = ws;
    sock.onopen = () => {
      lastHeard = now();
      raw({ t: 'hello', session: store.get(sessionKey), name: client.name ?? undefined });
    };
    sock.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage(msg);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      failPending('net: disconnected');
      awaitingRoom = false;
      if (stopped || !everConnected) {
        timers.clearInterval(pingTimer);
        setStatus('closed');
        client.room?._close('disconnected');
        ready?.reject(new Error('net: could not connect to ' + url));
        ready = null;
        return;
      }
      setStatus('reconnecting');
      retryTimer = timers.setTimeout(open, BACKOFF[Math.min(attempts++, BACKOFF.length - 1)]);
    };
    sock.onerror = () => {};
  }

  /** connect() opens the connection. Resolves with the client once the server said welcome. */
  function connect() {
    if (ws || client.status === 'connected') return Promise.resolve(client);
    stopped = false;
    const p = new Promise((resolve, reject) => { ready = { resolve, reject }; });
    open();
    pingTimer = timers.setInterval(() => {
      if (!ws || ws.readyState !== 1) return;
      if (now() - lastHeard > pingMs * 3) return ws.close(); // dead link: force a reconnect
      raw({ t: 'ping', c: now() });
    }, pingMs);
    pingTimer.unref?.();
    return p;
  }

  /** createRoom({ options, isPrivate, name }) makes a room and joins it. Resolves with the room. */
  async function createRoom({ options = {}, isPrivate = false, name } = {}) {
    await request({ t: 'create', options, isPrivate, name });
    return client.room;
  }
  /** joinRoom(code, { spectate }) joins a room by its 4-letter code. Resolves with the room. */
  async function joinRoom(code, { spectate = false } = {}) {
    await request({ t: 'join', code, spectate });
    return client.room;
  }
  /** listRooms() resolves with the public rooms: [{ code, name, phase, players, maxPlayers, open, host }]. */
  async function listRooms() {
    return (await request({ t: 'list' })).rooms;
  }
  /** close() disconnects for good (no automatic reconnect). */
  function close() {
    stopped = true;
    timers.clearTimeout(retryTimer);
    timers.clearInterval(pingTimer);
    if (ws) ws.close();
    else setStatus('closed');
  }

  return client;
}
