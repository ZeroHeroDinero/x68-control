import { X68, openKeyboard, VID, PID, SLOTS, MODE, RATES, LIGHT_EFFECTS } from './protocol.js';
import { MockX68 } from './mock.js';
import {
  LAYOUT, LAYOUT_WIDTH, LAYOUT_ROWS, BY_POS, GROUPS, HID_NAMES, PICKER_SECTIONS, SPECIAL_ACTIONS,
  CODE_TO_HID, SWITCH_TYPES, describeAction, sameBytes, shortName, variantFor, setVariant, VARIANT,
} from './keymap.js';
import { initMouse, renderMouse, mouseSubtitle, mouseState } from './mouse/ui.js';

const $ = sel => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => structuredClone(o);
const DEMO = new URLSearchParams(location.search).has('demo');

// ---------------------------------------------------------------- state
const S = {
  kb: null,
  profile: 0,
  keys: [],            // per-slot switch settings (what you see)
  saved: [],           // what the keyboard has
  subs: [[], [], [], []], // key matrix layers 0..3 (layer 0 = normal mapping)
  fn: [],
  light: null,
  options: null,
  rate: 8000,
  view: 'actuation',
  sel: new Set(),
  pendingFields: new Set(),
  pendingDks: new Set(),
  remapLayer: 'base',
  pickerTab: 'press',
  adv: null,           // draft for the advanced-key editor
  targetMode: null,    // 'snap' while choosing a partner key
  paint: null,         // custom pattern painting state
  macroSlot: 0,
  macro: null,
  live: { on: false, depth: 0, pos: null, last: 0 },
  busy: false,
  device: 'keyboard',
  mview: 'dpi',
};

const DEFAULT_ACTION = pos => {
  const k = BY_POS.get(pos);
  if (!k) return [0, 0, 0, 0];
  return k.label === 'Fn' ? [10, 1, 0, 0] : [0, 0, k.hid, 0];
};
const action = (layer, pos) => (layer[pos * 4] === undefined ? [0, 0, 0, 0] : layer.slice(pos * 4, pos * 4 + 4));
const editable = () => LAYOUT.filter(k => !k.fixed);
const step = () => (S.kb ? 1 / S.kb.multiplier : 0.01);
const fmt = v => (Math.round(v * 100) / 100).toFixed(2);

// ---------------------------------------------------------------- feedback
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isErr ? 5000 : 2200);
}

async function guard(fn, okMsg) {
  if (S.busy) return;
  S.busy = true;
  document.body.style.cursor = 'progress';
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    console.error(e);
    toast(e?.message?.includes('device') || e?.name === 'NotAllowedError'
      ? 'The keyboard stopped answering. Unplug it and plug it back in.'
      : `That didn't save: ${e.message || e}`, true);
  } finally {
    S.busy = false;
    document.body.style.cursor = '';
  }
}

function modal(html, wire) {
  const m = $('#modal');
  $('#modalCard').innerHTML = html;
  m.classList.remove('hidden');
  const close = () => m.classList.add('hidden');
  m.onclick = e => { if (e.target === m) close(); };
  wire?.($('#modalCard'), close);
  return close;
}

// ---------------------------------------------------------------- connection
async function connect(viaPicker = false) {
  if (DEMO) return load(new MockX68());
  try {
    if (viaPicker) await navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
    const devices = await navigator.hid.getDevices();
    const kb = await openKeyboard(devices);
    if (!kb) return showConnect();
    await load(kb);
  } catch (e) {
    console.error(e);
    showConnect('The keyboard is busy', 'Another program has it open. Close the official Attack Shark page or app, then press Connect.');
  }
}

function showConnect(title = 'Plug in your X68 HE', text = 'Use the USB cable. The app finds the keyboard on its own once it is plugged in.') {
  $('#connectOverlay').classList.remove('hidden');
  $('#connectTitle').textContent = title;
  $('#connectText').textContent = text;
  $('#loadProgress').classList.add('hidden');
  $('#connectBtn').classList.remove('hidden');
  renderShell();
}

function progress(frac, text) {
  $('#loadProgress').classList.remove('hidden');
  $('#connectBtn').classList.add('hidden');
  $('#loadBar').style.width = `${Math.round(frac * 100)}%`;
  if (text) $('#connectText').textContent = text;
}

async function load(kb) {
  if (S.kb && S.kb !== kb) await S.kb.close().catch(() => {});
  S.kb = kb;
  $('#connectOverlay').classList.remove('hidden');
  $('#connectTitle').textContent = 'Reading your keyboard';
  progress(0.05, 'Checking which keyboard this is');
  const info = await kb.identify();
  progress(0.15, 'Reading your settings');
  S.profile = await kb.getProfile() ?? 0;
  S.options = await kb.getOptions();
  S.rate = await kb.getRate() ?? 8000;
  S.light = await kb.getLight();
  await loadProfileData((f, t) => progress(0.2 + f * 0.8, t));
  setVariant(variantFor(info.deviceId, S.subs[0]));
  buildBoard();
  await repairBottomRow();
  if (!kb._subscribed) { kb.onEvent(onKeyboardEvent); kb._subscribed = true; }
  S.kbLine = `X68 HE · firmware ${info.version}${DEMO ? ' (preview)' : ''}`;
  $('#connectOverlay').classList.add('hidden');
  renderAll();
}

async function loadProfileData(onProgress = () => {}) {
  const kb = S.kb;
  onProgress(0.05, 'Reading key mapping');
  for (let sub = 0; sub < 4; sub++) {
    S.subs[sub] = await kb.getKeyMatrix(S.profile, sub);
    onProgress(0.05 + sub * 0.1, 'Reading key mapping');
  }
  S.fn = await kb.getFnMatrix(S.profile, 0);
  onProgress(0.5, 'Reading switch settings');
  S.keys = await kb.readSwitches();
  S.saved = clone(S.keys);
  S.pendingFields.clear();
  S.pendingDks.clear();
  S.adv = null;
  onProgress(1, 'Done');
}

// Version 1.1.2 and earlier assumed layout A for every X68 HE. On a layout B board that
// labelled the physical Alt key as "Win" and the physical Fn key as "Ctrl", so resetting
// those keys wrote the wrong codes. Put them back if we see that exact pattern.
async function repairBottomRow() {
  if (VARIANT !== 'B') return;
  const fixes = [];
  if (sameBytes(action(S.subs[0], 17), [0, 0, 227, 0]) || sameBytes(action(S.subs[0], 17), [0, 0, 0, 0])) fixes.push([17, [0, 0, 226, 0]]);
  if (sameBytes(action(S.subs[0], 65), [0, 0, 228, 0]) || sameBytes(action(S.subs[0], 65), [0, 0, 0, 0])) fixes.push([65, [10, 1, 0, 0]]);
  if (!fixes.length) return;
  for (const [pos, act] of fixes) {
    await S.kb.setKey(S.profile, pos, act, 0);
    S.subs[0].splice(pos * 4, 4, ...act);
  }
  setTimeout(() => toast('Fixed your Alt and Fn keys, they work normally again'), 600);
}

function onKeyboardEvent({ data }) {
  // live depth report: [27, lo, hi, key]
  if (data[0] === 27 && S.live.on) {
    const depth = ((data[2] << 8) | data[1]) / S.kb.multiplier;
    let pos = data[3];
    if (!BY_POS.has(pos)) pos = LAYOUT.find(k => k.hid === data[3])?.pos ?? null;
    S.live.depth = depth;
    S.live.pos = pos;
    S.live.last = Date.now();
    drawLive();
  }
  // profile changed with Fn shortcut on the keyboard itself
  if (data[0] === 1 && data[1] !== undefined && data[1] < 4 && data[1] !== S.profile && data[2] === 0) {
    S.profile = data[1];
    guard(async () => { await loadProfileData(); renderAll(); }, `Profile ${S.profile + 1} is active`);
  }
}

if (!DEMO && 'hid' in navigator) {
  navigator.hid.addEventListener('connect', () => { if (!S.kb) connect(); });
  navigator.hid.addEventListener('disconnect', e => {
    if (S.kb && e.device.vendorId === VID && e.device.productId === PID) {
      S.kb.close().catch(() => {});
      S.kb = null;
      showConnect('Keyboard unplugged', 'Plug it back in and the app reconnects on its own.');
    }
  });
}

// ---------------------------------------------------------------- board
let U = 54;
function layoutBoard() {
  const wrap = $('#boardWrap');
  const avail = wrap.clientWidth - 56;
  const byHeight = Math.floor((window.innerHeight * 0.36) / LAYOUT_ROWS);
  U = Math.max(38, Math.min(60, Math.floor(avail / LAYOUT_WIDTH), byHeight));
  const b = $('#board');
  b.style.width = `${U * LAYOUT_WIDTH}px`;
  b.style.height = `${U * LAYOUT_ROWS}px`;
  for (const cap of b.children) {
    const k = BY_POS.get(+cap.dataset.pos);
    cap.style.left = `${k.x * U}px`;
    cap.style.top = `${k.y * U}px`;
    cap.style.width = `${(k.w || 1) * U}px`;
    cap.style.height = `${U}px`;
  }
}

function buildBoard() {
  const b = $('#board');
  b.innerHTML = '';
  for (const k of LAYOUT) {
    const cap = el(`<div class="cap${k.fixed ? ' fixed' : ''}" data-pos="${k.pos}"><div class="cap-face"><div class="cap-label"></div><div class="cap-sub"></div></div></div>`);
    b.appendChild(cap);
  }
  layoutBoard();
  if (b._wired) return;
  b._wired = true;
  let dragging = null;
  b.addEventListener('mousedown', e => {
    const cap = e.target.closest('.cap');
    if (!cap || cap.classList.contains('fixed')) return;
    const pos = +cap.dataset.pos;
    e.preventDefault();
    if (S.targetMode) return pickTarget(pos);
    if (S.paint) { dragging = 'paint'; paintKey(pos); return; }
    if (S.view === 'actuation') {
      if (e.shiftKey || e.ctrlKey) { toggleSel(pos); dragging = S.sel.has(pos) ? 'add' : 'remove'; }
      else { S.sel = new Set([pos]); dragging = 'add'; }
    } else {
      S.sel = new Set([pos]);
      dragging = null;
    }
    onSelectionChanged();
  });
  b.addEventListener('mouseover', e => {
    if (!dragging) return;
    const cap = e.target.closest('.cap');
    if (!cap || cap.classList.contains('fixed')) return;
    const pos = +cap.dataset.pos;
    if (dragging === 'paint') return paintKey(pos);
    if (dragging === 'add' && !S.sel.has(pos)) { S.sel.add(pos); onSelectionChanged(); }
    if (dragging === 'remove' && S.sel.has(pos)) { S.sel.delete(pos); onSelectionChanged(); }
  });
  window.addEventListener('mouseup', () => {
    if (dragging === 'paint') renderBoard();
    dragging = null;
  });
}

