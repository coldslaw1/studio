// Optional multiplayer over Parley (the net engine). Off by default, and nothing of the net engine
// is even loaded until it is switched on, so the demo stays a plain static page. The pause menu opens
// the lobby (the net engine's lobby drawn with the ui kit): a list of open rooms, create a room (public
// or private), join one. ?net in the address skips the lobby and joins the first open room (tests). The Parley server must be serving this folder's rules.js; see rules.js.

/** The home address is left out of the web copy. `?net=ws://host:port/ws` picks a server. */
export const DEFAULT_SERVER = 'ws://localhost/ws';
/** The public rooms server: a page opened over https cannot talk to a plain ws:// address, so it uses this one. */
export const PUBLIC_SERVER = 'wss://odysseus.tailacb22c.ts.net:10000/ws';
const GAME = 'scene-demo'; // the folder name the Parley server serves the rules under
const COLORS = [{ top: '#3d7ac8', sleeve: '#2f62a8' }, { top: '#c8a03c', sleeve: '#a8842f' }, { top: '#8a4ac8', sleeve: '#6f3aa8' }, { top: '#3cc8a0', sleeve: '#2fa884' }];

/**
 * @param {object} game    core's game.
 * @param {object} shared  { stage, ui, sound, hamlet }.
 * @param {{ url?: string, importNet?: () => Promise<object>, location?: object }} [options]  For tests.
 * @returns {object} net: { on, status, others, toggle(), openLobby(), connect(), leave(), update(dt), draw(ctx), act(type) }
 */
