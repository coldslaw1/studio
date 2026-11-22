// Menu contents for the inventory screens, as plain option objects for the ui
// kit's ui.open(). Pure: no drawing except the small rarity dot icon.

import { stackLabel, stackRarity, stackStats } from './stack.js';
import { buyPrice, shopMoney } from './shop.js';

/** Default words. Override any of them with createInventoryUi({ labels: { close: 'Done' } }). */
export const LABELS = {
  inventory: 'Inventory', coins: 'Coins', weight: 'Weight', empty: 'Nothing here', equipped: 'Equipped',
  sort: 'Sort', close: 'Close', back: 'Back', use: 'Use', equip: 'Equip', unequip: 'Take off',
  drop: 'Drop', dropOne: 'Drop one', discard: 'Throw away', split: 'Split stack', chest: 'Chest', bag: 'Your bag',
  takeAll: 'Take all', shop: 'Shop', sell: 'Sell items', crafting: 'Crafting', needs: 'Needs',
  mainHand: 'Main hand', offHand: 'Off hand', head: 'Head', body: 'Body', back_slot: 'Back',
};

/** Short messages for refusals. Override with createInventoryUi({ reasons: { full: 'Bag full!' } }). */
export const REASON_TEXT = {
  full: 'No room', 'too-heavy': 'Too heavy to carry', coins: 'Not enough coins', stock: 'Sold out',
  missing: 'Something is missing', station: 'Wrong crafting station', worthless: 'The shop will not buy that',
  'shop-coins': 'The shop cannot afford that', 'not-usable': 'That cannot be used', 'not-equippable': 'That cannot be worn',
  'no-slot': 'Nowhere to wear that', 'wrong-slot': 'That does not go there', 'not-accepted': 'That does not go in there',
  occupied: 'That slot is taken', empty: 'Nothing there', gone: 'It is gone', 'too-far': 'Too far away',
  'not-ready': 'Not yet', unavailable: 'Not possible here', 'bad-action': 'Not possible',
};

function rarityIcon(catalog, stack) {
  const def = catalog.get(stack.id);
  if (typeof def.icon === 'function' || typeof def.icon === 'string') return def.icon;
  const color = def.color ?? catalog.rarity(stackRarity(catalog, stack)).color;
  return (ctx, cx, cy, size) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
}

