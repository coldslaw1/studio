// The story format in one place. The validator and the runtime both read
// these lists, so the two can never disagree about what is allowed.

export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const TEXT_VAR_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const STORY_KEYS = ['id', 'title', 'vars', 'events', 'dialogues', 'quests'];
export const DIALOGUE_KEYS = ['start', 'nodes'];
export const LINE_NODE_KEYS = ['speaker', 'text', 'choices', 'goto', 'end', 'do'];
export const BRANCH_NODE_KEYS = ['branch', 'do'];
export const BRANCH_ENTRY_KEYS = ['if', 'goto'];
export const CHOICE_KEYS = ['text', 'goto', 'end', 'if', 'once', 'do'];
export const QUEST_KEYS = ['title', 'description', 'objectives', 'rewards'];
export const OBJECTIVE_KEYS = ['id', 'text', 'count', 'optional'];

// A condition has exactly one of these "kind" keys.
export const CONDITION_KINDS = ['var', 'quest', 'objectiveDone', 'visited', 'all', 'any', 'not'];
export const COMPARE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
export const NUMBER_ONLY_OPS = ['gt', 'gte', 'lt', 'lte'];
export const QUEST_STATUSES = ['inactive', 'active', 'done', 'failed'];

// An effect has exactly one of these "kind" keys.
export const EFFECT_KINDS = ['set', 'add', 'startQuest', 'progress', 'failQuest', 'emit'];
export const EFFECT_EXTRA_KEYS = { set: ['to'], add: ['by'], startQuest: [], progress: ['by'], failQuest: [], emit: [] };

// Soft limits. Going over them is a warning, not an error.
export const LIMITS = { textLength: 300, choiceTextLength: 80, choicesPerNode: 5 };

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
