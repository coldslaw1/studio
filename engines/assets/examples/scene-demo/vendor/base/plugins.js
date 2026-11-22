// Plugins: how an engine joins a game. A plugin is a plain object that says what it is called,
// what it needs, and how to install itself. The base sorts plugins so each one is installed after
// the ones it needs, and stops with a clear message when one is missing.
//   { name: 'combat', requires: ['actors-kit'], uses: ['audio'], settings: [...], install(base) { ...; return api; } }

/**
 * checkPlugin(plugin) -> plugin   throws when the shape is wrong.
 *   name       required, unique in a game
 *   requires   names that must be installed first (missing: an error)
 *   uses       names it works with when they are there (installed first if present; fine if absent)
 *   settings   settings items it declares (see settings.js)
 *   actions    { actionName: [key codes] } default keys for input actions it reads; bound only when the game has not bound them
 *   install(base)   required. Hooks the engine in; what it returns is base.plugin(name).
 */
export function checkPlugin(plugin) {
  if (!plugin || typeof plugin !== 'object') throw new Error(`createBase: a plugin must be an object, got ${JSON.stringify(plugin)} (did you forget to call the plugin function, e.g. skyPlugin()?)`);
  if (typeof plugin === 'function') throw new Error('createBase: a plugin must be an object; call the plugin function, e.g. skyPlugin()');
  if (typeof plugin.name !== 'string' || !plugin.name) throw new Error(`createBase: a plugin needs a name, got ${JSON.stringify(plugin.name)}`);
  if (typeof plugin.install !== 'function') throw new Error(`createBase: plugin '${plugin.name}' needs an install(base) function`);
  for (const key of ['requires', 'uses', 'settings']) {
    if (plugin[key] !== undefined && !Array.isArray(plugin[key])) throw new Error(`createBase: plugin '${plugin.name}' ${key} must be an array, got ${JSON.stringify(plugin[key])}`);
  }
  return plugin;
}

/**
 * sortPlugins(plugins, installed = []) -> plugins in install order.
 * Throws on a duplicate name, a missing requirement, or a circle of requirements.
 */
export function sortPlugins(plugins, installed = []) {
  const byName = new Map();
  for (const p of plugins) {
    checkPlugin(p);
    if (byName.has(p.name) || installed.includes(p.name)) throw new Error(`createBase: plugin '${p.name}' is listed twice`);
    byName.set(p.name, p);
  }
  for (const p of plugins) {
    for (const need of p.requires ?? []) {
      if (!byName.has(need) && !installed.includes(need)) throw new Error(`createBase: plugin '${p.name}' requires '${need}', which is not in the plugins list (listed: ${[...installed, ...byName.keys()].join(', ')})`);
    }
  }
  const out = []; const state = new Map(); // 1 = being visited, 2 = done
  const visit = (p, trail) => {
    if (state.get(p.name) === 2) return;
    if (state.get(p.name) === 1) throw new Error(`createBase: plugins require each other in a circle: ${[...trail, p.name].join(' -> ')}`);
    state.set(p.name, 1);
    for (const need of [...(p.requires ?? []), ...(p.uses ?? [])]) if (byName.has(need)) visit(byName.get(need), [...trail, p.name]);
    state.set(p.name, 2);
    out.push(p);
  };
  for (const p of plugins) visit(p, []);
  return out;
}
