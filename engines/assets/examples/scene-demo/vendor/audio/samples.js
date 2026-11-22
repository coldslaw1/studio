// Recorded instruments and recorded sound layers. A "sample pack" is a folder with samples.json and
// small .wav files, made once from CC0 recordings by tools/make-sample-pack.mjs. Loaded into a bank,
// its instruments replace the synthesised ones of the same name ("strings", "harp", "flute", ...)
// wherever music is rendered; songs and scores do not change, and instruments the pack does not
// have are synthesised as before. Rendering stays plain JavaScript: the same notes and the same pack
// give the same samples on every machine, in the browser and under Node.
//
//   const bank = await loadSamplePack('samples/orchestra/');          // browser, at start-up
//   const audio = createAudio({ style: 'storybook', samples: bank });  // music now uses the recordings
//   renderScore(score, { samples: bank });                              // the same for files and tests

const noteToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/**
 * decodeWav(bytes) -> { sampleRate, channels: [Float32Array, ...] }
 * Reads PCM .wav files: 8, 16, 24 or 32 bit whole numbers and 32 bit floats, any channel count.
 */
export function decodeWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('decodeWav: not a .wav file');
  let at = 12, fmt = null, data = null;
  while (at + 8 <= b.length) {
    const id = tag(at), size = v.getUint32(at + 4, true);
    if (id === 'fmt ') {
      let format = v.getUint16(at + 8, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(at + 32, true); // "extensible": the real format sits further in
      fmt = { format, channels: v.getUint16(at + 10, true), sampleRate: v.getUint32(at + 12, true), bits: v.getUint16(at + 22, true) };
    } else if (id === 'data') data = { at: at + 8, size: Math.min(size, b.length - at - 8) };
    at += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('decodeWav: the file has no format or no sound data');
  if (!((fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (fmt.format === 3 && fmt.bits === 32))) throw new Error(`decodeWav: only plain PCM is read (this file is format ${fmt.format}, ${fmt.bits} bit)`);
  if (!(fmt.channels >= 1) || !(fmt.sampleRate > 0)) throw new Error('decodeWav: bad channel count or sample rate');
  const width = fmt.bits / 8, frames = Math.floor(data.size / (width * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.at + (i * fmt.channels + c) * width;
      channels[c][i] = fmt.format === 3 ? v.getFloat32(o, true)
        : width === 1 ? (b[o] - 128) / 128
          : width === 2 ? v.getInt16(o, true) / 32768
            : width === 3 ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388608
              : v.getInt32(o, true) / 2147483648;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}

/** Problems with a pack's samples.json, as sentences (empty when it is sound). */
export function validateSamplePack(manifest) {
  const errors = [];
  if (!manifest || manifest.studioAudio !== 'samples') return ['A sample pack\'s samples.json must have "studioAudio": "samples".'];
  if (manifest.version !== 1) errors.push(`"version" must be 1, got ${JSON.stringify(manifest.version)}.`);
  for (const group of ['instruments', 'sounds']) {
    for (const [name, def] of Object.entries(manifest[group] ?? {})) {
      const list = group === 'instruments' ? def.notes : def.takes;
      if (!Array.isArray(list) || list.length === 0) errors.push(`${group}.${name}: needs at least one ${group === 'instruments' ? 'note' : 'take'}.`);
      else if (list.some((n) => typeof n.file !== 'string' || (group === 'instruments' && !(n.midi >= 0 && n.midi <= 127)))) errors.push(`${group}.${name}: every ${group === 'instruments' ? 'note needs "midi" (0 to 127) and "file"' : 'take needs "file"'}.`);
      if (!def.source || typeof def.source.license !== 'string' || !def.source.license) errors.push(`${group}.${name}: "source.license" is required (an SPDX id such as "CC0-1.0").`);
    }
  }
  if (!manifest.instruments && !manifest.sounds) errors.push('The pack has neither "instruments" nor "sounds".');
  return errors;
}

const mono = (wav) => {
  if (wav.channels.length === 1) return wav.channels[0];
  const out = new Float32Array(wav.channels[0].length);
  for (const ch of wav.channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / wav.channels.length;
  return out;
};

/**
 * createSampleBank() -> bank. Usually made for you by readSamplePack or loadSamplePack.
 *   bank.addInstrument(name, { notes: [{ midi, data: Float32Array, sampleRate }], sustain, volume, attack, release, source })
 *   bank.addSound(name, { takes: [{ data, sampleRate }], tags, pitch, volume, source })
 *   bank.has(name), bank.instruments, bank.addNote(out, sampleRate, note)   used by the song renderer
 *   bank.sound(name), bank.sounds, bank.findSound(words), bank.matchSound(words)   recorded sound layers (recorded.js)
 *   bank.credits()                                                          what the recordings' licenses ask for
 *   bank.merge(other)                                                       take over another bank's recordings (a pack loaded later)
 */
export function createSampleBank() {
  const instruments = new Map(), sounds = new Map();
  const bank = {
    /** Take over every instrument and sound of another bank (a pack loaded later); same names are replaced. Returns this bank. */
    merge(other) {
      if (!other || typeof other._entries !== 'function') throw new Error('bank.merge: give another sample bank');
      const e = other._entries();
      for (const [n, d] of e.instruments) instruments.set(n, d);
      for (const [n, d] of e.sounds) sounds.set(n, d);
      return bank;
    },
    _entries: () => ({ instruments: [...instruments], sounds: [...sounds] }),
    get instruments() { return [...instruments.keys()]; },
    get sounds() { return [...sounds.keys()]; },
    has: (name) => instruments.has(name),
    hasSound: (name) => sounds.has(name),
    addInstrument(name, def) {
      if (typeof name !== 'string' || !name) throw new Error('bank.addInstrument: name must be text');
      if (!def || !Array.isArray(def.notes) || def.notes.length === 0) throw new Error(`bank.addInstrument: "${name}" needs notes: [{ midi, data, sampleRate }]`);
      for (const n of def.notes) if (!(n.data instanceof Float32Array) || n.data.length < 16 || !(n.sampleRate > 0) || !(n.midi >= 0 && n.midi <= 127)) throw new Error(`bank.addInstrument: "${name}" has a note without midi (0 to 127), data (Float32Array) or sampleRate`);
      if (!def.source?.license) throw new Error(`bank.addInstrument: "${name}" needs source.license (a recording without a recorded license must not be used)`);
      instruments.set(name, {
        notes: [...def.notes].sort((a, b) => a.midi - b.midi), sustain: Boolean(def.sustain), volume: def.volume ?? 0.3,
        attack: def.attack ?? 0.004, release: def.release ?? (def.sustain ? 0.3 : 0.5), source: def.source,
      });
      return bank;
    },
    addSound(name, def) {
      if (typeof name !== 'string' || !name) throw new Error('bank.addSound: name must be text');
      if (!def || !Array.isArray(def.takes) || def.takes.length === 0) throw new Error(`bank.addSound: "${name}" needs takes: [{ data, sampleRate }]`);
      for (const t of def.takes) if (!(t.data instanceof Float32Array) || t.data.length < 16 || !(t.sampleRate > 0)) throw new Error(`bank.addSound: "${name}" has a take without data (Float32Array) or sampleRate`);
      if (!def.source?.license) throw new Error(`bank.addSound: "${name}" needs source.license`);
      sounds.set(name, { takes: def.takes, tags: def.tags ?? name.split(/[-_ ]+/), volume: def.volume ?? 0.8, source: def.source });
      return bank;
    },
    /**
     * Mix one note of a recorded instrument into `out` (adds). note: { instrument, freq, delay, seconds, volume }.
     * wrap = true carries a tail past the end back to the start, for seamless loops.
     * The nearest recorded note is re-pitched; a held note longer than a sustaining recording loops its middle.
     */
    addNote(out, sampleRate, note, wrap = false) {
      const ins = instruments.get(note.instrument);
      if (!ins) throw new Error(`bank.addNote: no recorded instrument "${note.instrument}". This bank has: ${bank.instruments.join(', ') || 'none'}`);
      if (!(note.freq > 0) || !(note.seconds > 0) || !(note.delay >= 0)) throw new Error(`bank.addNote: freq and seconds must be above 0 and delay 0 or more, got ${JSON.stringify({ freq: note.freq, seconds: note.seconds, delay: note.delay })}`);
      const midi = noteToMidi(note.freq);
      let rec = ins.notes[0];
      for (const n of ins.notes) if (Math.abs(n.midi - midi) < Math.abs(rec.midi - midi)) rec = n;
      const step = Math.pow(2, (midi - rec.midi) / 12) * rec.sampleRate / sampleRate; // source samples per output sample
      const src = rec.data, len = src.length;
      const held = Math.round(note.seconds * sampleRate), rel = Math.max(32, Math.round(ins.release * sampleRate));
      const natural = Math.floor((len - 2) / step);
      const n = ins.sustain ? held + rel : Math.min(held + rel, natural);
      const att = Math.max(8, Math.round(ins.attack * sampleRate));
      const vol = (note.volume ?? 1) * ins.volume;
      // loop region of a sustaining recording: its middle half, cross-faded over 80 ms
      const loopA = len * 0.3, loopB = len * 0.8, loopLen = loopB - loopA, fadeLen = Math.min(loopLen / 2, rec.sampleRate * 0.08);
      const at = (p) => { const i = Math.floor(p), f = p - i; return src[i] + (src[i + 1] - src[i]) * f; };
      const start = Math.round(note.delay * sampleRate);
      for (let i = 0; i < n; i++) {
        let p = i * step, x;
        if (ins.sustain && p >= loopB - fadeLen) {
          p = loopA + ((p - loopA) % loopLen);
          const intoEnd = p - (loopB - fadeLen);
          if (intoEnd > 0) { const k = intoEnd / fadeLen; x = at(p) * (1 - k) + at(p - loopLen) * k; } else x = at(p); // fade into the loop's start
        } else if (p >= len - 1) break; else x = at(p);
        let env = i < att ? i / att : 1;
        if (i >= held) env *= Math.exp(-5 * (i - held) / rel);
        else if (!ins.sustain && i > natural - rel) env *= Math.max(0, (natural - i) / rel);
        let o = start + i;
        if (o >= out.length) { if (!wrap) break; o %= out.length; }
        out[o] += x * env * vol;
      }
      return out;
    },
    /** How long addNote's sound lasts for a note of `seconds`, in seconds (for job sizes). */
    noteSeconds(instrument, seconds) { const ins = instruments.get(instrument); return ins ? seconds + ins.release : seconds; },
    /** sound(name, take = 0) -> { data, sampleRate, volume } of a recorded sound layer; throws when unknown. */
    sound(name, take = 0) {
      const s = sounds.get(name);
      if (!s) throw new Error(`bank.sound: no recorded sound "${name}". This bank has: ${bank.sounds.slice(0, 30).join(', ') || 'none'}`);
      const t = s.takes[((take % s.takes.length) + s.takes.length) % s.takes.length];
      return { data: t.data, sampleRate: t.sampleRate, volume: s.volume, takes: s.takes.length };
    },
    /** findSound(['wood', 'hit']) -> names of recorded sounds tagged with every word, best first (fewest other tags). */
    findSound(words) {
      const want = words.map((w) => String(w).toLowerCase());
      return [...sounds.entries()].filter(([, s]) => want.every((w) => s.tags.includes(w))).sort((a, b) => a[1].tags.length - b[1].tags.length || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
    },
    /** matchSound(['wood', 'door', 'creak', 'heavy']) -> names of recorded sounds whose tags are ALL among the words, most tags first. */
    matchSound(words) {
      const have = new Set(words.map((w) => String(w).toLowerCase()));
      return [...sounds.entries()].filter(([, s]) => s.tags.length > 0 && s.tags.every((t) => have.has(t))).sort((a, b) => b[1].tags.length - a[1].tags.length || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
    },
    soundTags: (name) => [...(sounds.get(name)?.tags ?? [])],
    /** One entry per source pack: { pack, author, license, url, required, uses: [names] }. required is false for CC0. */
    credits() {
      const seen = new Map();
      for (const [name, def] of [...instruments, ...sounds]) {
        const s = def.source, key = [s.pack, s.author, s.license, s.url].join('|');
        if (!seen.has(key)) seen.set(key, { pack: s.pack ?? '', author: s.author ?? '', license: s.license, url: s.url ?? '', required: !/^CC0|^Unlicense|^0BSD/i.test(s.license), uses: [] });
        seen.get(key).uses.push(name);
      }
      return [...seen.values()];
    },
  };
  return bank;
}

/**
 * readSamplePack(manifest, getBytes) -> bank. getBytes(file) returns the bytes of a .wav named in the manifest.
 * Use it under Node or with files you already hold; in a browser loadSamplePack fetches for you.
 * @param {{ only?: string[] }} [options]  only: load just these instruments and sounds.
 */
export function readSamplePack(manifest, getBytes, options = {}) {
  const errors = validateSamplePack(manifest);
  if (errors.length) throw new Error(`readSamplePack: the pack is not usable:\n- ${errors.join('\n- ')}`);
  const bank = createSampleBank(), keep = (name) => !options.only || options.only.includes(name);
  const read = (file) => { const wav = decodeWav(getBytes(file)); return { data: mono(wav), sampleRate: wav.sampleRate }; };
  for (const [name, def] of Object.entries(manifest.instruments ?? {})) if (keep(name)) bank.addInstrument(name, { ...def, notes: def.notes.map((n) => ({ midi: n.midi, ...read(n.file) })) });
  for (const [name, def] of Object.entries(manifest.sounds ?? {})) if (keep(name)) bank.addSound(name, { ...def, takes: def.takes.map((t) => read(t.file)) });
  return bank;
}

/**
 * loadSamplePack(baseUrl, options?) -> Promise<bank>. baseUrl is the pack's folder, ending in "/".
 * @param {{ fetch?: Function, only?: string[] }} [options]
 */
export async function loadSamplePack(baseUrl, options = {}) {
  if (typeof baseUrl !== 'string' || !baseUrl.endsWith('/')) throw new Error(`loadSamplePack: baseUrl must be a folder address ending in "/", got ${JSON.stringify(baseUrl)}`);
  const get = options.fetch ?? globalThis.fetch;
  if (!get) throw new Error('loadSamplePack: no fetch here; pass options.fetch, or use readSamplePack with the files');
  const ok = async (file) => { const r = await get(baseUrl + file); if (!r.ok) throw new Error(`loadSamplePack: ${baseUrl + file} answered ${r.status}`); return r; };
  const manifest = await (await ok('samples.json')).json();
  const errors = validateSamplePack(manifest);
  if (errors.length) throw new Error(`loadSamplePack: the pack is not usable:\n- ${errors.join('\n- ')}`);
  const keep = (name) => !options.only || options.only.includes(name);
  const files = new Set();
  for (const [name, def] of Object.entries(manifest.instruments ?? {})) if (keep(name)) for (const n of def.notes) files.add(n.file);
  for (const [name, def] of Object.entries(manifest.sounds ?? {})) if (keep(name)) for (const t of def.takes) files.add(t.file);
  const bytes = new Map();
  await Promise.all([...files].map(async (f) => bytes.set(f, new Uint8Array(await (await ok(f)).arrayBuffer()))));
  return readSamplePack(manifest, (f) => bytes.get(f), options);
}
