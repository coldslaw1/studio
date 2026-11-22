// Minds for the hamlet's people, by the ai engine. The merchant and the farmer live a day of their
// own: home, work, the well, bed, on the same clock as the sky. They find their way round the houses
// on a walk grid built from the scene's footprints, the stage's collision still moves their bodies,
// and what they mutter shows as a line over their heads when you are near enough to hear it.
// (The quest's people stay where the quest needs them, and the skeleton keeps combat's own brain.)
import { navFromShapes, bindBarks, agentFromAsset } from '../vendor/ai/index.js';
import { aiPlugin } from '../vendor/ai/plugin.js';

/**
 * @param {object} game    The game (pixelRatio).
 * @param {object} shared  { stage, sky }.
 * @param {Array<{actor:object, asset:object, home:[number,number], work:[number,number]}>} people
 *   Stage characters to give a mind: the generated asset each was made from, and two places of their own.
 * @returns {object} minds: { ai, update(dt), draw(ctx), reset(), save(), load(data) }
 */
export function createMinds(game, shared, people) {
  const { stage, sky } = shared;
  const { world, collision, layers, player } = stage;
  const grid = navFromShapes({
    shapes: world.footprints({ maxZ: stage.headHeight }),
    bounds: { x: 0, y: 0, w: 80, h: 80 }, cellSize: 0.5, padding: 0.45,
    blocked: (x, y) => x < 2 || y < 2 || x > 78 || y > 78 || world.isWater(x, y),
  });
  const bodies = new Map(); // agent id -> stage character
  // The ai plugin makes the minds on the base: they keep the base's hour (the sky), see the base's hero,
  // step in the base's 'sim' (so they stand still under a menu and in the cellar), every agent is a base
  // actor, and what they do goes out on the bus as 'ai:<event>'.
  game.base.use(aiPlugin({
    grid, seed: 7, hero: 'hero', heroFaction: 'player', modes: ['title', 'play'], // the hamlet's people rest while the player is in the open world or the cellar
    places: { inn: { x: 45.5, y: 42.5 } }, // the well is where people meet
    factions: { neutral: [['player', 'villagers'], ['player', 'guards']], allies: [['villagers', 'guards']] },
    // the stage's collision moves the body, so people stop at walls, at each other and at the player
    move(agent, dx, dy) {
      const c = bodies.get(agent.id);
      if (!c) return { x: agent.x + dx, y: agent.y + dy };
      collision.move(c.body, dx, dy, { mask: layers.SCENERY | layers.CHARACTER });
      return { x: c.body.x, y: c.body.y };
    },
  }));
  const minds = game.base.plugin('ai');
  const { ai } = minds;
  const start = people.map((p) => ({ id: p.actor.name, x: p.actor.body.x, y: p.actor.body.y }));
  function addAll() {
    for (const p of people) {
      const id = p.actor.name;
      const at = start.find((s) => s.id === id);
      if (ai.has(id)) minds.remove(id);
      collision.teleport(p.actor.body, at.x, at.y);
      minds.add(agentFromAsset(p.asset, { id, x: at.x, y: at.y, home: p.home, places: { work: p.work } }));
      bodies.set(id, p.actor);
    }
  }
  addAll();

  const said = new Map(); // agent id -> { text, left }
  bindBarks(ai, (e) => { if (bodies.has(e.id)) said.set(e.id, { text: e.text, left: 3 }); }, { near: () => ({ x: player.body.x, y: player.body.y, radius: 14 }) });

  return {
    ai, grid,
    /** One tick in the hamlet: the plugin has stepped the minds; the stage's characters take their walk from them. */
    update(dt) {
      for (const [id, c] of bodies) { const a = ai.get(id); c.vx = a.vx; c.vy = a.vy; c.doing = a.activity ?? a.goal; }
      for (const [id, s] of said) { s.left -= dt; if (s.left <= 0) said.delete(id); }
    },
    /** What people say, over their heads. */
    draw(ctx) {
      if (!said.size) return;
      const k = game.pixelRatio;
      ctx.save();
      ctx.font = `${Math.round(13 * k)}px Consolas, monospace`; ctx.textAlign = 'center';
      for (const [id, s] of said) {
        const c = bodies.get(id);
        const p = stage.toScreen ? stage.toScreen(c.body.x, c.body.y, 2.3) : null;
        if (!p || p.visible === false) continue;
        const w = ctx.measureText(s.text).width + 12 * k;
        ctx.globalAlpha = Math.min(1, s.left * 2);
        ctx.fillStyle = 'rgba(16, 19, 31, 0.82)'; ctx.fillRect(p.x - w / 2, p.y - 17 * k, w, 20 * k);
        ctx.fillStyle = '#f2ecd8'; ctx.fillText(s.text, p.x, p.y - 3 * k);
      }
      ctx.restore();
    },
    /** A new game: everyone back where the day starts. */
    reset() { said.clear(); addAll(); },
    /** For play-tests: what each person is doing. */
    snapshot: () => ai.snapshot(),
  };
}
