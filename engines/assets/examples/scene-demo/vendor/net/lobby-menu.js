// The lobby drawn with the studio ui kit (studio-engines/ui): a room list, a waiting room with
// ready marks, and joining a private room by its code. Works with keys, mouse, touch and pads,
// because it is made of ordinary kit menus. Needs only the kit's `ui` object, so nothing is imported.
import { CODE_ALPHABET } from './protocol.js';

/**
 * openLobbyMenu(ui, lobby, options) -> { close(), refresh() }
 *   ui       the kit's ui (ui.open, ui.back, ui.current, ui.toast).
 *   lobby    from createLobby. It is opened here if it is not open yet.
 *   options  { title = 'Multiplayer', roomName, onPlay(room), onClose(reason), leaveOnClose = true }
 *            roomName   name given to rooms this player creates (default: the server names it after the player)
 *            onPlay     the room started (or you joined one that is running): the menu has closed, start drawing the game
 *            onClose    the player backed out ('back') or the lobby could not connect ('failed')
 * The menus have the ids 'lobby-connecting', 'lobby-rooms', 'lobby-room' and 'lobby-code'; room rows have the id 'room-<CODE>'.
 */
export function openLobbyMenu(ui, lobby, options = {}) {
  const title = options.title ?? 'Multiplayer';
  let menu = null; // the kit menu we have on screen
  let shown = '';
  let suggested = '';
  let view = 'main'; // 'main' follows the lobby; 'code' is the code entry
  let isPrivate = false;
  let code = [0, 0, 0, 0];
  let closed = false;
  let lastError = '';

  const mine = () => menu && ui.current() === menu;
  function put(spec, grab = '') {
    const json = JSON.stringify(spec, (k, v) => (typeof v === 'function' ? undefined : v));
    if (json === shown && mine()) return;
    if (menu && !mine()) { if (ui.isOpen()) return; menu = null; } // something else is on top: wait for it
    // Keep the player's place in the list, unless the suggested row changed (Start just became possible).
    const kept = menu && suggested === `${spec.id}|${grab}` ? menu.focusId : undefined;
    if (menu) ui.back();
    shown = json;
    suggested = `${spec.id}|${grab}`;
    menu = ui.open({ ...spec, focus: spec.items.some((i) => i.id === kept && !i.disabled && i.type !== 'text') ? kept : spec.focus });
  }
  function shut() {
    if (mine()) ui.back();
    menu = null;
    shown = '';
  }
  function finish(reason) {
    if (closed) return;
    closed = true;
    off(); offPlay();
    shut();
    if (reason !== 'play' && options.leaveOnClose !== false) lobby.close();
    if (reason !== 'play') options.onClose?.(reason);
  }

  function roomsMenu(s) {
    const rows = s.rooms.map((r) => ({
      id: 'room-' + r.code, label: r.name,
      detail: `${r.host ? 'Host ' + r.host + ', ' : ''}${r.phase === 'lobby' ? 'waiting to start' : r.phase === 'playing' ? 'in game' : 'finished'}`,
      badge: `${r.players}/${r.maxPlayers}`, disabled: !r.open || s.busy,
      onSelect: () => lobby.join(r.code),
    }));
    return {
      id: 'lobby-rooms', title, subtitle: s.rooms.length ? `${s.rooms.length} open room${s.rooms.length === 1 ? '' : 's'}` : 'No open rooms yet', wide: true,
      focus: rows.find((r) => !r.disabled)?.id ?? 'create',
      items: [
        ...rows,
        { id: 'create', label: 'Create a room', icon: 'play', disabled: s.busy, onSelect: () => lobby.create({ name: options.roomName, isPrivate }) },
        { id: 'private', label: 'Private (join by code only)', type: 'toggle', value: isPrivate, onChange: (v) => { isPrivate = v; } },
        { id: 'code', label: 'Join with a code', onSelect: () => { view = 'code'; render(); } },
        { id: 'back', label: 'Back', onSelect: () => finish('back') },
      ],
      onCancel: () => finish('back'),
    };
  }
  function codeMenu() {
    const letters = [...CODE_ALPHABET];
    return {
      id: 'lobby-code', title: 'Join with a code', text: 'Pick the four letters of the room code.', focus: 'letter-0',
      items: [
        ...code.map((n, i) => ({ id: 'letter-' + i, label: `Letter ${i + 1}`, type: 'choice', value: letters[n], options: letters, onChange: (v) => { code[i] = letters.indexOf(v); } })),
        { id: 'join', label: 'Join', icon: 'play', onSelect: async () => { view = 'main'; if (!(await lobby.join(code.map((n) => letters[n]).join('')))) render(); } },
        { id: 'back', label: 'Back', onSelect: () => { view = 'main'; render(); } },
      ],
      onCancel: () => { view = 'main'; render(); },
    };
  }
  function roomMenu(s) {
    const r = s.room;
    const people = r.players.map((p, i) => ({
      type: 'text', id: 'player-' + i,
      label: `${p.name}${p.you ? ' (you)' : ''}${p.host ? ', host' : ''}${!p.connected ? ', away' : r.requireReady && !p.host ? (p.ready ? ', ready' : ', not ready') : ''}`,
    }));
    const hint = r.phase === 'ended' ? (r.isHost ? 'The game is over. Start again when you like.' : 'The game is over. Waiting for the host.')
      : r.waitingFor ? `Waiting for ${r.waitingFor}.` : r.isHost ? 'Everyone is here. Start when you like.' : 'Waiting for the host to start.';
    const items = [...people, { type: 'text', id: 'hint', label: hint }];
    if (r.isHost) items.push({ id: 'start', label: r.phase === 'ended' ? 'Play again' : 'Start game', icon: 'play', disabled: !r.canStart || s.busy, onSelect: () => (r.phase === 'ended' ? lobby.room.restart().catch((e) => ui.toast(e.message)) : lobby.start()) });
    else if (r.requireReady && r.phase === 'lobby') items.push({ id: 'ready', label: 'Ready', type: 'toggle', value: r.meReady, onChange: (v) => lobby.ready(v) });
    items.push({ id: 'leave', label: 'Leave room', danger: true, onSelect: () => lobby.leave() });
    return {
      id: 'lobby-room', title: r.name, subtitle: `Code ${r.code}${r.isPrivate ? ' (private)' : ''}, ${r.players.length} of ${r.maxPlayers} players`, wide: true,
      focus: r.isHost && r.canStart ? 'start' : !r.isHost && r.requireReady ? 'ready' : 'leave',
      items, onCancel: () => lobby.leave(),
    };
  }

  function render() {
    if (closed) return;
    const s = lobby.state;
    if (s.error && s.error !== lastError) ui.toast(s.error, 4);
    lastError = s.error;
    if (s.screen === 'playing') {
      const room = lobby.room;
      finish('play');
      options.onPlay?.(room);
      return;
    }
    if (s.screen === 'room') { view = 'main'; return put(roomMenu(s), s.room.canStart ? 'start' : ''); }
    if (s.screen === 'rooms') return put(view === 'code' ? codeMenu() : roomsMenu(s));
    if (s.screen === 'connecting') return put({ id: 'lobby-connecting', title, subtitle: 'Connecting...', items: [{ id: 'back', label: 'Cancel', onSelect: () => finish('back') }], onCancel: () => finish('back') });
  }

  const off = lobby.onChange(render);
  const offPlay = lobby.onPlay(render);
  if (lobby.state.screen === 'closed') {
    lobby.open().then((ok) => { if (!ok && !closed) { ui.toast(lobby.state.error || 'Could not reach the multiplayer server', 4); finish('failed'); } });
  }
  render();
  return { close: () => finish('back'), refresh: render };
}
