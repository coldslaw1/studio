// Names for input codes (core's codes: KeyboardEvent.code, 'pad:a', ...), used
// by the key rebinding rows and the control hints.

const NAMES = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Del',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', CapsLock: 'Caps', Minus: '-', Equal: '=', Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
  PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins',
  'pad:a': 'A', 'pad:b': 'B', 'pad:x': 'X', 'pad:y': 'Y', 'pad:lb': 'LB', 'pad:rb': 'RB', 'pad:lt': 'LT',
  'pad:rt': 'RT', 'pad:start': 'Start', 'pad:select': 'Select', 'pad:ls': 'L Stick', 'pad:rs': 'R Stick',
  'pad:up': 'D-pad ↑', 'pad:down': 'D-pad ↓', 'pad:left': 'D-pad ←', 'pad:right': 'D-pad →',
};

/** keyLabel('KeyW') -> 'W'. A short name for an input code, for showing to the player. */
export function keyLabel(code) {
  const c = String(code);
  if (NAMES[c]) return NAMES[c];
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad/.test(c)) return `Num ${c.slice(6)}`;
  return c;
}

/** isKeyboardCode(code) -> true for a keyboard key, false for pad:, swipe:, btn:, tap and pointer codes. */
export function isKeyboardCode(code) {
  return typeof code === 'string' && code !== '' && !code.includes(':') && code !== 'tap' && code !== 'pointer';
}

/** Keys the rebinding row never accepts: they would trap the player in or out of menus. */
export const RESERVED_KEYS = ['Escape', 'MetaLeft', 'MetaRight', 'ContextMenu'];

/**
 * hintParts(device, menu) -> the control hints for a menu as [{ key, text }], empty on touch and mouse.
 *   device: 'keyboard' | 'gamepad' | 'mouse' | 'touch'
 *   menu: { canCancel, adjust, grid } what the focused row can do
 */
export function hintParts(device, menu = {}) {
  if (device !== 'keyboard' && device !== 'gamepad') return [];
  const pad = device === 'gamepad';
  const parts = [{ key: pad ? 'D-pad' : (menu.grid ? '←↑↓→' : '↑↓'), text: 'Move' }];
  if (menu.adjust) parts.push({ key: '←→', text: 'Change' });
  else parts.push({ key: pad ? 'A' : 'Enter', text: 'Select' });
  if (menu.canCancel) parts.push({ key: pad ? 'B' : 'Esc', text: 'Back' });
  return parts;
}
