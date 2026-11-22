// Smallest full use of the engine: one audio object, buttons call it.
import {
  createAudio, generateSound, generateScore, generateAmbience, generateSong, jingle, parseDescription,
  SFX_NAMES, MOOD_NAMES, JINGLE_NAMES, SOUND_STYLE_NAMES, SURFACE_NAMES, AMBIENCE_KINDS, MUSIC_STATES, SPACE_NAMES,
} from '../src/index.js';

const audio = createAudio();
let seed = 0, songSeed = 1, style = 'storybook', score = null;

const $ = (id) => document.getElementById(id);
function button(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.name = label;
  b.addEventListener('click', () => onClick(b));
  parent.append(b);
  return b;
}

// Generated: describe a sound, pick a style and a seed.
for (const name of SOUND_STYLE_NAMES) { const o = document.createElement('option'); o.textContent = name; $('style').append(o); }
$('style').addEventListener('change', () => { style = $('style').value; score = null; });
function describeAndPlay() {
  const asset = generateSound({ describe: $('describe').value, seed: Number($('genseed').value) || 1, style });
  audio.play(asset);
  const known = parseDescription($('describe').value).said.size;
  const notes = known
    ? [`Playing a ${asset.kind} sound${asset.material ? ' in ' + asset.material : ''}, ${asset.seconds} s, seed ${asset.seed}`]
    : [`Playing a ${asset.kind} sound. Say what happens (creak, hit, splash, roar, pickup, explosion...) and what it is made of (wood, metal, glass...) to steer it`];
  if (asset.guessed.length) notes.push(`read ${asset.guessed.map((g) => `"${g.word}" as "${g.as}"`).join(', ')}`);
  if (asset.fallback) notes.push(`no word said what the sound is, so this is the nearest known one: "${asset.fallback}"`);
  if (asset.ignored.length) notes.push(`not understood: ${asset.ignored.join(', ')}`);
  if (asset.unused.length) notes.push(`no effect on this kind of sound: ${asset.unused.join(', ')}`);
  $('understood').textContent = notes.join(' · ');
  $('song').textContent = JSON.stringify(asset.sound, null, 1);
}
$('generate').addEventListener('click', describeAndPlay);
$('describe').addEventListener('keydown', (e) => { if (e.key === 'Enter') describeAndPlay(); });
$('another').addEventListener('click', () => { $('genseed').value = (Number($('genseed').value) || 1) + 1; describeAndPlay(); });
for (const words of ['heavy wooden door creak', 'slime squelch', 'coin pickup', 'sword swing', 'glass bottle smash', 'giant monster roar', 'magic spell cast', 'distant thunder', 'echoing cave drip', 'huge bell toll']) {
  button($('ideas'), words, () => { $('describe').value = words; describeAndPlay(); });
}

// Adaptive music: one score, four states.
for (const state of MUSIC_STATES) {
  button($('score'), state, () => {
    if (!score) score = generateScore({ style, seed: songSeed });
    audio.playMusic(score, { state });
    $('song').textContent = `${score.name}: ${score.key}, ${score.bpm} bpm\n` + JSON.stringify(score.states, null, 1);
  });
}
button($('score'), 'new score', () => { songSeed++; score = generateScore({ style, seed: songSeed }); audio.playMusic(score); });
// the same score by a dial instead of named states, and by time of day
$('intensity').addEventListener('input', () => { if (!score) { score = generateScore({ style, seed: songSeed }); audio.playMusic(score); } audio.setMusicIntensity(Number($('intensity').value)); });
for (const time of ['day', 'dusk', 'night']) button($('times'), time, () => { if (score && audio.musicName === score.name) audio.setMusicTime(time); });
// the place everything is heard in
for (const name of SPACE_NAMES) button($('spaces'), name, (b) => { audio.setSpace(name); for (const other of $('spaces').children) other.classList.toggle('on', other === b); });
button($('score'), 'stop', () => audio.stopMusic());

for (const kind of AMBIENCE_KINDS) button($('ambience'), kind, () => audio.playAmbience(generateAmbience({ kind, style, seed: 1 })));
button($('ambience'), 'stop', () => audio.stopAmbience());

for (const surface of SURFACE_NAMES) button($('steps'), surface, () => { for (let i = 0; i < 4; i++) setTimeout(() => audio.step(surface), i * 420); });

// A looping emitter the pointer walks around: move over the pad to hear it pass by.
let fire = null;
$('pad').addEventListener('pointermove', (e) => {
  const box = $('pad').getBoundingClientRect();
  audio.setListener(((e.clientX - box.left) / box.width - 0.5) * 900, ((e.clientY - box.top) / box.height - 0.5) * 400);
});
button($('emitter'), 'campfire on / off', (b) => {
  if (fire) { fire.stop(); fire = null; } else fire = audio.emitter(generateAmbience({ kind: 'fire', seconds: 6 }), { x: 0, y: 0 });
  b.classList.toggle('on', Boolean(fire));
});

// Built-in effects, songs and jingles.
for (const name of SFX_NAMES) button($('sfx'), name, () => audio.play(name, { seed }));
$('vary').addEventListener('click', () => {
  seed = (seed + 1) % 6;
  $('vary').textContent = seed === 0 ? 'Variation: standard' : `Variation: seed ${seed}`;
});
for (const mood of MOOD_NAMES) {
  button($('music'), mood, () => {
    const song = generateSong({ mood, seed: songSeed++ });
    audio.playMusic(song);
    $('song').textContent = JSON.stringify(song, null, 1);
  });
}
button($('music'), 'stop', () => { audio.stopMusic(); $('song').textContent = 'none'; });
for (const name of JINGLE_NAMES) button($('jingles'), name, () => audio.play(jingle(name)));

for (const bus of ['master', 'sfx', 'music', 'ambience']) {
  const label = document.createElement('label');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.05; slider.value = audio.getVolume(bus);
  slider.addEventListener('input', () => audio.setVolume(bus, Number(slider.value)));
  label.append(bus, slider);
  $('volumes').append(label);
}
button($('volumes'), 'mute', (b) => b.classList.toggle('on', audio.toggleMute()));

let shown = 0, last = performance.now(), frames = 0;
function frame(now) {
  audio.update((now - last) / 1000); last = now;
  shown = Math.max(audio.level(), shown * 0.9);
  $('bar').style.width = `${Math.min(100, shown * 300)}%`;
  if (++frames % 30 === 0) {
    const s = audio.stats();
    $('stats').textContent = `space ${audio.space} · voices ${s.voices} · building ${s.rendering} · device delay ${Math.round(s.latency * 1000)} ms · longest frame gap ${Math.round(s.worstGap * 1000)} ms · music ${audio.musicName ?? 'none'}${audio.musicState ? ' (' + audio.musicState + ')' : ''} · place ${audio.ambienceName ?? 'none'}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For play-tests: lets a test read the log and the output level.
window.game = { audio, get state() { return { music: audio.musicName, musicState: audio.musicState, ambience: audio.ambienceName, unlocked: audio.unlocked, log: audio.log }; } };
