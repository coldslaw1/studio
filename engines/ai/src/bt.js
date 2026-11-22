// Behaviour trees as plain data. A tree is compiled once (names checked, nodes numbered); what a tree
// is in the middle of lives in a small plain object per agent, so it saves and loads with the agent.
//
// Node forms (JSON):
//   'name'                          an action, or a condition when no action has that name
//   { do: 'name', ...args }         action: (ctx, agent, args, mem) => 'ok' | 'fail' | 'run' (true / false also work)
//   { if: 'name', ...args }         condition: (ctx, agent, args) => true | false
//   { seq: [nodes] }                run in order; fails as soon as one fails; remembers where it was
//   { sel: [nodes] }                first child that does not fail; checked again from the top every tick
//   { par: [nodes], need: 'all' }   tick every child; 'all' (default) or 'any' must succeed
//   { not: node }                   swap ok and fail
//   { wait: 2 } or { wait: [1, 3] } seconds, the range picks a seeded random time
//   { cooldown: 5, then: node }     fails while the last success is less than 5 seconds old
//   { repeat: 3, then: node }       run the child that many times ('forever' never ends)
//   { chance: 0.3, then: node }     run the child with that probability (seeded), else fail
//   { while: 'name', then: node }   run the child, but fail the moment the condition is false
//   { timeout: 4, then: node }      fail when the child is still running after 4 seconds
//   { always: 'ok', then: node }    run the child and report 'ok' (or 'fail') whatever it says when done
import { need } from './util.js';
import { roll } from './rng.js';

const KEYS = ['do', 'if', 'seq', 'sel', 'par', 'not', 'wait', 'cooldown', 'repeat', 'chance', 'while', 'timeout', 'always'];

/**
 * compileTree(def, registry, where) -> tree. registry: { actions: { name: fn }, conditions: { name: fn } }.
 * Throws with the path of the bad node when a name is unknown or a node is malformed.
 */
export function compileTree(def, registry, where = 'compileTree') {
  const { actions = {}, conditions = {} } = registry || {};
  let next = 0;
  const build = (d, path) => {
    const node = { id: next++, end: 0, kind: '', kids: [], args: null, fn: null, value: null };
    if (typeof d === 'string') d = actions[d] ? { do: d } : { if: d };
    need(d && typeof d === 'object' && !Array.isArray(d), `${where}: ${path} is not a node: ${JSON.stringify(d)}`);
    const kinds = KEYS.filter((k) => k in d);
    need(kinds.length === 1, `${where}: ${path} must have exactly one of ${KEYS.join(', ')}; got ${JSON.stringify(Object.keys(d))}`);
    const kind = node.kind = kinds[0];
    if (kind === 'do' || kind === 'if' || kind === 'while') {
      const table = kind === 'do' ? actions : conditions;
      need(typeof table[d[kind]] === 'function', `${where}: ${path} names the unknown ${kind === 'do' ? 'action' : 'condition'} "${String(d[kind])}". Known: ${Object.keys(table).sort().join(', ')}`);
      node.fn = table[d[kind]]; node.value = d[kind]; node.args = d;
    } else if (kind === 'seq' || kind === 'sel' || kind === 'par') {
      need(Array.isArray(d[kind]) && d[kind].length > 0, `${where}: ${path}.${kind} must be a non-empty list of nodes`);
      node.kids = d[kind].map((c, i) => build(c, `${path}.${kind}[${i}]`));
      node.value = d.need === 'any' ? 'any' : 'all';
    } else if (kind === 'wait') {
      const w = d.wait;
      need(w >= 0 || (Array.isArray(w) && w.length === 2 && w[0] >= 0 && w[1] >= w[0]), `${where}: ${path}.wait must be seconds or [min, max], got ${JSON.stringify(w)}`);
      node.value = w;
    } else {
      node.value = d[kind];
      if (kind === 'cooldown' || kind === 'timeout') need(d[kind] >= 0, `${where}: ${path}.${kind} must be seconds >= 0, got ${String(d[kind])}`);
      if (kind === 'repeat') need(d.repeat === 'forever' || (Number.isInteger(d.repeat) && d.repeat > 0), `${where}: ${path}.repeat must be a whole number above 0 or 'forever'`);
      if (kind === 'chance') need(d.chance >= 0 && d.chance <= 1, `${where}: ${path}.chance must be 0..1, got ${String(d.chance)}`);
      if (kind === 'always') need(d.always === 'ok' || d.always === 'fail', `${where}: ${path}.always must be 'ok' or 'fail'`);
    }
    if (kind === 'not') node.kids = [build(d.not, `${path}.not`)];
    else if ('then' in d || ['cooldown', 'repeat', 'chance', 'while', 'timeout', 'always'].includes(kind)) {
      need(d.then !== undefined, `${where}: ${path} (${kind}) needs a "then" node`);
      node.kids = [build(d.then, `${path}.then`)];
    }
    node.end = next - 1;
    return node;
  };
  const root = build(def, 'tree');
  return { root, size: next };
}

