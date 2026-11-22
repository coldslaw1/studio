// A dialogue box in the kit's look: speaker name, typewriter text, pages for
// long lines and a list of choices. It talks to a "story" object with
// view() / next() / choose(index), which is exactly what the dialogue engine's
// createStory returns, so nothing is imported from that engine. A plain array
// of lines works too.

import { clamp, contains, wrapText } from './geometry.js';
import { drawDialogue } from './dialogue-draw.js';

/** scriptStory(lines, onChoose) -> a small story object made from an array of { speaker, text, choices }. */
export function scriptStory(lines, onChoose) {
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((line, i) => {
    if (!line || typeof line.text !== 'string') throw new Error(`ui.showDialogue: line ${i} needs a "text" string`);
  });
  if (list.length === 0) throw new Error('ui.showDialogue: give at least one line');
  let at = 0;
  const go = (n) => { at = Number.isInteger(n) ? n : at + 1; };
  return {
    view() {
      const line = list[at];
      if (!line) return { active: false, dialogue: null, node: null, speaker: null, text: '', choices: [], canContinue: false };
      const choices = (line.choices || []).map((c) => (typeof c === 'string' ? { text: c } : c));
      return { active: true, dialogue: 'script', node: at, speaker: line.speaker ?? null, text: line.text, choices, canContinue: choices.length === 0 };
    },
    next() { go(list[at] && list[at].goto); },
    choose(index) {
      const choice = this.view().choices[index];
      if (typeof onChoose === 'function') onChoose(index, choice);
      go(choice && choice.goto);
    },
    close() { at = list.length; },
  };
}

/**
 * createDialogue(source, options) -> dialogue   (normally made by ui.showDialogue)
 *   source: a story ({ view(), next(), choose(i) }) or an array of lines
 *           [{ speaker, text, choices: ['Yes', 'No'] }, ...]
 *   options: {
 *     charsPerSecond = 45,   typewriter speed; 0 shows each line at once
 *     maxLines = 3,          lines of text per page; longer text gets more pages
 *     position = 'bottom',   'bottom' or 'top'
 *     modal = true,          true: the game waits and a tap anywhere moves on
 *     portrait(ctx, rect, speaker),   optional: draw the speaker's face in rect
 *     onChoose(index, choice),  onDone()
 *   }
 * dialogue: { active, selected, action(name), pointer(p, viewport), update(dt, motion),
 *             draw(ctx, theme, viewport, view), layout(viewport), snapshot(viewport), close() }
 */
