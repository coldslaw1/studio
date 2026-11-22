// Tiny "did you mean" helper for the validator.

function distance(a, b) {
  const row = [];
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * Find the closest allowed word to a misspelled one.
 * @param {string} word the word that was not recognised
 * @param {string[]} allowed the words that would have been accepted
 * @returns {string} ' Did you mean "x"?' or '' when nothing is close
 */
export function didYouMean(word, allowed) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of allowed) {
    const score = distance(String(word).toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  const limit = Math.max(2, Math.floor(String(word).length / 3));
  return best !== null && bestScore <= limit ? ` Did you mean "${best}"?` : '';
}
