// The cellar: a pushed scene with the crate puzzle. The rooms come from the levels engine
// (cellar-rules.js), each proven solvable, and H asks the solver for the next move.
import { cellarRooms, cellarPuzzle, cellarHint, CELLAR_ROOMS } from './cellar-rules.js';
import { finishRoom } from './model.js';

const GLYPH = { '#': ['▓▓', '#5a5a72', '#2c2c3c'], '.': [' .', '#3c4458', '#1a1d2a'], T: ['><', '#ffd166', '#1a1d2a'] };
const MOVES = [['up', 'U'], ['right', 'R'], ['down', 'D'], ['left', 'L']];

/** core scene factory for the cellar: (game, shared) => scene. Pops with { solved } when left. */
export function cellarScene(game, shared) {
  const { ui, sound, quest, bot } = shared;
  const { input } = game;
  let rooms = null; let puzzle = null; let cur = null; let moves = 0; let hint = null; let hintTime = 0; let wait = 0; let stuck = false;
  const state = {
    scene: 'cellar',
    get room() { return quest.room; }, get moves() { return moves; },
    get crates() { return cur ? cur.crates : []; }, get x() { return cur?.x; }, get y() { return cur?.y; },
    get bot() { return { on: bot.on, goal: bot.goal, done: bot.done }; },
  };
  function load() {
    puzzle = cellarPuzzle(rooms[quest.room].rows);
    cur = puzzle.start; moves = 0; hint = null; stuck = false;
  }
  const scene = {
    opaque: true,
    state,
    enter() {
      rooms ??= cellarRooms();
      shared.cellar = scene;
      ui.hud.visible = false;
      sound.music('cellar');
      shared.weatherSound?.setShelter(1); // down here the rain is only a murmur
      load();
    },
    exit() { shared.cellar = null; ui.hud.visible = true; shared.weatherSound?.setShelter(0); },
    /** The room's rows and where things are now, for the auto-play bot. */
    get rows() { return rooms[quest.room].rows; },
    get position() { return cur; },
    get busy() { return wait > 0; },
    update(dt) {
      bot.update(dt);
      if (shared.uiBusy()) return;
      if (input.pressed('bot')) bot.toggle();
      hintTime = Math.max(0, hintTime - dt);
      if (wait > 0) { // a solved room rests a moment before the next one
        wait -= dt;
        if (wait <= 0) { if (quest.room >= CELLAR_ROOMS) game.scenes.pop({ solved: true }); else load(); }
        return;
      }
      if (input.pressed('cancel') || input.pressed('pause')) { sound.play('door'); game.scenes.pop({ solved: false }); return; }
      if (input.pressed('reset')) { load(); sound.play('cancel', { volume: 0.5 }); return; }
      if (input.pressed('hint')) {
        hint = cellarHint(rooms[quest.room].rows, cur); hintTime = 2.5;
        if (hint === null) { ui.toast('No way to finish from here. R starts the room again.'); sound.play('error', { volume: 0.4 }); } else sound.play('blip', { volume: 0.5 });
      }
      for (const [action, dir] of MOVES) {
        if (!input.pressed(action)) continue;
        const next = puzzle.step(cur, dir);
        if (!next) { sound.play('thud', { volume: 0.35 }); break; }
        cur = next; moves += 1; hint = null;
        if (next.pushed) sound.play('crate'); else sound.step(0.8);
        if (puzzle.isWon(cur)) {
          finishRoom(quest);
          sound.play(quest.room >= CELLAR_ROOMS ? 'win' : 'quest');
          ui.toast(`Room ${quest.room} of ${CELLAR_ROOMS} done in ${moves} moves (best ${rooms[quest.room - 1].par})`, 2.5);
          wait = 1.6;
        } else if (next.pushed) {
          stuck = cellarHint(rooms[quest.room].rows, cur) === null;
          if (stuck) ui.toast('That crate is stuck. R starts the room again.', 3);
        }
        break;
      }
    },
    draw(ctx) {
      const k = game.pixelRatio; const W = game.width / k; const H = game.height / k; // drawn in CSS pixels
      ctx.save(); ctx.scale(k, k);
      ctx.fillStyle = '#0b0a12'; ctx.fillRect(0, 0, W, H);
      const grid = puzzle.grid;
      const cell = Math.floor(Math.min((W - 120) / grid.w, (H - 200) / grid.h, 64));
      const ox = Math.round((W - cell * grid.w) / 2); const oy = Math.round((H - cell * grid.h) / 2) + 16;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(cell * 0.62)}px Consolas, monospace`;
      const put = (x, y, text, fg, bg) => {
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell); }
        ctx.fillStyle = fg; ctx.fillText(text, ox + (x + 0.5) * cell, oy + (y + 0.5) * cell + 1);
      };
      for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
        const ch = grid.cells[y * grid.w + x];
        const g = GLYPH[ch] ?? GLYPH['.'];
        put(x, y, g[0], g[1], g[2]);
      }
      for (const [x, y] of cur.crates) {
        const home = puzzle.marks.includes(x + ',' + y);
        put(x, y, '[]', home ? '#10131f' : '#f4e3c0', home ? '#7fd17f' : '#9a6a3a');
      }
      put(cur.x, cur.y, '@', '#ffffff', '#3a6ea8');
      if (hint && hintTime > 0) {
        const d = { U: [0, -1, '^'], R: [1, 0, '>'], D: [0, 1, 'v'], L: [-1, 0, '<'] }[hint];
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(hintTime * 6));
        put(cur.x + d[0], cur.y + d[1], d[2], '#ffd166');
        ctx.globalAlpha = 1;
      }
      ctx.font = 'bold 26px Consolas, monospace'; ctx.fillStyle = '#e8e8f4';
      ctx.fillText(`Cellar, room ${Math.min(quest.room + 1, CELLAR_ROOMS)} of ${CELLAR_ROOMS}`, W / 2, 44);
      ctx.font = '16px Consolas, monospace'; ctx.fillStyle = '#9aa0b8';
      ctx.fillText(`Push each crate [] onto a mark ><.   Moves ${moves}, best ${rooms[Math.min(quest.room, CELLAR_ROOMS - 1)].par}`, W / 2, 76);
      ctx.fillText(bot.on ? 'Auto-play is solving it (B stops it)' : 'Arrows: move and push    R: start again    H: hint    Esc: back up the ladder', W / 2, H - 28);
      ctx.restore();
      ctx.restore();
      shared.drawUi(ctx);
    },
  };
  return scene;
}
