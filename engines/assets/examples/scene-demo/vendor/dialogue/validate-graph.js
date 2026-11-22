// Graph checks for one dialogue: missing targets are found in validate.js;
// this file finds unreachable nodes, loops with no way out, and branch loops.

import { isObject } from './spec.js';

/** List the node ids a node can lead to. */
export function targetsOf(node) {
  const targets = [];
  if (!isObject(node)) return targets;
  if (typeof node.goto === 'string') targets.push(node.goto);
  for (const list of [node.choices, node.branch]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (isObject(entry) && typeof entry.goto === 'string') targets.push(entry.goto);
  }
  return targets;
}

function canEndHere(node) {
  if (!isObject(node)) return false;
  if (node.end === true) return true;
  return Array.isArray(node.choices) && node.choices.some((c) => isObject(c) && c.end === true);
}

/**
 * Check how the nodes of one dialogue connect.
 * @param {object} ctx validation context from createContext()
 * @param {string} dialogueId id of the dialogue, used in paths
 * @param {object} dialogue the dialogue object ({ start, nodes })
 */
export function checkGraph(ctx, dialogueId, dialogue) {
  const nodes = dialogue.nodes;
  const base = `dialogues.${dialogueId}.nodes`;
  if (!Object.hasOwn(nodes, dialogue.start)) return; // already reported

  // 1. Everything must be reachable from the start node.
  const reachable = new Set([dialogue.start]);
  const queue = [dialogue.start];
  while (queue.length > 0) {
    for (const target of targetsOf(nodes[queue.shift()])) {
      if (Object.hasOwn(nodes, target) && !reachable.has(target)) { reachable.add(target); queue.push(target); }
    }
  }
  for (const id of Object.keys(nodes)) {
    if (!reachable.has(id)) {
      ctx.error('unreachable-node', `${base}.${id}`,
        `Node "${id}" can never be reached from the start node "${dialogue.start}". Link to it with a "goto" or delete it.`);
    }
  }

  // 2. From every node the player must be able to reach an ending.
  const canFinish = new Set(Object.keys(nodes).filter((id) => canEndHere(nodes[id])));
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of Object.keys(nodes)) {
      if (!canFinish.has(id) && targetsOf(nodes[id]).some((t) => canFinish.has(t))) { canFinish.add(id); grew = true; }
    }
  }
  for (const id of reachable) {
    const hasWayOn = targetsOf(nodes[id]).length > 0 || canEndHere(nodes[id]);
    if (hasWayOn && !canFinish.has(id)) {
      ctx.error('no-ending', `${base}.${id}`,
        `No path from node "${id}" ever reaches an ending. Add "end": true to a node or choice so the conversation can finish.`);
    }
  }

  // 3. Branch nodes show no text, so a loop made only of them would spin forever.
  const isBranch = (id) => isObject(nodes[id]) && Array.isArray(nodes[id].branch);
  const state = {}; // 1 = on the current walk, 2 = finished
  const walk = (id) => {
    state[id] = 1;
    for (const target of targetsOf(nodes[id])) {
      if (!Object.hasOwn(nodes, target) || !isBranch(target)) continue;
      if (state[target] === 1) {
        ctx.error('branch-loop', `${base}.${id}`,
          `Branch nodes "${id}" and "${target}" loop into each other without ever showing a line. Put a text node in the loop.`);
      } else if (!state[target]) walk(target);
    }
    state[id] = 2;
  };
  for (const id of Object.keys(nodes)) if (isBranch(id) && !state[id]) walk(id);
}