export function createNetplay(game, shared, options = {}) {
  const { stage, ui } = shared;
  const loc = options.location ?? globalThis.location;
  const importNet = options.importNet ?? (() => import('../vendor/net/index.js'));
  const asked = stage.query?.get('net');
  const url = options.url ?? (asked && /^wss?:\/\//.test(asked) ? asked : loc?.protocol === 'https:' ? PUBLIC_SERVER : DEFAULT_SERVER);
  const remotes = new Map(); // player id -> character on the stage
  let client = null; let room = null; let lerp = (a, b, t) => a + (b - a) * t;
  const blocked = () => { if (loc && loc.protocol === 'https:' && url.startsWith('ws://')) { ui.toast('Multiplayer on a secure page needs a secure (wss://) rooms server', 4); return true; } return false; };
  // an https page reaching a tailnet address: Chrome asks first, and a refusal looks like no answer
  const allowTip = () => { if (loc?.protocol === 'https:') ui.toast('If your browser asked to allow local network access, choose Allow.', 6); };
  const newClient = (lib) => lib.createClient({ game: GAME, url, name: game.saves.settings.get('net.name', undefined), store: game.saves.settings });
  /** In a room that is running: listen to it. Called by connect() and by the lobby. */
  function enter(joined) {
    room = joined;
    net.status = `room ${room.code}`;
    room.onEvent((name, data) => {
      const c = remotes.get(data?.id);
      if (!c) return;
      if (name === 'wave') c.actor.wave(true); else c.actor.attack();
      if (name !== 'wave') { const s = shared.sound.at(c.body.x, c.body.y, stage.player.body); shared.sound.play('swish', { volume: 0.5 * s.near, pan: s.pan }); }
    });
    room.onClosed((reason) => { ui.toast(`Multiplayer ended (${reason})`); net.leave(); });
    client.onStatus((s) => { if (net.on && s !== 'connected') net.status = s; else if (net.on && room) net.status = `room ${room.code}`; });
    ui.toast(`You are in ${room.name || 'room ' + room.code} (code ${room.code}). Others find it under Multiplayer in the pause menu.`, 5);
  }
  let seated = false; // true once the local player stands on the start the server gave its seat

  function drop(id) {
    const c = remotes.get(id);
    if (!c) return;
    stage.collision.remove(c.body);
    stage.actors.splice(stage.actors.indexOf(c), 1);
    remotes.delete(id);
  }
  function remote(id, p) {
    if (!remotes.has(id)) {
      const c = stage.addCharacter('villager', p.x, p.y, { name: p.name, netId: id }, { colors: COLORS[p.seat % COLORS.length] });
      shared.hamlet.yard.addPerson(c);
      remotes.set(id, c);
      ui.toast(`${p.name} walked into the hamlet`);
    }
    return remotes.get(id);
  }

  const net = {
    on: false, status: 'off', url,
    get others() { return remotes.size; },
    /** The lobby: a list of open rooms to join, or create one (public or private). */
    async openLobby() {
      if (net.on || blocked()) return;
      net.on = true; net.status = 'lobby';
      try {
        const lib = await importNet();
        lerp = lib.lerp;
        client = newClient(lib);
        lib.openLobbyMenu(ui, lib.createLobby({ client }), {
          title: 'Multiplayer',
          onPlay: (joined) => enter(joined),
          onClose: (why) => { if (why === 'failed') { ui.toast(`Multiplayer is not available (no answer from ${url})`, 4); allowTip(); } net.leave(); },
        });
      } catch (e) {
        ui.toast(`Multiplayer is not available: ${e.message}`, 4); allowTip();
        net.leave();
      }
    },
    /** No lobby: join the first open room, or make one (?net in the address, tests). */
    async connect() {
      if (net.on || blocked()) return;
      net.on = true; net.status = 'connecting';
      try {
        const lib = await importNet();
        lerp = lib.lerp;
        client = newClient(lib);
        await Promise.race([client.connect(), new Promise((_, no) => setTimeout(() => no(new Error('no answer from ' + url)), 4000))]);
        const open = (await client.listRooms()).find((r) => r.open ?? r.players < r.maxPlayers);
        const joined = open ? await client.joinRoom(open.code) : await client.createRoom({});
        if (joined.phase === 'lobby') await (joined.isHost ? joined.start() : joined.ready()); // no waiting room on this path
        enter(joined);
      } catch (e) {
        ui.toast(`Multiplayer is not available: ${e.message}`, 4); allowTip();
        net.leave();
      }
    },
    leave() {
      for (const id of [...remotes.keys()]) drop(id);
      try { client?.close(); } catch { /* already closed */ }
      client = null; room = null; seated = false; net.on = false; net.status = 'off';
    },
    toggle() { if (net.on) { net.leave(); ui.toast('Multiplayer off'); } else net.openLobby(); },
    /** Tell the others about a one-off action: 'wave', 'swing' or 'throw'. */
    act(type) { if (room) room.send({ type }).catch(() => {}); },
    /** Once per update: send where the player is, and move the others to where the server says they are. */
    update(dt) {
      if (!room) return;
      const me = stage.player.body;
      // Every seat has a start of its own in the rules (state.players[id].x, y). Until the first snapshot
      // says where this player's is, nothing is sent: everyone joining from the same spot stood inside
      // each other and could barely walk.
      if (seated) room.input({ x: +me.x.toFixed(2), y: +me.y.toFixed(2) });
      room.update(dt);
      const { prev, next, alpha } = room.smooth();
      if (!next) return;
      if (!seated) {
        const mine = next.players?.[client.playerId];
        if (!mine) return;
        if (Number.isFinite(mine.x) && Number.isFinite(mine.y)) stage.collision.teleport(me, mine.x, mine.y);
        seated = true;
      }
      const away = new Set(room.players.filter((p) => p.connected === false).map((p) => p.id)); // dropped out; the server keeps the seat a minute
      for (const id of [...remotes.keys()]) if (!next.players[id] || away.has(id)) { ui.toast(`${remotes.get(id).name} left`); drop(id); }
      for (const [id, p] of Object.entries(next.players)) {
        if (id === client.playerId || away.has(id)) continue;
        const c = remote(id, p);
        const old = prev?.players?.[id] ?? p;
        stage.collision.teleport(c.body, lerp(old.x, p.x, alpha), lerp(old.y, p.y, alpha));
        c.vx = p.vx; c.vy = p.vy; // the stage animates it from this, like any character
      }
    },
    /** Names over the other players' heads. */
    draw(ctx) {
      if (!remotes.size) return;
      const { view, rect } = stage;
      ctx.save();
      ctx.font = `bold ${Math.round(13 * game.pixelRatio)}px Consolas, monospace`; ctx.textAlign = 'center';
      for (const c of remotes.values()) {
        const p = view.toPoint(c.body.x, c.body.y, rect, view.heightAt(c.body.x, c.body.y) + 2.2 * 16);
        ctx.fillStyle = '#10131f'; ctx.fillText(c.name, p.x + 1, p.y + 1);
        ctx.fillStyle = '#e8f0ff'; ctx.fillText(c.name, p.x, p.y);
      }
      ctx.restore();
    },
  };
  return net;
}
