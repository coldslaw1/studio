// Word lists for names and quest text. Plain data: a game may pass its own lists to the generators.

/** First names for quest givers and recipients. */
export const PEOPLE_NAMES = ['Ann', 'Bram', 'Cora', 'Dunstan', 'Edda', 'Finn', 'Greta', 'Hob', 'Isolde', 'Jory', 'Kester', 'Linnet', 'Marn', 'Nell', 'Osric', 'Petra', 'Quill', 'Rowan', 'Sela', 'Tobin', 'Una', 'Wat'];

/** Things to fetch: [item id, singular, plural, where they are found]. */
export const FETCH_ITEMS = [
  ['moon_herb', 'moon herb', 'moon herbs', 'in the shade of old trees'],
  ['iron_ore', 'lump of iron ore', 'lumps of iron ore', 'among the rocks'],
  ['wolf_pelt', 'wolf pelt', 'wolf pelts', 'on the wolves of the wood'],
  ['red_cap', 'red cap mushroom', 'red cap mushrooms', 'in damp hollows'],
  ['old_coin', 'old coin', 'old coins', 'in the ruins'],
  ['candle', 'grave candle', 'grave candles', 'down in the dark'],
  ['feather', 'crow feather', 'crow feathers', 'under the tall pines'],
];

/** Things to deliver: [item id, name]. */
export const PARCELS = [['parcel', 'parcel'], ['letter', 'sealed letter'], ['medicine', 'bottle of medicine'], ['tools', 'bundle of tools'], ['bread', 'basket of bread']];

/** Creatures to hunt when no camp is given: [kind, singular, plural]. Kinds are ai archetypes. */
export const HUNT_KINDS = [['wolf', 'wolf', 'wolves'], ['boar', 'boar', 'boars'], ['rat', 'rat', 'rats'], ['goblin', 'goblin', 'goblins'], ['bandit', 'bandit', 'bandits'], ['skeleton', 'skeleton', 'skeletons'], ['slime', 'slime', 'slimes'], ['bat', 'bat', 'bats']];

/** Plurals of every ai mob kind, for quest text about a camp or a dungeon. */
export const PLURALS = { wolf: 'wolves', boar: 'boars', rat: 'rats', bat: 'bats', slime: 'slimes', goblin: 'goblins', orc: 'orcs', ogre: 'ogres', skeleton: 'skeletons', ghoul: 'ghouls', imp: 'imps', golem: 'golems', bandit: 'bandits', cultist: 'cultists' };

/** Lines the quest giver says. $-words are filled in by quests.js: $n $things $thing $place $to $item $coins. */
export const QUEST_LINES = {
  kill: {
    title: ['Thin the $things', 'Trouble with $things', 'The $things of $place'],
    offer: ['The $things at $place grow bolder every night. Put down $n of them and I will pay $coins coins.', 'We have lost too much to the $things at $place. Kill $n and there are $coins coins in it for you.', '$n $things. That is all I ask. You will find them at $place. $coins coins when it is done.'],
    waiting: ['Still $things about at $place. Come back when $n are dead.', 'Not done yet? They are at $place.'],
    done: ['You did it. We will sleep easier now. Here is your pay.', 'Word travels fast: the $things are gone. Take this, you earned it.'],
  },
  fetch: {
    title: ['$things for $giver', 'A need for $things', 'Gathering $things'],
    offer: ['I need $n $things. You find them $place. Bring them and I will pay $coins coins.', 'My stores are empty. $n $things would see me through. Look $place. $coins coins for your trouble.'],
    waiting: ['I still need $n $things. Look $place.', 'No $things yet? Try $place.'],
    done: ['Just what I needed. Here, $coins coins as promised.', 'Wonderful, that is all I asked for. Take your pay.'],
    offerOne: ['There is a $thing $place and I need it. Bring it to me and I will pay $coins coins.', 'I am told a $thing lies $place. Fetch it for me. $coins coins for your trouble.'],
    waitingOne: ['No $thing yet? It is $place.', 'I still need that $thing. Look $place.'],
  },
  deliver: {
    title: ['A $item for $to', 'Errand to $to', 'Carry it to $to'],
    offer: ['This $item must reach $to at $place, and I cannot leave. $to will pay you $coins coins on delivery.', 'Would you carry a $item to $to? You will find them at $place. There are $coins coins in it.'],
    waiting: ['$to is still waiting on that $item. Try $place.', 'The $item, remember? $to, at $place.'],
    done: ['$to got it? Good. Thank you.', 'I heard it arrived. You are worth knowing.'],
    handOver: ['From $giver? At last. Here, $coins coins for the road.', 'I have waited days for this $item. Thank you. Take this.'],
    stranger: ['Good day to you.', 'Mind how you go.'],
    after: ['Thank you again for the $item.', 'It arrived safe, thanks to you.'],
  },
  accepted: ['Good. Do not keep me waiting.', 'Thank you. Go carefully.', 'I knew I could count on you.'],
  thanks: ['Good to see you again.', 'We still talk about what you did.'],
};
