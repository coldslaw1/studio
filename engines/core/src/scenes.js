// Scene stack. A scene is a plain object with optional hooks:
//   enter(params)  the scene becomes active for the first time
//   exit()         the scene is removed
//   pause()        another scene was pushed on top
//   resume(result) the scene on top was popped; result is what pop() was given
//   update(dt)     only the TOP scene is updated
//   draw(ctx)      every scene on the stack is drawn, bottom first
// Set `opaque: true` on a scene to stop the scenes under it from being drawn.

/**
 * createScenes(shared) -> scenes
 * shared: any object. It is handed to scene factories, e.g. { input, saves }.
 * scenes:
 *   add(name, sceneOrFactory)  register. A factory is (shared, scenes) => scene and
 *                              runs each time the scene is entered (fresh state).
 *   go(name, params)           replace the whole stack with one scene
 *   push(name, params)         put a scene on top (pause menu, dialog)
 *   pop(result)                remove the top scene, resume the one under it
 *   update(dt), draw(ctx)      call these from the loop
 *   current                    name of the top scene, or null
 *   top                        the top scene object, or null
 *   depth                      number of scenes on the stack
 * go/push/pop called from inside update() take effect after that update ends.
 */
export function createScenes(shared = {}) {
  const defs = new Map();
  const stack = []; // { name, scene }
  const queue = [];
  let updating = false;

  function build(name, fnName) {
    if (!defs.has(name)) {
      throw new Error(`scenes.${fnName}: unknown scene "${name}". Known: ${[...defs.keys()].join(', ') || '(none)'}`);
    }
    const def = defs.get(name);
    const scene = typeof def === 'function' ? def(shared, scenes) : def;
    if (!scene || typeof scene !== 'object') {
      throw new Error(`scenes.${fnName}: factory for "${name}" did not return a scene object`);
    }
    return { name, scene };
  }

  function run(op) {
    if (op.type === 'go') {
      const entry = build(op.name, 'go');
      while (stack.length) stack.pop().scene.exit?.();
      stack.push(entry);
      entry.scene.enter?.(op.params);
    } else if (op.type === 'push') {
      const entry = build(op.name, 'push');
      stack[stack.length - 1]?.scene.pause?.();
      stack.push(entry);
      entry.scene.enter?.(op.params);
    } else {
      if (stack.length === 0) throw new Error('scenes.pop: the stack is empty');
      stack.pop().scene.exit?.();
      stack[stack.length - 1]?.scene.resume?.(op.result);
    }
  }

  function request(op) {
    if (op.name !== undefined && !defs.has(op.name)) build(op.name, op.type); // throws now, not later
    if (updating) queue.push(op);
    else run(op);
  }

  const scenes = {
    add(name, sceneOrFactory) {
      if (typeof name !== 'string' || !name) throw new Error('scenes.add: name must be a non-empty string');
      const t = typeof sceneOrFactory;
      if (!sceneOrFactory || (t !== 'object' && t !== 'function')) {
        throw new Error(`scenes.add: "${name}" must be a scene object or a factory function`);
      }
      defs.set(name, sceneOrFactory);
      return scenes;
    },
    go(name, params) { request({ type: 'go', name, params }); },
    push(name, params) { request({ type: 'push', name, params }); },
    pop(result) { request({ type: 'pop', result }); },
    update(dt) {
      const top = stack[stack.length - 1];
      updating = true;
      try {
        top?.scene.update?.(dt);
      } finally {
        updating = false;
      }
      while (queue.length) run(queue.shift());
    },
    draw(ctx) {
      let first = stack.length - 1;
      while (first > 0 && !stack[first].scene.opaque) first--;
      for (let i = Math.max(first, 0); i < stack.length; i++) stack[i].scene.draw?.(ctx);
    },
    get current() { return stack.length ? stack[stack.length - 1].name : null; },
    get top() { return stack.length ? stack[stack.length - 1].scene : null; },
    get depth() { return stack.length; },
    get names() { return stack.map((e) => e.name); },
  };
  return scenes;
}
