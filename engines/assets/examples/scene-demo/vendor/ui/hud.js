// HUD: small widgets pinned to the corners of the screen during play.
//
// Widget shapes (plain objects passed to hud.add):
//   { id, type: 'counter', label: 'Score', value: 0, icon?: 'coin' }
//   { id, type: 'timer', value: 0 }                 value in seconds, shown as m:ss
//   { id, type: 'bar', value: 3, max: 5, label?: 'HP', color?: '#f00', showValue?, segments?, width? }
//   { id, type: 'pips', value: 2, max: 3, icon?: 'heart' }   e.g. lives
//   { id, type: 'text', value: 'Level 2' }
//   { id, type: 'button', icon: 'pause', onPress() {} }      finger-sized button
//   { id, type: 'minimap', size?: 6, shape?: 'round', value: { center, range, points, heading } }
//   { id, type: 'hotbar', slots: [{ icon, count, key }], value: 0, onPress?(index) }
//   { id, type: 'prompt', value: 'Talk', key: 'E', keys?: { gamepad: 'A' }, onPress?() }
// Every widget takes anchor: 'top-left' (default), 'top-center', 'top-right',
// 'bottom-left', 'bottom-center' or 'bottom-right'. Widgets sharing an anchor stack.
// Every widget may add: hint (text shown when the mouse rests on it), hidden: true.

import { ANCHORS, approach, contains, estimateTextWidth, formatTime } from './geometry.js';
import { isIcon } from './icons.js';
import { drawWidget } from './hud-draw.js';

const TYPES = ['counter', 'timer', 'bar', 'pips', 'text', 'button', 'minimap', 'hotbar', 'prompt'];

/** textOf(widget) -> the text a counter, timer, text or prompt widget shows. */
export function textOf(w) {
  if (w.type === 'timer') return formatTime(w.value);
  if (w.type === 'counter') return w.label ? `${w.label} ${w.value}` : String(w.value);
  return String(w.value ?? '');
}

/** promptKey(widget, device) -> the key name a prompt shows for a device ('' for none). */
export function promptKey(w, device) {
  const own = w.keys && w.keys[device];
  if (own !== undefined) return String(own ?? '');
  return device === 'touch' ? '' : String(w.key ?? '');
}

function sizeOf(w, u, device) {
  if (w.type === 'button') return { w: 2.6 * u, h: 2.6 * u };
  if (w.type === 'bar') return { w: (w.width ?? 7) * u, h: 1.3 * u };
  if (w.type === 'pips') return { w: w.max * 1.4 * u + 0.6 * u, h: 1.7 * u };
  if (w.type === 'minimap') return { w: (w.size ?? 6) * u, h: (w.size ?? 6) * u };
  if (w.type === 'hotbar') return { w: w.slots.length * 2.4 * u + (w.slots.length - 1) * 0.25 * u, h: 2.4 * u };
  if (w.type === 'prompt') {
    const key = promptKey(w, device);
    const keyW = key ? Math.max(1.5 * u, estimateTextWidth(key, 0.8 * u) + 0.8 * u) + 0.5 * u : 0;
    return { w: estimateTextWidth(textOf(w), 0.95 * u) + 1.2 * u + keyW, h: 1.9 * u };
  }
  const iconW = w.icon ? 1.4 * u : 0;
  return { w: Math.max(3 * u, estimateTextWidth(textOf(w), 0.95 * u) + 1.2 * u + iconW), h: 1.7 * u };
}

/**
 * createHud() -> hud
 *   hud.add(widget)        add a widget (see shapes above); returns the hud
 *   hud.set(id, value)     change a widget's value
 *   hud.set(id, value, max)   the same, and a new maximum for a bar or pips
 *   hud.patch(id, fields)  change other fields of a widget (max, label, slots, hidden ...)
 *   hud.get(id)            read a widget's value
 *   hud.remove(id) / hud.clear()
 *   hud.visible            set false to hide everything
 * The ui object calls update, pointer and draw for you.
 */
