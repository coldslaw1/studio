// The lobby without a screen: which rooms are open, the room you are in, who is ready.
// Draw it any way you like (lobby.js draws it with page elements, lobby-menu.js with the ui kit).

/**
 * createLobby({ client, options, pollMs = 2000, connectMs = 5000, timers })
 *   client   a client from createClient (connected or not; open() connects it).
 *   options  passed to the rules as ctx.options when this player creates a room.
 * Returns the lobby:
 *   state            { screen, rooms, room, error, busy }
 *                    screen: 'closed' | 'connecting' | 'rooms' | 'room' | 'playing'
 *                    rooms:  [{ code, name, host, players, maxPlayers, phase, open }]  (public rooms)
 *                    room:   null or { code, name, phase, isPrivate, isHost, requireReady, minPlayers, maxPlayers,
 *                            players: [{ id, name, seat, connected, ready, host, you }], canStart, waitingFor, meReady }
 *   room             the client's room object once in one (room.onState, room.send, ...), else null
 *   open()           connect and start listing rooms. Resolves true when the first list is in, false
 *                    (with state.error) if the server did not answer within connectMs.
 *   refresh()        ask for the room list now (it also refreshes by itself every pollMs)
 *   create({ name, isPrivate }), join(code), leave(), ready(on), start()
 *                    each resolves true, or false with state.error set; none of them throws
 *   close()          leave the room, stop listing and disconnect
 *   onChange(fn)     fn(state) after anything changed. Returns an unsubscribe function.
 *   onPlay(fn)       fn(room) once each time the room you are in starts playing.
 */
export function createLobby({ client, options = {}, pollMs = 2000, connectMs = 5000, timers = globalThis } = {}) {
  if (!client) throw new Error('createLobby: needs a client from createClient');
  const changeL = new Set();
  const playL = new Set();
  const state = { screen: 'closed', rooms: [], room: null, error: '', busy: false };
  let poll = null;
  let watched = null; // the client room we are listening to
  let offRoom = null;
  let wasPlaying = false;
  let last = '';

  function summary(room) {
    const meta = room.meta;
    if (!meta) return null;
    const players = meta.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, connected: p.connected !== false,
      ready: p.id === meta.host || Boolean(p.ready), host: p.id === meta.host, you: p.id === client.playerId,
    }));
    const enough = players.length >= meta.minPlayers;
    const slow = meta.requireReady ? players.find((p) => !p.ready) ?? null : null;
    const isHost = meta.host === client.playerId;
    return {
      code: meta.code, name: meta.name ?? meta.code, phase: meta.phase, isPrivate: Boolean(meta.isPrivate), isHost,
      requireReady: Boolean(meta.requireReady), minPlayers: meta.minPlayers, maxPlayers: meta.maxPlayers, players,
      canStart: isHost && meta.phase !== 'playing' && enough && !slow,
      waitingFor: !enough ? `${meta.minPlayers - players.length} more player${meta.minPlayers - players.length === 1 ? '' : 's'}` : slow ? slow.name : '',
      meReady: Boolean(players.find((p) => p.you)?.ready),
    };
  }

  function sync() {
    const room = client.room && !client.room.closed ? client.room : null;
    if (room !== watched) {
      offRoom?.();
      offRoom = null;
      watched = room;
      wasPlaying = false;
      if (room) {
        const a = room.onRoom(() => sync());
        const b = room.onClosed((reason) => {
          if (reason !== 'left') state.error = reason === 'idle' ? 'The room was closed for being idle' : `The room closed (${reason})`;
          sync();
          refresh();
        });
        offRoom = () => { a(); b(); };
      }
    }
    if (state.screen !== 'closed' && state.screen !== 'connecting') {
      state.room = room ? summary(room) : null;
      state.screen = !state.room ? 'rooms' : state.room.phase === 'playing' ? 'playing' : 'room';
    }
    lobby.room = room;
    const json = JSON.stringify(state);
    if (json !== last) {
      last = json;
      for (const fn of [...changeL]) fn(state);
    }
    const playing = Boolean(room) && state.screen === 'playing';
    if (playing && !wasPlaying) for (const fn of [...playL]) fn(room);
    wasPlaying = playing;
  }

  async function attempt(work) {
    state.busy = true;
    state.error = '';
    sync();
    try {
      await work();
      return true;
    } catch (err) {
      state.error = String(err?.message ?? err).replace(/^net: /, '');
      return false;
    } finally {
      state.busy = false;
      sync();
    }
  }

  async function refresh() {
    if (state.screen === 'closed' || client.status !== 'connected') return;
    try {
      state.rooms = (await client.listRooms()).map((r) => ({ open: r.players < r.maxPlayers, name: r.code, ...r }));
    } catch { /* keep the old list; the next poll tries again */ }
    sync();
  }

  const lobby = {
    state,
    room: null,
    async open() {
      if (state.screen !== 'closed') return true;
      state.screen = 'connecting';
      const ok = await attempt(async () => {
        if (client.status === 'connected') return;
        let timer;
        try {
          await Promise.race([client.connect(), new Promise((_, no) => { timer = timers.setTimeout(() => no(new Error('no answer from the multiplayer server')), connectMs); })]);
        } catch (err) {
          try { client.close(); } catch { /* never opened */ }
          throw err;
        } finally {
          timers.clearTimeout(timer);
        }
      });
      if (!ok) { state.screen = 'closed'; sync(); return false; }
      state.screen = 'rooms';
      sync();
      await refresh();
      poll = timers.setInterval(refresh, pollMs);
      poll?.unref?.();
      return true;
    },
    refresh,
    create: ({ name, isPrivate = false } = {}) => attempt(() => client.createRoom({ options, isPrivate, name })),
    join: (code) => attempt(() => client.joinRoom(String(code ?? '').trim().toUpperCase())),
    leave: () => attempt(async () => { await client.room?.leave(); await refresh(); }),
    ready: (on = true) => attempt(() => client.room ? client.room.ready(on) : Promise.reject(new Error('not in a room'))),
    start: () => attempt(() => client.room ? client.room.start() : Promise.reject(new Error('not in a room'))),
    close() {
      if (poll) timers.clearInterval(poll);
      poll = null;
      try { client.room?.leave(); } catch { /* already gone */ }
      try { client.close(); } catch { /* already closed */ }
      state.screen = 'closed'; state.rooms = []; state.room = null; state.busy = false;
      sync();
    },
    onChange(fn) { changeL.add(fn); return () => changeL.delete(fn); },
    onPlay(fn) { playL.add(fn); return () => playL.delete(fn); },
  };
  return lobby;
}
