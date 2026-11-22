// Small statistics helpers.

export function mean(values) {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** quantile(values, q) with q in 0..1, linear interpolation. null when empty. */
export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

/** 95% Wilson interval for a proportion. Returns { low, high }. */
export function wilson(successes, n) {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - spread) / denom), high: Math.min(1, (centre + spread) / denom) };
}

export const round = (value, digits = 3) => (
  value === null || value === undefined ? null : Number(Number(value).toFixed(digits))
);
