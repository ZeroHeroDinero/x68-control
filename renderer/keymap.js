// X68 HE physical layout and key naming.
// pos = matrix slot used by the keyboard (column * 6 + row).
// x / w are in key units (1u = one normal key). Rows 0..4 top to bottom.

export const LAYOUT = [
  // row 0
  { pos: 1, hid: 41, label: 'Esc', x: 0, y: 0 },
  { pos: 7, hid: 30, label: '1', x: 1, y: 0 },
  { pos: 13, hid: 31, label: '2', x: 2, y: 0 },
  { pos: 19, hid: 32, label: '3', x: 3, y: 0 },
  { pos: 25, hid: 33, label: '4', x: 4, y: 0 },
  { pos: 31, hid: 34, label: '5', x: 5, y: 0 },
  { pos: 37, hid: 35, label: '6', x: 6, y: 0 },
  { pos: 43, hid: 36, label: '7', x: 7, y: 0 },
  { pos: 49, hid: 37, label: '8', x: 8, y: 0 },
  { pos: 55, hid: 38, label: '9', x: 9, y: 0 },
  { pos: 61, hid: 39, label: '0', x: 10, y: 0 },
  { pos: 67, hid: 45, label: '-', x: 11, y: 0 },
  { pos: 73, hid: 46, label: '=', x: 12, y: 0 },
  { pos: 79, hid: 42, label: 'Backspace', x: 13, y: 0, w: 2 },
  { pos: 85, hid: 76, label: 'Del', x: 15.25, y: 0 },
  // row 1
  { pos: 2, hid: 43, label: 'Tab', x: 0, y: 1, w: 1.5 },
  { pos: 8, hid: 20, label: 'Q', x: 1.5, y: 1 },
  { pos: 14, hid: 26, label: 'W', x: 2.5, y: 1 },
  { pos: 20, hid: 8, label: 'E', x: 3.5, y: 1 },
  { pos: 26, hid: 21, label: 'R', x: 4.5, y: 1 },
  { pos: 32, hid: 23, label: 'T', x: 5.5, y: 1 },
  { pos: 38, hid: 28, label: 'Y', x: 6.5, y: 1 },
  { pos: 44, hid: 24, label: 'U', x: 7.5, y: 1 },
  { pos: 50, hid: 12, label: 'I', x: 8.5, y: 1 },
  { pos: 56, hid: 18, label: 'O', x: 9.5, y: 1 },
  { pos: 62, hid: 19, label: 'P', x: 10.5, y: 1 },
  { pos: 68, hid: 47, label: '[', x: 11.5, y: 1 },
  { pos: 74, hid: 48, label: ']', x: 12.5, y: 1 },
  { pos: 80, hid: 49, label: '\\', x: 13.5, y: 1, w: 1.5 },
  { pos: 86, hid: 75, label: 'PgUp', x: 15.25, y: 1 },
  // row 2
  { pos: 3, hid: 57, label: 'Caps', x: 0, y: 2, w: 1.75 },
  { pos: 9, hid: 4, label: 'A', x: 1.75, y: 2 },
  { pos: 15, hid: 22, label: 'S', x: 2.75, y: 2 },
  { pos: 21, hid: 7, label: 'D', x: 3.75, y: 2 },
  { pos: 27, hid: 9, label: 'F', x: 4.75, y: 2 },
  { pos: 33, hid: 10, label: 'G', x: 5.75, y: 2 },
  { pos: 39, hid: 11, label: 'H', x: 6.75, y: 2 },
  { pos: 45, hid: 13, label: 'J', x: 7.75, y: 2 },
  { pos: 51, hid: 14, label: 'K', x: 8.75, y: 2 },
  { pos: 57, hid: 15, label: 'L', x: 9.75, y: 2 },
  { pos: 63, hid: 51, label: ';', x: 10.75, y: 2 },
  { pos: 69, hid: 52, label: "'", x: 11.75, y: 2 },
  { pos: 81, hid: 40, label: 'Enter', x: 12.75, y: 2, w: 2.25 },
  { pos: 87, hid: 78, label: 'PgDn', x: 15.25, y: 2 },
  // row 3
  { pos: 4, hid: 225, label: 'Shift', x: 0, y: 3, w: 2.25 },
  { pos: 16, hid: 29, label: 'Z', x: 2.25, y: 3 },
  { pos: 22, hid: 27, label: 'X', x: 3.25, y: 3 },
  { pos: 28, hid: 6, label: 'C', x: 4.25, y: 3 },
  { pos: 34, hid: 25, label: 'V', x: 5.25, y: 3 },
  { pos: 40, hid: 5, label: 'B', x: 6.25, y: 3 },
  { pos: 46, hid: 17, label: 'N', x: 7.25, y: 3 },
  { pos: 52, hid: 16, label: 'M', x: 8.25, y: 3 },
  { pos: 58, hid: 54, label: ',', x: 9.25, y: 3 },
  { pos: 64, hid: 55, label: '.', x: 10.25, y: 3 },
  { pos: 70, hid: 56, label: '/', x: 11.25, y: 3 },
  { pos: 76, hid: 229, label: 'Shift', x: 12.25, y: 3, w: 1.75 },
  { pos: 82, hid: 82, label: '↑', x: 14.25, y: 3 },
  // row 4
  { pos: 5, hid: 224, label: 'Ctrl', x: 0, y: 4, w: 1.25 },
  { pos: 17, hid: 227, label: 'Win', x: 1.25, y: 4, w: 1.25 },
  { pos: 23, hid: 226, label: 'Alt', x: 2.5, y: 4, w: 1.25 },
  { pos: 41, hid: 44, label: 'Space', x: 3.75, y: 4, w: 6.25 },
  { pos: 59, hid: 0, label: 'Fn', x: 10, y: 4, fixed: true },
  { pos: 65, hid: 228, label: 'Ctrl', x: 11, y: 4 },
  { pos: 77, hid: 80, label: '←', x: 13.25, y: 4 },
  { pos: 83, hid: 81, label: '↓', x: 14.25, y: 4 },
  { pos: 89, hid: 79, label: '→', x: 15.25, y: 4 },
];