const slotLabel = (L, slot) => L[slot === 'back' ? 'back_slot' : slot] ?? slot;
const statLine = (stats) => Object.entries(stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ');
const stackButton = (catalog, id, stack, extra = '') => ({ id, label: stackLabel(catalog, stack) + extra, icon: rarityIcon(catalog, stack) });

function header(inv, L, money = null) {
  const lines = [{ type: 'text', id: 'coins', label: money && !money.coins ? money.name : L.coins, value: money ? money.balance : inv.coins }];
  if (inv.maxWeight !== null) lines.push({ type: 'text', id: 'weight', label: L.weight, value: `${round(inv.weight)} / ${inv.maxWeight}` });
  return lines;
}
const round = (v) => Math.round(v * 10) / 10;

/** bagScreen(inventory, L, o) -> ui.open options listing a bag and the equipment. Button ids: slot-<index>, equip-<slot>, sort, close. */
export function bagScreen(inv, L, o = {}) {
  const items = header(inv, L);
  const list = inv.list(o.bag);
  for (const e of list) items.push(stackButton(inv.catalog, `slot-${e.index}`, e));
  if (list.length === 0) items.push({ type: 'text', id: 'empty', label: L.empty });
  const worn = Object.entries(inv.equipment()).filter(([, s]) => s);
  if (worn.length) items.push({ type: 'text', id: 'equipped', label: L.equipped });
  for (const [slot, s] of worn) items.push({ ...stackButton(inv.catalog, `equip-${slot}`, s), label: `${slotLabel(L, slot)}: ${inv.catalog.get(s.id).name}` });
  if (list.length > 1) items.push({ id: 'sort', label: L.sort });
  items.push({ id: 'close', label: L.close, icon: 'close' });
  return { id: 'inventory', title: o.title ?? L.inventory, items };
}

/** itemScreen(inventory, L, ref, o) -> ui.open options for one stack. Button ids: use, equip, unequip, drop, drop-one, discard, split, back. */
export function itemScreen(inv, L, ref, o = {}) {
  const stack = inv.at(ref);
  const def = inv.catalog.get(stack.id);
  const rarity = inv.catalog.rarity(stackRarity(inv.catalog, stack));
  const stats = statLine(stackStats(inv.catalog, stack));
  const items = [];
  const worn = ref.equip !== undefined;
  if (def.use !== undefined) items.push({ id: 'use', label: L.use });
  if (worn) items.push({ id: 'unequip', label: L.unequip });
  else if (def.equip) items.push({ id: 'equip', label: L.equip });
  if (!worn && stack.n > 1) items.push({ id: 'split', label: L.split });
  if (o.canDrop) {
    items.push({ id: 'drop', label: L.drop });
    if (stack.n > 1) items.push({ id: 'drop-one', label: L.dropOne });
  } else if (o.canDiscard) items.push({ id: 'discard', label: L.discard, danger: true });
  items.push({ id: 'back', label: L.back, icon: 'back' });
  return {
    id: 'inventory-item', title: stackLabel(inv.catalog, stack),
    subtitle: [rarity.label ?? '', stats].filter(Boolean).join('  |  '), text: def.description, items,
  };
}

/** chestScreen(inventory, L, name, o) -> ui.open options for a chest next to the bag. Button ids: chest-<index>, bag-<index>, take-all, close. */
export function chestScreen(inv, L, name, o = {}) {
  const items = [{ type: 'text', id: 'chest-head', label: o.title ?? L.chest }];
  const inside = inv.list(name);
  for (const e of inside) items.push(stackButton(inv.catalog, `chest-${e.index}`, e));
  if (inside.length === 0) items.push({ type: 'text', id: 'chest-empty', label: L.empty });
  items.push({ type: 'text', id: 'bag-head', label: L.bag });
  for (const e of inv.list()) items.push(stackButton(inv.catalog, `bag-${e.index}`, e));
  if (inside.length > 0) items.push({ id: 'take-all', label: L.takeAll });
  items.push({ id: 'close', label: L.close, icon: 'close' });
  return { id: 'chest', title: o.title ?? L.chest, items };
}

/** shopScreen(inventory, L, shop, o) -> ui.open options for buying. Button ids: buy-<line>, sell, close. o.money: from shopMoney. */
export function shopScreen(inv, L, shop, o = {}) {
  const money = o.money ?? shopMoney(inv, shop);
  const items = header(inv, L, money);
  shop.stock.forEach((line, i) => {
    if (line.n === 0) return;
    const price = buyPrice(shop, inv.catalog, i);
    const count = line.n === null ? '' : ` (${line.n})`;
    items.push({ ...stackButton(inv.catalog, `buy-${i}`, { ...line, n: 1 }, `${count}  -  ${price}${money.symbol}`), disabled: money.balance < price });
  });
  items.push({ id: 'sell', label: L.sell });
  items.push({ id: 'close', label: L.close, icon: 'close' });
  return { id: 'shop', title: o.title ?? L.shop, items };
}

/** sellScreen(inventory, L, shop, o) -> ui.open options for selling from the bag. Button ids: sell-<index>, back. o.money: from shopMoney. */
export function sellScreen(inv, L, shop, o = {}) {
  const money = o.money ?? shopMoney(inv, shop);
  const items = header(inv, L, money);
  for (const e of inv.list()) {
    const each = money.sellPrice(e);
    items.push({ ...stackButton(inv.catalog, `sell-${e.index}`, e, each > 0 ? `  -  +${each}${money.symbol} each` : ''), disabled: each <= 0 });
  }
  items.push({ id: 'back', label: L.back, icon: 'back' });
  return { id: 'shop-sell', title: o.title ?? L.sell, items };
}

/** craftScreen(inventory, L, crafting, o) -> ui.open options listing recipes. Button ids: craft-<recipe id>, close. */
export function craftScreen(inv, L, crafting, o = {}) {
  const items = [];
  const name = (m) => (m.coins ? L.coins : (m.tag ?? inv.catalog.get(m.item ?? m.tool).name));
  for (const r of crafting.list(inv, { station: o.station })) {
    const made = r.recipe.outputs[0];
    const label = made.n > 1 ? `${r.name} x${made.n}` : r.name;
    items.push({ id: `craft-${r.id}`, label, disabled: !r.ok, icon: rarityIcon(inv.catalog, { id: made.item, n: 1, data: made.data }) });
    if (!r.ok) items.push({ type: 'text', id: `needs-${r.id}`, label: `${L.needs}: ${r.missing.map((m) => `${name(m)} ${m.have}/${m.need}`).join(', ')}` });
  }
  if (items.length === 0) items.push({ type: 'text', id: 'empty', label: L.empty });
  items.push({ id: 'close', label: L.close, icon: 'close' });
  return { id: 'crafting', title: o.title ?? L.crafting, items };
}