function toggleSel(pos) { S.sel.has(pos) ? S.sel.delete(pos) : S.sel.add(pos); }

function onSelectionChanged() {
  if (S.view === 'advanced') S.adv = null;
  renderBoard();
  renderPanel();
}

const MODE_BADGE = { [MODE.DKS]: ['DKS', 'dks'], [MODE.MT]: ['MT', 'mt'], [MODE.TGL_HOLD]: ['TGL', 'tgl'], [MODE.TGL_RAPID]: ['TGL', 'tgl'], [MODE.SNAP]: ['SNAP', 'snap'] };

function renderBoard() {
  const view = S.view;
  for (const cap of $('#board').children) {
    const pos = +cap.dataset.pos;
    const k = BY_POS.get(pos);
    const cfg = S.keys[pos];
    const face = cap.firstElementChild;
    const label = face.querySelector('.cap-label');
    const sub = face.querySelector('.cap-sub');
    face.querySelectorAll('.cap-depth,.cap-badge,.cap-rt').forEach(n => n.remove());
    cap.classList.toggle('sel', S.sel.has(pos));
    cap.classList.toggle('target', S.targetMode === 'snap' && S.adv?.partner === pos);
    cap.classList.remove('pending', 'paint');
    cap.style.removeProperty('--paint');
    label.textContent = k.label;
    sub.textContent = '';
    sub.className = 'cap-sub';
    if (!cfg || k.fixed) continue;

    if (view === 'actuation') {
      const v = cfg.mode === MODE.NORMAL || cfg.mode === MODE.SNAP ? cfg.press : null;
      if (v != null) {
        sub.textContent = fmt(v);
        sub.classList.add('press');
        const bar = el('<div class="cap-depth"></div>');
        bar.style.transform = `scaleX(${Math.min(1, v / 3.4)})`;
        face.appendChild(bar);
      } else sub.textContent = MODE_BADGE[cfg.mode]?.[0] ?? '';
      if (cfg.rt) face.appendChild(el('<div class="cap-rt" title="Rapid Trigger on"></div>'));
      const saved = S.saved[pos];
      if (saved && JSON.stringify(saved) !== JSON.stringify(cfg)) cap.classList.add('pending');
    } else if (view === 'advanced') {
      const b = MODE_BADGE[cfg.mode];
      if (b) face.appendChild(el(`<div class="cap-badge ${b[1]}">${b[0]}</div>`));
      if (cfg.mode === MODE.SNAP && BY_POS.get(cfg.snapWith)) sub.textContent = `+ ${BY_POS.get(cfg.snapWith).label}`;
    } else if (view === 'remap') {
      const layer = S.remapLayer === 'fn' ? S.fn : S.subs[0];
      const act = action(layer, pos);
      const def = S.remapLayer === 'fn' ? [0, 0, 0, 0] : DEFAULT_ACTION(pos);
      if (!sameBytes(act, def)) {
        sub.textContent = describeAction(act);
        sub.classList.add('changed');
      } else if (S.remapLayer === 'fn') sub.textContent = '';
      if (MODE_BADGE[cfg.mode] && S.remapLayer === 'base' && cfg.mode !== MODE.SNAP) face.appendChild(el(`<div class="cap-badge ${MODE_BADGE[cfg.mode][1]}">${MODE_BADGE[cfg.mode][0]}</div>`));
    } else if (view === 'lighting' && S.paint) {
      const rgb = S.paint.data.slice(pos * 3, pos * 3 + 3);
      cap.classList.add('paint');
      cap.style.setProperty('--paint', `rgb(${rgb.join(',')})`);
    }
  }
  drawLive();
}

function drawLive() {
  for (const n of document.querySelectorAll('.cap-live')) n.remove();
  if (!S.live.on || S.live.pos == null) return;
  const cap = $(`.cap[data-pos="${S.live.pos}"] .cap-face`);
  if (cap) {
    const d = el('<div class="cap-live"></div>');
    d.style.height = `${Math.min(100, (S.live.depth / 3.6) * 100)}%`;
    cap.appendChild(d);
  }
  const g = $('#gaugeLive');
  if (g) g.setAttribute('height', String(Math.max(0, gaugeY(S.live.depth) - gaugeY(0))));
  const gv = $('#gaugeLiveVal');
  if (gv) gv.textContent = `${fmt(S.live.depth)} mm`;
}

// press a key on the keyboard to select it
window.addEventListener('keydown', e => {
  if (S.device !== 'keyboard') return;
  if (S.macro?.recording) return;
  if (e.target.matches('input, select, textarea')) return;
  if (S.pickerTab === 'press' && S.view === 'remap' && S.capturing) return;
  const hid = CODE_TO_HID[e.code];
  const k = LAYOUT.find(x => x.hid === hid && !x.fixed);
  if (!k || !S.keys.length) return;
  if (S.view === 'actuation' && (e.key === 'Shift' || e.key === 'Control')) return; // used for adding to the selection
  if (['actuation', 'advanced', 'remap'].includes(S.view)) {
    e.preventDefault();
    if (S.targetMode) return pickTarget(k.pos);
    if (S.view === 'actuation' && e.shiftKey && hid !== 225) S.sel.add(k.pos);
    else S.sel = new Set([k.pos]);
    $(`.cap[data-pos="${k.pos}"]`)?.classList.add('pressed');
    onSelectionChanged();
  }
});
window.addEventListener('keyup', e => {
  const hid = CODE_TO_HID[e.code];
  const k = LAYOUT.find(x => x.hid === hid);
  if (k) $(`.cap[data-pos="${k.pos}"]`)?.classList.remove('pressed');
});

// ---------------------------------------------------------------- shell
function renderShell() {
  const mouse = S.device === 'mouse';
  document.body.classList.toggle('mode-mouse', mouse);
  $('#nav').classList.toggle('hidden', mouse);
  $('#mouseNav').classList.toggle('hidden', !mouse);
  $('#sideFoot').classList.toggle('hidden', mouse);
  document.querySelectorAll('#devSwitch button').forEach(b => b.classList.toggle('on', b.dataset.dev === S.device));
  document.querySelectorAll('#mouseNav button').forEach(b => b.classList.toggle('active', b.dataset.mview === S.mview));
  $('#kbDot').classList.toggle('live', !!S.kb);
  $('#msDot').classList.toggle('live', !!mouseState.dev);
  $('#deviceLine').textContent = mouse ? mouseSubtitle() : (S.kb ? S.kbLine : 'Keyboard not connected');
}

function renderAll() {
  renderShell();
  if (S.device === 'mouse') {
    $('#boardWrap').classList.add('hidden');
    renderPanel();
    return;
  }
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  document.querySelectorAll('#profiles button').forEach(b => b.classList.toggle('active', +b.dataset.p === S.profile));
  renderBoardChrome();
  renderBoard();
  renderPanel();
}

function renderBoardChrome() {
  const tools = $('#boardTools');
  const legend = $('#boardLegend');
  tools.innerHTML = '';
  legend.innerHTML = '';
  $('#boardWrap').classList.toggle('hidden', S.view === 'macros' || S.view === 'settings' || (S.view === 'lighting' && !S.paint));
  const titles = {
    actuation: 'Click keys, drag across them, or press them on your keyboard',
    advanced: 'Pick one key to give it a special behavior',
    remap: S.remapLayer === 'fn' ? 'Pick a key to change what it does while holding Fn' : 'Pick a key to change what it types',
    lighting: 'Click or drag over keys to paint them',
  };
  $('#boardTitle').textContent = titles[S.view] ?? '';
  if (S.view === 'actuation') {
    const groups = [['All keys', 'all'], ['WASD', 'wasd'], ['Letters', 'letters'], ['Numbers', 'numbers']];
    for (const [name, g] of groups) {
      const b = el(`<button class="chip">${name}</button>`);
      b.onclick = () => { S.sel = new Set(GROUPS[g]); onSelectionChanged(); };
      tools.appendChild(b);
    }
    const c = el('<button class="chip">Clear</button>');
    c.onclick = () => { S.sel.clear(); onSelectionChanged(); };
    tools.appendChild(c);
    legend.innerHTML = '<span style="--c:var(--press)">Number = actuation point in mm</span><span style="--c:var(--rt)">Dot = Rapid Trigger on</span><span style="--c:var(--release)">Dashed = not saved yet</span>';
  }
  if (S.view === 'remap') {
    const seg = el('<div class="seg"><button data-l="base">Normal layer</button><button data-l="fn">Fn layer</button></div>');
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.l === S.remapLayer);
      b.onclick = () => { S.remapLayer = b.dataset.l; renderBoardChrome(); renderBoard(); renderPanel(); };
    });
    tools.appendChild(seg);
    legend.innerHTML = '<span style="--c:var(--release)">Teal text = changed from the default</span>';
  }
  if (S.view === 'advanced') {
    legend.innerHTML = '<span style="--c:var(--press)">DKS = several actions in one press</span><span style="--c:var(--release)">MT = tap or hold</span><span style="--c:#ff9f7a">TGL = toggle or rapid fire</span><span style="--c:#7ac0ff">SNAP = Snap Tap pair</span>';
  }
  layoutBoard();
}

function renderPanel() {
  const p = $('#panel');
  const fns = { actuation: renderActuation, advanced: renderAdvanced, remap: renderRemap, lighting: renderLighting, macros: renderMacros, settings: renderSettings };
  p.innerHTML = '';
  if (S.device === 'mouse') return renderMouse(p, S.mview);
  if (!S.keys.length) return;
  fns[S.view](p);
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => switchView(b.dataset.view));
document.querySelectorAll('#mouseNav button').forEach(b => b.onclick = () => { S.mview = b.dataset.mview; renderAll(); });
document.querySelectorAll('#devSwitch button').forEach(b => b.onclick = () => switchDevice(b.dataset.dev));

function switchDevice(d) {
  if (d === S.device) return;
  if (d === 'mouse' && S.pendingFields.size && S.view === 'actuation') {
    return modal(`<h2>Save your keyboard changes first?</h2><p>You changed actuation settings that aren't on the keyboard yet.</p>
      <div class="row"><button class="btn primary" data-a="save">Save to keyboard</button><button class="btn" data-a="drop">Throw them away</button></div>`, (card, close) => {
      card.querySelector('[data-a=save]').onclick = async () => { close(); await saveActuation(); switchDevice(d); };
      card.querySelector('[data-a=drop]').onclick = () => { close(); undoActuation(); switchDevice(d); };
    });
  }
  stopLive();
  S.device = d;
  renderAll();
}

