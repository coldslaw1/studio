// Auto-play: a playbot bot plays the demo through the same keys a person uses. The bot (playbot's
// look-ahead player) thinks on copies of the quest model and names the next thing to do; this
// file walks there with the arrow keys, presses Space, picks dialogue choices and solves the cellar
// with the levels solver. It doubles as a test: `game.state.bot.done` turns true when the quest is won.
import { createBot } from '../vendor/playbot/bots.js';
import { normalizeAdapter } from '../vendor/playbot/adapter.js';
import { createRng } from '../vendor/playbot/rng.js';
import { createAdapter, questActions, questWon, snapshot, createQuest } from './model.js';
import { cellarHint } from './cellar-rules.js';
import { keysToward } from './nav.js';
import { SPOTS } from './hamlet.js';

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const MOVE_KEY = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight' };
const NAMES = { 'talk:guard': 'talk to the guard', 'talk:elder': 'ask Elder Maren', 'talk:tobin': 'talk to Tobin', cellar: 'sort the cellar', throw: 'hit the practice barrel' };

/**
 * @param {object} game    core's game (input, scenes).
 * @param {object} shared  { stage, quest, hamlet, box, ui }.
 * @returns {object} bot: { on, goal, done, log, start(), stop(), toggle(), update(dt) }
 */
