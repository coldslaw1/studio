// The UI kit on top of the core kit: title scene, play scene with HUD and
// pause menu, settings saved through core's saves. In a real game the imports
// are '../vendor/core/index.js' and '../vendor/ui/index.js'.
import { createGame } from '../../../core/src/index.js';
import { createUi, createSettings, STANDARD_SETTINGS, THEMES } from '../../src/index.js';

const WIDTH = 640;
const HEIGHT = 360;
let ui = null; // one ui for the whole game, made by the first scene that needs it

function getUi(game) {
  if (ui) return ui;
  const settings = createSettings({
    store: game.saves.settings,
    schema: [...STANDARD_SETTINGS,
      { id: 'theme', label: 'Theme', type: 'choice', value: 'moss', options: Object.keys(THEMES) }],
  });
  ui = createUi({ width: WIDTH, height: HEIGHT, settings });
  return ui;
}

const title = (game) => ({
  opaque: true,
  state: { screen: 'title' },
  enter() {
    getUi(game).hud.clear();
    ui.showTitle({ title: 'Star Hop', subtitle: 'UI kit + core kit', onPlay: () => game.scenes.go('play') });
  },
  update(dt) { ui.update(dt, game.input); },
  draw(ctx) { ui.draw(ctx); },
});

const play = (game) => {
  const state = { x: WIDTH / 2, y: HEIGHT / 2, stars: 0, time: 0, taps: 0 };
  const pause = () => getUi(game).showPause({
    onRestart: () => game.scenes.go('play'),
    onQuit: () => game.scenes.go('title'),
  });
  return {
    state,
    enter() {
      getUi(game).hud.clear();
      ui.hud
        .add({ id: 'stars', type: 'counter', label: 'Stars', value: 0, icon: 'star' })
        .add({ id: 'time', type: 'timer', anchor: 'top-center' })
        .add({ id: 'pause', type: 'button', icon: 'pause', anchor: 'top-right', onPress: pause });
    },
    update(dt) {
      if (ui.update(dt, game.input)) return;       // a menu is open: the game waits
      if (game.input.pressed('pause') || game.input.pressed('cancel')) { pause(); return; }
      state.x += game.input.axis('left', 'right') * 200 * dt;
      state.y += game.input.axis('up', 'down') * 200 * dt;
      state.time += dt;
      ui.hud.set('time', state.time);
      // A tap counts for the game only when it did not land on a HUD button.
      if (game.input.pressed('confirm') && !ui.pointerUsed) {
        state.taps += 1;
        state.stars += 1;
        ui.hud.set('stars', state.stars);
        if (state.stars === 3) ui.toast('Three stars!');
      }
    },
    draw(ctx) {
      ctx.fillStyle = ui.theme.bg;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = ui.theme.good;
      ctx.fillRect(state.x - 10, state.y - 10, 20, 20);
      ui.draw(ctx);                                 // last, so the UI is on top
    },
  };
};

const game = createGame({
  canvas: document.getElementById('game'),
  gameId: 'ui-with-core',
  width: WIDTH,
  height: HEIGHT,
  scenes: { title, play },
});
window.game.ui = getUi(game); // play-tests can call game.ui.snapshot()