function switchView(v) {
  if (v === S.view) return;
  if (S.pendingFields.size && S.view === 'actuation') {
    return modal(`<h2>Save your changes first?</h2><p>You changed actuation settings that aren't on the keyboard yet.</p>
      <div class="row"><button class="btn primary" data-a="save">Save to keyboard</button><button class="btn" data-a="drop">Throw them away</button></div>`, (card, close) => {
      card.querySelector('[data-a=save]').onclick = async () => { close(); await saveActuation(); switchView(v); };
      card.querySelector('[data-a=drop]').onclick = () => { close(); undoActuation(); switchView(v); };
    });
  }
  stopLive();
  S.targetMode = null;
  S.paint = null;
  S.adv = null;
  if (v !== 'actuation' && S.sel.size > 1) S.sel = new Set([...S.sel].slice(0, 1));
  S.view = v;
  renderAll();
}

document.querySelectorAll('#profiles button').forEach(b => b.onclick = () => {
  const p = +b.dataset.p;
  if (p === S.profile || !S.kb) return;
  guard(async () => {
    await S.kb.setProfile(p);
    S.profile = p;
    await loadProfileData();
    await repairBottomRow();
    S.light = await S.kb.getLight();
    renderAll();
  }, `Profile ${p + 1} is active`);
});

$('#connectBtn').onclick = () => connect(true);
window.addEventListener('resize', () => layoutBoard());

// ---------------------------------------------------------------- actuation view
const FIELDS = {
  press: { label: 'Actuation point', hint: 'How far you press before the key fires. Lower is faster, higher prevents accidental presses.', min: 0.1, max: 3.3, cls: 'press' },
  release: { label: 'Release point', hint: 'How far the key has to come back up before it stops firing.', min: 0.1, max: 3.3, cls: 'release' },
  rtPress: { label: 'Press sensitivity', hint: 'With Rapid Trigger, the key fires again after moving down this far, wherever it is.', min: 0.01, max: 2.0, cls: 'rt' },
  rtRelease: { label: 'Release sensitivity', hint: 'With Rapid Trigger, the key stops the moment it rises this much. This is what makes counter-strafing instant.', min: 0.01, max: 2.0, cls: 'rt' },
  topDz: { label: 'Top dead zone', hint: 'Ignore the first bit of travel so a resting finger never triggers the key.', min: 0, max: 1.0, cls: 'plain' },
  bottomDz: { label: 'Bottom dead zone', hint: 'Ignore wobble at the very bottom so a key held down never flickers.', min: 0, max: 1.0, cls: 'plain' },
};

function selCfgs() { return [...S.sel].map(p => S.keys[p]).filter(Boolean); }
function common(list, f) { if (!list.length) return null; const v = list[0][f]; return list.every(k => Math.abs(k[f] - v) < 1e-6) ? v : 'mixed'; }

function renderActuation(p) {
  const list = selCfgs();
  const advKeys = list.filter(k => k.mode !== MODE.NORMAL && k.mode !== MODE.SNAP).length;
  const grid = el('<div class="panel-grid"><div class="stack" id="actLeft"></div><div class="stack" id="actRight"></div></div>');
  p.appendChild(grid);
  const left = grid.querySelector('#actLeft');
  const right = grid.querySelector('#actRight');

  if (!list.length) {
    left.appendChild(el(`<div><h2>Actuation and Rapid Trigger</h2><p class="lead">Pick the keys you want to change on the keyboard above. Tip: press WASD on your keyboard while holding Shift to grab them all.</p></div>`));
    left.appendChild(presetBlock());
  } else {
    const rt = common(list, 'rt');
    const head = el(`<div><h2>${list.length === 1 ? `${BY_POS.get([...S.sel][0]).label} key` : `${list.length} keys selected`}</h2>
      <p class="lead">${advKeys ? `${advKeys} of these use an advanced mode, so only their Rapid Trigger setting applies here.` : 'Changes show on the keys right away. They go to the keyboard when you press Save.'}</p></div>`);
    left.appendChild(head);

    const main = el('<div class="block stack"></div>');
    main.appendChild(sliderField('press', list));
    const rtRow = el(`<label class="toggle"><input type="checkbox" ${rt === true ? 'checked' : ''}><span class="sw"></span><span>Rapid Trigger${rt === 'mixed' ? ' <span class="note">(on for some)</span>' : ''}</span></label>`);
    rtRow.querySelector('input').onchange = e => {
      for (const k of list) k.rt = e.target.checked;
      S.pendingFields.add('mode');
      renderBoard();
      renderPanel();
    };
    main.appendChild(rtRow);
    if (rt === false) main.appendChild(sliderField('release', list));
    else {
      main.appendChild(sliderField('rtPress', list));
      main.appendChild(sliderField('rtRelease', list));
    }
    left.appendChild(main);

    const fine = el('<details class="block"><summary style="cursor:pointer;font-weight:600">Dead zones</summary><div class="stack" style="margin-top:16px"></div></details>');
    if (S.kb.supportsTopDz) fine.querySelector('.stack').appendChild(sliderField('topDz', list));
    fine.querySelector('.stack').appendChild(sliderField('bottomDz', list));
    left.appendChild(fine);
    left.appendChild(presetBlock());
  }

  right.appendChild(gaugeBlock(list));
  right.appendChild(liveBlock());

  if (S.pendingFields.size) {
    const changed = S.keys.filter((k, i) => JSON.stringify(k) !== JSON.stringify(S.saved[i])).length;
    const bar = el(`<div class="save-bar"><span class="msg">${changed} key${changed === 1 ? '' : 's'} changed, not saved to the keyboard yet</span><span class="spacer"></span>
      <button class="btn" id="undoBtn">Undo</button><button class="btn primary" id="saveBtn">Save to keyboard</button></div>`);
    bar.querySelector('#undoBtn').onclick = () => { undoActuation(); renderAll(); };
    bar.querySelector('#saveBtn').onclick = () => saveActuation();
    p.appendChild(bar);
  }
}

function sliderField(f, list) {
  const def = FIELDS[f];
  const v = common(list, f);
  const value = v === 'mixed' ? (list[0][f]) : v;
  const pct = ((value - def.min) / (def.max - def.min)) * 100;
  const node = el(`<div class="field">
    <label>${def.label}</label>
    <div class="row" style="gap:8px"><div class="steppers"><button data-d="-1" title="Smaller">−</button><button data-d="1" title="Bigger">+</button></div>
    <div class="val${v === 'mixed' ? ' mixed' : ''}">${v === 'mixed' ? 'Mixed' : `${fmt(value)}<small>mm</small>`}</div></div>
    <input type="range" class="${def.cls}" min="${def.min}" max="${def.max}" step="${step()}" value="${value}" style="--p:${pct}%">
    <div class="hint">${def.hint}</div></div>`);
  const range = node.querySelector('input');
  const valEl = node.querySelector('.val');
  const apply = val => {
    val = Math.max(def.min, Math.min(def.max, Math.round(val / step()) * step()));
    for (const k of list) k[f] = val;
    if (f === 'press' && list.some(k => k.release > val + 1e-6) && !S.pendingFields.has('release')) {
      // keep release point at or above the actuation point so the key always lets go
      for (const k of list) if (k.release > val) k.release = val;
      S.pendingFields.add('release');
    }
    S.pendingFields.add(f);
    range.value = val;
    range.style.setProperty('--p', `${((val - def.min) / (def.max - def.min)) * 100}%`);
    valEl.classList.remove('mixed');
    valEl.innerHTML = `${fmt(val)}<small>mm</small>`;
    renderBoard();
    updateGauge(list);
    ensureSaveBar();
  };
  range.oninput = () => apply(+range.value);
  node.querySelectorAll('.steppers button').forEach(b => b.onclick = () => apply(+range.value + (+b.dataset.d) * (f.startsWith('rt') ? 0.01 : 0.05)));
  return node;
}

function ensureSaveBar() {
  if (!$('.save-bar')) { const top = $('#panel').scrollTop; renderPanel(); $('#panel').scrollTop = top; }
  else {
    const changed = S.keys.filter((k, i) => JSON.stringify(k) !== JSON.stringify(S.saved[i])).length;
    $('.save-bar .msg').textContent = `${changed} key${changed === 1 ? '' : 's'} changed, not saved to the keyboard yet`;
  }
}

function undoActuation() {
  S.keys = clone(S.saved);
  S.pendingFields.clear();
  S.pendingDks.clear();
}

async function saveActuation() {
  await guard(async () => {
    await S.kb.writeSwitches(S.keys, new Set(S.pendingFields), [...S.pendingDks]);
    S.saved = clone(S.keys);
    S.pendingFields.clear();
    S.pendingDks.clear();
    renderAll();
  }, `Saved to profile ${S.profile + 1}`);
}

// the switch seen from the side: top = resting, bottom = fully pressed
const G = { top: 34, bottom: 300, max: 3.6 };
const gaugeY = mm => G.top + (Math.min(mm, G.max) / G.max) * (G.bottom - G.top);

