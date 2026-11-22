// procgen as a plugin of the base engine (studio-engines/base). The plugin keeps the world seed,
// remembers which places and quests were made (only their options: everything is rebuilt from
// the seed on load), and remembers what the player changed in them: chests emptied, doors
// unlocked, creatures killed. It imports nothing but its own engine.
import { generateDungeon, generateInterior, generateCamp, generateQuest, createQuestTracker, mergeStory, createPoiKinds, campAt, toAiAgents, toTileMap, toKilnScene, seedOf } from './index.js';

const MAKERS = { dungeon: generateDungeon, interior: generateInterior, camp: generateCamp };
const need = (ok, message) => { if (!ok) throw new Error(message); };

/**
 * procgenPlugin(options) -> plugin for createBase({ plugins: [...] })
 *   options.seed    the world seed. Default: the base's gameId.
 *   options.level   default level of everything made, 1..10. Default 1.
 * base.plugin('procgen'):
 *   seed
 *   dungeon(options), interior(options), camp(options)   as generateDungeon / generateInterior / generateCamp.
 *        Without a seed, each call takes the next seed of the world ('dungeon' 0, 1, 2 ...). Give
 *        `key` (any string, e.g. the POI's 'tx,ty') to get the same place for the same key every time.
 *   quest(options)      as generateQuest; also adds it to `tracker`
 *   get(id)             a place made earlier (rebuilt from its options after a load); throws when unknown
 *   places(), quests(), tracker
 *   story(base)         mergeStory(base, ...quests()) for the dialogue engine
 *   poiKinds(options), campAt(site, options)   for the world engine
 *   agents(id, options) toAiAgents of a place, without the creatures marked dead
 *   tileMap(id, options)   toTileMap with the doors the player unlocked
 *   scene(id, options)  toKilnScene in the game's current style and detail
 *   enter(id), leave(), current     which place the player is in ('procgen:entered', 'procgen:left')
 *   loot(id) / isLooted(id), unlock(doorId) / isUnlocked(doorId), kill(spawnId) / isDead(spawnId)
 *   populate(id, options)   puts the living creatures and people of a place into base.actors; returns them
 *   save(), load(data)
 * Bus events: 'procgen:made' { kind, id }, 'procgen:quest' { id }, 'procgen:entered' { id }, 'procgen:left' { id },
 *   'procgen:looted' { id }, 'procgen:unlocked' { id }, 'procgen:killed' { id }.
 */
