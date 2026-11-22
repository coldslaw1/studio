// Turns samples into a .wav file (16-bit, mono or stereo). Handy for listening
// to a sound outside the game, or for tests. Games do not need this.

/**
 * encodeWav(samples, sampleRate?) -> Uint8Array holding a complete .wav file
 *   samples: a Float32Array (mono), or { left, right } / [left, right] for stereo
 */
export function encodeWav(samples, sampleRate = 44100) {
  const channels = samples instanceof Float32Array ? [samples] : Array.isArray(samples) ? samples : samples && samples.left && samples.right ? [samples.left, samples.right] : null;
  if (!channels || channels.length < 1 || channels.length > 2 || !channels.every((c) => c instanceof Float32Array && c.length === channels[0].length)) {
    throw new Error(`encodeWav: samples must be a Float32Array, or { left, right } of equal length, got ${typeof samples}`);
  }
  const count = channels.length, frames = channels[0].length, size = frames * count * 2;
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(at, Math.round(s * 32767), true);
      at += 2;
    }
  }
  return bytes;
}