export function createDialogue(source, options = {}) {
  const isStory = source && typeof source.view === 'function' && typeof source.next === 'function' && typeof source.choose === 'function';
  if (!isStory && !Array.isArray(source) && !(source && typeof source.text === 'string')) {
    throw new Error('ui.showDialogue: expected a story (view, next, choose) or an array of { speaker, text } lines');
  }
  const story = isStory ? source : scriptStory(source, options.onChoose);
  const speed = options.charsPerSecond ?? 45;
  const maxLines = options.maxLines ?? 3;
  if (!(speed >= 0)) throw new Error(`ui.showDialogue: charsPerSecond must be 0 or more, got ${speed}`);
  if (!(Number.isInteger(maxLines) && maxLines > 0)) throw new Error(`ui.showDialogue: maxLines must be a whole number above 0, got ${maxLines}`);
  const position = options.position ?? 'bottom';
  if (position !== 'bottom' && position !== 'top') throw new Error(`ui.showDialogue: position must be 'bottom' or 'top', got "${position}"`);
  let key = null; // which line `shown` belongs to
  let shown = 0; // characters revealed on this page
  let page = 0;
  let pages = [['']];
  let lastLayout = null;
  const off = isStory && typeof story.on === 'function' ? story.on('line', () => { key = null; }) : null;

  const pageLength = () => pages[page].join(' ').length;
  const typing = () => shown < pageLength();
  function finish() {
    if (!d.active) return;
    d.active = false;
    if (typeof off === 'function') off();
    if (typeof options.onDone === 'function') options.onDone();
  }
  // Re-read the story; restart the typewriter when the line changed.
  function sync(viewport) {
    const view = story.view();
    if (!view.active) { finish(); return view; }
    const now = `${view.dialogue}.${view.node}.${view.text}`;
    if (now !== key || !lastLayout || lastLayout.viewport !== viewport) {
      const fresh = now !== key;
      const l = layoutDialogue(viewport, view, { maxLines, position, portrait: !!options.portrait });
      pages = l.pages;
      lastLayout = { viewport, l };
      if (fresh) { key = now; shown = 0; page = 0; d.selected = 0; }
      page = clamp(page, 0, pages.length - 1);
    }
    d.selected = clamp(d.selected, 0, Math.max(0, view.choices.length - 1));
    return view;
  }
  function advance(view) {
    if (typing()) { shown = pageLength(); return; }
    if (page < pages.length - 1) { page += 1; shown = 0; return; }
    if (view.choices.length > 0) {
      const index = d.selected;
      if (isStory && typeof options.onChoose === 'function') options.onChoose(index, view.choices[index]);
      story.choose(index);
    } else story.next();
    key = null;
  }
  const choicesOpen = (view) => view.choices.length > 0 && !typing() && page === pages.length - 1;

  const d = {
    active: true,
    modal: options.modal !== false,
    position,
    age: 0, // seconds since it opened, for the slide-in
    selected: 0,
    /** action(name): 'confirm' moves on or picks, 'up'/'down' change the choice. Returns true if used. */
    action(name) {
      if (!d.active || !lastLayout) return false;
      const view = sync(lastLayout.viewport);
      if (!view.active) return false;
      if (name === 'confirm') { advance(view); sync(lastLayout.viewport); return true; }
      if ((name === 'up' || name === 'down') && choicesOpen(view)) {
        const n = view.choices.length;
        d.selected = (d.selected + (name === 'down' ? 1 : n - 1)) % n;
        return true;
      }
      return false;
    },
    /** pointer(p, viewport) -> true when the press was for the dialogue. */
    pointer(p, viewport) {
      if (!d.active) return false;
      const view = sync(viewport);
      if (!view.active) return false;
      const l = d.layout(viewport);
      const open = choicesOpen(view);
      const hit = open ? l.choices.findIndex((c) => contains(c.rect, p.x, p.y)) : -1;
      if (hit >= 0) d.selected = hit;
      const inside = hit >= 0 || contains(l.box, p.x, p.y);
      if (p.pressed && (inside || d.modal)) {
        if (open && hit < 0) return true; // choices are showing: only a tap on one picks
        advance(view);
        sync(viewport);
        return true;
      }
      return inside || d.modal;
    },
    update(dt, motion, viewport) {
      if (!d.active) return;
      d.age += dt;
      const view = sync(viewport);
      if (!view.active) return;
      shown = speed > 0 && motion !== false ? Math.min(pageLength(), shown + speed * dt) : pageLength();
    },
    layout(viewport) {
      const view = sync(viewport);
      return layoutDialogue(viewport, view, { maxLines, position, portrait: !!options.portrait });
    },
    draw(ctx, theme, viewport, view) {
      if (!d.active) return;
      const now = sync(viewport);
      if (!now.active) return;
      drawDialogue(ctx, theme, d.layout(viewport), {
        view: now, lines: pages[page], shown: Math.floor(shown), choicesOpen: choicesOpen(now), selected: d.selected,
        more: !typing(), portrait: options.portrait, time: view.time, motion: view.motion, age: d.age, position,
      });
    },
    snapshot(viewport) {
      const view = sync(viewport);
      if (!view.active) return { active: false };
      const l = d.layout(viewport);
      const centre = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
      return {
        active: true, speaker: view.speaker, text: view.text, typing: typing(), page, pages: pages.length,
        selected: d.selected, ...centre(l.box),
        choices: choicesOpen(view) ? view.choices.map((c, i) => ({ text: c.text, ...centre(l.choices[i].rect) })) : [],
      };
    },
    /** close() ends the dialogue now (also closes the story's open dialogue, if it can). */
    close() {
      if (d.active && typeof story.close === 'function' && story.view().active) story.close();
      finish();
    },
  };
  return d;
}

/**
 * layoutDialogue(viewport, view, o) -> { unit, box, name, text, pages, choices, portrait }
 *   Pure. o: { maxLines, position, portrait }. pages: the wrapped text, maxLines lines per page.
 */
export function layoutDialogue(viewport, view, o) {
  const { width, height, unit: u, safe } = viewport;
  const pad = 0.9 * u;
  const size = 1.0 * u;
  const lineH = 1.4 * u;
  const areaW = width - safe.left - safe.right;
  const w = Math.max(6 * u, Math.min(areaW - 1.2 * u, 32 * u));
  const h = pad * 2 + o.maxLines * lineH;
  const x = safe.left + (areaW - w) / 2;
  const nameH = view.speaker ? 1.7 * u : 0;
  const y = o.position === 'top' ? safe.top + 0.6 * u + nameH * 0.6 : height - safe.bottom - 0.9 * u - h;
  const box = { x, y, w, h };
  const face = o.portrait ? Math.min(h - pad, 5 * u) : 0;
  const portrait = face ? { x: x + pad * 0.6, y: y + (h - face) / 2, w: face, h: face } : null;
  const textX = x + pad + (face ? face + pad * 0.4 : 0);
  const textW = x + w - pad - textX;
  const all = wrapText(view.text ?? '', textW / (size * 0.52));
  const pages = [];
  for (let i = 0; i < all.length; i += o.maxLines) pages.push(all.slice(i, i + o.maxLines));
  if (pages.length === 0) pages.push(['']);
  const name = view.speaker ? { x: x + pad * 0.6, y: y - nameH * 0.6, h: nameH, size: 0.9 * u } : null;
  const rowH = 1.9 * u;
  const gap = 0.25 * u;
  const n = (view.choices || []).length;
  const cw = Math.min(w, 18 * u);
  const blockH = n * rowH + Math.max(0, n - 1) * gap;
  const top = o.position === 'top' ? y + h + 0.5 * u : y - 0.5 * u - blockH;
  const choices = (view.choices || []).map((c, i) => ({ rect: { x: x + w - cw, y: top + i * (rowH + gap), w: cw, h: rowH } }));
  return { unit: u, box, name, portrait, text: { x: textX, y: y + pad, w: textW, size, lineH }, pages, choices };
}
