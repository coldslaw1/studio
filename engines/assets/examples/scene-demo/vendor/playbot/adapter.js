// The adapter is the only game-specific part: a small object that lets the
// bots drive a game's pure logic without a browser. See README.md.

const REQUIRED = ['create', 'actions', 'step', 'status'];
const STATUSES = new Set(['playing', 'won', 'lost']);

/**
 * normalizeAdapter(raw) -> adapter with every optional field filled in.
 * Throws an Error with a readable message when the adapter is unusable.
 */
export function normalizeAdapter(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('adapter must be an object (export default { ... })');
  }
  for (const name of REQUIRED) {
    if (typeof raw[name] !== 'function') {
      throw new Error(`adapter is missing the function "${name}"`);
    }
  }
  const adapter = {
    name: raw.name || 'game',
    endless: Boolean(raw.endless),
    deterministic: Boolean(raw.deterministic),
    maxSteps: Number.isInteger(raw.maxSteps) && raw.maxSteps > 0 ? raw.maxSteps : 2000,
    secondsPerStep: typeof raw.secondsPerStep === 'number' ? raw.secondsPerStep : null,
    bots: Array.isArray(raw.bots) ? raw.bots : null,
    levels: typeof raw.levels === 'function' ? () => raw.levels() : () => [{ id: 0, name: 'main' }],
    create: (opts) => raw.create(opts),
    actions: (state) => raw.actions(state),
    step: (state, action, rng) => {
      const next = raw.step(state, action, rng);
      return next === undefined ? state : next;
    },
    status: (state) => {
      const s = raw.status(state);
      if (!STATUSES.has(s)) {
        throw new Error(`adapter.status returned "${s}"; expected playing, won or lost`);
      }
      return s;
    },
    clone: typeof raw.clone === 'function' ? (state) => raw.clone(state) : (state) => structuredClone(state),
    progress: typeof raw.progress === 'function'
      ? (state) => Math.max(0, Math.min(1, Number(raw.progress(state)) || 0))
      : null,
    value: typeof raw.value === 'function' ? (state) => raw.value(state) : null,
    key: typeof raw.key === 'function' ? (state) => raw.key(state) : null,
    cause: typeof raw.cause === 'function' ? (state) => raw.cause(state) : null,
    score: typeof raw.score === 'function' ? (state) => raw.score(state) : null,
  };
  const levels = adapter.levels();
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error('adapter.levels() must return a non-empty array');
  }
  adapter.levels = () => levels.map((l, i) => (
    l && typeof l === 'object' ? { id: l.id ?? i, name: l.name ?? String(l.id ?? i) } : { id: l, name: String(l) }
  ));
  return adapter;
}

/** How good a state is for the player. Used by the thinking bots. */
export function stateValue(adapter, state) {
  if (adapter.value) return adapter.value(state);
  const status = adapter.status(state);
  if (status === 'won') return 2;
  if (status === 'lost') return -1;
  return adapter.progress ? adapter.progress(state) : 0;
}