function gaugeSvg(k) {
  if (!k) k = { press: 2, release: 2, rt: false, rtPress: 0.3, rtRelease: 0.3, topDz: 0, bottomDz: 0.3 };
  const ticks = [];
  for (let mm = 0; mm <= 3.5; mm += 0.5) ticks.push(`<line x1="62" x2="${mm % 1 === 0 ? 74 : 70}" y1="${gaugeY(mm)}" y2="${gaugeY(mm)}" stroke="#6b7380"/>${mm % 1 === 0 ? `<text x="54" y="${gaugeY(mm) + 4}" text-anchor="end" fill="#98a1ae" font-size="11">${mm} mm</text>` : ''}`);
  const yP = gaugeY(k.press);
  const yR = gaugeY(k.release);
  const bottomStart = gaugeY(G.max - k.bottomDz * 1);
  return `<svg viewBox="0 0 330 320" role="img" aria-label="Key travel diagram">
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#6b7380" stroke-width="2"/></pattern></defs>
    ${ticks.join('')}
    <rect x="96" y="${G.top}" width="70" height="${G.bottom - G.top}" rx="6" fill="#1b1f26" stroke="#3a414d"/>
    ${k.topDz ? `<rect x="97" y="${G.top}" width="68" height="${gaugeY(k.topDz) - G.top}" fill="url(#hatch)" opacity=".7"/>` : ''}
    ${k.bottomDz ? `<rect x="97" y="${gaugeY(3.4 - k.bottomDz)}" width="68" height="${gaugeY(3.4) - gaugeY(3.4 - k.bottomDz)}" fill="url(#hatch)" opacity=".7"/>` : ''}
    <rect id="gaugeLive" x="97" y="${G.top}" width="68" height="0" fill="rgba(240,181,61,.28)"/>
    <rect x="88" y="${G.top - 22}" width="86" height="20" rx="5" class="gauge-cap"/>
    ${k.rt ? `
      <rect x="170" y="${yP - (gaugeY(k.rtRelease) - gaugeY(0))}" width="8" height="${gaugeY(k.rtRelease) - gaugeY(0)}" rx="2" fill="#a58bff" opacity=".9"/>
      <rect x="182" y="${yP}" width="8" height="${gaugeY(k.rtPress) - gaugeY(0)}" rx="2" fill="#a58bff" opacity=".55"/>
      <text x="204" y="${yP + 22}" fill="#a58bff" font-size="12">stops after ${fmt(k.rtRelease)} up</text>
      <text x="204" y="${yP + 38}" fill="#a58bff" font-size="12">fires again ${fmt(k.rtPress)} down</text>`
    : `<line x1="96" x2="196" y1="${yR}" y2="${yR}" stroke="#3cc8b4" stroke-width="3" stroke-dasharray="6 4"/>
       <text x="204" y="${Math.abs(yR - yP) < 20 ? yP + 22 : yR + 4}" fill="#3cc8b4" font-size="12">lets go at ${fmt(k.release)}</text>`}
    <line x1="80" x2="196" y1="${yP}" y2="${yP}" stroke="#f0b53d" stroke-width="3"/>
    <circle cx="80" cy="${yP}" r="5" fill="#f0b53d"/>
    <text x="204" y="${yP + 5}" fill="#f0b53d" font-size="14" font-weight="600">fires at ${fmt(k.press)}</text>
  </svg>`;
}

function gaugeBlock(list) {
  const k = list.length ? list[0] : null;
  const node = el(`<div class="block gauge"><h3>How the key moves</h3><div id="gaugeSvg">${gaugeSvg(k)}</div>
    <p class="note">${list.length > 1 ? 'Showing the first selected key.' : list.length ? 'Top is the key at rest, bottom is fully pressed.' : 'Select a key to see its settings here.'}</p></div>`);
  return node;
}
function updateGauge(list) { const g = $('#gaugeSvg'); if (g) g.innerHTML = gaugeSvg(list[0]); drawLive(); }

function liveBlock() {
  const node = el(`<div class="block"><label class="toggle"><input type="checkbox" ${S.live.on ? 'checked' : ''}><span class="sw"></span><span>Show live key depth</span></label>
    <p class="note" id="liveNote">Press any key and watch how far it goes. <span id="gaugeLiveVal"></span></p></div>`);
  node.querySelector('input').onchange = e => (e.target.checked ? startLive() : stopLive());
  return node;
}
async function startLive() {
  S.live.on = true; S.live.last = 0;
  await guard(() => S.kb.setDepthReports(true));
  setTimeout(() => {
    if (S.live.on && !S.live.last && $('#liveNote')) $('#liveNote').textContent = 'No depth readings arrived. Press a key a few times. If nothing shows, this firmware only sends live depth over Bluetooth.';
  }, 6000);
}
function stopLive() {
  if (!S.live.on) return;
  S.live.on = false; S.live.pos = null;
  S.kb?.setDepthReports(false).catch(() => {});
  drawLive();
}

const PRESETS = [
  { name: 'Siege competitive', desc: 'WASD and lean keys fire at 0.4 mm with Rapid Trigger, everything else at 1.2 mm.', apply: () => {
    const fast = new Set([...GROUPS.wasd, 8, 20]); // + Q, E for leaning
    for (const k of editable()) {
      const c = S.keys[k.pos];
      if (fast.has(k.pos)) Object.assign(c, { press: 0.4, release: 0.4, rt: true, rtPress: 0.15, rtRelease: 0.15 });
      else Object.assign(c, { press: 1.2, release: 1.2, rt: false });
    }
  } },
  { name: 'Rapid Trigger everywhere', desc: 'Every key fires at 0.5 mm and resets the instant it lifts.', apply: () => {
    for (const k of editable()) Object.assign(S.keys[k.pos], { press: 0.5, release: 0.5, rt: true, rtPress: 0.2, rtRelease: 0.2 });
  } },
  { name: 'Comfortable typing', desc: 'All keys at 2.0 mm, Rapid Trigger off. Fewer typos.', apply: () => {
    for (const k of editable()) Object.assign(S.keys[k.pos], { press: 2.0, release: 2.0, rt: false });
  } },
  { name: 'Light and quick', desc: 'All keys at 1.0 mm, Rapid Trigger off.', apply: () => {
    for (const k of editable()) Object.assign(S.keys[k.pos], { press: 1.0, release: 1.0, rt: false });
  } },
];

function presetBlock() {
  const node = el('<div class="block"><h3>Start from a preset</h3><div class="presets"></div><p class="note">Presets fill in the keys, then you can fine-tune. Nothing changes on the keyboard until you save.</p></div>');
  for (const pr of PRESETS) {
    const b = el(`<button class="preset"><b>${pr.name}</b><span>${pr.desc}</span></button>`);
    b.onclick = () => {
      pr.apply();
      for (const f of ['press', 'release', 'rtPress', 'rtRelease', 'mode']) S.pendingFields.add(f);
      renderBoard();
      renderPanel();
      toast(`${pr.name} loaded. Press Save to send it to the keyboard.`);
    };
    node.querySelector('.presets').appendChild(b);
  }
  return node;
}

// ---------------------------------------------------------------- advanced keys
const ADV_MODES = [
  { id: MODE.NORMAL, name: 'Normal', desc: 'One press, one key. Uses the actuation settings.' },
  { id: MODE.SNAP, name: 'Snap Tap', desc: 'Pair two keys. Pressing one cancels the other, great for A and D.' },
  { id: MODE.DKS, name: 'Dynamic keystroke', desc: 'Up to four actions on one key, at different depths.' },
  { id: MODE.MT, name: 'Tap or hold', desc: 'Tap for one action, hold for another.' },
  { id: MODE.TGL_HOLD, name: 'Toggle', desc: 'Tap once to keep the key held down, tap again to let go.' },
  { id: MODE.TGL_RAPID, name: 'Rapid fire', desc: 'Repeats the key really fast while you hold it.' },
];

function advDraft(pos) {
  const c = S.keys[pos];
  return {
    pos,
    mode: c.mode,
    partner: c.mode === MODE.SNAP ? c.snapWith : null,
    dksTravel: c.dksTravel || 0.5,
    press: c.press,
    rows: [...c.dksRows],
    outs: [0, 1, 2, 3].map(i => action(S.subs[i], pos)),
    mtTime: c.mtTime || 200,
    savedMode: c.mode,
  };
}

// When a key switches into a mode it wasn't in, start from sensible outputs.
function seedMode(d, mode) {
  const base = action(S.subs[0], d.pos);
  const out = base.some(Boolean) ? base : DEFAULT_ACTION(d.pos);
  const none = [0, 0, 0, 0];
  if (mode === d.savedMode) return;
  if (mode === MODE.DKS) {
    d.outs = [out, none, none, none];
    d.rows = [1 | (0 << 2), 0, 0, 0];
    d.dksTravel = 1.0;
    d.press = Math.max(d.press, 3.0);
  }
  if (mode === MODE.MT) d.outs = [out, out, none, none];
  if (mode === MODE.TGL_HOLD || mode === MODE.TGL_RAPID) d.outs = [out, none, none, none];
}

