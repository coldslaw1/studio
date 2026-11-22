// Short messages that slide in and fade ("Saved", "Checkpoint", "No room").

import { label } from './draw.js';
import { drawSurface } from './surface.js';
import { drawIcon, isIcon } from './icons.js';
import { estimateTextWidth, easeOut } from './geometry.js';

/** Toast kinds: the colour of the edge and the icon. */
export const TOAST_KINDS = ['info', 'good', 'warn', 'danger'];
const KIND_ICON = { good: 'check', warn: 'warn', danger: 'close' };

/**
 * createToasts() -> toasts
 *   toasts.show(text, seconds = 2)   queue a message
 *   toasts.show({ text, kind = 'info', icon, seconds = 2 })   the same with a kind
 *       (see TOAST_KINDS) and an optional icon. The same text shown again while
 *       it is still up restarts its timer and counts up ("Coin x3").
 *   toasts.update(dt)                advance time (dt in seconds)
 *   toasts.draw(ctx, theme, viewport, { top, motion, lift })   top: true stacks from the top edge;
 *       lift: pixels to stay clear of at the bottom (HUD widgets there)
 *   toasts.list()                    texts currently showing (for tests)
 */
export function createToasts() {
  let active = [];
  return {
    show(spec, seconds) {
      const o = typeof spec === 'object' && spec !== null ? spec : { text: spec, seconds };
      const { text, kind = 'info', icon } = o;
      const time = o.seconds ?? 2;
      if (typeof text !== 'string' || !text) throw new Error(`toast: text must be a non-empty string, got ${String(text)}`);
      if (!(time > 0)) throw new Error(`toast: seconds must be positive, got ${time}`);
      if (!TOAST_KINDS.includes(kind)) throw new Error(`toast: unknown kind "${kind}". Use one of: ${TOAST_KINDS.join(', ')}`);
      if (icon !== undefined && !isIcon(icon)) throw new Error(`toast: unknown icon "${icon}"`);
      const same = active.find((t) => t.text === text && t.kind === kind);
      if (same) {
        same.count += 1;
        same.total = time + Math.min(0.15, same.total - same.left);
        same.left = time;
        return;
      }
      active.push({ text, kind, icon: icon ?? KIND_ICON[kind], left: time, total: time, count: 1 });
      if (active.length > 3) active = active.slice(-3);
    },
    update(dt) {
      for (const t of active) t.left -= dt;
      active = active.filter((t) => t.left > 0);
    },
    list() { return active.map((t) => t.text); },
    clear() { active = []; },
    draw(ctx, theme, viewport, o = {}) {
      if (active.length === 0) return;
      const { width, height, unit: u, safe } = viewport;
      const motion = o.motion !== false;
      const h = 1.9 * u;
      const dir = o.top ? 1 : -1;
      // `lift` is the height taken by HUD widgets at the bottom centre: toasts sit above them.
      let y = o.top ? safe.top + 0.8 * u : height - safe.bottom - Math.max(1.7 * u, o.lift ?? 0) - h - 0.6 * u;
      ctx.save();
      for (let i = active.length - 1; i >= 0; i--) {
        const t = active[i];
        const size = 0.95 * u;
        const shown = t.count > 1 ? `${t.text} x${t.count}` : t.text;
        const iconW = t.icon ? 1.5 * u : 0;
        const w = Math.min(width - safe.left - safe.right - 1.2 * u, estimateTextWidth(shown, size) + 2 * u + iconW);
        const age = t.total - t.left;
        const enter = motion ? easeOut(age / 0.18) : 1;
        const fade = Math.min(1, t.left / 0.3) * (motion ? Math.min(1, age / 0.12 + 0.2) : 1);
        ctx.globalAlpha = Math.max(0, fade);
        const box = { x: safe.left + (width - safe.left - safe.right - w) / 2, y: y - dir * (1 - enter) * u, w, h };
        const tone = t.kind === 'info' ? theme.accent : (theme[t.kind] ?? theme.accent);
        drawSurface(ctx, box, theme, u, { edge: tone, lift: 2, strong: true, glow: tone });
        if (t.icon) drawIcon(ctx, t.icon, box.x + 1.2 * u, box.y + h / 2, 1.05 * u, tone);
        label(ctx, theme, shown, box.x + (w + iconW) / 2, box.y + h / 2, {
          size, weight: '600', color: theme.text, align: 'center', maxWidth: w - u - iconW,
        });
        y += dir * (h + 0.4 * u);
      }
      ctx.restore();
    },
  };
}
