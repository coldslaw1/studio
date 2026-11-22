// Areas: named places on the ground. Three shapes, all in the game's ground units
// (metres under the base engine, pixels in a plain 2D game):
//   circle   { x, y, radius }          x, y is the centre
//   box      { x, y, w, h }            x, y is the corner with the smallest x and y
//   polygon  { points: [[x, y], ...] } three or more corners, in order
// An area can also stand for every point of interest of one kind in a streamed world:
//   { poi: 'tower', radius: 6 }   or   { poi: 'tower', w: 10, h: 8 }   (centred on each tower)
// The game tells the engine where those are as the world loads (events.addPlace).

/** 'circle', 'box', 'polygon', or null when the object is none of them. */
export function areaShape(area) {
  if (!area || typeof area !== 'object') return null;
  if (Array.isArray(area.points)) return 'polygon';
  if (typeof area.radius === 'number') return 'circle';
  if (typeof area.w === 'number' && typeof area.h === 'number') return 'box';
  return null;
}

/** True when the point is inside the area (edges count as inside). */
export function areaContains(area, x, y) {
  const shape = areaShape(area);
  if (shape === 'circle') return Math.hypot(x - area.x, y - area.y) <= area.radius;
  if (shape === 'box') return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
  if (shape === 'polygon') {
    let inside = false;
    const p = area.points;
    for (let i = 0, j = p.length - 1; i < p.length; j = i, i += 1) {
      const [xi, yi] = p[i]; const [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  throw new Error(`areaContains: not an area: ${JSON.stringify(area)}`);
}

/** The middle of an area: { x, y }. */
export function areaCentre(area) {
  const shape = areaShape(area);
  if (shape === 'circle') return { x: area.x, y: area.y };
  if (shape === 'box') return { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  if (shape === 'polygon') {
    let x = 0; let y = 0;
    for (const [px, py] of area.points) { x += px; y += py; }
    return { x: x / area.points.length, y: y / area.points.length };
  }
  throw new Error(`areaCentre: not an area: ${JSON.stringify(area)}`);
}

/** Distance from a point to the area: 0 inside, otherwise to its centre minus its rough size. */
export function areaDistance(area, x, y) {
  if (areaContains(area, x, y)) return 0;
  const c = areaCentre(area);
  const size = areaShape(area) === 'circle' ? area.radius : 0;
  return Math.max(0, Math.hypot(x - c.x, y - c.y) - size);
}

/** The concrete shape of a poi area at one place { x, y }: a circle, or a box centred on it. */
export function areaAt(area, place) {
  if (typeof area.radius === 'number') return { x: place.x, y: place.y, radius: area.radius };
  return { x: place.x - area.w / 2, y: place.y - area.h / 2, w: area.w, h: area.h };
}