export const LAYOUT_WIDTH = 16.25;
export const LAYOUT_ROWS = 5;
export const BY_POS = new Map(LAYOUT.map(k => [k.pos, k]));

// Handy key groups for quick selection.
export const GROUPS = {
  all: LAYOUT.filter(k => !k.fixed).map(k => k.pos),
  wasd: [14, 9, 15, 21],
  movement: [14, 9, 15, 21, 4, 5, 41, 23 /*Alt*/],
  letters: LAYOUT.filter(k => k.hid >= 4 && k.hid <= 29).map(k => k.pos),
  numbers: LAYOUT.filter(k => k.hid >= 30 && k.hid <= 39).map(k => k.pos),
};

// HID usage names for the key picker and for showing what a key does.
export const HID_NAMES = {
  4: 'A', 5: 'B', 6: 'C', 7: 'D', 8: 'E', 9: 'F', 10: 'G', 11: 'H', 12: 'I', 13: 'J', 14: 'K', 15: 'L', 16: 'M',
  17: 'N', 18: 'O', 19: 'P', 20: 'Q', 21: 'R', 22: 'S', 23: 'T', 24: 'U', 25: 'V', 26: 'W', 27: 'X', 28: 'Y', 29: 'Z',
  30: '1', 31: '2', 32: '3', 33: '4', 34: '5', 35: '6', 36: '7', 37: '8', 38: '9', 39: '0',
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=', 47: '[', 48: ']', 49: '\\',
  50: '#', 51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps Lock',
  58: 'F1', 59: 'F2', 60: 'F3', 61: 'F4', 62: 'F5', 63: 'F6', 64: 'F7', 65: 'F8', 66: 'F9', 67: 'F10', 68: 'F11', 69: 'F12',
  70: 'Print Screen', 71: 'Scroll Lock', 72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'Page Up', 76: 'Delete', 77: 'End',
  78: 'Page Down', 79: '→', 80: '←', 81: '↓', 82: '↑', 83: 'Num Lock',
  84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +', 88: 'Num Enter', 89: 'Num 1', 90: 'Num 2', 91: 'Num 3', 92: 'Num 4',
  93: 'Num 5', 94: 'Num 6', 95: 'Num 7', 96: 'Num 8', 97: 'Num 9', 98: 'Num 0', 99: 'Num .', 100: 'ISO \\', 101: 'Menu',
  104: 'F13', 105: 'F14', 106: 'F15', 107: 'F16', 108: 'F17', 109: 'F18', 110: 'F19', 111: 'F20', 112: 'F21', 113: 'F22', 114: 'F23', 115: 'F24',
  224: 'Left Ctrl', 225: 'Left Shift', 226: 'Left Alt', 227: 'Left Win', 228: 'Right Ctrl', 229: 'Right Shift', 230: 'Right Alt', 231: 'Right Win',
};

