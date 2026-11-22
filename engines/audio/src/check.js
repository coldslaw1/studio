// Quality checks for rendered audio: is it there, is it clean, does it loop?
// The command line's --strict uses these; so can a game's own tests.

/**
 * checkAudio(samples, { sampleRate, loop, maxSeconds }?) -> { ok, warnings, seconds, peak, rms, dc, seam }
 *   samples: a Float32Array, or { left, right }
 *   loop:    true for music and ambience that must repeat without a click
 * warnings is a list of plain sentences; ok is true when it is empty.
 */
export function checkAudio(samples, options = {}) {
  const channels = samples instanceof Float32Array ? [samples] : samples && samples.left && samples.right ? [samples.left, samples.right] : null;
  if (!channels) throw new Error(`checkAudio: samples must be a Float32Array or { left, right }, got ${typeof samples}`);
  const { sampleRate = 44100, loop = false, maxSeconds = loop ? 180 : 12 } = options;
  const n = channels[0].length, warnings = [];
  let peak = 0, sum = 0, mean = 0, clipped = 0, broken = false, seam = 0, biggest = 0, edge = 0;
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      const x = ch[i], a = Math.abs(x);
      if (!(a <= 1e9)) { broken = true; continue; }
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x * x; mean += x;
      if (i) { const d = Math.abs(x - ch[i - 1]); if (d > biggest) biggest = d; }
    }
    seam = Math.max(seam, Math.abs(ch[0] - ch[n - 1]));
    edge = Math.max(edge, Math.abs(ch[0]), Math.abs(ch[n - 1]));
  }
  const total = n * channels.length, rms = Math.sqrt(sum / total), dc = mean / total, seconds = n / sampleRate;
  const r = (x) => Math.round(x * 1000) / 1000;
  if (broken) warnings.push('The audio holds values that are not numbers.');
  if (peak < 0.01) warnings.push('The audio is silent.');
  else if (peak < 0.08) warnings.push(`The audio is very quiet (peak ${r(peak)}).`);
  if (clipped > 3) warnings.push(`The audio clips (${clipped} samples at full scale).`);
  if (Math.abs(dc) > 0.02) warnings.push(`The audio is off centre (average ${r(dc)}), which wastes headroom and can thump.`);
  if (seconds > maxSeconds) warnings.push(`The audio is ${r(seconds)} s long, more than ${maxSeconds} s.`);
  if (loop && seam > 0.05 && seam > biggest) warnings.push(`The loop point jumps by ${r(seam)}, more than anything inside the loop: it will click.`);
  if (!loop && edge > 0.05) warnings.push(`The audio does not start and end at silence (${r(edge)}): it will click.`);
  return { ok: warnings.length === 0, warnings, seconds: r(seconds), peak: r(peak), rms: r(rms), dc: r(dc), seam: r(seam) };
}