function renderAdvanced(p) {
  const pos = [...S.sel][0];
  if (pos === undefined) {
    p.appendChild(el(`<div><h2>Advanced keys</h2><p class="lead">Pick one key above, or press it on your keyboard. Then choose what it should do: Snap Tap, tap-or-hold, toggles, or several actions in one press.</p></div>`));
    return;
  }
  if (!S.adv || S.adv.pos !== pos) S.adv = advDraft(pos);
  const d = S.adv;
  const key = BY_POS.get(pos);
  p.appendChild(el(`<div><h2>${esc(key.label)} key</h2><p class="lead">Choose a behavior, set it up, then press Save.</p></div>`));
  const modes = el('<div class="modes"></div>');
  for (const m of ADV_MODES) {
    const b = el(`<button class="mode${d.mode === m.id ? ' on' : ''}"><b>${m.name}</b><span>${m.desc}</span></button>`);
    b.onclick = () => {
      if (d.mode !== m.id) seedMode(d, m.id);
      d.mode = m.id;
      if (m.id === MODE.SNAP && d.partner == null) S.targetMode = 'snap';
      else S.targetMode = null;
      renderBoard(); renderPanel();
    };
    modes.appendChild(b);
  }
  p.appendChild(modes);

  const body = el('<div class="block stack" style="margin-top:16px"></div>');
  if (d.mode === MODE.NORMAL) body.appendChild(el('<p class="note" style="margin:0">This key types normally. Set how deep it fires on the Actuation page.</p>'));

  if (d.mode === MODE.SNAP) {
    const partner = BY_POS.get(d.partner);
    body.appendChild(el(`<div><h3>Snap Tap partner</h3><p class="note" style="margin:0 0 12px">${S.targetMode === 'snap' ? 'Click the partner key on the keyboard above, or press it.' : `Paired with <b style="color:var(--text)">${esc(partner?.label ?? '?')}</b>. When both are held, the one pressed last wins.`}</p></div>`));
    const b = el(`<button class="btn small">${partner ? 'Pick a different partner' : 'Pick the partner key'}</button>`);
    b.onclick = () => { S.targetMode = 'snap'; renderBoard(); renderPanel(); };
    body.appendChild(b);
  }

  if (d.mode === MODE.DKS) {
    body.appendChild(el('<h3>Actions by depth</h3>'));
    body.appendChild(dksField('dksTravel', 'First trigger point', 'The light-press point. Actions in the first and last column happen here.', 0.1, 3.3));
    body.appendChild(dksField('press', 'Bottom-out point', 'The deep-press point. Actions in the middle columns happen here.', 0.1, 3.4));
    const g = el(`<div class="dks">
      <div class="h">Output key</div>
      <div class="h"><b>Light press</b>going down</div><div class="h"><b>Full press</b>going down</div>
      <div class="h"><b>Start lifting</b>coming up</div><div class="h"><b>Full release</b>coming up</div></div>`);
    for (let r = 0; r < 4; r++) {
      const out = d.outs[r];
      const set = !sameBytes(out, [0, 0, 0, 0]);
      const ob = el(`<button class="out${set ? ' set' : ''}">${set ? esc(describeAction(out)) : '+ Add key'}</button>`);
      ob.onclick = () => openActionPicker(act => { d.outs[r] = act; if (!act.some(Boolean)) d.rows[r] = 0; renderPanel(); }, `Output ${r + 1}`);
      g.appendChild(ob);
      for (let s = 0; s < 4; s++) {
        const v = (d.rows[r] >> (s * 2)) & 3;
        const label = ['', 'Tap', 'Hold', 'Hold on'][v];
        const c = el(`<button class="cell" data-v="${v}" title="Click to change">${label}</button>`);
        c.onclick = () => {
          const nv = (v + 1) % 4;
          d.rows[r] = (d.rows[r] & ~(3 << (s * 2))) | (nv << (s * 2));
          renderPanel();
        };
        g.appendChild(c);
      }
    }
    body.appendChild(g);
    if (d.dksTravel >= d.press) body.appendChild(el('<p class="warn">The first trigger point should be shallower than the bottom-out point.</p>'));
    body.appendChild(el('<p class="note">Click a box to cycle: <b>Tap</b> presses once. <b>Hold</b> keeps it down until the next point. <b>Hold on</b> keeps it down until the key is fully released.</p>'));
  }

  if (d.mode === MODE.MT) {
    body.appendChild(el('<h3>Tap or hold</h3>'));
    const row = el('<div class="row" style="gap:16px"></div>');
    const mk = (label, i) => {
      const w = el(`<div class="stack" style="gap:6px"><span class="note" style="margin:0">${label}</span><button class="btn">${esc(describeAction(d.outs[i]) || 'Pick a key')}</button></div>`);
      w.querySelector('button').onclick = () => openActionPicker(act => { d.outs[i] = act; renderPanel(); }, label);
      return w;
    };
    row.appendChild(mk('When tapped', 1));
    row.appendChild(mk('When held', 0));
    body.appendChild(row);
    const f = el(`<div class="field"><label>Hold time</label><div class="val">${d.mtTime}<small>ms</small></div>
      <input type="range" class="release" min="100" max="1000" step="10" value="${d.mtTime}" style="--p:${((d.mtTime - 100) / 900) * 100}%">
      <div class="hint">Hold longer than this and the key counts as held.</div></div>`);
    f.querySelector('input').oninput = e => { d.mtTime = +e.target.value; f.querySelector('.val').innerHTML = `${d.mtTime}<small>ms</small>`; e.target.style.setProperty('--p', `${((d.mtTime - 100) / 900) * 100}%`); };
    body.appendChild(f);
  }

  if (d.mode === MODE.TGL_HOLD || d.mode === MODE.TGL_RAPID) {
    body.appendChild(el(`<h3>${d.mode === MODE.TGL_HOLD ? 'Key to toggle' : 'Key to repeat'}</h3>`));
    const b = el(`<button class="btn">${esc(describeAction(d.outs[0]) || 'Pick a key')}</button>`);
    b.onclick = () => openActionPicker(act => { d.outs[0] = act; renderPanel(); }, 'Output');
    body.appendChild(b);
  }
  p.appendChild(body);

  const bar = el('<div class="save-bar"><span class="msg"></span><span class="spacer"></span><button class="btn" id="advReset">Undo</button><button class="btn primary" id="advSave">Save to keyboard</button></div>');
  bar.querySelector('#advReset').onclick = () => { S.adv = null; S.targetMode = null; renderBoard(); renderPanel(); };
  bar.querySelector('#advSave').onclick = () => saveAdvanced();
  if (d.mode === MODE.SNAP && d.partner == null) bar.querySelector('#advSave').disabled = true;
  p.appendChild(bar);
}

function dksField(f, label, hint, min, max) {
  const d = S.adv;
  const v = d[f];
  const node = el(`<div class="field"><label>${label}</label><div class="val">${fmt(v)}<small>mm</small></div>
    <input type="range" class="${f === 'press' ? 'press' : 'release'}" min="${min}" max="${max}" step="${step()}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%"><div class="hint">${hint}</div></div>`);
  node.querySelector('input').oninput = e => {
    d[f] = +e.target.value;
    node.querySelector('.val').innerHTML = `${fmt(d[f])}<small>mm</small>`;
    e.target.style.setProperty('--p', `${((d[f] - min) / (max - min)) * 100}%`);
  };
  return node;
}

function pickTarget(pos) {
  const d = S.adv;
  if (!d || pos === d.pos) return;
  d.partner = pos;
  S.targetMode = null;
  renderBoard();
  renderPanel();
}

async function saveAdvanced() {
  const d = S.adv;
  if (!d) return;
  const fields = new Set(['mode']);
  const dks = [];
  const keys = S.keys;
  const me = keys[d.pos];
  // undo an old Snap Tap pairing on both sides
  const unpair = pos => {
    const k = keys[pos];
    if (k.mode === MODE.SNAP) {
      const other = keys[k.snapWith];
      if (other && other.mode === MODE.SNAP && other.snapWith === pos) { other.mode = MODE.NORMAL; other.snapWith = 0; }
      k.snapWith = 0;
      fields.add('snapWith');
    }
  };
  unpair(d.pos);
  me.mode = d.mode;
  const subWrites = [];
  const want = i => d.outs[i];
  if (d.mode === MODE.SNAP) {
    unpair(d.partner);
    const other = keys[d.partner];
    other.mode = MODE.SNAP; other.snapWith = d.pos;
    me.snapWith = d.partner;
    fields.add('snapWith');
  }
  if (d.mode === MODE.DKS) {
    me.dksTravel = d.dksTravel; me.press = d.press; me.dksRows = [...d.rows];
    fields.add('dksTravel'); fields.add('press');
    dks.push(d.pos);
    for (let i = 0; i < 4; i++) subWrites.push([i, want(i)]);
  }
  if (d.mode === MODE.MT) {
    me.mtTime = d.mtTime; fields.add('mtTime');
    subWrites.push([0, want(0)], [1, want(1)]);
  }
  if (d.mode === MODE.TGL_HOLD || d.mode === MODE.TGL_RAPID) subWrites.push([0, want(0)]);
  if (d.mode === MODE.NORMAL || d.mode === MODE.SNAP) {
    // give the key its normal output back if an advanced mode had taken it over
    const cur = action(S.subs[0], d.pos);
    if (S.saved[d.pos].mode !== MODE.NORMAL && S.saved[d.pos].mode !== MODE.SNAP) subWrites.push([0, DEFAULT_ACTION(d.pos)]);
    else if (!cur.some(Boolean)) subWrites.push([0, DEFAULT_ACTION(d.pos)]);
  }
  await guard(async () => {
    for (const [sub, act] of subWrites) {
      if (sameBytes(action(S.subs[sub], d.pos), act)) continue;
      await S.kb.setKey(S.profile, d.pos, act, sub);
      S.subs[sub].splice(d.pos * 4, 4, ...act);
    }
    // only send what this editor touched; leave unsaved actuation edits for the Actuation page
    const merged = S.saved.map((k, i) => (i === d.pos || i === d.partner || keys[i].mode !== k.mode || keys[i].snapWith !== k.snapWith) ? keys[i] : k);
    await S.kb.writeSwitches(merged, fields, dks);
    S.saved = clone(merged);
    S.keys = clone(merged);
    S.adv = null;
    renderBoard();
    renderPanel();
  }, `Saved to profile ${S.profile + 1}`);
}

// ---------------------------------------------------------------- action picker (used by remap and advanced)
function pickerBody(onPick, current) {
  const wrap = el('<div class="picker"><div class="picker-tabs"></div><div class="picker-body"></div></div>');
  const tabs = [['press', 'Press a key'], ['keys', 'All keys'], ['combo', 'Key combo'], ['media', 'Media and system'], ['mouse', 'Mouse'], ['kb', 'Keyboard and lights'], ['macro', 'Macro'], ['off', 'Turn off']];
  const tabsEl = wrap.querySelector('.picker-tabs');
  const body = wrap.querySelector('.picker-body');
  const show = t => {
    S.pickerTab = t;
    tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    body.innerHTML = '';
    S.capturing = false;
    if (t === 'press') {
      const c = el('<button class="capture" style="width:100%;background:none">Click here, then press the key you want it to type</button>');
      const onKey = e => {
        if (!document.body.contains(c)) { S.capturing = false; return window.removeEventListener('keydown', onKey, true); }
        const hid = CODE_TO_HID[e.code];
        if (!hid) return;
        e.preventDefault(); e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        S.capturing = false;
        onPick([0, 0, hid, 0]);
      };
      c.onclick = () => {
        if (S.capturing) return;
        S.capturing = true;
        c.classList.add('listening');
        c.textContent = 'Listening… press the key now';
        window.addEventListener('keydown', onKey, true);
      };
      body.appendChild(c);
      body.appendChild(el('<p class="note">Works for normal keys. For media keys or mouse buttons, use the other tabs.</p>'));
    }
    if (t === 'keys') {
      for (const sec of PICKER_SECTIONS) {
        body.appendChild(el(`<div class="sec-title">${sec.name}</div>`));
        const g = el('<div class="keys-grid"></div>');
        for (const code of sec.codes) {
          const b = el(`<button class="k${current && sameBytes(current, [0, 0, code, 0]) ? ' on' : ''}">${esc(HID_NAMES[code])}</button>`);
          b.onclick = () => onPick([0, 0, code, 0]);
          g.appendChild(b);
        }
        body.appendChild(g);
      }
    }
    if (t === 'combo') {
      const combo = [];
      const view = el('<div class="stack"><p class="note" style="margin:0">Pick up to 3 keys pressed together, like Ctrl + Shift + Esc.</p><div class="row" id="comboShow"></div><div class="row"><button class="btn primary small" id="comboUse" disabled>Use this combo</button><button class="btn small" id="comboClear">Start over</button></div><div id="comboKeys"></div></div>');
      const redraw = () => {
        view.querySelector('#comboShow').innerHTML = combo.length ? combo.map(c => `<span class="k on">${esc(shortName(c))}</span>`).join('<span class="note">+</span>') : '<span class="note">No keys yet</span>';
        view.querySelector('#comboUse').disabled = combo.length < 1;
      };
      const grid = view.querySelector('#comboKeys');
      for (const sec of [PICKER_SECTIONS[5], PICKER_SECTIONS[0], PICKER_SECTIONS[1], PICKER_SECTIONS[3], PICKER_SECTIONS[6]]) {
        grid.appendChild(el(`<div class="sec-title">${sec.name}</div>`));
        const g = el('<div class="keys-grid"></div>');
        for (const code of sec.codes) {
          const b = el(`<button class="k">${esc(HID_NAMES[code])}</button>`);
          b.onclick = () => { if (combo.length < 3 && !combo.includes(code)) { combo.push(code); redraw(); } };
          g.appendChild(b);
        }
        grid.appendChild(g);
      }
      view.querySelector('#comboClear').onclick = () => { combo.length = 0; redraw(); };
      view.querySelector('#comboUse').onclick = () => {
        const c = [...combo].sort((a, b) => (b >= 224) - (a >= 224));
        onPick([0, c[0] ?? 0, c[1] ?? 0, c[2] ?? 0].map((v, i, arr) => v));
      };
      redraw();
      body.appendChild(view);
    }
    const listOf = groups => {
      for (const grp of groups) {
        body.appendChild(el(`<div class="sec-title">${grp}</div>`));
        const g = el('<div class="keys-grid"></div>');
        for (const s of SPECIAL_ACTIONS.filter(a => a.group === grp)) {
          const b = el(`<button class="k${current && sameBytes(current, s.bytes) ? ' on' : ''}">${esc(s.name)}</button>`);
          b.onclick = () => onPick([...s.bytes]);
          g.appendChild(b);
        }
        body.appendChild(g);
      }
    };
    if (t === 'media') listOf(['Media', 'System']);
    if (t === 'mouse') listOf(['Mouse']);
    if (t === 'kb') listOf(['Keyboard', 'Lighting']);
    if (t === 'macro') {
      body.appendChild(el('<p class="note" style="margin:0 0 12px">Record macros on the Macros page first, then assign them here.</p>'));
      const g = el('<div class="keys-grid"></div>');
      for (let i = 0; i < 16; i++) {
        const b = el(`<button class="k">Macro ${i + 1}</button>`);
        b.onclick = () => onPick([9, 0, i, 0]);
        g.appendChild(b);
      }
      body.appendChild(g);
      body.appendChild(el('<p class="note">Plays once per press.</p>'));
    }
    if (t === 'off') {
      const b = el('<button class="btn">Turn this key off</button>');
      b.onclick = () => onPick([0, 0, 0, 0]);
      body.appendChild(el('<p class="note" style="margin:0 0 12px">The key does nothing when pressed. Handy for the Windows key while gaming.</p>'));
      body.appendChild(b);
    }
  };
  for (const [id, name] of tabs) {
    const b = el(`<button data-t="${id}">${name}</button>`);
    b.onclick = () => show(id);
    tabsEl.appendChild(b);
  }
  show(S.pickerTab === 'press' || tabs.some(t => t[0] === S.pickerTab) ? S.pickerTab : 'press');
  return wrap;
}

