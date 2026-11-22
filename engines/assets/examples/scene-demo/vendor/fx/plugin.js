// The base plugin: how the fx engine joins a game that stands on studio-engines/base.
//   createBase({ plugins: [fxPlugin()] })   then   base.plugin('fx').fx.burst('spark', { x, y, z })
// or, from any other plugin, without knowing fx is there:   base.bus.emit('fx:burst', { effect: 'spark', x, y, z })
import { createFx } from './fx.js';

/**
 * fxPlugin(options) -> plugin for createBase({ plugins: [...] })
 *   options.rng, options.seed, options.shake, options.createCanvas   passed to createFx
 *   options.cellPx      pixels per character when the showing view does not say (view.cellPx). Default 4.
 *   options.on          { 'combat:hit': (event, fx, base) => { ... } }: turn other plugins' bus events into effects
 *   options.light       false = do not dim smoke and dust with the time of day. Default true.
 *   options.modes       game modes in which effects run and draw. Default: every mode.
 * Settings used: 'detail' and 'reducedMotion' (shared), 'fx.shake' (its own, 0..1).
 * Bus events it hears: 'fx:burst' { effect, x, y, z, dir, count, power, radius }, 'fx:shake' { amount, seconds },
 *   'fx:kick' { dx, dy, seconds }, 'fx:flash' { color, seconds, strength }, 'fx:clear'.
 * A view may offer, besides toScreen: cellPx, cellOrigin { x, y } and occluded(x, y, h, point) -> true to hide a particle.
 * base.plugin('fx') -> { fx, save, load }
 */
export function fxPlugin(options = {}) {
  return {
    name: 'fx',
    requires: [],
    uses: ['sky', 'weather'],
    settings: [{ id: 'fx.shake', label: 'Screen shake', type: 'slider', value: 1, min: 0, max: 1, step: 0.25 }],
    install(base) {
      const fx = createFx({ rng: options.rng, seed: options.seed, shake: options.shake, createCanvas: options.createCanvas });
      const hook = options.modes ? { modes: options.modes } : {};
      let background = '#000';
      const view = {
        toScreen: (x, y, h) => base.views.toScreen(x, y, h),
        cellPx: options.cellPx ?? 4, originX: 0, originY: 0, width: 0, height: 0, occluded: null,
      };

      base.settings.watch('detail', (name) => fx.setDetail(name));
      base.settings.watch('reducedMotion', (on) => fx.setReducedMotion(on));
      base.settings.watch('fx.shake', (s) => fx.setShakeStrength(s));
      base.style.watch((tokens, name) => {
        if (tokens.fx && typeof tokens.fx === 'object') fx.defineStyle(name, tokens.fx); // a game's own style brings its own looks
        fx.setStyle(fx.hasStyle(name) ? name : fx.hasStyle(tokens.kiln) ? tokens.kiln : 'storybook');
        background = tokens.palette?.shadow ?? '#000';
      });
      base.env?.watch?.('wind', (w) => { if (Array.isArray(w)) fx.setWind(w[0] ?? 0, w[1] ?? 0); else if (w && Number.isFinite(w.x) && Number.isFinite(w.y)) fx.setWind(w.x, w.y); });

      base.on('late', (dt) => {
        if (options.light !== false) { const tone = base.time.now?.tone; if (Array.isArray(tone) && tone.length === 3 && tone.every((v) => v >= 0)) fx.setLight(tone); }
        fx.update(dt);
      }, hook);
      base.on('draw:effects', (ctx, alpha) => {
        const showing = base.views.current;
        view.cellPx = showing?.cellPx ?? options.cellPx ?? 4;
        view.originX = showing?.cellOrigin?.x ?? 0; view.originY = showing?.cellOrigin?.y ?? 0;
        view.width = base.width; view.height = base.height;
        view.occluded = typeof showing?.occluded === 'function' ? showing.occluded : null;
        fx.draw(ctx, view, alpha);
      }, hook);
      // after the world, the actors and the effects, before overlays and menus: the world shakes, the HUD holds still
      base.on('draw:overlay', (ctx) => {
        if (ctx.canvas) fx.applyShake(ctx, { width: base.width, height: base.height, background });
        fx.drawFlash(ctx, base.width, base.height);
      }, { ...hook, order: -1000 });

      base.bus.on('fx:burst', (e) => fx.burst(e.effect, e));
      base.bus.on('fx:shake', (e) => fx.shake(e.amount ?? 0.5, e.seconds));
      base.bus.on('fx:kick', (e) => fx.kick(e.dx, e.dy, e.seconds));
      base.bus.on('fx:flash', (e) => fx.flash(e.color, e.seconds, e.strength));
      base.bus.on('fx:clear', () => fx.clear());
      for (const [name, fn] of Object.entries(options.on ?? {})) {
        if (typeof fn !== 'function') throw new Error(`fxPlugin: options.on['${name}'] must be a function (event, fx, base), got ${typeof fn}`);
        base.bus.on(name, (e) => fn(e, fx, base));
      }
      return { fx, save: () => fx.save(), load: (data) => fx.load(data) };
    },
  };
}
