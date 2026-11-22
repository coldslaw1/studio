// A small HUD: plain data for bars and effect icons, and a plain canvas drawing of it. Games with the
// ui kit can feed hudView() to their own widgets instead.

/**
 * hudView(stats, id, { resources }) -> { id, level, xp, points, bars: [{ id, label, value, max, ratio }], effects: [...] }
 * `resources` picks and orders the bars (default: every resource whose max is above 0).
 */
export function hudView(stats, id, options = {}) {
  const v = stats.view(id);
  const ids = options.resources ?? Object.keys(v.resources).filter((r) => v.resources[r].max > 0);
  return { id, level: v.level, xp: v.xp, points: v.points, bars: ids.map((r) => v.resources[r]), effects: v.effects };
}

const BAR_COLORS = { hp: 'danger', mana: 'accent', stamina: 'good' };
const FALLBACK = { bg: '#10131f', panel: '#2a2238', text: '#f6ecd2', textDim: '#b9ad94', accent: '#ffd166', danger: '#e2584d', good: '#7fc77a', shadow: '#10131f' };

/**
 * drawHud(ctx, view, options) -> { width, height } of what was drawn.
 * Draws the level, one bar per resource, the XP bar and a row of effect timers at options.x, options.y.
 * options: x (12), y (12), width (180), palette (the base style's palette; has a built-in fallback), font ('sans-serif'),
 *          colors { resourceId: css colour }, scale (1). Restores the context state it changes.
 */
export function drawHud(ctx, view, options = {}) {
  const k = options.scale ?? 1;
  const x = options.x ?? 12; const y = options.y ?? 12; const w = (options.width ?? 180) * k;
  const p = { ...FALLBACK, ...(options.palette ?? {}) };
  const font = options.font ?? 'sans-serif';
  const barH = 12 * k; const gap = 4 * k; let cy = y;
  ctx.save();
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const bar = (ratio, color, h, label) => {
    ctx.fillStyle = p.shadow; ctx.fillRect(x - k, cy - k, w + 2 * k, h + 2 * k);
    ctx.fillStyle = p.panel; ctx.fillRect(x, cy, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, cy, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
    if (label) { ctx.font = `${Math.round(9 * k)}px ${font}`; ctx.lineWidth = 2 * k; ctx.lineJoin = 'round'; ctx.strokeStyle = p.shadow; ctx.strokeText?.(label, x + 4 * k, cy + h / 2 + 0.5); ctx.fillStyle = p.text; ctx.fillText(label, x + 4 * k, cy + h / 2 + 0.5); }
    cy += h + gap;
  };
  ctx.font = `bold ${Math.round(12 * k)}px ${font}`; ctx.fillStyle = p.text;
  ctx.fillText(`Level ${view.level}${view.points > 0 ? `  (+${view.points} to spend)` : ''}`, x, cy + 7 * k);
  cy += 16 * k;
  for (const b of view.bars) bar(b.ratio, options.colors?.[b.id] ?? p[BAR_COLORS[b.id] ?? 'accent'], barH, `${b.label} ${Math.floor(b.value)} / ${Math.floor(b.max)}`);
  bar(view.xp.ratio, p.accent, 4 * k, null);
  let ex = x;
  for (const e of view.effects) {
    const size = 16 * k;
    ctx.fillStyle = p.panel; ctx.fillRect(ex, cy, size, size);
    ctx.fillStyle = e.kind === 'debuff' ? p.danger : p.good; ctx.fillRect(ex, cy + size * (1 - e.ratio), size, size * e.ratio);
    ctx.font = `bold ${Math.round(9 * k)}px ${font}`; ctx.textAlign = 'center'; ctx.lineWidth = 2 * k; ctx.lineJoin = 'round'; ctx.strokeStyle = p.shadow;
    ctx.strokeText?.(e.stacks > 1 ? String(e.stacks) : e.name.slice(0, 1), ex + size / 2, cy + size / 2 + 0.5);
    ctx.fillStyle = p.text; ctx.fillText(e.stacks > 1 ? String(e.stacks) : e.name.slice(0, 1), ex + size / 2, cy + size / 2 + 0.5);
    ctx.textAlign = 'left';
    ex += size + gap;
  }
  if (view.effects.length) cy += 16 * k + gap;
  ctx.restore();
  return { width: w, height: cy - y };
}
