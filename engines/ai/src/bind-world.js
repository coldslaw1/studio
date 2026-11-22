// The world engine hook. The world engine decides which entities are in memory and how near each is
// to a player (its tiers: 0 active, 1 near, 2 far, dormant = not in memory). This link keeps one agent
// per entity that has an `ai` field, follows those tiers, and parks the agent's whole state on the
// entity when its chunk goes to sleep, so the world's save carries it.
//
//   const link = createWorldLink(ai);
//   const entities = createEntities({ world, update: link.update, catchUp: link.catchUp, toRecord: link.toRecord, spawn });
//   link.attach(entities);
//   spawn: add({ x, y, persist: true, ai: { kind: 'wolf' } })      // options for ai.add, without id, x, y
//   each step: entities.update(dt, focus); ai.step(dt);            // createAi({ autoTier: false })
import { need } from './util.js';
import { isAgent } from './agent.js';

/**
 * createWorldLink(ai, options) -> link
 *   idOf(entity) = 'e' + entity.id   the agent id for an entity
 * link: { attach(entities), update(entity, dt, tier), catchUp(entity, seconds), toRecord(entity), save(), load(data),
 *         agentOf(entity), entityOf(id), count }
 *   attach    listens to the entity store's 'wake', 'sleep' and 'tier' events
 *   update    pass as createEntities({ update }): copies the agent's position onto the entity
 *   catchUp   pass as createEntities({ catchUp }): replays the time the agent spent asleep
 *   toRecord  pass as createEntities({ toRecord }): the entity's save record with the agent's whole state in it
 * An agent that dies removes its entity from the store (entity.dead is set to true first).
 */
export function createWorldLink(ai, options = {}) {
  need(ai && typeof ai.adopt === 'function' && typeof ai.release === 'function', 'createWorldLink: first argument must be an ai from createAi');
  const idOf = options.idOf ?? ((e) => `e${e.id}`);
  const byId = new Map();
  let store = null; // the entity store given to attach()
  const tierOf = (t) => (t === 0 || t === 1 ? t : 2);

  function wake(e) {
    if (!e.ai || typeof e.ai !== 'object') return;
    const id = idOf(e);
    if (ai.has(id)) { byId.set(id, e); e.ai = { kind: ai.state.agents[id].kind }; return; } // already there (ai.load ran first): just follow it
    let agent;
    if (isAgent(e.ai)) { agent = e.ai; agent.id = id; agent.x = e.x; agent.y = e.y; ai.adopt(agent); } // coming back from sleep
    else agent = ai.add({ ...e.ai, id, x: e.x, y: e.y });
    agent.tier = tierOf(e._tier);
    e.ai = { kind: agent.kind }; // the live state is in the ai now; toRecord() puts it back into save records
    byId.set(id, e);
  }
  function sleep(e) {
    const id = idOf(e);
    if (!byId.has(id)) return;
    byId.delete(id);
    if (ai.has(id)) ai.release(id);
  }

  // a linked agent that dies takes its entity with it, so it does not come back when the chunk is next loaded
  ai.on('death', (ev) => {
    const e = byId.get(ev.id);
    if (!e) return;
    byId.delete(ev.id);
    e.ai = null; e.dead = true;
    if (store) store.remove(e);
  });

  const link = {
    get count() { return byId.size; },
    attach(entities) {
      need(entities && typeof entities.on === 'function', 'createWorldLink.attach: entities must come from the world engine\'s createEntities');
      store = entities;
      entities.on('wake', wake);
      entities.on('sleep', sleep);
      entities.on('tier', (e, tier) => { const id = idOf(e); if (ai.has(id)) ai.setTier(id, tierOf(tier)); });
      return link;
    },
    update(e, dt, tier) {
      const id = idOf(e);
      if (!byId.has(id)) return;
      if (!ai.has(id)) { byId.delete(id); return; } // the agent was removed by the game
      const a = ai.state.agents[id];
      if (a.tier !== tierOf(tier)) a.tier = tierOf(tier);
      e.x = a.x; e.y = a.y;
    },
    catchUp(e, seconds) {
      const id = idOf(e);
      if (!ai.has(id)) return;
      ai.catchUp(id, seconds);
      const a = ai.state.agents[id];
      e.x = a.x; e.y = a.y;
    },
    toRecord(e) {
      const rec = {};
      for (const k in e) if (k[0] !== '_' && typeof e[k] !== 'function') rec[k] = e[k];
      const id = idOf(e);
      if (byId.has(id) && ai.has(id)) rec.ai = structuredClone(ai.state.agents[id]);
      return rec;
    },
    /**
     * save() -> what the world's save does not carry: the ai's clock, faction standing, squads' losses and
     * any agents that are NOT tied to a world entity. Keep it next to the world's save.
     * load(data) puts it back; call it on a fresh ai BEFORE the world loads its chunks.
     */
    save() {
      const state = ai.toJSON();
      for (const id of byId.keys()) delete state.agents[id];
      for (const sq of Object.values(state.squads)) sq.members = sq.members.filter((m) => state.agents[m]);
      state.sounds = [];
      return state;
    },
    load(data) { ai.load(data); return link; },
    agentOf: (e) => (ai.has(idOf(e)) ? ai.state.agents[idOf(e)] : null),
    entityOf: (id) => byId.get(id) ?? null,
  };
  return link;
}
