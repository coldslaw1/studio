// A ready-made lobby screen made of page elements: enter a name, see the open rooms, create one
// (named, public or private) or join one, wait for players (with ready marks when the game asks
// for them), start. Canvas games use lobby-menu.js with the ui kit instead; custom screens use lobby-model.js.
import { createClient } from './client.js';

const CSS = `
.net-lobby{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
 background:#0c0f16;color:#e8ecf4;font:16px system-ui,sans-serif;overflow:auto}
.net-lobby .box{width:min(92vw,380px);padding:20px}
.net-lobby h1{font-size:26px;margin:0 0 16px}
.net-lobby input,.net-lobby button{font:inherit;padding:12px;border-radius:10px;border:1px solid #2c3550;
 background:#161b29;color:inherit;width:100%;box-sizing:border-box;margin:0 0 10px}
.net-lobby button{background:#3d6df2;border-color:#3d6df2;font-weight:600;cursor:pointer}
.net-lobby button.plain{background:#161b29;border-color:#2c3550;font-weight:400}
.net-lobby button:disabled{opacity:.45;cursor:default}
.net-lobby .row{display:flex;gap:8px}.net-lobby .row input{flex:1;text-transform:uppercase}
.net-lobby .row button{width:auto}
.net-lobby .code{font-size:44px;letter-spacing:8px;font-weight:700;text-align:center;margin:8px 0}
.net-lobby .hint{color:#8d97b3;font-size:14px;margin:0 0 12px}
.net-lobby .err{color:#ff8b8b;min-height:20px;font-size:14px}
.net-lobby ul{list-style:none;padding:0;margin:0 0 12px}
.net-lobby li{padding:10px 12px;border:1px solid #2c3550;border-radius:10px;margin-bottom:6px;
 display:flex;justify-content:space-between}
.net-lobby li.pick{cursor:pointer}.net-lobby .off{opacity:.5}
.net-lobby li small{display:block;color:#8d97b3;font-size:13px}
.net-lobby label.check{display:flex;gap:8px;align-items:center;margin:0 0 10px;color:#8d97b3;font-size:14px}
.net-lobby label.check input{width:auto;margin:0}
.net-lobby h2{font-size:20px;margin:0 0 4px}`;

/**
 * openLobby({ title, name, game, url, store, mount, document, location, client })
 * Shows the lobby over the page and resolves with { client, room } once the
 * match has started (room.phase is no longer 'lobby'). A room code in the page
 * URL hash (#ABCD) is joined automatically, and the hash is set after joining
 * so the address can be shared. `store` ({ get, set }) remembers the name and seat.
 */
