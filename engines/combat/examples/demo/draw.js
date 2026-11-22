// Drawing for the combat demo: a pitched 2.5D view built with puppet's
// projection, so ground positions, heights and characters all line up.
import { createVectorRenderer, frontProjection, project } from '../../../puppet/src/index.js';
import { dirOf } from '../../src/index.js';

const UNIT = 30; // pixels per metre
const PITCH = 42; // degrees the camera looks down

/** createView(options) -> { draw(ctx, pointer), toGround(px, py) } */
export function createView({ combat, actors, state, inventory, walls, width, height }) {
  const camera = frontProjection({ unit: UNIT, pitch: PITCH });
  const renderer = createVectorRenderer({ style: { shading: 'cel', outline: 1.6, groundShadow: 0.25 }, projection: camera });
  const ox = width / 2; const oy = height / 2 + 12;
  let shakeX = 0; let shakeY = 0;
  const at = (x, y, z = 0) => { const s = project([x, y, z], camera); return [ox + s[0] + shakeX, oy + s[1] + shakeY]; };
  const sinP = Math.sin(PITCH * Math.PI / 180);
  /** toGround(px, py) -> the ground point { x, y } under a canvas point. */
  const toGround = (px, py) => ({ x: (px - ox) / UNIT, y: -(py - oy) / (UNIT * sinP) });

  function poly(ctx, points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x, y, z], i) => { const s = at(x, y, z); if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  // an arc or box from moveOutline / a telegraph event, flat on the ground
  function shape(ctx, s, fill, stroke) {
    if (s.kind === 'box') { poly(ctx, s.points.map(([x, y]) => [x, y, 0.02]), fill, stroke); return; }
    const pts = [];
    const n = Math.max(2, Math.ceil(Math.abs(s.to - s.from) / 12));
    for (let i = 0; i <= n; i++) { const [dx, dy] = dirOf(s.from + (s.to - s.from) * i / n); pts.push([s.x + dx * s.reach, s.y + dy * s.reach, 0.02]); }
    for (let i = n; i >= 0; i--) { const [dx, dy] = dirOf(s.from + (s.to - s.from) * i / n); pts.push([s.x + dx * s.inner, s.y + dy * s.inner, 0.02]); }
    poly(ctx, pts, fill, stroke);
  }
  function wall(ctx, w) {
    const h = w.height ?? 1.6; const x1 = w.x + w.w; const y1 = w.y + w.h;
    poly(ctx, [[w.x, w.y, 0], [x1, w.y, 0], [x1, w.y, h], [w.x, w.y, h]], w.height < 1 ? '#5a6b52' : '#4a4f66'); // the face toward the camera
    poly(ctx, [[w.x, w.y, h], [x1, w.y, h], [x1, y1, h], [w.x, y1, h]], w.height < 1 ? '#74896a' : '#646a86');
  }
  function projectile(ctx, p) {
    const ground = at(p.x, p.y, 0); const s = at(p.x, p.y, p.z);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(ground[0], ground[1], 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(s[0], s[1]);
    if (p.kind === 'rock') { ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.rotate((p.mode === 'fly' ? p.angle : 135) * Math.PI / 180 + Math.atan2(-p.vy * sinP, p.vx || 1e-6));
      ctx.strokeStyle = '#8a5a33'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.fillStyle = '#cfd6e4'; ctx.fillRect(2, -4, 5, 5);
    }
    ctx.restore();
  }
  function bars(ctx, f) {
    const s = at(f.x, f.y, f.z + f.height + 0.25);
    const w = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(s[0] - w / 2 - 1, s[1] - 1, w + 2, 5);
    ctx.fillStyle = f.faction === 'player' ? '#5fd38d' : '#e0564f'; ctx.fillRect(s[0] - w / 2, s[1], w * f.hp / f.maxHp, 3);
    if (f.guard.on) { ctx.fillStyle = '#7fd4ff'; ctx.fillRect(s[0] - w / 2, s[1] + 4, w * Math.max(0, f.guard.meter) / (combat.config.shields[f.shield]?.guard ?? combat.config.weapons[f.weapon].guard?.guard ?? 1), 2); }
    if (f.statuses.length) { ctx.fillStyle = '#c98bff'; ctx.font = '8px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.statuses.map((x) => x.id).join(' '), s[0], s[1] - 3); }
  }

  return {
    toGround,
    draw(ctx, pointer) {
      shakeX = state.shake > 0 ? Math.sin(state.shake * 190) * 60 * state.shake * 0.25 : 0;
      shakeY = state.shake > 0 ? Math.cos(state.shake * 230) * 60 * state.shake * 0.15 : 0;
      poly(ctx, [[-9, -5.5, 0], [9, -5.5, 0], [9, 5.5, 0], [-9, 5.5, 0]], '#2d3a34');
      for (let x = -8; x <= 8; x += 2) poly(ctx, [[x, -5.5, 0], [x, 5.5, 0]], null, 'rgba(255,255,255,0.04)');
      for (const t of state.telegraphs) shape(ctx, t.shape, 'rgba(255,80,60,0.22)', 'rgba(255,120,90,0.7)');
      for (const f of combat.fighters()) {
        const m = f.alive ? combat.moveOf(f.id) : null;
        if (m && (m.phase === 'active' || state.shapes)) shape(ctx, m.outline, m.phase === 'active' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)', state.shapes ? 'rgba(255,255,255,0.4)' : null);
        if (state.shapes) { const s = at(f.x, f.y, 0); ctx.strokeStyle = f.iframes > 0 ? '#7fd4ff' : '#ffffff55'; ctx.beginPath(); ctx.ellipse(s[0], s[1], f.radius * UNIT, f.radius * UNIT * sinP, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      // far things first: sort walls, fighters and projectiles by how close they are to the camera
      const items = [
        ...walls.filter((w) => Number.isFinite(w.height)).map((w) => ({ y: w.y, draw: () => wall(ctx, w) })),
        ...combat.fighters().filter((f) => actors.has(f.id)).map((f) => ({ y: f.y, draw: () => {
          const a = actors.get(f.id); const s = at(f.x, f.y, f.z);
          renderer.draw(ctx, a.character.puppet, s[0], s[1], { alpha: a.gone !== null ? Math.min(1, a.gone) : f.iframes > 0 && Math.floor(f.iframes * 20) % 2 ? 0.45 : 1 });
          if (f.alive) bars(ctx, f);
        } })),
        ...combat.projectiles.map((p) => ({ y: p.y - 0.01, draw: () => projectile(ctx, p) })),
      ].sort((a, b) => b.y - a.y);
      for (const it of items) it.draw();
      ctx.textAlign = 'center'; ctx.font = 'bold 11px system-ui, sans-serif';
      for (const f of state.floats) { const s = at(f.x, f.y, f.z + f.t * 1.2); ctx.globalAlpha = 1 - f.t / 0.9; ctx.fillStyle = f.color; ctx.fillText(f.text, s[0], s[1]); }
      ctx.globalAlpha = 1;
      if (pointer && combat.fighter('hero').alive) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(pointer.x, pointer.y, 6, 6 * sinP, 0, 0, Math.PI * 2); ctx.stroke(); }
      // HUD
      const h = combat.fighter('hero');
      ctx.textAlign = 'left'; ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#e8e4d8';
      ctx.fillText(`HP ${Math.ceil(h.hp)}/${h.maxHp}   ${h.weapon}${h.shield ? ' + shield' : ''}   axes ${inventory.count('axe')}   kills ${state.kills}   parries ${state.parries}`, 10, 16);
      ctx.fillStyle = '#9aa3b8';
      ctx.fillText('WASD move  J/click attack, again = combo  K/Shift block, late = parry  Space roll  F throw  Q swap  H shapes  M mute  R restart', 10, height - 8);
      ctx.textAlign = 'center'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.fillStyle = '#ffd98a';
      if (state.rest > 0 || !h.alive) ctx.fillText(state.message, width / 2, 40);
    },
  };
}
