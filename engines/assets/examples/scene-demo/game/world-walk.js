// Finding the way for the open world's residents. The world stage strolls each resident straight
// toward a random point near home, so anyone whose point lay behind the well, a stall or a house
// walked into it and stayed there. Here every stroll gets a real path:
// each stroll is planned on the nav engine's field (the base's nav plugin: the page's scenery in world
// metres), and the resident is handed that path one corner at a time. The stage still does
// the walking and the collision; it is only told where to go next.
import { rand2 } from '../vendor/ai/index.js';

/**
 * @param {object} shared  { worldTalking?: object } the resident being talked to is left alone.
 * @param {object} nav     The nav engine's nav (the base's nav plugin): its field holds the scenery of the
 *   page's collision world in world metres, and follows the player from page to page.
 * @returns {{ attach(ws: object): void, update(dt: number): void, stats: object }}
 */
export function createWorldWalk(shared, nav) {
  let ws = null; let page = null;
  const stats = { paths: 0, repaths: 0, noWay: 0 };
  const radius = () => ws.player.radius + 0.12;
  // water is not a body in the collision world (the stage stops people at the shore itself), so the path is checked for it here
  const water = (x, y) => page.ground.isWater(x - page.ox, y - page.oy);
  /** The way from a resident to a point, as world points, or null when there is none on dry ground. */
  function way(e, gx, gy) {
    const found = nav.findPath({ x: e.x, y: e.y }, { x: gx, y: gy }, { radius: radius() });
    if (!found.complete || !found.points.length || found.points.some(([x, y]) => water(x, y))) return null;
    return found.points.map(([x, y]) => [x, y]);
  }
  /** A new stroll: somewhere open near home, and the way there. Returns false when no way was found. */
  function plan(e, w) {
    const a = rand2(e.seed, w.n++, 11) * 6.283; const r = 3 + rand2(e.seed, w.n++, 12) * 7;
    let gx = e.home[0] + Math.cos(a) * r; let gy = e.home[1] + Math.sin(a) * r;
    if (!nav.openAt(gx, gy, radius())) { const open = nav.nearestOpen(gx, gy, radius(), 12); if (!open) return false; gx = open.x; gy = open.y; }
    if (water(gx, gy)) return false;
    const path = way(e, gx, gy);
    if (!path) { stats.noWay += 1; return false; }
    w.path = path; // world metres, so a page swap does not disturb it
    w.best = Infinity; w.slow = 0; w.tries = 0;
    stats.paths += 1;
    return true;
  }

  return {
    stats,
    attach(stage) {
      ws = stage;
      ws.onPage((pg) => { page = pg; }); // a new page has its own ground (the nav field follows the collision plugin by itself)
    },
    /** Once per tick, BEFORE the stage's own update: tell each resident in view where to walk next. */
    update(dt) {
      if (!ws || !page || !page.ground) return;
      for (const e of ws.people) {
        if (!e.home || e === shared.worldTalking) continue;
        const w = (e.walk ??= { n: 0, path: null, rest: rand2(e.seed, 0, 13) * 2, best: Infinity, slow: 0, tries: 0 });
        e.stuck = 0; // the stage's own "give up and pick a random point" never fires: the path decides
        if (w.rest > 0) { w.rest -= dt; e.rest = 1; continue; } // standing a while (the stage sees a rest and does not move it)
        if (!w.path || !w.path.length) {
          if (!plan(e, w)) { w.rest = 1; e.rest = 1; continue; }
        }
        let [tx, ty] = w.path[0];
        let d = Math.hypot(tx - e.x, ty - e.y);
        while (d < 0.7 && w.path.length > 1) { w.path.shift(); [tx, ty] = w.path[0]; d = Math.hypot(tx - e.x, ty - e.y); w.best = Infinity; w.slow = 0; }
        if (d < 0.7) { w.path = null; w.rest = 1 + rand2(e.seed, w.n++, 14) * 4; e.rest = 1; continue; } // arrived: look about for a while
        // no headway toward the corner for a while (someone in the way, a corner cut too close): find the way again
        if (d < w.best - 0.05) { w.best = d; w.slow = 0; } else w.slow += dt;
        if (w.slow > 1.2) {
          w.slow = 0; w.best = Infinity; w.tries += 1; stats.repaths += 1;
          if (w.tries > 2) { w.path = null; continue; } // this stroll is not working: another one next tick
          const end = w.path[w.path.length - 1];
          const again = way(e, end[0], end[1]);
          if (again) w.path = again; else { w.path = null; continue; }
          [tx, ty] = w.path[0];
        }
        e.goal = [tx, ty]; e.rest = 0;
      }
    },
  };
}