export function openLobby(opts = {}) {
  const doc = opts.document ?? globalThis.document;
  const loc = opts.location ?? globalThis.location;
  if (!doc) throw new Error('openLobby: needs a document; pass options.document');
  const store = opts.store ?? { get: () => undefined, set: () => {} };
  const mount = opts.mount ?? doc.body;
  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(doc.createElement(tag), props);
    for (const k of kids) n.append(k);
    return n;
  };
  const root = el('div', { className: 'net-lobby' });
  const box = el('div', { className: 'box' });
  root.append(el('style', { textContent: CSS }), box);
  mount.append(root);
  let client = opts.client ?? null;
  let poll = null;
  const err = el('div', { className: 'err' });
  const show = (...kids) => { box.replaceChildren(el('h1', { textContent: opts.title ?? 'Multiplayer' }), ...kids, err); };
  const fail = (e) => { err.textContent = e.message.replace(/^net: /, ''); };
  const hashCode = () => (loc ? loc.hash.replace('#', '').trim().toUpperCase() : '');

  return new Promise((resolve) => {
    function done(room) {
      clearInterval(poll);
      root.remove();
      resolve({ client, room });
    }

    function waiting(room) {
      clearInterval(poll);
      if (loc) loc.hash = room.code;
      const list = el('ul');
      const startBtn = el('button', { textContent: 'Start game' });
      const readyBtn = el('button', { textContent: 'Ready' });
      const nameLine = el('h2');
      let meReady = false;
      readyBtn.onclick = () => room.ready(!meReady).catch(fail);
      const leaveBtn = el('button', { textContent: 'Leave', className: 'plain' });
      const hint = el('p', { className: 'hint' });
      startBtn.onclick = () => room.start().catch(fail);
      leaveBtn.onclick = () => { room.leave(); if (loc) loc.hash = ''; menu(); };
      show(nameLine, el('p', { className: 'hint', textContent: 'Room code' }), el('div', { className: 'code', textContent: room.code }), hint, list, readyBtn, startBtn, leaveBtn);
      let off = null;
      let started = false;
      off = room.onRoom((meta) => {
        if (started) return;
        if (meta.phase !== 'lobby') { started = true; off?.(); return done(room); }
        list.replaceChildren(...meta.players.map((p) => el('li', {
          className: p.connected ? '' : 'off',
          textContent: p.name + (p.id === meta.host ? ' (host)' : '') + (p.id === client.playerId ? ' (you)' : '')
            + (meta.requireReady && p.id !== meta.host ? (p.ready ? ', ready' : ', not ready') : ''),
        })));
        nameLine.textContent = meta.name ?? '';
        const enough = meta.players.length >= meta.minPlayers;
        const slow = meta.requireReady ? meta.players.find((p) => p.id !== meta.host && !p.ready) : null;
        meReady = Boolean(meta.players.find((p) => p.id === client.playerId)?.ready);
        startBtn.style.display = room.isHost ? '' : 'none';
        startBtn.disabled = !enough || Boolean(slow);
        readyBtn.style.display = meta.requireReady && !room.isHost && meta.you?.seat !== null ? '' : 'none';
        readyBtn.textContent = meReady ? 'Not ready' : 'Ready';
        readyBtn.className = meReady ? 'plain' : '';
        hint.textContent = !enough ? `Waiting for players (${meta.players.length} of ${meta.minPlayers} needed). Others join with this code.`
          : slow ? `Waiting for ${slow.name} to be ready.`
          : room.isHost ? 'Ready when you are.' : 'Waiting for the host to start.';
      });
      if (started) off();
      room.onClosed(() => { if (root.isConnected && !started) menu(); });
    }

    function menu() {
      const codeIn = el('input', { placeholder: 'CODE', maxLength: 4, value: hashCode() });
      const joinBtn = el('button', { textContent: 'Join' });
      const createBtn = el('button', { textContent: 'Create room' });
      const roomNameIn = el('input', { placeholder: 'Room name (optional)', maxLength: 24 });
      const privateIn = el('input', { type: 'checkbox' });
      const privateRow = el('label', { className: 'check' }, [privateIn, 'Private: not listed, join by code only']);
      const rooms = el('ul');
      const join = (code) => client.joinRoom(code).then(waiting, fail);
      joinBtn.onclick = () => join(codeIn.value);
      createBtn.onclick = () => client.createRoom({ options: opts.options ?? {}, name: roomNameIn.value.trim() || undefined, isPrivate: privateIn.checked }).then(waiting, fail);
      show(roomNameIn, privateRow, createBtn, el('div', { className: 'row' }, [codeIn, joinBtn]), el('p', { className: 'hint', textContent: 'Open rooms' }), rooms);
      const refresh = () => client.listRooms().then((list) => {
        rooms.replaceChildren(...list.map((r) => {
          const joinable = r.open !== false;
          const li = el('li', { className: joinable ? 'pick' : 'off' }, [
            el('span', {}, [r.name ?? r.code, el('small', { textContent: `${r.code}, host ${r.host}` })]),
            el('span', { textContent: `${r.players}/${r.maxPlayers} ${r.phase === 'lobby' ? 'waiting' : r.phase === 'playing' ? 'in game' : 'finished'}` }),
          ]);
          if (joinable) li.onclick = () => join(r.code);
          return li;
        }));
        if (!list.length) rooms.replaceChildren(el('li', { className: 'off', textContent: 'None yet' }));
      }, () => {});
      refresh();
      clearInterval(poll);
      poll = setInterval(refresh, 2000);
    }

    async function enter(name) {
      err.textContent = '';
      try {
        store.set('net.name', name);
        client ??= createClient({ ...opts, name, store });
        await client.connect();
        if (client.room) return waiting(client.room); // seat reclaimed after a reload
        const code = hashCode();
        if (code) return client.joinRoom(code).then(waiting, (e) => { menu(); fail(e); });
        menu();
      } catch (e) {
        client = opts.client ?? null;
        fail(e);
      }
    }

    const saved = opts.name ?? store.get('net.name');
    const nameIn = el('input', { placeholder: 'Your name', maxLength: 20, value: saved ?? '' });
    const go = el('button', { textContent: 'Continue' });
    go.onclick = () => enter(nameIn.value.trim() || 'Player');
    nameIn.onkeydown = (e) => { if (e.key === 'Enter') go.onclick(); };
    show(nameIn, go);
    const gameName = opts.game ?? (loc ? loc.pathname.split('/').filter(Boolean)[0] : '');
    if (saved && store.get('net.session.' + gameName)) go.onclick();
  });
}