export function createAutoplay(game, shared) {
  const { input } = game;
  const adapter = normalizeAdapter(createAdapter());
  const thinker = createBot({ name: 'careful', type: 'lookahead', rollouts: 8, depth: 14 });
  const rng = createRng('autoplay');
  const ctx = { adapter, rng, level: 'quest', memory: {} };
  const held = new Set();
  let throws = 0; // stones thrown at the bet in this run
  const blocked = new Set(); // actions whose place could not be walked to; left alone for the rest of the run
  let action = null; // the quest action being carried out
  let path = null; let pathAge = 0; let wait = 0; let lastSpot = null; let still = 0; let tap = null;

  const hold = (codes) => {
    for (const code of [...held]) if (!codes.includes(code)) { input.release(code); held.delete(code); }
    for (const code of codes) if (!held.has(code)) { input.press(code); held.add(code); }
  };
  const pulse = (code) => { hold([]); input.press(code); tap = code; }; // released on the next update, like a quick key press
  const say = (text) => { if (bot.log.at(-1) !== text) bot.log.push(text); if (bot.log.length > 40) bot.log.shift(); };

  /** Where an action happens on the ground, and how near is near enough. */
  function target(act) {
    const [verb, arg] = act.split(':');
    const { people, herbs, hatch } = shared.hamlet;
    if (verb === 'talk') return { x: people[arg].body.x, y: people[arg].body.y, near: 1.9 };
    if (verb === 'herb') return { x: herbs[Number(arg)].body.x, y: herbs[Number(arg)].body.y, near: 1.0 };
    if (verb === 'cellar') return { x: hatch.body.x, y: hatch.body.y, near: 1.3 };
    return { x: SPOTS.throwFrom[0], y: SPOTS.throwFrom[1], near: 0.5 };
  }

  function think() {
    const quest = shared.quest;
    let options = questActions(quest).filter((a) => !blocked.has(a));
    if (questWon(quest)) { // encore after the main quest: Tobin's bet, to show the thrown stones
      const practice = quest.story.quest('practice');
      if (practice.status === 'done' || throws >= 9) return null; // a few tries at the bet, never an endless loop of throwing
      options = practice.status === 'inactive' ? ['talk:tobin'] : options.includes('throw') ? ['throw'] : ['talk:tobin'];
      return options[0];
    }
    const copy = createQuest(snapshot(quest)); // the bot thinks on a copy, never on the real game
    return thinker.pick(copy, options, ctx);
  }

  function talk(dt) { // a dialogue is open: read, then answer
    hold([]);
    wait -= dt;
    if (wait > 0) return;
    const view = shared.quest.story.view();
    if (view.canContinue) { pulse('Enter'); wait = 0.9; return; }
    const options = questActions(shared.quest); // choose:N
    let want;
    if (questWon(shared.quest)) want = 0; // Tobin: take the bet, or ask for stones
    else want = Number(thinker.pick(createQuest(snapshot(shared.quest)), options, ctx).split(':')[1]);
    if (shared.box.selected < want) { pulse('ArrowDown'); wait = 0.25; } else if (shared.box.selected > want) { pulse('ArrowUp'); wait = 0.25; } else { pulse('Enter'); wait = 0.9; }
  }

  function cellar(dt) {
    hold([]);
    wait -= dt;
    const scene = shared.cellar;
    if (wait > 0 || scene.busy) return;
    const move = cellarHint(scene.rows, scene.position);
    if (move === null) { pulse('KeyR'); wait = 0.5; return; }
    pulse(MOVE_KEY[move]); wait = 0.22;
  }

  function walk(dt) {
    const { player } = shared.stage;
    const t = target(action);
    const dx = t.x - player.body.x; const dy = t.y - player.body.y; const d = Math.hypot(dx, dy);
    if (d <= t.near) {
      hold([]);
      if (action === 'throw') { // face the barrel with one short step, then throw
        const aim = shared.hamlet.yard.loose.find((p) => p.kind === 'target').body;
        wait -= dt;
        if (wait > 0) return;
        if (!walk.aimed) { hold(keysToward(shared.stage.view, aim.x - player.body.x, aim.y - player.body.y)); walk.aimed = true; wait = 0.12; return; }
        walk.aimed = false; pulse('KeyF'); wait = 1.1; action = null; throws += 1;
        return;
      }
      pulse('Space'); action = null; path = null; wait = 0.6;
      return;
    }
    pathAge += dt;
    if (!path || pathAge > 1.2) { // look again now and then: the guard walks, and props get in the way
      path = shared.hamlet.nav.path(player.body.x, player.body.y, t.x, t.y); pathAge = 0;
      if (!path) { say(`no way to ${NAMES[action] ?? action}`); blocked.add(action); action = null; wait = 1; hold([]); return; }
    }
    while (path.length > 1 && Math.hypot(path[0][0] - player.body.x, path[0][1] - player.body.y) < 0.45) path.shift();
    const next = path.length && d > t.near + 1 ? path[0] : [t.x, t.y];
    const keys = keysToward(shared.stage.view, next[0] - player.body.x, next[1] - player.body.y);
    hold(d > 6 ? [...keys, 'ShiftLeft'] : keys);
    // not moving for a while (a person or a barrel in the way): step aside at random
    if (lastSpot && Math.hypot(player.body.x - lastSpot[0], player.body.y - lastSpot[1]) < 0.02) still += dt; else still = 0;
    lastSpot = [player.body.x, player.body.y];
    if (still > 0.8) { hold([ARROWS[rng.int(4)], ARROWS[rng.int(4)]]); wait = 0.35; still = 0; path = null; }
  }

  const bot = {
    on: false, done: false, goal: '', log: [],
    start() { blocked.clear(); throws = 0; bot.on = true; bot.done = false; action = null; path = null; wait = 0.8; say('auto-play started'); },
    stop() { if (!bot.on) return; bot.on = false; bot.goal = ''; hold([]); if (tap) { input.release(tap); tap = null; } },
    toggle() { if (bot.on) { bot.stop(); shared.ui.toast('Auto-play off'); } else { bot.start(); shared.ui.toast('Auto-play on. B stops it.'); } },
    /** Call at the start of the scene's update, before the scene reads the input. */
    update(dt) {
      if (tap) { input.release(tap); tap = null; }
      if (!bot.on) return;
      if (shared.ui.isOpen()) { hold([]); return; } // a menu is the player's business
      if (game.scenes.current === 'cellar') { bot.goal = 'sort the cellar'; cellar(dt); return; }
      if (game.scenes.current !== 'play') { hold([]); return; }
      if (shared.quest.story.view().active) { talk(dt); return; }
      if (wait > 0 && action !== 'throw') { wait -= dt; if (!action) hold([]); return; } // (a throw counts its own pauses)
      if (!action) {
        action = think();
        if (!action) {
          bot.done = true; bot.goal = '';
          say('quest and bet finished');
          shared.ui.toast(`Auto-play finished everything in ${Math.round(shared.hamlet.seconds)} seconds`, 4);
          bot.stop();
          return;
        }
        bot.goal = NAMES[action] ?? (action.startsWith('herb') ? 'pick moonleaf' : action);
        say(action);
        path = null; still = 0;
      }
      walk(dt);
    },
  };
  return bot;
}
