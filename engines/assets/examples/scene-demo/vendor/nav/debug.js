// drawNav: a picture of what the walkers know, for demos and for finding out why someone will not
// go somewhere. Draws on any 2D canvas context; restores every context setting it changes.

/**
 * drawNav(ctx, nav, options)
 *   toScreen   (x, y) -> { x, y } from game units to canvas pixels. Default: scale and offset below.
 *   scale = 16, offsetX = 0, offsetY = 0   used when toScreen is not given (top-down)
 *   cells = true       shade the cells nobody can walk
 *   clearance = false  tint cells by how much room there is (the nearer a prop, the stronger)
 *   radius             shade also the cells a body of this radius cannot stand on
 *   mesh = false       outline the navmesh pieces for that radius
 *   paths = true, agents = true
 *   colours    { blocked, tight, mesh, path, agent, goal } CSS colours
 */
export function drawNav(ctx, nav, options = {}) {
  const scale = options.scale ?? 16; const ox = options.offsetX ?? 0; const oy = options.offsetY ?? 0;
  const top = !options.toScreen;
  const at = options.toScreen ?? ((x, y) => ({ x: x * scale + ox, y: y * scale + oy }));
  const col = { blocked: 'rgba(40, 30, 30, 0.55)', tight: 'rgba(200, 120, 40, 0.35)', mesh: 'rgba(60, 130, 200, 0.7)', path: '#d9480f', agent: '#1c7ed6', goal: '#2b8a3e', ...(options.colours ?? {}) };
  const field = nav.field(); const cs = field.cellSize;
  const radius = options.radius ?? nav.config.radius;
  ctx.save();
  if (options.cells !== false || options.clearance) {
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const i = r * field.cols + c;
        const blocked = field.cost[i] === 0; const tight = !blocked && field.clear[i] < radius;
        let fill = null;
        if (blocked && options.cells !== false) fill = col.blocked;
        else if (tight && options.cells !== false) fill = col.tight;
        else if (options.clearance && !blocked) { const t = 1 - Math.min(1, field.clear[i] / field.maxClear); if (t > 0.02) { ctx.globalAlpha = t * 0.5; fill = col.tight; } }
        if (!fill) continue;
        const x = field.originX + c * cs; const y = field.originY + r * cs;
        ctx.fillStyle = fill;
        if (top) { const p = at(x, y); ctx.fillRect(p.x, p.y, cs * scale + 0.5, cs * scale + 0.5); } else {
          const p = [at(x, y), at(x + cs, y), at(x + cs, y + cs), at(x, y + cs)];
          ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let k = 1; k < 4; k++) ctx.lineTo(p[k].x, p[k].y); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  if (options.mesh) {
    ctx.strokeStyle = col.mesh; ctx.lineWidth = 1;
    for (const p of nav.mesh(radius).polys) {
      const pts = p.points ? p.points.map((v) => at(v[0], v[1])) : [at(p.x0, p.y0), at(p.x1, p.y0), at(p.x1, p.y1), at(p.x0, p.y1)];
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y); ctx.closePath(); ctx.stroke();
    }
  }
  for (const a of nav.agents()) {
    const p = at(a.x, a.y);
    if (options.paths !== false && a.path && a.path.length) {
      ctx.strokeStyle = col.path; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y);
      for (const w of a.path) { const s = at(w[0], w[1]); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
      const g = at(a.path[a.path.length - 1][0], a.path[a.path.length - 1][1]);
      ctx.fillStyle = col.goal; ctx.beginPath(); ctx.arc(g.x, g.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    if (options.agents !== false) {
      const e = at(a.x + a.radius, a.y);
      ctx.fillStyle = a.status === 'stuck' || a.status === 'blocked' ? col.path : col.agent;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, Math.abs(e.x - p.x)), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
