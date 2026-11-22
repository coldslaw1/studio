// The stage: what a cutscene does to the picture. Only numbers and text, so it runs under Node;
// overlay.js draws it and the game's camera reads the shot.

/** A fresh stage: no fade, no bars, no caption, camera left to the game. */
export function createStage() {
  return {
    fade: { alpha: 0, color: '#000' },
    bars: 0,
    caption: null, // { speaker, text, shown, bark }
    shot: { active: false, x: 0, y: 0, zoom: 1, yaw: null, pitch: null, height: null, distance: null, follow: null, pov: null, shakeX: 0, shakeY: 0 },
  };
}

/** Plain data for drawing and tests, made from the stage and a few facts from the engine. */
export function stageView(stage, extra) {
  const c = stage.caption;
  return {
    ...extra,
    fade: stage.fade.alpha,
    fadeColor: stage.fade.color,
    bars: stage.bars,
    caption: c ? { speaker: c.speaker, text: c.text.slice(0, Math.floor(c.shown)), full: c.text, done: c.shown >= c.text.length, bark: c.bark } : null,
    shot: { ...stage.shot },
  };
}
