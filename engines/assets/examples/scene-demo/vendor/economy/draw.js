// The little the economy draws itself: a progress badge over a working crafting station, and
// game hours as text. Menus and the shop panel come from the ui and inventory engines.

/** formatHours(hours) -> '2 h', '1 h 30 min', '20 min', 'now'. */
export function formatHours(hours) {
  if (!(hours > 0)) return 'now';
  const minutes = Math.max(1, Math.round(hours * 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * drawStationBadge(ctx, station, x, y, options)
 * A ring that fills as the station's first job runs, with the number of finished things waiting.
 *   station   from economy.station(id)
 *   x, y      middle of the badge, in canvas pixels
 *   options   { size = 10, colors: { track, accent, good, text }, font = 'sans-serif' }
 * Draws nothing when the station is idle and its tray is empty. Restores the context.
 */
export function drawStationBadge(ctx, station, x, y, options = {}) {
  if (!station || (station.jobs.length === 0 && station.tray.length === 0)) return false;
  const size = options.size ?? 10;
  const colors = { track: '#2a2238', accent: '#ffd166', good: '#7fc77a', text: '#f6ecd2', ...(options.colors ?? {}) };
  const waiting = station.tray.reduce((sum, s) => sum + s.n, 0);
  ctx.save();
  ctx.lineWidth = Math.max(2, size * 0.3);
  ctx.strokeStyle = colors.track;
  ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.stroke();
  if (station.jobs.length > 0) {
    ctx.strokeStyle = colors.accent;
    ctx.beginPath(); ctx.arc(x, y, size, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, station.jobs[0].progress))); ctx.stroke();
  }
  if (waiting > 0) {
    ctx.fillStyle = colors.good;
    ctx.beginPath(); ctx.arc(x, y, size * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors.track;
    ctx.font = `700 ${Math.round(size * 0.95)}px ${options.font ?? 'sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(waiting), x, y + 0.5);
  }
  ctx.restore();
  return true;
}