// Groups shown in the key picker.
export const PICKER_SECTIONS = [
  { name: 'Letters', codes: range(4, 29) },
  { name: 'Numbers', codes: range(30, 39) },
  { name: 'Symbols', codes: [45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56] },
  { name: 'Editing', codes: [40, 41, 42, 43, 44, 57, 73, 76, 74, 77, 75, 78, 101] },
  { name: 'Arrows', codes: [82, 80, 81, 79] },
  { name: 'Modifiers', codes: [224, 225, 226, 227, 228, 229, 230, 231] },
  { name: 'Function row', codes: [...range(58, 69), ...range(104, 115)] },
  { name: 'Numpad', codes: [83, 84, 85, 86, 87, 88, ...range(89, 99)] },
  { name: 'System', codes: [70, 71, 72] },
];

// Special 4-byte actions understood by the keyboard.
export const SPECIAL_ACTIONS = [
  { group: 'Media', name: 'Play / pause', bytes: [3, 0, 205, 0] },
  { group: 'Media', name: 'Next track', bytes: [3, 0, 181, 0] },
  { group: 'Media', name: 'Previous track', bytes: [3, 0, 182, 0] },
  { group: 'Media', name: 'Stop', bytes: [3, 0, 183, 0] },
  { group: 'Media', name: 'Mute', bytes: [3, 0, 226, 0] },
  { group: 'Media', name: 'Volume up', bytes: [3, 0, 233, 0] },
  { group: 'Media', name: 'Volume down', bytes: [3, 0, 234, 0] },
  { group: 'Media', name: 'Media player', bytes: [3, 0, 131, 1] },
  { group: 'System', name: 'Calculator', bytes: [3, 0, 146, 1] },
  { group: 'System', name: 'My computer', bytes: [3, 0, 148, 1] },
  { group: 'System', name: 'Email', bytes: [3, 0, 138, 1] },
  { group: 'System', name: 'Browser home', bytes: [3, 0, 35, 2] },
  { group: 'System', name: 'Browser back', bytes: [3, 0, 36, 2] },
  { group: 'System', name: 'Browser refresh', bytes: [3, 0, 39, 2] },
  { group: 'System', name: 'Search', bytes: [3, 0, 33, 2] },
  { group: 'System', name: 'Screen brighter', bytes: [3, 0, 111, 0] },
  { group: 'System', name: 'Screen dimmer', bytes: [3, 0, 112, 0] },
  { group: 'System', name: 'Lock PC (Win+L)', bytes: [0, 0, 227, 15] },
  { group: 'System', name: 'Show desktop (Win+D)', bytes: [0, 0, 227, 7] },
  { group: 'System', name: 'File explorer (Win+E)', bytes: [0, 0, 227, 8] },
  { group: 'System', name: 'Task manager', bytes: [0, 224, 225, 41] },
  { group: 'System', name: 'Copy', bytes: [0, 0, 224, 6] },
  { group: 'System', name: 'Paste', bytes: [0, 0, 224, 25] },
  { group: 'Mouse', name: 'Left click', bytes: [1, 0, 240, 0] },
  { group: 'Mouse', name: 'Right click', bytes: [1, 0, 241, 0] },
  { group: 'Mouse', name: 'Middle click', bytes: [1, 0, 242, 0] },
  { group: 'Mouse', name: 'Mouse back', bytes: [1, 0, 243, 0] },
  { group: 'Mouse', name: 'Mouse forward', bytes: [1, 0, 244, 0] },
  { group: 'Mouse', name: 'Scroll up', bytes: [1, 0, 245, 1] },
  { group: 'Mouse', name: 'Scroll down', bytes: [1, 0, 245, 255] },
  { group: 'Keyboard', name: 'Fn key', bytes: [10, 1, 0, 0] },
  { group: 'Keyboard', name: 'Fn lock', bytes: [10, 13, 0, 0] },
  { group: 'Keyboard', name: 'Next profile', bytes: [8, 0, 1, 0] },
  { group: 'Keyboard', name: 'Previous profile', bytes: [8, 0, 2, 0] },
  { group: 'Keyboard', name: 'Cycle profiles', bytes: [8, 0, 3, 0] },
  { group: 'Lighting', name: 'Next light effect', bytes: [13, 1, 0, 0] },
  { group: 'Lighting', name: 'Brighter', bytes: [13, 2, 1, 0] },
  { group: 'Lighting', name: 'Dimmer', bytes: [13, 2, 2, 0] },
  { group: 'Lighting', name: 'Effect faster', bytes: [13, 3, 1, 0] },
  { group: 'Lighting', name: 'Effect slower', bytes: [13, 3, 2, 0] },
  { group: 'Lighting', name: 'Change light color', bytes: [13, 5, 1, 0] },
];

