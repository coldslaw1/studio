// Cutscene shots for every kind of view. A shot is view-independent: "look at this ground point, from
// this side, this close": { x, y, zoom, yaw } with yaw in the baked camera's degrees (a Kiln scene yaw)
// or null for "whichever way the camera looks now". The baked isometric camera takes it as it is
// (lookAt, zoomTo, rotateTo). These two functions say what the same shot means for a camera that
// circles a point in a live 3D view (createOrbitRig), and back, so a cutscene frames the same thing
// whichever view is showing.

/**
 * What a shot means for an orbiting 3D camera.
 * @param {{x:number, y:number, zoom?:number, yaw?:number|null, pitch?:number|null, distance?:number|null, height?:number|null, shakeX?:number, shakeY?:number}} shot
 *   pitch, distance and height (metres above the ground of the point looked at) are for 3D views; each may be
 *   left out or null, and the view then decides: the tilt from `o.pitch`, the distance from the zoom.
 *   A SHOT's pitch is degrees DOWN (positive looks down, 89 is straight down), as the events engine writes
 *   it. A rig's pitch is the other way (negative looks down). The two functions here convert.
 * @param {object} [o]
 * @param {number} [o.distance]   Distance at zoom 1 (default 9). Zoom 2 is half as far.
 * @param {number} [o.pitch]      Tilt when the shot gives none, in RIG terms (default -32: looking down).
 * @param {number} [o.yawOffset]  Degrees from the shot's yaw to the 3D view's yaw (default 90: a Kiln scene yaw is a quarter turn behind a 3D view that looks along +x at yaw 0).
 * @param {number} [o.yaw]        The 3D yaw to use when the shot has none (default 0; pass the view's current yaw).
 * @param {number} [o.minDistance]  Default 1.5.
 * @param {number} [o.maxDistance]  Default 40.
 * @param {number|null} [o.height]  Height of the point looked at when the shot gives none (default null: the view decides, usually the ground or a hero's chest).
 * @returns {{x:number, y:number, yaw:number, pitch:number, distance:number, height:number|null}}  In rig terms (pitch negative = down). x, y: the point to circle (the shot's point, moved by its shake).
 *   A shot's own distance is taken as it is; one worked out from the zoom is kept within minDistance..maxDistance.
 */
export function orbitFromShot(shot, o = {}) {
  if (!shot || !Number.isFinite(shot.x) || !Number.isFinite(shot.y)) throw new Error('orbitFromShot: a shot needs numeric x and y');
  const zoom = shot.zoom ?? 1;
  if (!(zoom > 0)) throw new Error(`orbitFromShot: zoom must be above 0, got ${shot.zoom}`);
  if (shot.distance !== null && shot.distance !== undefined && !(shot.distance > 0)) throw new Error(`orbitFromShot: distance must be above 0, got ${shot.distance}`);
  const far = Number.isFinite(shot.distance) ? shot.distance : Math.min(o.maxDistance ?? 40, Math.max(o.minDistance ?? 1.5, (o.distance ?? 9) / zoom));
  const pitch = Number.isFinite(shot.pitch) ? -shot.pitch : (o.pitch ?? -32); // shot: degrees down; rig: negative is down
  const height = Number.isFinite(shot.height) ? shot.height : (o.height ?? null);
  const yaw = Number.isFinite(shot.yaw) ? shot.yaw + (o.yawOffset ?? 90) : (o.yaw ?? 0);
  return { x: shot.x + (shot.shakeX ?? 0), y: shot.y + (shot.shakeY ?? 0), yaw: ((yaw % 360) + 360) % 360, pitch, distance: far, height };
}

/**
 * The shot that frames what an orbiting 3D camera shows now: the other way round. A cutscene starts
 * from it and eases back to it, so nothing jumps when a shot begins or is released.
 * @param {{x:number, y:number, height?:number|null}} point  The point the camera circles (in first person: the hero), and its height above the ground if the view has one.
 * @param {{yaw:number, distance:number, pitch?:number}} rig  The camera's yaw, distance and tilt (in first person: the look direction and a short distance such as 2).
 * @param {{distance?:number, yawOffset?:number}} [o]  As in orbitFromShot.
 * @returns {{x:number, y:number, zoom:number, yaw:number, pitch:number|null, distance:number, height:number|null}}  In shot terms (pitch = degrees down).
 *   Everything a shot can carry, so a cutscene can ease every part of it from here and back to here.
 */
export function shotFromOrbit(point, rig, o = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('shotFromOrbit: the point needs numeric x and y');
  if (!rig || !Number.isFinite(rig.yaw) || !(rig.distance > 0)) throw new Error('shotFromOrbit: the rig needs a yaw and a distance above 0');
  const yaw = rig.yaw - (o.yawOffset ?? 90);
  return { x: point.x, y: point.y, zoom: (o.distance ?? 9) / rig.distance, yaw: ((yaw % 360) + 360) % 360, pitch: Number.isFinite(rig.pitch) ? (rig.pitch === 0 ? 0 : -rig.pitch) : null, distance: rig.distance, height: Number.isFinite(point.height) ? point.height : null };
}