function openActionPicker(onPick, title) {
  const close = modal(`<h2>${esc(title)}</h2><div id="pickerHost" style="max-height:60vh;overflow:auto"></div><div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="pickCancel">Cancel</button></div>`, (card, close) => {
    card.style.width = '760px';
    card.querySelector('#pickCancel').onclick = close;
    card.querySelector('#pickerHost').appendChild(pickerBody(act => { close(); onPick(act); }));
  });
  return close;
}

// ---------------------------------------------------------------- remap view
function renderRemap(p) {
  const pos = [...S.sel][0];
  const fnLayer = S.remapLayer === 'fn';
  if (pos === undefined) {
    p.appendChild(el(`<div><h2>${fnLayer ? 'Fn layer' : 'Remap keys'}</h2><p class="lead">${fnLayer ? 'These are the actions you get while holding Fn. ' : ''}Pick a key above, or press it on your keyboard, then choose what it should do.</p></div>`));
    return;
  }
  const key = BY_POS.get(pos);
  const cfg = S.keys[pos];
  const layer = fnLayer ? S.fn : S.subs[0];
  const cur = action(layer, pos);
  const def = fnLayer ? [0, 0, 0, 0] : DEFAULT_ACTION(pos);
  const head = el(`<div class="row" style="align-items:flex-start"><div><h2>${fnLayer ? 'Fn + ' : ''}${esc(key.label)}</h2>
    <p class="lead">Right now: <b style="color:var(--text)">${esc(describeAction(cur) || 'Nothing')}</b>. Pick something new below and it saves straight away.</p></div><span class="spacer"></span>
    <button class="btn small" id="resetKey" ${sameBytes(cur, def) ? 'disabled' : ''}>${fnLayer ? 'Clear' : 'Back to default'}</button></div>`);
  p.appendChild(head);
  const blocked = !fnLayer && cfg && [MODE.DKS, MODE.MT, MODE.TGL_HOLD, MODE.TGL_RAPID].includes(cfg.mode);
  if (blocked) {
    p.appendChild(el('<div class="block"><p class="warn" style="margin:0">This key uses an advanced behavior, which decides its output. Change it on the Advanced keys page, or set it back to Normal there first.</p></div>'));
    return;
  }
  const write = act => guard(async () => {
    if (fnLayer) { await S.kb.setFnKey(S.profile, pos, act, 0); S.fn.splice(pos * 4, 4, ...act); }
    else { await S.kb.setKey(S.profile, pos, act, 0); S.subs[0].splice(pos * 4, 4, ...act); }
    renderBoard();
    renderPanel();
  }, `${fnLayer ? 'Fn + ' : ''}${key.label} now does: ${describeAction(act) || 'nothing'}`);
  head.querySelector('#resetKey').onclick = () => write(def);
  const block = el('<div class="block"></div>');
  block.appendChild(pickerBody(write, cur));
  p.appendChild(block);
}

// ---------------------------------------------------------------- lighting view
const FX = [
  { id: 1, name: 'Static', speed: false }, { id: 2, name: 'Breathing' }, { id: 4, name: 'Wave', dirs: ['Right', 'Left', 'Down', 'Up'] },
  { id: 5, name: 'Ripple' }, { id: 6, name: 'Raindrop' }, { id: 7, name: 'Snake', dirs: ['Zigzag', 'Spiral'] },
  { id: 8, name: 'Light on press' }, { id: 19, name: 'Dark on press' }, { id: 9, name: 'Converge' }, { id: 10, name: 'Sine wave' },
  { id: 11, name: 'Kaleidoscope', dirs: ['Outward', 'Inward'] }, { id: 12, name: 'Line wave', dirs: ['Right', 'Left'] },
  { id: 14, name: 'Laser' }, { id: 15, name: 'Circle wave', dirs: ['Counter-clockwise', 'Clockwise'] }, { id: 16, name: 'Dazzle' },
  { id: 17, name: 'Rain down' }, { id: 18, name: 'Meteor' }, { id: 3, name: 'Neon', color: false },
  { id: 13, name: 'My patterns', color: false, speed: false, dirs: ['Pattern 1', 'Pattern 2', 'Pattern 3', 'Pattern 4', 'Pattern 5'] },
  { id: 0, name: 'Off', color: false, speed: false, bright: false },
];
const SWATCH = [0xffffff, 0xff2a2a, 0xff8a00, 0xffd400, 0x3cff6a, 0x00e1ff, 0x2f6bff, 0xa35cff, 0xff4fc3];
let lightTimer;
function queueLight() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(() => guard(() => S.kb.setLight(S.light)), 250);
}

function renderLighting(p) {
  const L = S.light;
  const fx = FX.find(f => f.id === L.effect) ?? FX[0];
  const grid = el('<div class="panel-grid"><div class="stack" id="lLeft"></div><div class="stack" id="lRight"></div></div>');
  p.appendChild(grid);
  const left = grid.querySelector('#lLeft');
  const right = grid.querySelector('#lRight');
  left.appendChild(el('<div><h2>Lighting</h2><p class="lead">Changes show on the keyboard as you make them.</p></div>'));
  const fxGrid = el('<div class="fx-grid"></div>');
  for (const f of FX) {
    const b = el(`<button class="fx${f.id === L.effect ? ' on' : ''}">${f.name}</button>`);
    b.onclick = () => {
      L.effect = f.id;
      if (!f.dirs || L.option >= f.dirs.length) L.option = 0;
      S.paint = null;
      queueLight();
      renderAll();
    };
    fxGrid.appendChild(b);
  }
  left.appendChild(el('<div class="block"></div>')).appendChild(fxGrid);

  const ctl = el('<div class="block stack"></div>');
  const lvl = (label, key, show) => {
    if (!show) return;
    const f = el(`<div class="field"><label>${label}</label><div class="val">${L[key]}<small>/ 4</small></div>
      <input type="range" class="plain" min="0" max="4" step="1" value="${L[key]}" style="--p:${L[key] * 25}%"></div>`);
    f.querySelector('input').oninput = e => { L[key] = +e.target.value; f.querySelector('.val').innerHTML = `${L[key]}<small>/ 4</small>`; e.target.style.setProperty('--p', `${L[key] * 25}%`); queueLight(); };
    ctl.appendChild(f);
  };
  lvl('Brightness', 'bright', fx.bright !== false);
  lvl('Speed', 'speed', fx.speed !== false);
  if (fx.dirs) {
    const seg = el('<div class="stack" style="gap:8px"><label style="font-weight:600">' + (fx.id === 13 ? 'Which pattern' : 'Direction') + '</label><div class="seg"></div></div>');
    fx.dirs.forEach((d, i) => {
      const b = el(`<button class="${i === L.option ? 'on' : ''}">${d}</button>`);
      b.onclick = () => { L.option = i; queueLight(); if (S.paint) loadPattern(i); renderPanel(); };
      seg.querySelector('.seg').appendChild(b);
    });
    ctl.appendChild(seg);
  }
  if (fx.color !== false) {
    const c = el(`<div class="stack" style="gap:10px"><label class="toggle ok"><input type="checkbox" ${L.rainbow ? 'checked' : ''}><span class="sw"></span><span>Rainbow colors</span></label>
      <div class="row ${L.rainbow ? 'hidden' : ''}" id="colorRow"><div class="swatches"></div><input type="color" value="#${L.rgb.toString(16).padStart(6, '0')}" title="Any color"></div></div>`);
    c.querySelector('input[type=checkbox]').onchange = e => { L.rainbow = e.target.checked; queueLight(); renderPanel(); };
    for (const sw of SWATCH) {
      const b = el(`<button class="swatch${!L.rainbow && L.rgb === sw ? ' on' : ''}" style="--c:#${sw.toString(16).padStart(6, '0')}" title="Pick color"></button>`);
      b.onclick = () => { L.rgb = sw; queueLight(); renderPanel(); };
      c.querySelector('.swatches').appendChild(b);
    }
    c.querySelector('input[type=color]').oninput = e => { L.rgb = parseInt(e.target.value.slice(1), 16); queueLight(); };
    ctl.appendChild(c);
  }
  if (fx.id === 13) {
    const b = el(`<button class="btn ${S.paint ? '' : 'primary'}">${S.paint ? 'Stop painting' : 'Paint this pattern'}</button>`);
    b.onclick = () => { if (S.paint) { S.paint = null; renderAll(); } else loadPattern(L.option); };
    ctl.appendChild(b);
  }
  right.appendChild(ctl);
  if (S.paint) right.appendChild(paintBlock());
  if (L.effect === 0) right.appendChild(el('<p class="note">Lights are off.</p>'));
}