function clear(mem, node) {
  for (let i = node.id; i <= node.end; i++) if (i in mem) delete mem[i];
}

const norm = (r) => (r === true || r === 'ok' ? 'ok' : r === 'run' ? 'run' : 'fail');

function tick(node, env) {
  const { mem } = env;
  const kid = node.kids[0];
  switch (node.kind) {
    case 'do': {
      if (!(node.id in mem)) mem[node.id] = {};
      const s = norm(node.fn(env.ctx, env.agent, node.args, mem[node.id]));
      if (s !== 'run') delete mem[node.id];
      return s;
    }
    case 'if': return node.fn(env.ctx, env.agent, node.args) ? 'ok' : 'fail';
    case 'seq': {
      for (let i = mem[node.id] ?? 0; i < node.kids.length; i++) {
        const s = tick(node.kids[i], env);
        if (s === 'run') { mem[node.id] = i; return 'run'; }
        if (s === 'fail') { clear(mem, node); return 'fail'; }
      }
      clear(mem, node);
      return 'ok';
    }
    case 'sel': {
      const was = mem[node.id];
      for (let i = 0; i < node.kids.length; i++) {
        const s = tick(node.kids[i], env);
        if (s === 'fail') continue;
        if (was !== undefined && was !== i) clear(mem, node.kids[was]);
        if (s === 'run') mem[node.id] = i; else delete mem[node.id];
        return s;
      }
      clear(mem, node);
      return 'fail';
    }
    case 'par': {
      let ok = 0; let fail = 0;
      for (const k of node.kids) { const s = tick(k, env); if (s === 'ok') ok++; else if (s === 'fail') fail++; }
      const any = node.value === 'any';
      if (any ? ok > 0 : ok === node.kids.length) { clear(mem, node); return 'ok'; }
      if (any ? fail === node.kids.length : fail > 0) { clear(mem, node); return 'fail'; }
      return 'run';
    }
    case 'not': { const s = tick(kid, env); return s === 'run' ? 'run' : s === 'ok' ? 'fail' : 'ok'; }
    case 'wait': {
      if (!(node.id in mem)) mem[node.id] = Array.isArray(node.value) ? node.value[0] + roll(env.agent) * (node.value[1] - node.value[0]) : node.value;
      mem[node.id] -= env.dt;
      if (mem[node.id] > 0) return 'run';
      delete mem[node.id];
      return 'ok';
    }
    case 'cooldown': {
      const m = mem[node.id] || (mem[node.id] = { ready: 0, on: false });
      if (!m.on && env.time < m.ready) return 'fail';
      const s = tick(kid, env);
      m.on = s === 'run';
      if (s === 'ok') m.ready = env.time + node.value;
      return s;
    }
    case 'repeat': {
      const s = tick(kid, env);
      if (s === 'fail') { clear(mem, node); return 'fail'; }
      if (s === 'run' || node.value === 'forever') return 'run';
      mem[node.id] = (mem[node.id] ?? 0) + 1;
      if (mem[node.id] < node.value) return 'run';
      clear(mem, node);
      return 'ok';
    }
    case 'chance': {
      if (!(node.id in mem)) mem[node.id] = roll(env.agent) < node.value;
      if (!mem[node.id]) { delete mem[node.id]; return 'fail'; }
      const s = tick(kid, env);
      if (s !== 'run') delete mem[node.id];
      return s;
    }
    case 'while': {
      if (!node.fn(env.ctx, env.agent, node.args)) { clear(mem, node); return 'fail'; }
      return tick(kid, env);
    }
    case 'timeout': {
      mem[node.id] = (mem[node.id] ?? 0) + env.dt;
      if (mem[node.id] > node.value) { clear(mem, node); return 'fail'; }
      const s = tick(kid, env);
      if (s !== 'run') delete mem[node.id];
      return s;
    }
    case 'always': { const s = tick(kid, env); return s === 'run' ? 'run' : node.value; }
    default: throw new Error(`tickTree: unknown node kind "${node.kind}"`);
  }
}

/**
 * tickTree(tree, env) -> 'ok' | 'fail' | 'run'
 *   env: { ctx, agent, mem, dt, time }. `mem` is the plain object that remembers running nodes (keep one
 *   per agent per tree, empty it with resetTree when the agent switches trees). `agent` needs integer
 *   `seed` and `n` fields for the seeded nodes (wait ranges and chance).
 */
export function tickTree(tree, env) {
  return tick(tree.root, env);
}

/** resetTree(mem) empties a tree memory object in place. */
export function resetTree(mem) {
  for (const k of Object.keys(mem)) delete mem[k];
}
