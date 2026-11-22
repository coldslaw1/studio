// createDialogueBox(story): a simple on-canvas dialogue box. It reads core's
// input actions (up, down, confirm) and draws with a 2D canvas context.
// Games that use the UI kit can skip this file and draw story.view() themselves.

import { bindChoiceActions, pressedChoice } from './keys.js';

const DEFAULT_STYLE = {
  font: '16px sans-serif', lineHeight: 22, padding: 14,
  panel: '#1b1f2a', border: '#8fa3c7', text: '#f2f2f2', speaker: '#ffd27a',
  choice: '#c9d4ea', selected: '#ffffff', selectedBack: '#3a4763', hint: '#8fa3c7',
};

/**
 * Split text into lines that fit a width, using ctx.measureText.
 * @param {CanvasRenderingContext2D} ctx canvas context (its current font is used)
 * @param {string} text the text to wrap; "\n" forces a new line
 * @param {number} maxWidth width in logical pixels
 * @returns {string[]} the lines
 */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Create a dialogue box that shows the story's current line and choices.
 * @param {object} story a story made by createStory()
 * @param {object} [options]
 * @param {number} [options.charsPerSecond=45] typewriter speed; 0 shows text at once
 * @param {object} [options.style] colours and font, merged over the defaults
 * @param {boolean} [options.numberKeys=true] keys 1 to 9 pick the answer with that number
 * @returns {{selected: number, typed: boolean, update: function, draw: function, finish: function, setStyle: function}}
 */
export function createDialogueBox(story, options = {}) {
  const style = { ...DEFAULT_STYLE, ...(options.style || {}) };
  const speed = options.charsPerSecond === undefined ? 45 : options.charsPerSecond;
  let shown = 0; // characters revealed so far
  let lineKey = null; // which line `shown` belongs to
  let choiceRects = []; // filled by draw(), used for pointer picks
  const numberKeys = options.numberKeys !== false;
  const prepared = new WeakSet(); // inputs whose number-key actions were looked after
  const unbound = new WeakMap(); // input -> choice actions it does not have
  story.on('line', () => { lineKey = null; }); // every new line restarts the typewriter

  const box = {
    /** Index of the highlighted choice. */
    selected: 0,
    /** True when a dialogue is open and its current line is fully typed out (answers are on screen). */
    get typed() {
      const view = story.view();
      return view.active && `${view.dialogue}.${view.node}` === lineKey && shown >= view.text.length;
    },
    /** Show the whole current line at once (what the first confirm press does). */
    finish() {
      const view = story.view();
      if (!view.active) return;
      lineKey = `${view.dialogue}.${view.node}`;
      shown = view.text.length;
    },
    /**
     * Change colours or font while running.
     * @param {object} changes any of the style keys; the rest keep their value
     */
    setStyle(changes) {
      if (changes === null || typeof changes !== 'object') throw new Error(`box.setStyle: changes must be an object, got ${JSON.stringify(changes)}`);
      Object.assign(style, changes);
    },
    /**
     * Advance the typewriter and handle input. Call once per update step.
     * @param {number} dt seconds since the last update
     * @param {object} input core's input object (down/pressed/pointer)
     */
    update(dt, input) {
      const view = story.view();
      if (!view.active) { lineKey = null; return; }
      const key = `${view.dialogue}.${view.node}`;
      if (key !== lineKey) { lineKey = key; shown = 0; box.selected = 0; }
      if (numberKeys && input && !prepared.has(input)) { prepared.add(input); unbound.set(input, new Set()); bindChoiceActions(input); }
      const full = view.text.length;
      const pointer = (input && input.pointer) || {};
      // Core turns a finished tap into "confirm". While the pointer is the device
      // in use, only pointer.pressed counts, so one tap never acts twice.
      const byPointer = Boolean(input && input.lastDevice === 'pointer');
      const confirm = Boolean(input && !byPointer && input.pressed('confirm'));
      if (shown < full) {
        shown = speed > 0 ? Math.min(full, shown + speed * dt) : full;
        // The first press only finishes the line. A number key does the same (never a blind pick:
        // the answers are not on screen yet), so a player who knows the answers is not left waiting.
        const number = numberKeys && input && view.choices.length > 0 && pressedChoice(input, view.choices.length, unbound.get(input)) >= 0;
        if (confirm || pointer.pressed || number) shown = full;
        return;
      }
      if (view.choices.length === 0) {
        if (confirm || pointer.pressed) story.next();
        return;
      }
      box.selected = Math.min(box.selected, view.choices.length - 1);
      if (!input) return;
      if (numberKeys) {
        const picked = pressedChoice(input, view.choices.length, unbound.get(input));
        if (picked >= 0) { story.choose(picked); return; }
      }
      if (input.pressed('down')) box.selected = (box.selected + 1) % view.choices.length;
      if (input.pressed('up')) box.selected = (box.selected + view.choices.length - 1) % view.choices.length;
      const hit = choiceRects.findIndex((r) => pointer.x >= r.x && pointer.x < r.x + r.width && pointer.y >= r.y && pointer.y < r.y + r.height);
      if (hit >= 0 && hit < view.choices.length) box.selected = hit;
      if (confirm || (pointer.pressed && hit >= 0 && hit < view.choices.length)) story.choose(box.selected);
    },
    /**
     * Draw the box. Draws nothing when no dialogue is open.
     * @param {CanvasRenderingContext2D} ctx canvas context (state is restored)
     * @param {{x: number, y: number, width: number, height: number}} rect where to draw, in logical pixels
     */
    draw(ctx, rect) {
      const view = story.view();
      choiceRects = [];
      if (!view.active) return;
      const reveal = `${view.dialogue}.${view.node}` === lineKey ? Math.floor(shown) : view.text.length;
      ctx.save();
      ctx.font = style.font;
      ctx.textBaseline = 'top';
      ctx.fillStyle = style.panel;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      const left = rect.x + style.padding;
      const inner = rect.width - style.padding * 2;
      let y = rect.y + style.padding;
      if (view.speaker) {
        ctx.fillStyle = style.speaker;
        ctx.fillText(view.speaker, left, y);
        y += style.lineHeight;
      }
      ctx.fillStyle = style.text;
      let budget = reveal;
      for (const line of wrapText(ctx, view.text, inner)) {
        ctx.fillText(line.slice(0, Math.max(0, budget)), left, y);
        budget -= line.length + 1;
        y += style.lineHeight;
      }
      if (reveal >= view.text.length) {
        y += style.lineHeight / 2;
        view.choices.forEach((choice, i) => {
          const lines = wrapText(ctx, `${i + 1}. ${choice.text}`, inner);
          const height = lines.length * style.lineHeight;
          choiceRects.push({ x: left, y, width: inner, height });
          if (i === box.selected) { ctx.fillStyle = style.selectedBack; ctx.fillRect(left - 4, y - 2, inner + 8, height); }
          ctx.fillStyle = i === box.selected ? style.selected : style.choice;
          lines.forEach((line, n) => ctx.fillText(line, left, y + n * style.lineHeight));
          y += height;
        });
        if (view.canContinue) {
          ctx.fillStyle = style.hint;
          ctx.fillText('▼', rect.x + rect.width - style.padding - 12, rect.y + rect.height - style.padding - 14);
        }
      }
      ctx.restore();
    },
  };
  return box;
}