async function loadPattern(slot) {
  await guard(async () => {
    const data = await S.kb.getPattern(slot);
    S.paint = { slot, data: [...data], color: S.paint?.color ?? 0xffffff, dirty: false };
    renderAll();
  });
}
function paintKey(pos) {
  const c = S.paint.color;
  S.paint.data.splice(pos * 3, 3, (c >> 16) & 255, (c >> 8) & 255, c & 255);
  S.paint.dirty = true;
  const cap = $(`.cap[data-pos="${pos}"]`);
  cap?.style.setProperty('--paint', `#${c.toString(16).padStart(6, '0')}`);
  cap?.classList.add('paint');
  const saveBtn = $('#patSave');
  if (saveBtn) saveBtn.disabled = false;
}
function paintBlock() {
  const P = S.paint;
  const node = el(`<div class="block stack"><h3 style="margin:0">Paint pattern ${P.slot + 1}</h3><div class="swatches"></div>
    <div class="row"><input type="color" value="#${P.color.toString(16).padStart(6, '0')}"><button class="btn small" id="patFill">Fill every key</button><button class="btn small" id="patClear">Clear all</button></div>
    <button class="btn primary" id="patSave" ${P.dirty ? '' : 'disabled'}>Save pattern to keyboard</button></div>`);
  for (const sw of [...SWATCH, 0x000000]) {
    const b = el(`<button class="swatch${P.color === sw ? ' on' : ''}" style="--c:#${sw.toString(16).padStart(6, '0')}" title="${sw === 0 ? 'Off' : 'Pick color'}"></button>`);
    b.onclick = () => { P.color = sw; renderPanel(); };
    node.querySelector('.swatches').appendChild(b);
  }
  node.querySelector('input[type=color]').oninput = e => { P.color = parseInt(e.target.value.slice(1), 16); };
  const fillAll = c => { for (const k of LAYOUT) P.data.splice(k.pos * 3, 3, (c >> 16) & 255, (c >> 8) & 255, c & 255); P.dirty = true; renderAll(); };
  node.querySelector('#patFill').onclick = () => fillAll(P.color);
  node.querySelector('#patClear').onclick = () => fillAll(0);
  node.querySelector('#patSave').onclick = () => guard(async () => {
    await S.kb.setPattern(P.slot, P.data);
    S.light.effect = 13; S.light.option = P.slot;
    await S.kb.setLight(S.light);
    P.dirty = false;
    renderPanel();
  }, `Pattern ${P.slot + 1} saved`);
  return node;
}

// ---------------------------------------------------------------- macros view
function renderMacros(p) {
  const grid = el('<div class="panel-grid" style="grid-template-columns:200px 1fr"><div class="block"><h3>Macro slots</h3><div class="macro-list"></div></div><div class="stack" id="mBody"></div></div>');
  p.appendChild(grid);
  const list = grid.querySelector('.macro-list');
  for (let i = 0; i < 16; i++) {
    const b = el(`<button class="${i === S.macroSlot ? 'on' : ''}">Macro ${i + 1}</button>`);
    b.onclick = () => { S.macroSlot = i; S.macro = null; renderPanel(); };
    list.appendChild(b);
  }
  const body = grid.querySelector('#mBody');
  if (!S.macro || S.macro.slot !== S.macroSlot) {
    body.appendChild(el('<p class="note">Reading macro from the keyboard…</p>'));
    guard(async () => {
      const m = await S.kb.getMacro(S.macroSlot);
      S.macro = { slot: S.macroSlot, repeat: m.repeat || 1, steps: m.steps, recording: false, dirty: false };
      renderPanel();
    });
    return;
  }
  const M = S.macro;
  const bytes = 2 + M.steps.reduce((n, s) => n + (s.delay > 127 ? 4 : 2), 0);
  body.appendChild(el(`<div><h2>Macro ${M.slot + 1}</h2><p class="lead">Record a sequence of key presses, then assign it to any key on the Remap page.</p></div>`));
  const ctl = el(`<div class="block stack"><div class="row"><button class="btn ${M.recording ? '' : 'primary'}" id="recBtn"><span class="rec-dot"></span>${M.recording ? 'Stop recording' : 'Record'}</button>
    <button class="btn" id="clrBtn" ${M.steps.length ? '' : 'disabled'}>Clear</button><span class="spacer"></span>
    <label class="row" style="gap:8px">Play <input type="number" min="1" max="999" value="${M.repeat}" id="repIn"> time(s)</label></div>
    <p class="note" style="margin:0">${M.recording ? 'Recording. Type on your keyboard, the timing is captured too. Press Stop when done.' : `${M.steps.length} steps, ${bytes} of 256 bytes used.`}</p>
    <div class="steps" id="steps"></div>
    <div class="row"><span class="spacer"></span><button class="btn primary" id="mSave" ${M.dirty && M.steps.length && !M.recording ? '' : 'disabled'}>Save macro to keyboard</button></div></div>`);
  if (M.recording) ctl.classList.add('recording');
  const stepsEl = ctl.querySelector('#steps');
  if (!M.steps.length && !M.recording) stepsEl.appendChild(el('<div class="empty">No steps yet. Press Record and type something.</div>'));
  M.steps.forEach((s, i) => {
    const name = s.type === 'mouse' ? ['Left click', 'Right click', 'Middle click', 'Mouse back', 'Mouse forward'][s.button] : (HID_NAMES[s.code] ?? `Key ${s.code}`);
    const row = el(`<div class="step"><span class="dir ${s.down ? 'down' : 'up'}" title="${s.down ? 'Press' : 'Release'}">${s.down ? '↓' : '↑'}</span><span>${esc(name)} ${s.down ? 'down' : 'up'}</span>
      <label class="row" style="gap:6px"><input type="number" min="1" max="65535" value="${s.delay}" style="width:76px"> ms</label><button title="Remove step">✕</button></div>`);
    row.querySelector('input').onchange = e => { s.delay = Math.max(1, Math.min(65535, +e.target.value || 1)); M.dirty = true; renderPanel(); };
    row.querySelector('button').onclick = () => { M.steps.splice(i, 1); M.dirty = true; renderPanel(); };
    stepsEl.appendChild(row);
  });
  ctl.querySelector('#recBtn').onclick = () => (M.recording ? stopRecording() : startRecording());
  ctl.querySelector('#clrBtn').onclick = () => { M.steps = []; M.dirty = true; renderPanel(); };
  ctl.querySelector('#repIn').onchange = e => { M.repeat = Math.max(1, Math.min(999, +e.target.value || 1)); M.dirty = true; renderPanel(); };
  ctl.querySelector('#mSave').onclick = () => {
    if (bytes > 256) return toast('This macro is too long for the keyboard. Remove some steps.', true);
    guard(async () => { await S.kb.setMacro(M.slot, { repeat: M.repeat, steps: M.steps }); M.dirty = false; renderPanel(); }, `Macro ${M.slot + 1} saved. Assign it to a key on the Remap page.`);
  };
  body.appendChild(ctl);
}

let recLast = 0;
function recKey(e) {
  const M = S.macro;
  if (!M?.recording) return;
  const hid = CODE_TO_HID[e.code];
  if (!hid) return;
  e.preventDefault();
  if (e.type === 'keydown' && e.repeat) return;
  const now = performance.now();
  if (M.steps.length) M.steps[M.steps.length - 1].delay = Math.max(1, Math.round(now - recLast));
  recLast = now;
  M.steps.push({ type: 'key', code: hid, down: e.type === 'keydown', delay: 10 });
  M.dirty = true;
  renderPanel();
}
function startRecording() {
  S.macro.recording = true;
  S.macro.steps = [];
  recLast = performance.now();
  window.addEventListener('keydown', recKey, true);
  window.addEventListener('keyup', recKey, true);
  renderPanel();
}
function stopRecording() {
  S.macro.recording = false;
  window.removeEventListener('keydown', recKey, true);
  window.removeEventListener('keyup', recKey, true);
  renderPanel();
}