export function procgenPlugin(options = {}) {
  return {
    name: 'procgen',
    requires: [],
    uses: ['world', 'ai', 'dialogue', 'inventory', 'assets'],
    settings: [],
    install(base) {
      let state = fresh(options.seed ?? base.gameId ?? 'game');
      let cache = new Map(); let tracker = createQuestTracker(); let questCache = [];
      let style = null; let detail = 2;
      base.style.watch((tokens) => { style = tokens?.kiln ?? null; });
      base.settings.watch('detail', () => { detail = base.detail ?? 2; });

      function fresh(seed) { return { seed, counts: {}, places: {}, quests: [], looted: {}, unlocked: {}, dead: {}, current: null }; }
      const build = (record) => MAKERS[record.kind](record.options);
      function make(kind, given = {}) {
        const { key, ...rest } = given;
        const opts = { level: options.level ?? 1, ...rest };
        if (opts.seed === undefined) {
          if (key !== undefined) opts.seed = seedOf(state.seed, kind, 'key', key);
          else { opts.seed = seedOf(state.seed, kind, state.counts[kind] ?? 0); state.counts[kind] = (state.counts[kind] ?? 0) + 1; }
        }
        try { JSON.stringify(opts); } catch (e) { throw new Error(`procgen.${kind}: options must be plain JSON data so they can be saved (${e.message})`); }
        const place = build({ kind, options: opts });
        if (!state.places[place.id]) { state.places[place.id] = { kind, options: JSON.parse(JSON.stringify(opts)) }; base.bus.emit('procgen:made', { kind, id: place.id }); }
        cache.set(place.id, place);
        return place;
      }
      function get(id) {
        if (cache.has(id)) return cache.get(id);
        need(state.places[id], `procgen.get: no place '${id}' (made: ${Object.keys(state.places).join(', ') || 'none'})`);
        const place = build(state.places[id]);
        cache.set(id, place);
        return place;
      }
      const mark = (table, event) => (id) => {
        need(typeof id === 'string' && id, `procgen: ${event} needs an id string, got ${JSON.stringify(id)}`);
        if (state[table][id]) return false;
        state[table][id] = true; base.bus.emit(`procgen:${event}`, { id });
        return true;
      };
      const api = {
        get seed() { return state.seed; },
        dungeon: (o) => make('dungeon', o), interior: (o) => make('interior', o), camp: (o) => make('camp', o),
        quest(o = {}) {
          const opts = { level: options.level ?? 1, ...o };
          if (opts.seed === undefined) { opts.seed = seedOf(state.seed, 'quest', state.counts.quest ?? 0); state.counts.quest = (state.counts.quest ?? 0) + 1; }
          const quest = generateQuest(opts);
          need(!questCache.some((q) => q.id === quest.id), `procgen.quest: quest '${quest.id}' was already made; pass another seed`);
          // camps and dungeons are saved by id, not copied
          state.quests.push({ ...opts, camp: opts.camp?.id, dungeon: opts.dungeon?.id });
          questCache.push(quest); tracker.add(quest);
          base.bus.emit('procgen:quest', { id: quest.id });
          return quest;
        },
        get, places: () => Object.keys(state.places), quests: () => questCache.slice(),
        get tracker() { return tracker; },
        story: (storyBase) => mergeStory(storyBase, ...questCache),
        poiKinds: (o) => createPoiKinds({ level: options.level, ...o }),
        campAt: (site, o) => campAt(site, { level: options.level, ...o }),
        agents: (id, o) => toAiAgents(get(id), o).filter((a) => !state.dead[a.id]),
        tileMap: (id, o) => toTileMap(get(id), { ...o, unlocked: Object.keys(state.unlocked) }),
        scene: (id, o) => toKilnScene(get(id), { ...(style ? { style } : {}), detail, ...o }),
        enter(id) { get(id); if (state.current === id) return; if (state.current) api.leave(); state.current = id; base.bus.emit('procgen:entered', { id }); },
        leave() { const id = state.current; if (!id) return; state.current = null; base.bus.emit('procgen:left', { id }); },
        get current() { return state.current; },
        loot: mark('looted', 'looted'), isLooted: (id) => !!state.looted[id],
        unlock: mark('unlocked', 'unlocked'), isUnlocked: (id) => !!state.unlocked[id],
        kill: mark('dead', 'killed'), isDead: (id) => !!state.dead[id],
        populate(id, o) {
          return api.agents(id, o).map((a) => (base.actors.get?.(a.id) ? base.actors.get(a.id) : base.actors.add({ id: a.id, x: a.x, y: a.y, z: 0, radius: 0.35 * (a.size ?? 1), kind: a.kind, procgen: id, ai: a })));
        },
        save: () => JSON.parse(JSON.stringify(state)),
        load(data) {
          need(data && typeof data === 'object' && data.places && Array.isArray(data.quests), `procgen.load: expected data from save(), got ${JSON.stringify(data)?.slice(0, 80)}`);
          state = { ...fresh(data.seed), ...JSON.parse(JSON.stringify(data)) };
          cache = new Map(); tracker = createQuestTracker(); questCache = [];
          for (const q of state.quests) {
            const quest = generateQuest({ ...q, camp: q.camp ? get(q.camp) : undefined, dungeon: q.dungeon ? get(q.dungeon) : undefined });
            questCache.push(quest); tracker.add(quest);
          }
        },
      };
      return api;
    },
  };
}