function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }

export function sameBytes(a, b) {
  return a && b && a.length === b.length && a.every((v, i) => v === b[i]);
}

// Turn a 4-byte key action into a short readable name.
export function describeAction(bytes) {
  if (!bytes) return '';
  const [t, a, b, c] = bytes;
  if (t === 0 && a === 0 && b === 0 && c === 0) return 'Off';
  const special = SPECIAL_ACTIONS.find(s => sameBytes(s.bytes, bytes));
  if (special) return special.name;
  if (t === 0) {
    const parts = [a, b, c].filter(Boolean).map(code => shortName(code));
    return parts.join(' + ');
  }
  if (t === 9) return `Macro ${b + 1}`;
  if (t === 10 && a === 1) return 'Fn';
  if (t === 10) return 'Fn function';
  if (t === 13) return 'Lighting';
  if (t === 8) return 'Profile';
  if (t === 1) return 'Mouse';
  if (t === 3) return 'Media';
  return 'Custom';
}

export function shortName(code) {
  const n = HID_NAMES[code];
  if (!n) return `Key ${code}`;
  return n.replace('Left ', 'L').replace('Right ', 'R').replace('Page ', 'Pg');
}

// Browser key codes -> HID usage, used for "press a key" and macro recording.
export const CODE_TO_HID = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m['Key' + String.fromCharCode(65 + i)] = 4 + i;
  for (let i = 1; i <= 9; i++) m['Digit' + i] = 29 + i;
  m.Digit0 = 39;
  Object.assign(m, {
    Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
    Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
    PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
    ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
    NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101,
    ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  });
  for (let i = 1; i <= 9; i++) m['Numpad' + i] = 88 + i;
  for (let i = 1; i <= 12; i++) m['F' + i] = 57 + i;
  for (let i = 13; i <= 24; i++) m['F' + i] = 91 + i;
  return m;
})();

export const SWITCH_TYPES = [
  'Gateron (default)', 'Gateron Magnetic Jade', 'Gateron Jade Pro', 'Gateron Jade Gaming', 'TTC Tianwang',
  'TTC Wanciwang', 'Kailh (Ketai)', 'Mechanical', 'Magnetic White', 'Jade custom', 'TTC Wanciwang Pro',
  'TTC Tianwang SE', 'TTC Wanciwang RGB', 'TTC Wanciwang POM', 'Cishen', 'Kailh', 'TTC Magnetic King',
];
