// What the game adds to the stage: two villagers, moonleaf, the cellar hatch, the yard's loose
// props, the walkable grid, and the list of things the player can use. One per session; reset()
// puts it back for a new game or a loaded save.
import { SIDE_QUEST } from './story.js';
import { generateAsset } from '../../../src/gen.js';
import { createProp, createYard } from './props.js';
import { createNav } from './nav.js';
import { resetQuest, snapshot, canGather, canEnterCellar, HERBS } from './model.js';

/** Where things are, in ground units (the hamlet is 80 x 80, its flat middle is around 40, 40). */
export const SPOTS = {
  start: [36.5, 50],
  elder: [46.6, 43.6],
  tobin: [32.5, 53],
  hatch: [32.6, 37.4],
  herbs: [[55, 38.5], [27.5, 27.2], [45, 54.6]],
  ball: [38.4, 52.4],
  target: [38.6, 57.6],
  barrel: [34.4, 57],
  throwFrom: [35.6, 54.2],
  merchant: [49, 44.6],
  farmer: [30.2, 47.2],
};

/**
 * @param {object} game    core's game.
 * @param {object} shared  { stage, quest, sound, ui }.
 */
export function createHamlet(game, shared) {
  const { stage, quest, sound } = shared;
  const { player, npc, collision, camera } = stage;
  const story = quest.story;

  // The people are made by Kiln's asset generator from a few words and a seed, and handed to the
  // puppet engine as rigs: the same words and seed always give the same person.
  const person = (describe, seed, at, name) => {
    const asset = generateAsset({ describe, seed, kind: 'npc' });
    return stage.addCharacter(asset.model, at[0], at[1], { name, generated: asset.name, asset });
  };
  const elder = person('elder with a staff', 3, SPOTS.elder, 'elder');
  const tobin = person('bard', 11, SPOTS.tobin, 'tobin');
  const extras = [person('merchant', 5, SPOTS.merchant, 'merchant'), person('farmer', 8, SPOTS.farmer, 'farmer')];
  const people = { guard: npc, elder, tobin };

  const herbs = SPOTS.herbs.map(([x, y], i) => {
    const prop = createProp(stage, 'herb', { x, y }, { name: 'herb' + i, hidden: true });
    stage.actors.push(prop);
    return prop;
  });
  if (herbs.length !== HERBS) throw new Error(`createHamlet: SPOTS.herbs has ${herbs.length} places, the quest needs ${HERBS}`);
  const hatch = createProp(stage, 'hatch', { x: SPOTS.hatch[0], y: SPOTS.hatch[1] }, { name: 'hatch' });
  stage.actors.push(hatch);

  const yard = createYard(stage, {
    onHit(a, b, speed) {
      if (speed < 1) return;
      const s = sound.at(a.body.x, a.body.y, player.body);
      sound.play('wood', { volume: Math.min(1, 0.3 + speed / 12) * s.near, pan: s.pan });
      const stone = a.kind === 'stone' ? a : b.kind === 'stone' ? b : null;
      const other = stone === a ? b : a;
      if (stone && stone.thrown && other.kind === 'target' && speed > 3) { stone.thrown = false; shared.onTargetHit?.(); shared.fx?.burst('spark', { x: other.body.x, y: other.body.y, z: 0.8 }); shared.fx?.kick(0.2, 0); }
    },
    onBump(prop, speed) {
      const s = sound.at(prop.body.x, prop.body.y, player.body);
      sound.play(prop.kind === 'ball' ? 'bounce' : 'thud', { volume: Math.min(0.7, speed / 14) * s.near, pan: s.pan });
      if (prop.kind === 'stone') { prop.thrown = false; shared.fx?.burst('dust', { x: prop.body.x, y: prop.body.y, count: 3 }); } // a stone that touched the ground or a wall no longer counts as a throw
    },
  });
  yard.add('ball', ...SPOTS.ball, { name: 'ball' });
  yard.add('target', ...SPOTS.target, { name: 'target' });
  yard.add('barrel', ...SPOTS.barrel, { name: 'barrel' });
  const home = yard.save();

  const nav = createNav(stage, player.body.r);
  let seconds = 0;

  /** Everything the player can use right now: [{ id, kind, x, y, reach, label }]. */
  function usable() {
    const list = [
      { id: 'guard', kind: 'talk', x: npc.body.x, y: npc.body.y, reach: 2.4, label: 'Talk to the guard' },
      { id: 'elder', kind: 'talk', x: elder.body.x, y: elder.body.y, reach: 2.2, label: 'Talk to Elder Maren' },
      { id: 'tobin', kind: 'talk', x: tobin.body.x, y: tobin.body.y, reach: 2.2, label: 'Talk to Tobin' },
      { id: SIDE_QUEST.giver.dialogue, kind: 'talk', x: extras[1].body.x, y: extras[1].body.y, reach: 2.0, label: 'Talk to the farmer' },
      { id: 'merchant', kind: 'shop', x: extras[0].body.x, y: extras[0].body.y, reach: 2.0, label: 'Trade with the merchant' },
      { id: 'hatch', kind: 'cellar', x: hatch.body.x, y: hatch.body.y, reach: 1.8, label: canEnterCellar(quest) ? 'Go down into the cellar' : (story.getVar('cellar_open') ? 'The cellar is in order' : 'The hatch is locked') },
    ];
    if (canGather(quest)) herbs.forEach((h, i) => { if (!quest.herbs[i]) list.push({ id: 'herb:' + i, kind: 'herb', index: i, x: h.body.x, y: h.body.y, reach: 1.5, label: 'Pick the moonleaf' }); });
    return list;
  }

  return {
    people, herbs, hatch, yard, nav, usable,
    /** The people who are not part of the quest: the ai engine gives them a day of their own (game/minds.js). */
    extras,
    get seconds() { return seconds; },
    /** The usable thing nearest the player and within its reach, or null. */
    nearest() {
      let best = null; let bestD = Infinity;
      for (const u of usable()) {
        const d = Math.hypot(u.x - player.body.x, u.y - player.body.y);
        if (d <= u.reach && d < bestD && u.label) { best = u; bestD = d; }
      }
      return best;
    },
    /** Where quest markers float: ground points of what the main quest wants next. */
    markers() {
      const out = [];
      const q = story.quest('supplies');
      const done = (id) => q.objectives.find((o) => o.id === id).done;
      if (q.status === 'inactive') out.push([npc.body.x, npc.body.y, 2.4]);
      else if (q.status === 'active') {
        if (!done('ask_elder')) out.push([elder.body.x, elder.body.y, 2.4]);
        if (canGather(quest)) herbs.forEach((h, i) => { if (!quest.herbs[i]) out.push([h.body.x, h.body.y, 1.1]); });
        if (canEnterCellar(quest)) out.push([hatch.body.x, hatch.body.y, 1.0]);
        if (done('herbs') && done('cellar')) out.push([npc.body.x, npc.body.y, 2.4]);
      }
      return out;
    },
    /** Once per update, after stage.update. */
    update(dt) {
      seconds += dt;
      yard.update(dt);
      const head = [player.body.x, player.body.y, stage.groundAt(player.body.x, player.body.y) + 1.6];
      for (const c of [elder, tobin, ...extras]) c.actor.lookAt(Math.hypot(player.body.x - c.body.x, player.body.y - c.body.y) < 7 ? head : null);
      const gather = canGather(quest);
      herbs.forEach((h, i) => { h.hidden = !gather || quest.herbs[i]; });
      npc.halt = story.view().active && story.view().dialogue === 'guard';
    },
    /** Plain data for a save slot. */
    save() {
      return { v: 1, mode: 'hamlet', events: shared.events.save(), shop: shared.shop.save(), sheet: shared.sheet.save(), sky: shared.sky.save(), weather: shared.weather.save(), items: shared.items.save(), quest: snapshot(quest), player: [+player.body.x.toFixed(2), +player.body.y.toFixed(2)], props: yard.save(), camera: { yaw: camera.target.yaw, zoom: camera.target.zoom }, seconds: Math.round(seconds) };
    },
    /** Start over, or continue from save() data. */
    reset(saved = null) {
      resetQuest(quest, saved && saved.quest);
      const at = saved && Array.isArray(saved.player) && saved.player.every(Number.isFinite) ? saved.player : SPOTS.start;
      collision.teleport(player.body, at[0], at[1]);
      collision.teleport(npc.body, npc.route[0][0], npc.route[0][1]);
      npc.leg = 0; npc.stuck = 0; npc.dodge = 0; npc.halt = false;
      if (player.actor.state === 'die') player.actor.revive();
      for (const prop of yard.loose.filter((p) => p.kind === 'stone')) yard.remove(prop);
      yard.load(home);
      if (saved) yard.load(saved.props);
      seconds = saved && Number.isFinite(saved.seconds) ? saved.seconds : 0;
      if (saved && saved.camera && Number.isFinite(saved.camera.yaw) && Number.isFinite(saved.camera.zoom)) camera.zoomTo(saved.camera.zoom).rotateTo(saved.camera.yaw);
      else camera.zoomTo(1).rotateTo(stage.orbit.yaws[0]);
      camera.snap();
    },
  };
}