export function createHud() {
  let widgets = [];
  let pressId = null;

  function find(id, who) {
    const w = widgets.find((x) => x.id === id);
    if (!w) throw new Error(`${who}: no HUD widget with id "${id}"`);
    return w;
  }
  function check(w) {
    if (!ANCHORS.includes(w.anchor)) {
      throw new Error(`hud.add: widget "${w.id}" has unknown anchor "${w.anchor}". Use one of: ${ANCHORS.join(', ')}`);
    }
    if ((w.type === 'bar' || w.type === 'pips') && !(w.max > 0)) {
      throw new Error(`hud.add: widget "${w.id}" needs a positive "max"`);
    }
    if (w.type === 'button' && typeof w.onPress !== 'function') {
      throw new Error(`hud.add: button "${w.id}" needs an onPress function`);
    }
    if (w.type === 'button' && !w.icon && !w.label) throw new Error(`hud.add: button "${w.id}" needs an icon or a label`);
    if (w.icon && !isIcon(w.icon)) throw new Error(`hud.add: widget "${w.id}" has unknown icon "${w.icon}"`);
    if (w.type === 'hotbar' && (!Array.isArray(w.slots) || w.slots.length === 0)) {
      throw new Error(`hud.add: hotbar "${w.id}" needs a non-empty "slots" array`);
    }
    if (w.type === 'minimap' && w.shape !== undefined && w.shape !== 'round' && w.shape !== 'square') {
      throw new Error(`hud.add: minimap "${w.id}" shape must be 'round' or 'square', got "${w.shape}"`);
    }
  }
  // Rectangles that react to a press: buttons, prompts with onPress, hotbar slots.
  function targets(viewport) {
    const out = [];
    hud.layout(viewport).forEach((s, i) => {
      const w = widgets[i];
      if (w.hidden || typeof w.onPress !== 'function') return;
      if (w.type === 'hotbar') {
        const u = viewport.unit;
        w.slots.forEach((slot, n) => out.push({ key: `${w.id}:${n}`, rect: { x: s.rect.x + n * 2.65 * u, y: s.rect.y, w: 2.4 * u, h: 2.4 * u }, fire: () => w.onPress(n) }));
      } else if (w.type === 'button' || w.type === 'prompt') {
        out.push({ key: w.id, rect: s.rect, fire: () => w.onPress() });
      }
    });
    return out;
  }

  const hud = {
    visible: true,
    add(raw) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) throw new Error('hud.add: widget needs a string "id"');
      if (!TYPES.includes(raw.type)) {
        throw new Error(`hud.add: widget "${raw.id}" has unknown type "${raw.type}". Use one of: ${TYPES.join(', ')}`);
      }
      if (widgets.some((w) => w.id === raw.id)) throw new Error(`hud.add: a widget with id "${raw.id}" already exists`);
      const w = { anchor: 'top-left', value: 0, bump: 0, ...raw };
      check(w);
      if (w.type === 'pips' && !w.icon) w.icon = 'heart';
      if (w.type === 'text' || w.type === 'prompt') w.value = raw.value ?? '';
      if (w.type === 'minimap') w.value = raw.value ?? { points: [] };
      widgets.push(w);
      return hud;
    },
    set(id, value, max) {
      const w = find(id, 'hud.set');
      if (max !== undefined) {
        // A bar or pips can get a new maximum with its value (max HP rises on a level-up).
        if (w.type !== 'bar' && w.type !== 'pips') throw new Error(`hud.set: widget "${id}" is a ${w.type}, only a bar or pips has a max`);
        if (!(max > 0)) throw new Error(`hud.set: max for "${id}" must be a positive number, got ${max}`);
        w.max = max;
      }
      if (w.value !== value && w.type !== 'timer' && w.type !== 'minimap') w.bump = 0.25;
      w.value = value;
    },
    patch(id, fields) {
      const w = find(id, 'hud.patch');
      if (!fields || typeof fields !== 'object') throw new Error(`hud.patch: fields for "${id}" must be an object`);
      if ('id' in fields || 'type' in fields) throw new Error('hud.patch: "id" and "type" cannot be changed');
      const next = { ...w, ...fields };
      check(next);
      Object.assign(w, fields);
    },
    get(id) { return find(id, 'hud.get').value; },
    has(id) { return widgets.some((w) => w.id === id); },
    remove(id) { find(id, 'hud.remove'); widgets = widgets.filter((w) => w.id !== id); },
    clear() { widgets = []; pressId = null; },
    update(dt, motion = true) {
      for (const w of widgets) {
        w.bump = Math.max(0, w.bump - dt);
        if (w.type !== 'bar') continue;
        // The fill follows the value smoothly; a paler "ghost" trails behind a loss.
        w.shown = motion ? approach(w.shown ?? w.value, w.value, dt, 14) : w.value;
        const ghost = w.ghost ?? w.value;
        w.ghost = !motion || ghost < w.shown ? w.shown : approach(ghost, w.shown, dt, 2.5);
      }
    },
    /** layout(viewport) -> [{ id, rect }] positions of every widget. */
    layout(viewport) {
      const { width, height, unit: u, safe } = viewport;
      const margin = 0.6 * u;
      const gap = 0.4 * u;
      const offsets = {};
      const spots = widgets.map((w) => {
        const size = sizeOf(w, u, viewport.device ?? 'keyboard');
        const [v, h] = w.anchor.split('-');
        const used = offsets[w.anchor] || 0;
        if (!w.hidden) offsets[w.anchor] = used + size.h + gap;
        let x = safe.left + margin;
        if (h === 'center') x = safe.left + (width - safe.left - safe.right - size.w) / 2;
        if (h === 'right') x = width - safe.right - margin - size.w;
        const y = v === 'top' ? safe.top + margin + used : height - safe.bottom - margin - used - size.h;
        return { id: w.id, rect: { x, y, w: size.w, h: size.h } };
      });
      // On a narrow screen a centre widget would sit on top of the corner stacks: it steps past them instead.
      spots.forEach((s, i) => {
        const [v, h] = widgets[i].anchor.split('-');
        if (h !== 'center' || widgets[i].hidden) return;
        for (let pass = 0; pass < widgets.length; pass++) {
          const hit = spots.find((o, n) => o !== s && !widgets[n].hidden && widgets[n].anchor.split('-')[0] === v && widgets[n].anchor !== widgets[i].anchor
            && o.rect.x < s.rect.x + s.rect.w && s.rect.x < o.rect.x + o.rect.w && o.rect.y < s.rect.y + s.rect.h && s.rect.y < o.rect.y + o.rect.h);
          if (!hit) break;
          s.rect.y = v === 'top' ? hit.rect.y + hit.rect.h + gap : hit.rect.y - gap - s.rect.h;
        }
      });
      return spots;
    },
    /** bottomCentre(viewport) -> pixels above the bottom edge used by visible bottom-center widgets (0 for none). */
    bottomCentre(viewport) {
      if (!hud.visible) return 0;
      let used = 0;
      hud.layout(viewport).forEach((s, i) => {
        if (widgets[i].anchor === 'bottom-center' && !widgets[i].hidden) used = Math.max(used, viewport.height - viewport.safe.bottom - s.rect.y);
      });
      return used;
    },
    /** pointer(p, viewport) -> true when the pointer is on a HUD button. Fires onPress on release. */
    pointer(p, viewport) {
      if (!hud.visible) { pressId = null; return false; }
      const hit = targets(viewport).find((t) => contains(t.rect, p.x, p.y));
      if (p.pressed) pressId = hit ? hit.key : null;
      const used = !!hit || pressId !== null;
      if (p.released) {
        const id = pressId;
        pressId = null;
        if (id && hit && hit.key === id) hit.fire();
      }
      return used;
    },
    /** hintAt(x, y, viewport) -> { text, rect } for the widget with a `hint` under the point, or null. */
    hintAt(x, y, viewport) {
      if (!hud.visible || !widgets.some((w) => w.hint)) return null;
      const spots = hud.layout(viewport);
      const i = widgets.findIndex((w, n) => w.hint && !w.hidden && contains(spots[n].rect, x, y));
      return i < 0 ? null : { text: String(widgets[i].hint), rect: spots[i].rect };
    },
    draw(ctx, theme, viewport, o = {}) {
      if (!hud.visible || widgets.length === 0) return;
      const spots = hud.layout(viewport);
      ctx.save();
      widgets.forEach((w, i) => {
        // o.skip: 'top' or 'bottom' leaves out the widgets on that edge (a dialogue box is there).
        if (!w.hidden && !(o.skip && w.anchor.startsWith(o.skip))) drawWidget(ctx, w, spots[i].rect, theme, viewport, pressId);
      });
      ctx.restore();
    },
    /** snapshot(viewport) -> { id: { type, value, x, y } } with each widget's centre, for tests. */
    snapshot(viewport) {
      const out = {};
      hud.layout(viewport).forEach((s, i) => {
        out[s.id] = {
          type: widgets[i].type, value: widgets[i].value,
          x: Math.round(s.rect.x + s.rect.w / 2), y: Math.round(s.rect.y + s.rect.h / 2),
        };
      });
      return out;
    },
  };
  return hud;
}
