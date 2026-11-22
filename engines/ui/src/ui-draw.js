// Draws everything the ui owns, in order: HUD, dialogue, the top menu (or
// custom screen), a menu that is fading out, the tooltip, then toasts.

import { drawMenu } from './menu-draw.js';
import { hintParts } from './keys.js';
import { displayValue } from './items.js';
import { drawSurface, focusRing } from './surface.js';
import { drawIcon } from './icons.js';
import { drawSlot } from './grid-draw.js';
import { label } from './draw.js';

// Handed to custom screens in `frame`, so a game or engine that cannot import the kit can still draw in its look.
const HELPERS = { drawSurface, drawIcon, drawSlot, drawText: label, focusRing };

/**
 * drawUi(ctx, s)
 *   s: { theme, view, frame, hud, toasts, tooltip, menu, dialogue, ghost }
 *   view: the ui's viewport { width, height, unit, safe, hint, device }.
 *   frame: { width, height, time, motion }. menu: the top menu or null.
 *   dialogue: the open dialogue or null. ghost: { menu, fade } for a menu fading out, or null.
 */
export function drawUi(ctx, s) {
  const { theme, view, frame, menu, dialogue } = s;
  // The HUD makes room for the dialogue box on its edge of the screen.
  s.hud.draw(ctx, theme, view, { skip: dialogue ? dialogue.position : null });
  if (dialogue) dialogue.draw(ctx, theme, view, frame);
  if (menu && menu.custom) {
    menu.draw(ctx, theme, { ...frame, ...HELPERS });
  } else if (menu) {
    const item = menu.items[menu.focusIndex];
    const hint = view.hint
      ? hintParts(view.device, { canCancel: menu.canCancel, grid: item.type === 'grid', adjust: ['toggle', 'slider', 'choice'].includes(item.type) })
      : null;
    drawMenu(ctx, menu, theme, { ...frame, hint });
  }
  if (s.ghost) drawMenu(ctx, s.ghost.menu, theme, { ...frame, fade: s.ghost.fade, backdrop: !menu });
  s.tooltip.draw(ctx, theme, view, frame.motion);
  if (s.toasts.list().length === 0) return;
  // Toasts sit above the bottom HUD. Next to a menu they take the side of the
  // panel with more room; a panel that fills the screen gets them at the
  // bottom, so its title stays readable.
  const busy = !!menu || !!dialogue;
  let top = busy;
  if (menu && !menu.custom) {
    const { panel } = menu.layout();
    const above = panel.y - view.safe.top;
    const below = view.height - view.safe.bottom - (panel.y + panel.h);
    top = above >= below && above >= 2.6 * view.unit;
  }
  s.toasts.draw(ctx, theme, view, { top, motion: frame.motion, lift: busy ? 0 : s.hud.bottomCentre(view) });
}

/**
 * describeFocus(menu, dialogue, view) -> what a screen reader should say now:
 * the menu title, the focused row and its value, or the dialogue line. '' for nothing.
 */
export function describeFocus(menu, dialogue, view) {
  if (menu && menu.custom) return '';
  if (menu) {
    const hint = menu.focusHint();
    const item = menu.items[menu.focusIndex];
    const name = item.type === 'grid' ? (hint ? hint.title : '') : item.label;
    return [menu.title, name, item.type === 'grid' ? '' : displayValue(item)].filter(Boolean).join(', ');
  }
  if (dialogue) {
    const snap = dialogue.snapshot(view);
    return snap.active ? [snap.speaker, snap.text].filter(Boolean).join(': ') : '';
  }
  return '';
}
