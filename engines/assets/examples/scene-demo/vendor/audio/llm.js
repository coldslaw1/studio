// Optional: let a local language model turn free text ("the noise my nan's
// gate makes on a cold morning") into a description the generator knows.
// The engine never needs this: generateSound works offline on its own
// vocabulary. This only rewrites the words first, and anything the model says
// is checked against the vocabulary before it is used.

import { parseDescription, SOUND_KINDS, MATERIAL_NAMES } from './words.js';

const HINT = `kinds: hit knock thud slam clang creak squeak squelch splat pickup chime sparkle whoosh swing slash explosion boom rumble thunder zap laser spell click blip confirm cancel error splash drip bubble roar growl hiss chirp croak howl hoot bark meow jump bounce break shatter crumble burn sizzle crackle bell gong powerup heal teleport hurt death open close lock rustle flap footstep alarm hum
materials: ${MATERIAL_NAMES.join(' ')}
things: door gate chest crate coin key sword hammer chain bottle window potion boulder floor ship torch campfire monster dragon bird frog owl ghost wolf dog cat lever gem book tree
size: tiny small big heavy huge giant   length: short quick long slow   force: soft quiet hard loud   pitch: high shrill low deep
place: distant echoing dry   texture: rusty wet magical dark bright spooky cute retro   degree: very slightly extremely`;

/**
 * describeWithModel(text, { fetch, url, model, timeoutMs }?) -> Promise<{ describe, dropped, raw }>
 *   text:  anything a person might type
 *   fetch: the fetch function to use (default: the global one)
 *   url:   an OpenAI-style chat endpoint (default http://127.0.0.1:1234/v1/chat/completions, LM Studio's)
 *   model: model name to ask for (default: whatever the server has loaded)
 * describe is made only of words the generator understands; dropped lists what the model said that it does not.
 * Rejects when the server cannot be reached or answers nothing usable: catch it and use the text as it is.
 */
export async function describeWithModel(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`describeWithModel: text must be a non-empty string, got ${JSON.stringify(text)}`);
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('describeWithModel: no fetch function here; pass one as options.fetch');
  const url = options.url ?? 'http://127.0.0.1:1234/v1/chat/completions';
  const body = {
    ...(options.model ? { model: options.model } : {}), temperature: 0, max_tokens: 60, stream: false,
    messages: [
      { role: 'system', content: `You turn a request for a game sound effect into 2 to 8 plain words for a sound generator. Use ONLY words from these lists. Say what happens (a kind), what it is made of or what thing it is, then size, length, force, place and texture if they matter. Answer with the words only, lower case, separated by spaces, no punctuation, no explanation.\n${HINT}` },
      { role: 'user', content: text.slice(0, 400) },
    ],
  };
  const control = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = control ? setTimeout(() => control.abort(), options.timeoutMs ?? 15000) : null;
  let reply;
  try {
    const res = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(control ? { signal: control.signal } : {}) });
    if (!res.ok) throw new Error(`the model server answered ${res.status}`);
    reply = await res.json();
  } catch (e) {
    throw new Error(`describeWithModel: could not ask the model at ${url} (${e.message})`);
  } finally { if (timer) clearTimeout(timer); }
  const raw = String(reply?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, ' ').trim();
  const parsed = parseDescription(raw.split('\n').pop() ?? '');
  const dropped = [...parsed.ignored, ...parsed.guessed.map((g) => g.word)]; // no guessing here: the model was told the exact words
  const kept = parsed.words.filter((w) => parsed.said.has(w) && !dropped.includes(w)).slice(0, 10); // only words that were understood
  const check = parseDescription(kept.join(' '));
  if (!kept.length || (!check.kind && !check.objectKind && !check.material)) throw new Error(`describeWithModel: the model's answer had no usable words: ${JSON.stringify(raw.slice(0, 120))}`);
  return { describe: kept.join(' '), dropped, raw };
}

/** The kinds the model is told about (same list generateSound uses). */
export const MODEL_KINDS = SOUND_KINDS;
