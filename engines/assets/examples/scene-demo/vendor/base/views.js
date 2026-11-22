// Views: the ways the same world is shown (isometric picture, open world pages, first person,
// orbit). Each one offers the same small contract, so the game talks to "the view that is
// showing" and never has to know which it is. Switching is one call.
import { POINTER_MODES } from './focus.js';

/** Characters-per-metre numbers behind the shared 'detail' setting. */
export const DETAIL_LEVELS = Object.freeze({ low: 2, medium: 3, high: 5 });

/**
 * A view is an object with:
 *   draw(ctx, alpha)          required. Paint the world.
 *   pointer                   'free' (default), 'drag' or 'locked': what the mouse does while this view shows
 *   update(dt, input)         optional. Once per tick while the game is not paused. `input` is the game layer's input.
 *   toScreen(x, y, h)         optional. Canvas point { x, y, visible } of a world point h metres above the ground.
 *   toGround(dx, dy)          optional. Turns a screen direction (right, down) into a ground direction [gx, gy], so
 *                             "up" walks away from the camera in every view. Without it screen directions are ground directions.
 *   enter(previousName), leave(nextName)   optional
 *   setDetail(n), setTime(now), setStyle(tokens), resize(width, height)   optional; the base calls them, also right after add()
 *
 * createViews(options) -> views
 *   options.bus, options.focus   'view:changed' { name, previous } is emitted; the game layer's pointer mode follows the view
 *   options.context()            () => { detail, now, tokens, width, height }: what a new view is told at once
 * views:
 *   add(name, view)    register. The first one added becomes the showing view.
 *   set(name)          show a view.   next()  step to the one after it.
 *   name, current      the showing view's name and object (null before any is added)
 *   names(), has(name), get(name)
 *   toScreen(x, y, h)  ask the showing view; { x: 0, y: 0, visible: false } when it cannot say
 *   each(fn)           fn(view, name) for every view
 */
export function createViews(options = {}) {
  const { bus = null, focus = null, context = () => ({}) } = options;
  const map = new Map();
  let name = null;
  const nowhere = Object.freeze({ x: 0, y: 0, visible: false });
  const brief = (view) => {
    const c = context();
    if (c.detail !== undefined) view.setDetail?.(c.detail);
    if (c.tokens) view.setStyle?.(c.tokens);
    if (c.now !== undefined) view.setTime?.(c.now);
    if (c.width) view.resize?.(c.width, c.height);
  };
  const views = {
    add(n, view) {
      if (typeof n !== 'string' || !n) throw new Error(`views.add: name must be a non-empty string, got ${JSON.stringify(n)}`);
      if (map.has(n)) throw new Error(`views.add: a view named '${n}' is already there`);
      if (typeof view?.draw !== 'function') throw new Error(`views.add: view '${n}' needs a draw(ctx, alpha) function`);
      const pointer = view.pointer ?? 'free';
      if (!POINTER_MODES.includes(pointer)) throw new Error(`views.add: view '${n}' pointer must be one of ${POINTER_MODES.join(', ')}, got ${JSON.stringify(view.pointer)}`);
      for (const m of ['update', 'toScreen', 'toGround', 'enter', 'leave', 'setDetail', 'setTime', 'setStyle', 'resize']) {
        if (view[m] !== undefined && typeof view[m] !== 'function') throw new Error(`views.add: view '${n}' has ${m} but it is not a function`);
      }
      map.set(n, view);
      brief(view);
      if (name === null) views.set(n);
      return view;
    },
    set(n) {
      if (!map.has(n)) throw new Error(`views.set: no view named ${JSON.stringify(n)} (there are: ${[...map.keys()].join(', ') || 'none'})`);
      if (n === name) return map.get(n);
      const previous = name;
      if (previous !== null) map.get(previous).leave?.(n);
      name = n;
      const view = map.get(n);
      brief(view);
      view.enter?.(previous);
      focus?.setGamePointer(view.pointer ?? 'free');
      bus?.emit('view:changed', { name, previous });
      return view;
    },
    next() { const all = [...map.keys()]; if (!all.length) return null; return views.set(all[(all.indexOf(name) + 1) % all.length]); },
    get name() { return name; },
    get current() { return name === null ? null : map.get(name); },
    names() { return [...map.keys()]; },
    has(n) { return map.has(n); },
    get(n) { return map.get(n) ?? null; },
    /** A screen direction as a ground direction, through the showing view. */
    toGround(dx, dy) { return views.current?.toGround?.(dx, dy) ?? [dx, dy]; },
    toScreen(x, y, h = 0) { const p = views.current?.toScreen?.(x, y, h); return p ? { visible: true, ...p } : nowhere; },
    each(fn) { for (const [n, view] of map) fn(view, n); },
  };
  return views;
}
