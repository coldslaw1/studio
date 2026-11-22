// "Did you mean" hints for typos in an events file.

/** Edit distance between two short strings. */
export function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** The closest of `options` to `word`, or null when nothing is close. */
export function closest(word, options) {
  let best = null; let bestD = Infinity;
  const w = String(word).toLowerCase();
  for (const option of options) {
    const d = distance(w, String(option).toLowerCase());
    if (d < bestD) { best = option; bestD = d; }
  }
  return best !== null && bestD <= (w.length <= 3 ? 1 : Math.max(2, Math.floor(w.length / 3))) ? best : null;
}

/** ' Did you mean "x"?' or '' . */
export function hint(word, options) {
  const c = closest(word, options);
  return c === null ? '' : ` Did you mean "${c}"?`;
}