// ---------------------------------------------------------------- settings view
function renderSettings(p) {
  const O = S.options;
  p.appendChild(el('<div><h2>Settings</h2><p class="lead">These apply to the current profile and save as soon as you change them.</p></div>'));
  const grid = el('<div class="panel-grid"><div class="stack" id="sLeft"></div><div class="stack" id="sRight"></div></div>');
  p.appendChild(grid);
  const left = grid.querySelector('#sLeft');
  const right = grid.querySelector('#sRight');

  const segBlock = (title, hint, options, value, onPick) => {
    const b = el(`<div class="block stack" style="gap:10px"><h3 style="margin:0">${title}</h3><div class="seg"></div><p class="note" style="margin:0">${hint}</p></div>`);
    for (const [v, label] of options) {
      const btn = el(`<button class="${v === value ? 'on' : ''}">${label}</button>`);
      btn.onclick = () => onPick(v);
      b.querySelector('.seg').appendChild(btn);
    }
    return b;
  };
  left.appendChild(segBlock('Polling rate', 'How often the keyboard reports to your PC. 8000 Hz is the fastest. Drop to 1000 Hz if a game or PC stutters.',
    RATES.slice(0, 5).map(r => [r, `${r} Hz`]), S.rate, r => guard(async () => { await S.kb.setRate(r); S.rate = r; renderPanel(); }, `Polling rate set to ${r} Hz`)));
  left.appendChild(segBlock('Rapid Trigger stability', 'Smooths out tiny wobbles at the bottom of a press. Higher is steadier but adds a little delay. Leave at 0% unless keys chatter.',
    [0, 25, 50, 75, 100].map(v => [v, `${v}%`]), O.rtStab, v => setOpt({ rtStab: v }, `Stability set to ${v}%`)));
  left.appendChild(segBlock('Operating system', 'Changes what the Windows and Alt keys do.', [['win', 'Windows'], ['mac', 'Mac']], O.system, v => setOpt({ system: v }, v === 'mac' ? 'Mac mode on' : 'Windows mode on')));

  const toggles = el('<div class="block stack"></div>');
  const tg = (label, hint, key) => {
    const t = el(`<div><label class="toggle ok"><input type="checkbox" ${O[key] ? 'checked' : ''}><span class="sw"></span><span>${label}</span></label><p class="note">${hint}</p></div>`);
    t.querySelector('input').onchange = e => setOpt({ [key]: e.target.checked }, `${label} ${e.target.checked ? 'on' : 'off'}`);
    toggles.appendChild(t);
  };
  tg('Accidental press guard', 'Compensates for desk bumps and small switch differences so keys don\'t fire by themselves.', 'antiMistouch');
  tg('Swap WASD and arrow keys', 'WASD acts as arrows and arrows act as WASD.', 'wasdSwap');
  left.appendChild(toggles);

  const sw = el(`<div class="block stack" style="gap:10px"><h3 style="margin:0">Switch type</h3><select></select><p class="note" style="margin:0">Tells the keyboard which magnetic switches are installed so depth readings are accurate. Only change this if you swapped the switches.</p></div>`);
  const cur = common(editable().map(k => S.keys[k.pos]), 'switchType');
  const sel = sw.querySelector('select');
  if (cur === 'mixed') sel.appendChild(el('<option selected>Mixed</option>'));
  SWITCH_TYPES.forEach((name, i) => sel.appendChild(el(`<option value="${i}" ${cur === i ? 'selected' : ''}>${name}</option>`)));
  sel.onchange = () => {
    const v = +sel.value;
    const keys = clone(S.saved);
    for (const k of editable()) keys[k.pos].switchType = v;
    guard(async () => { await S.kb.writeSwitches(keys, new Set(['switchType'])); S.saved = keys; for (const k of editable()) S.keys[k.pos].switchType = v; }, 'Switch type saved');
  };
  right.appendChild(sw);

  const cal = el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Calibrate switches</h3><p class="note" style="margin:0">Do this if keys feel too sensitive or don\'t register, or after swapping switches. Takes about a minute.</p><button class="btn">Start calibration</button></div>');
  cal.querySelector('button').onclick = calibrate;
  right.appendChild(cal);

  const bk = el(`<div class="block stack" style="gap:10px"><h3 style="margin:0">Backup</h3><p class="note" style="margin:0">Save profile ${S.profile + 1} to a file, or load one back. Good before trying big changes.</p>
    <div class="row"><button class="btn" id="bkSave">Save to file</button><button class="btn" id="bkLoad">Load from file</button><input type="file" accept=".json" class="hidden" id="bkFile"></div></div>`);
  bk.querySelector('#bkSave').onclick = exportProfile;
  bk.querySelector('#bkLoad').onclick = () => bk.querySelector('#bkFile').click();
  bk.querySelector('#bkFile').onchange = e => e.target.files[0] && importProfile(e.target.files[0]);
  right.appendChild(bk);

  const rs = el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Factory reset</h3><p class="note" style="margin:0">Puts every profile, key and light back to how it came out of the box.</p><button class="btn danger">Reset keyboard</button></div>');
  rs.querySelector('button').onclick = () => modal(`<h2>Reset everything?</h2><p>All four profiles, remaps, macros, lighting and actuation settings go back to factory defaults. This can't be undone. Save a backup first if you might want them back.</p>
    <div class="row"><button class="btn danger" data-a="go">Reset keyboard</button><button class="btn" data-a="no">Cancel</button></div>`, (card, close) => {
    card.querySelector('[data-a=no]').onclick = close;
    card.querySelector('[data-a=go]').onclick = () => { close(); guard(async () => { await S.kb.factoryReset(); }, 'Keyboard reset').then(() => load(S.kb)); };
  });
  right.appendChild(rs);
  const up = el(`<div class="block stack" style="gap:10px"><h3 style="margin:0">App updates</h3><p class="note" style="margin:0">X68 Control ${UPD.appVersion ? 'version ' + UPD.appVersion : ''}. <span id="updLine">${updLine()}</span></p><button class="btn small" style="align-self:flex-start">Check now</button></div>`);
  up.querySelector('button').onclick = () => window.x68app?.checkForUpdates();
  right.appendChild(up);
  const diag = el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Something not working?</h3><p class="note" style="margin:0">Copies a short technical report you can paste to whoever is helping you.</p><button class="btn">Copy diagnostic info</button></div>');
  diag.querySelector('button').onclick = async () => {
    const info = { app: `X68 Control ${UPD.appVersion}`, deviceId: S.kb.deviceId, version: S.kb.version, multiplier: S.kb.multiplier, profile: S.profile, rate: S.rate, options: S.options, light: S.light,
      sample: editable().slice(0, 6).map(k => ({ key: k.label, ...S.keys[k.pos], base: action(S.subs[0], k.pos) })), trace: S.kb.trace ?? [] };
    await navigator.clipboard.writeText(JSON.stringify(info, null, 1));
    toast('Copied. Paste it into your chat.');
  };
  right.appendChild(diag);
  right.appendChild(el(`<p class="note">Keyboard ID ${S.kb.deviceId} · firmware ${S.kb.version} · ${S.kb.precision} mm steps</p>`));
}

function setOpt(patch, msg) {
  const next = { ...S.options, ...patch };
  guard(async () => { await S.kb.setOptions(next); S.options = next; renderPanel(); }, msg);
}

function calibrate() {
  let stop = false;
  const close = modal(`<h2>Calibrate switches</h2><p id="calText">Take your hands off the keyboard. Measuring the resting position…</p>
    <div class="progress"><div class="bar" id="calBar"></div></div><p class="note" id="calCount"></p>
    <div class="row"><span class="spacer"></span><button class="btn primary" id="calDone" disabled>Finish</button></div>`, (card) => {
    card.querySelector('#calDone').onclick = async () => { stop = true; await S.kb.stopCalibration(); close(); renderBoard(); toast('Calibration saved'); };
  });
  $('#modal').onclick = null; // must finish properly
  (async () => {
    await S.kb.startCalibration();
    $('#calText').textContent = 'Now press every key all the way down, one at a time, and hold each for a second. Keys you\'ve done are counted below.';
    $('#calDone').disabled = false;
    const done = new Set();
    const total = editable().length;
    while (!stop) {
      const vals = await S.kb.readLiveTravel().catch(() => null);
      if (vals) for (const k of editable()) if (vals[k.pos] > 2.0) done.add(k.pos);
      const bar = $('#calBar'); const cnt = $('#calCount');
      if (!bar) break;
      bar.style.width = `${(done.size / total) * 100}%`;
      cnt.textContent = `${done.size} of ${total} keys done${done.size >= total ? '. All done, press Finish.' : ''}`;
      await new Promise(r => setTimeout(r, 250));
    }
  })();
}

function exportProfile() {
  const data = { app: 'X68 Control', format: 1, profile: S.profile, savedAt: new Date().toISOString(), keys: S.saved, layers: S.subs, fn: S.fn, light: S.light, options: S.options, rate: S.rate };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `X68-profile-${S.profile + 1}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup saved to your Downloads folder');
}

async function importProfile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file isn\'t a backup from this app.', true); }
  if (data.app !== 'X68 Control' || !Array.isArray(data.keys) || data.keys.length !== SLOTS) return toast('That file isn\'t a backup from this app.', true);
  modal(`<h2>Load this backup into profile ${S.profile + 1}?</h2><p>It replaces this profile's actuation, key mapping and lighting.</p><div class="row"><button class="btn primary" data-a="go">Load backup</button><button class="btn" data-a="no">Cancel</button></div>`, (card, close) => {
    card.querySelector('[data-a=no]').onclick = close;
    card.querySelector('[data-a=go]').onclick = () => {
      close();
      guard(async () => {
        const all = new Set(['press', 'release', 'rtPress', 'rtRelease', 'bottomDz', 'topDz', 'dksTravel', 'mode', 'mtTime', 'snapWith']);
        const dks = data.keys.map((k, i) => (k.mode === MODE.DKS ? i : -1)).filter(i => i >= 0);
        await S.kb.writeSwitches(data.keys, all, dks);
        for (let sub = 0; sub < 4; sub++) for (const k of LAYOUT) {
          const want = action(data.layers[sub], k.pos);
          if (!sameBytes(want, action(S.subs[sub], k.pos))) await S.kb.setKey(S.profile, k.pos, want, sub);
        }
        for (const k of LAYOUT) {
          const want = action(data.fn, k.pos);
          if (!sameBytes(want, action(S.fn, k.pos))) await S.kb.setFnKey(S.profile, k.pos, want, 0);
        }
        if (data.light) { await S.kb.setLight(data.light); S.light = data.light; }
        await loadProfileData();
        renderAll();
      }, 'Backup loaded');
    };
  });
}

// ---------------------------------------------------------------- updates
const UPD = { state: 'idle', version: null, appVersion: '' };
if (window.x68app) {
  window.x68app.version().then(v => { UPD.appVersion = v; });
  window.x68app.onUpdate(s => {
    Object.assign(UPD, s);
    if (s.state === 'ready') {
      $('#updateText').textContent = `Version ${s.version} is ready. Your keyboard settings stay on the keyboard, nothing is lost.`;
      $('#updateBar').classList.remove('hidden');
    }
    const line = $('#updLine');
    if (line) line.textContent = updLine();
  });
  $('#updateBtn').onclick = () => window.x68app.installUpdate();
}
function updLine() {
  return ({
    checking: 'Checking for updates…',
    downloading: `Downloading an update${UPD.percent ? ` (${UPD.percent}%)` : ''}…`,
    ready: `Version ${UPD.version} is ready, use the green bar to install it.`,
    latest: 'You have the latest version.',
    error: 'Couldn\'t check for updates right now. It tries again next time you open the app.',
  })[UPD.state] ?? 'Checks for updates every time the app opens.';
}

// ---------------------------------------------------------------- boot
buildBoard();
renderAll();
initMouse({ $, el, esc, toast, guard, modal, CODE_TO_HID, HID_NAMES, PICKER_SECTIONS, DEMO, onMouseChanged: () => {
  // nothing to show for a missing keyboard when the mouse is right there
  if (!S.kb && mouseState.dev && S.device === 'keyboard' && !S.autoSwitched) { S.autoSwitched = true; S.device = 'mouse'; }
  renderAll();
} });
if (new URLSearchParams(location.search).get('device') === 'mouse') S.device = 'mouse';
if (DEMO || 'hid' in navigator) connect();
else showConnect('This needs the desktop app', 'Open X68 Control from your Start menu.');
