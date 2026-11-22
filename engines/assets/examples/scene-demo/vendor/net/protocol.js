// Shared constants and small helpers used by both the client and the server.

/** Wire protocol version. Client and server must agree. */
export const PROTOCOL = 1;

/** Letters used in room codes (no I or O, which look like 1 and 0). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** cleanName(value, fallback) trims a player name to 1..20 printable chars. */
export function cleanName(value, fallback = 'Player') {
  const s = String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return s || fallback;
}

/** cleanRoomName(value, fallback) trims a room name to 1..24 printable chars. */
export function cleanRoomName(value, fallback = 'Room') {
  const s = String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return s || fallback;
}

/** normalizeGame(game) checks a rules module and fills in defaults. */
export function normalizeGame(game) {
  if (!game || typeof game.setup !== 'function') {
    throw new Error('normalizeGame: rules module must export setup(ctx), got ' + typeof game?.setup);
  }
  const maxPlayers = game.maxPlayers ?? 2;
  const minPlayers = game.minPlayers ?? Math.min(2, maxPlayers);
  const tickRate = game.tickRate ?? 0;
  if (!(maxPlayers >= 1) || !(minPlayers >= 1) || minPlayers > maxPlayers) {
    throw new Error(`normalizeGame: bad player limits min=${minPlayers} max=${maxPlayers}`);
  }
  if (tickRate < 0 || tickRate > 60) {
    throw new Error(`normalizeGame: tickRate must be 0..60, got ${tickRate}`);
  }
  if (tickRate > 0 && typeof game.tick !== 'function') {
    throw new Error('normalizeGame: tickRate is set but tick(state, dt, ctx) is missing');
  }
  return {
    ...game,
    minPlayers,
    maxPlayers,
    tickRate,
    snapshotEvery: Math.max(1, game.snapshotEvery ?? 1),
    autoStart: Boolean(game.autoStart),
    spectators: game.spectators !== false,
    requireReady: Boolean(game.requireReady),
  };
}
