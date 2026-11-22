// Pure rectangle and sizing helpers. Everything is in logical canvas pixels.

/** clamp(v, lo, hi) -> v limited to the range lo..hi. */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** contains(rect, x, y) -> true when the point is inside {x, y, w, h}. */
export function contains(rect, x, y) {
  return !!rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * unitFor(width, height) -> the UI unit in pixels.
 * Every size in the kit is a multiple of this, so the UI scales with the
 * canvas. A menu row is 2.5 units tall, which keeps it finger-sized on a phone.
 */
export function unitFor(width, height) {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`unitFor: width and height must be positive numbers, got ${width} x ${height}`);
  }
  return Math.max(4, Math.min(width, height) / 20);
}

/**
 * approach(current, target, dt, rate) -> current moved smoothly toward target.
 * Frame-rate independent: rate 20 covers most of the distance in about 0.1 s.
 */
export function approach(current, target, dt, rate = 20) {
  if (!Number.isFinite(current)) return target;
  const next = target + (current - target) * Math.exp(-rate * dt);
  return Math.abs(next - target) < 0.001 ? target : next;
}

/** easeOut(t) -> 0..1 curve that starts fast and settles (t is clamped to 0..1). */
export function easeOut(t) {
  const c = clamp(t, 0, 1);
  return 1 - (1 - c) ** 3;
}

/** estimateTextWidth(text, fontSize) -> rough width in pixels, usable without a canvas. */
export function estimateTextWidth(text, fontSize) {
  return String(text).length * fontSize * 0.56;
}

/**
 * wrapText(text, maxChars) -> array of lines, breaking at spaces.
 * A "\n" in the text always starts a new line.
 */
export function wrapText(text, maxChars) {
  const limit = Math.max(4, Math.floor(maxChars));
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && (line.length + 1 + word.length) > limit) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** formatTime(seconds) -> "m:ss" (e.g. 75.4 -> "1:15"). Negative values show as 0:00. */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const ANCHORS = ['top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'];
