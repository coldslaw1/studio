// Built-in icons, drawn with canvas paths so games need no image files.
// Each icon draws inside a square of `size` pixels centred on (cx, cy).

const TAU = Math.PI * 2;

function poly(ctx, cx, cy, s, points) {
  ctx.beginPath();
  points.forEach(([px, py], i) => {
    const x = cx + px * s;
    const y = cy + py * s;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
}

const ICONS = {
  pause(ctx, cx, cy, s) {
    ctx.fillRect(cx - s * 0.3, cy - s * 0.35, s * 0.2, s * 0.7);
    ctx.fillRect(cx + s * 0.1, cy - s * 0.35, s * 0.2, s * 0.7);
  },
  play(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.25, -0.38], [0.4, 0], [-0.25, 0.38]]);
  },
  back(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.42, 0], [0, -0.38], [0, -0.14], [0.4, -0.14], [0.4, 0.14], [0, 0.14], [0, 0.38]]);
  },
  close(ctx, cx, cy, s) {
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3, cy - s * 0.3); ctx.lineTo(cx + s * 0.3, cy + s * 0.3);
    ctx.moveTo(cx + s * 0.3, cy - s * 0.3); ctx.lineTo(cx - s * 0.3, cy + s * 0.3);
    ctx.stroke();
  },
  check(ctx, cx, cy, s) {
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.34, cy + s * 0.02);
    ctx.lineTo(cx - s * 0.1, cy + s * 0.26);
    ctx.lineTo(cx + s * 0.36, cy - s * 0.26);
    ctx.stroke();
  },
  restart(ctx, cx, cy, s) {
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.3, -Math.PI * 0.35, Math.PI * 1.35);
    ctx.stroke();
    poly(ctx, cx, cy, s, [[0.02, -0.46], [0.36, -0.3], [0.06, -0.08]]);
  },
  home(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.44, 0], [0, -0.42], [0.44, 0], [0.3, 0], [0.3, 0.4], [-0.3, 0.4], [-0.3, 0]]);
  },
  gear(ctx, cx, cy, s) {
    const points = [];
    for (let i = 0; i < 16; i++) {
      const r = (i % 2 === 0 ? 0.42 : 0.3);
      const a = (i / 16) * TAU + 0.2;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(cx + px * s, cy + py * s) : ctx.moveTo(cx + px * s, cy + py * s)));
    ctx.closePath();
    ctx.arc(cx, cy, s * 0.13, 0, TAU, true);
    ctx.fill('evenodd');
  },
  sound(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.42, -0.14], [-0.2, -0.14], [0.06, -0.36], [0.06, 0.36], [-0.2, 0.14], [-0.42, 0.14]]);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.arc(cx + s * 0.08, cy, s * 0.26, -0.8, 0.8);
    ctx.stroke();
  },
  heart(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.38);
    ctx.bezierCurveTo(cx - s * 0.6, cy, cx - s * 0.4, cy - s * 0.5, cx, cy - s * 0.18);
    ctx.bezierCurveTo(cx + s * 0.4, cy - s * 0.5, cx + s * 0.6, cy, cx, cy + s * 0.38);
    ctx.fill();
  },
  star(ctx, cx, cy, s) {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.44 : 0.19;
      const a = (i / 10) * TAU - Math.PI / 2;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    poly(ctx, cx, cy, s, points);
  },
  coin(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.38, 0, TAU);
    ctx.arc(cx, cy, s * 0.2, 0, TAU, true);
    ctx.fill('evenodd');
  },
  warn(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.42); ctx.lineTo(cx + s * 0.44, cy + s * 0.36); ctx.lineTo(cx - s * 0.44, cy + s * 0.36);
    ctx.closePath();
    ctx.rect(cx - s * 0.05, cy - s * 0.16, s * 0.1, s * 0.26);
    ctx.rect(cx - s * 0.05, cy + s * 0.17, s * 0.1, s * 0.1);
    ctx.fill('evenodd');
  },
  info(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, TAU);
    ctx.rect(cx - s * 0.06, cy - s * 0.08, s * 0.12, s * 0.32);
    ctx.rect(cx - s * 0.06, cy - s * 0.27, s * 0.12, s * 0.12);
    ctx.fill('evenodd');
  },
  bag(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.3, -0.12], [0.3, -0.12], [0.42, 0.4], [-0.42, 0.4]]);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.14, s * 0.18, Math.PI, 0);
    ctx.stroke();
  },
  key(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.arc(cx - s * 0.2, cy, s * 0.22, 0, TAU);
    ctx.arc(cx - s * 0.2, cy, s * 0.09, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.fillRect(cx, cy - s * 0.06, s * 0.42, s * 0.12);
    ctx.fillRect(cx + s * 0.22, cy, s * 0.08, s * 0.18);
    ctx.fillRect(cx + s * 0.34, cy, s * 0.08, s * 0.14);
  },
  map(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.42, -0.3], [-0.14, -0.38], [0.14, -0.3], [0.42, -0.38], [0.42, 0.3], [0.14, 0.38], [-0.14, 0.3], [-0.42, 0.38]]);
  },
  save(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.38, cy - s * 0.38); ctx.lineTo(cx + s * 0.24, cy - s * 0.38); ctx.lineTo(cx + s * 0.38, cy - s * 0.24);
    ctx.lineTo(cx + s * 0.38, cy + s * 0.38); ctx.lineTo(cx - s * 0.38, cy + s * 0.38);
    ctx.closePath();
    ctx.rect(cx - s * 0.2, cy + s * 0.04, s * 0.4, s * 0.24);
    ctx.rect(cx - s * 0.2, cy - s * 0.3, s * 0.3, s * 0.16);
    ctx.fill('evenodd');
  },
  trash(ctx, cx, cy, s) {
    ctx.fillRect(cx - s * 0.36, cy - s * 0.3, s * 0.72, s * 0.1);
    ctx.fillRect(cx - s * 0.12, cy - s * 0.4, s * 0.24, s * 0.1);
    poly(ctx, cx, cy, s, [[-0.28, -0.14], [0.28, -0.14], [0.22, 0.4], [-0.22, 0.4]]);
  },
  lock(ctx, cx, cy, s) {
    ctx.fillRect(cx - s * 0.3, cy - s * 0.04, s * 0.6, s * 0.44);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.08, s * 0.19, Math.PI, 0);
    ctx.stroke();
  },
  chat(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[-0.42, -0.34], [0.42, -0.34], [0.42, 0.16], [-0.06, 0.16], [-0.26, 0.4], [-0.26, 0.16], [-0.42, 0.16]]);
  },
  sword(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[0.42, -0.42], [0.42, -0.24], [-0.08, 0.2], [-0.2, 0.08], [0.24, -0.42]]);
    poly(ctx, cx, cy, s, [[-0.3, -0.04], [0.04, 0.3], [-0.04, 0.38], [-0.38, 0.04]]);
    poly(ctx, cx, cy, s, [[-0.26, 0.18], [-0.18, 0.26], [-0.36, 0.44], [-0.44, 0.36]]);
  },
  shield(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.36, cy - s * 0.36); ctx.lineTo(cx + s * 0.36, cy - s * 0.36);
    ctx.lineTo(cx + s * 0.36, cy + s * 0.02);
    ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.34, cx, cy + s * 0.44);
    ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.34, cx - s * 0.36, cy + s * 0.02);
    ctx.closePath();
    ctx.fill();
  },
  potion(ctx, cx, cy, s) {
    ctx.fillRect(cx - s * 0.1, cy - s * 0.42, s * 0.2, s * 0.22);
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.12, s * 0.3, 0, TAU);
    ctx.fill();
  },
  arrow(ctx, cx, cy, s) {
    poly(ctx, cx, cy, s, [[0, -0.44], [0.32, 0.38], [0, 0.2], [-0.32, 0.38]]);
  },
};

/** Names of the built-in icons. */
export const ICON_NAMES = Object.keys(ICONS);

/**
 * drawIcon(ctx, icon, cx, cy, size, color)
 *   icon: a built-in name (see ICON_NAMES) or a function
 *         (ctx, cx, cy, size, color) => void that draws your own.
 * Throws on an unknown name.
 */
export function drawIcon(ctx, icon, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (typeof icon === 'function') {
    icon(ctx, cx, cy, size, color);
  } else if (ICONS[icon]) {
    ICONS[icon](ctx, cx, cy, size);
  } else {
    ctx.restore();
    throw new Error(`drawIcon: unknown icon "${icon}". Use one of: ${ICON_NAMES.join(', ')}`);
  }
  ctx.restore();
}

/** isIcon(value) -> true when value is a built-in icon name or a draw function. */
export function isIcon(value) {
  return typeof value === 'function' || Object.prototype.hasOwnProperty.call(ICONS, value);
}
