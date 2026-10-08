// Mouse pages for the V8 (and other Attack Shark 0x3554 mice).
import { Mouse, openMouse, mouseFilters, isOurMouse, BUTTON_TYPE, RATES } from './protocol.js';
import { SimMouseDevice } from './sim.js';

let H; // helpers from app.js: { $, el, esc, toast, guard, modal, CODE_TO_HID, HID_NAMES, PICKER_SECTIONS, DEMO }
const M = { dev: null, cfg: null, view: 'dpi', editStage: 0, button: 0, info: null, battery: null, fw: '', busyTimer: null, online: true };

const BUTTON_NAMES = { 0: 'Left button', 1: 'Right button', 2: 'Wheel click', 3: 'Back (side)', 4: 'Forward (side)', 5: 'Button 6', 6: 'Button 7' };
const LOD = {
  3950: [[3, '0.7 mm'], [1, '1 mm'], [2, '2 mm']],
  3955: [[1, '0.7 mm'], [2, '0.9 mm'], [3, '1.2 mm'], [4, '1.4 mm'], [5, '1.6 mm']],
};
const SLEEP = [[1, '10 seconds'], [3, '30 seconds'], [6, '1 minute'], [12, '2 minutes'], [30, '5 minutes'], [60, '10 minutes'], [90, '15 minutes']];
const MEDIA = [['Play / pause', 0x00cd], ['Next track', 0x00b5], ['Previous track', 0x00b6], ['Stop', 0x00b7], ['Mute', 0x00e2], ['Volume up', 0x00e9], ['Volume down', 0x00ea], ['Media player', 0x0183], ['Calculator', 0x0192], ['My computer', 0x0194], ['Email', 0x018a], ['Browser home', 0x0223], ['Browser back', 0x0224], ['Browser forward', 0x0225], ['Search', 0x0221]];
const MOUSE_KEYS = [['Left click', 0x0100], ['Right click', 0x0200], ['Middle click', 0x0400], ['Back', 0x0800], ['Forward', 0x1000]];
const MODS = { 224: 1, 225: 2, 226: 4, 227: 8, 228: 16, 229: 32, 230: 64, 231: 128 };
const MOD_NAMES = { 1: 'Ctrl', 2: 'Shift', 4: 'Alt', 8: 'Win', 16: 'Right Ctrl', 32: 'Right Shift', 64: 'Right Alt', 128: 'Right Win' };

const hex = n => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const fmtDpi = d => d.toLocaleString('en-US');

export function initMouse(helpers) {
  H = helpers;
  if (!H.DEMO && 'hid' in navigator) {
    navigator.hid.addEventListener('connect', e => { if (!M.dev && isOurMouse(e.device)) setTimeout(() => connectMouse(), 400); });
    navigator.hid.addEventListener('disconnect', e => {
      if (M.dev && e.device === M.dev.dev) { M.dev.close().catch(() => {}); M.dev = null; M.cfg = null; refresh(); }
    });
  }
  connectMouse();
}

export const mouseState = M;

function refresh() {
  window.x68app?.mouseState?.({ connected: !!M.dev && M.online, wired: !!M.dev?.wired, level: M.battery?.level ?? null, charging: !!M.battery?.charging });
  H.onMouseChanged?.();
}

export async function connectMouse(viaPicker = false) {
  try {
    let dev;
    if (H.DEMO) dev = new Mouse(new SimMouseDevice());
    else {
      if (viaPicker) await navigator.hid.requestDevice({ filters: mouseFilters() });
      dev = await openMouse(await navigator.hid.getDevices());
    }
    if (!dev) { refresh(); return false; }
    M.dev = dev;
    M.info = await dev.hello();
    if (!dev.wired && !(await dev.isOnline())) {
      M.online = false; refresh();
      await waitForWake(dev);
    }
    M.online = true;
    M.cfg = await dev.loadAll();
    M.editStage = Math.min(M.cfg.currentStage, M.cfg.stageCount - 1);
    M.fw = await dev.version().catch(() => '');
    M.battery = dev.wired ? null : await dev.battery().catch(() => null);
    dev.onEvent(onMouseEvent);
    clearInterval(M.batteryTimer);
    if (!dev.wired) M.batteryTimer = setInterval(async () => { if (M.dev === dev) { M.battery = await dev.battery().catch(() => M.battery); refresh(); } }, 60000);
    refresh();
    return true;
  } catch (e) {
    console.error(e);
    H.toast(e.message || 'Could not talk to the mouse.', true);
    refresh();
    return false;
  }
}

async function waitForWake(dev) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await dev.isOnline().catch(() => false)) return;
  }
  throw new Error('The mouse is asleep or switched off. Move it or switch it on, then press Connect.');
}

// The mouse tells us when its own buttons change DPI or polling rate.
let eventTimer;
function onMouseEvent(d) {
  if (d[0] !== 10) return;
  clearTimeout(eventTimer);
  eventTimer = setTimeout(async () => {
    if (!M.dev) return;
    await M.dev.readRange(0, 6).catch(() => {});
    const c = M.dev.decode();
    M.cfg.currentStage = c.currentStage; M.cfg.rate = c.rate; M.cfg.stageCount = c.stageCount;
    refresh();
  }, 250);
}

// Write a change, then update the view. Changes save the moment you make them.
function save(fn, msg) {
  return H.guard(async () => {
    if (!M.dev.wired && !(await M.dev.isOnline().catch(() => true))) throw new Error('The mouse is asleep. Move it, then try again.');
    await fn();
    refresh();
  }, msg);
}

// ---------------------------------------------------------------- shell
export function mouseSubtitle() {
  if (!M.dev) return 'Mouse not connected';
  const name = (M.dev.dev.productName || 'Attack Shark mouse').replace(/attack\s*shark/i, '').trim() || 'Mouse';
  const bat = M.battery ? ` · ${M.battery.level}%${M.battery.charging ? ' charging' : ''}` : '';
  return `${name}${M.dev.wired ? ' · wired' : ''}${bat}`;
}

export function renderMouse(p, view) {
  M.view = view;
  if (view === 'mtest') return renderTest(p);
  if (!M.dev) return p.appendChild(connectCard());
  if (!M.online || !M.cfg) return p.appendChild(H.el(`<div class="empty" style="padding:80px 0"><h2 style="margin:0 0 8px">Wake your mouse</h2><p class="lead" style="margin:0 auto">It's paired but asleep. Move it or click a button and the settings load on their own.</p></div>`));
  ({ dpi: renderDpi, buttons: renderButtons, sensor: renderSensor, mouseinfo: renderInfo })[view](p);
}

function connectCard() {
  const node = H.el(`<div class="connect-inline">
    <div class="mouse-art" aria-hidden="true"></div>
    <h2>Connect your mouse</h2>
    <p class="lead">Plug in the V8's cable or its wireless receiver, then press Connect. Close the official Attack Shark page first, two programs can't talk to the mouse at once.</p>
    <button class="btn primary">Connect mouse</button></div>`);
  node.querySelector('button').onclick = async () => { await connectMouse(true); };
  return node;
}

// ---------------------------------------------------------------- DPI
function renderDpi(p) {
  const c = M.cfg, dev = M.dev;
  const max = dev.model?.maxDpi ?? 42000;
  const step = dev.sensor === '3955' ? 1 : 50;
  p.appendChild(H.el(`<div><h2>DPI</h2><p class="lead">Your mouse cycles through these stages with its DPI button. Click a stage to edit it, then click Use to make it the active one. Changes save straight away.</p></div>`));

  const top = H.el(`<div class="block stack" style="gap:10px"><div class="row"><label style="font-weight:600">Number of stages</label><span class="spacer"></span><div class="seg" id="stageCount"></div></div>
    <p class="note" style="margin:0">Fewer stages means fewer presses to get back to your main DPI. For Siege, one or two stages is plenty.</p></div>`);
  for (let n = 1; n <= 8; n++) {
    const b = H.el(`<button class="${n === c.stageCount ? 'on' : ''}">${n}</button>`);
    b.onclick = () => save(async () => {
      await dev.setStageCount(n); c.stageCount = n;
      if (c.currentStage >= n) { await dev.setCurrentStage(0); c.currentStage = 0; }
      if (M.editStage >= n) M.editStage = 0;
    }, `${n} DPI stage${n > 1 ? 's' : ''}`);
    top.querySelector('#stageCount').appendChild(b);
  }
  p.appendChild(top);

  const grid = H.el('<div class="stages"></div>');
  for (let i = 0; i < c.stageCount; i++) {
    const s = c.stages[i];
    const card = H.el(`<div class="stage${i === M.editStage ? ' editing' : ''}${i === c.currentStage ? ' current' : ''}" tabindex="0">
      <div class="stage-top"><span class="stage-dot" style="--c:${hex(s.color)}"></span><span>Stage ${i + 1}</span><span class="spacer"></span>${i === c.currentStage ? '<span class="stage-badge">Active</span>' : '<button class="btn small use">Use</button>'}</div>
      <div class="stage-dpi">${fmtDpi(s.dpi)}</div><div class="note" style="margin:0">DPI</div></div>`);
    card.onclick = e => { if (e.target.closest('.use')) return; M.editStage = i; refresh(); };
    card.querySelector('.use')?.addEventListener('click', () => save(async () => { await dev.setCurrentStage(i); c.currentStage = i; }, `Stage ${i + 1} is active, ${fmtDpi(s.dpi)} DPI`));
    grid.appendChild(card);
  }
  p.appendChild(grid);

  const i = M.editStage, s = c.stages[i];
  const ed = H.el(`<div class="block stack">
    <div class="row"><h3 style="margin:0">Stage ${i + 1}</h3><span class="spacer"></span>
      <input type="number" min="${step}" max="${max}" step="${step}" value="${s.dpi}" style="width:110px" aria-label="DPI value"><span class="note" style="margin:0">DPI</span></div>
    <input type="range" class="press" min="${step === 1 ? 50 : step}" max="${Math.min(max, 6400)}" step="${step}" value="${Math.min(s.dpi, 6400)}">
    <div class="row" id="quick"></div>
    <div class="row"><label style="font-weight:600">Indicator color</label><span class="spacer"></span><div class="swatches" id="cols"></div><input type="color" value="${hex(s.color)}" title="Any color"></div>
    <p class="note" style="margin:0">The slider covers 50 to 6,400 for fine control. Type a number for anything up to ${fmtDpi(max)}.</p></div>`);
  const num = ed.querySelector('input[type=number]');
  const rng = ed.querySelector('input[type=range]');
  const setPct = v => rng.style.setProperty('--p', `${((Math.min(v, 6400) - rng.min) / (rng.max - rng.min)) * 100}%`);
  setPct(s.dpi);
  let t;
  const apply = v => {
    v = Math.max(step === 1 ? 1 : 50, Math.min(max, Math.round(v / step) * step));
    num.value = v; rng.value = Math.min(v, 6400); setPct(v);
    s.dpi = v;
    grid.children[i].querySelector('.stage-dpi').textContent = fmtDpi(v);
    clearTimeout(t);
    t = setTimeout(() => save(() => dev.setStageDpi(i, v), `Stage ${i + 1} set to ${fmtDpi(v)} DPI`), 350);
  };
  rng.oninput = () => apply(+rng.value);
  num.onchange = () => apply(+num.value);
  for (const q of [400, 800, 1200, 1600, 3200]) {
    const b = H.el(`<button class="chip${q === s.dpi ? ' on' : ''}">${fmtDpi(q)}</button>`);
    b.onclick = () => { apply(q); ed.querySelectorAll('#quick .chip').forEach(x => x.classList.toggle('on', x === b)); };
    ed.querySelector('#quick').appendChild(b);
  }
  const setCol = col => save(async () => { await dev.setStageColor(i, col); s.color = col; }, 'Color saved');
  for (const col of [0xff0000, 0xff8800, 0xffd400, 0x46fd1f, 0x00e1ff, 0x0000ff, 0xa35cff, 0xffffff]) {
    const b = H.el(`<button class="swatch${col === s.color ? ' on' : ''}" style="--c:${hex(col)}" title="Pick color"></button>`);
    b.onclick = () => setCol(col);
    ed.querySelector('#cols').appendChild(b);
  }
  ed.querySelector('input[type=color]').onchange = e => setCol(parseInt(e.target.value.slice(1), 16));
  p.appendChild(ed);
  p.appendChild(sensCalc(c.stages[c.currentStage]?.dpi ?? s.dpi));
}

// ---------------------------------------------------------------- sens calculator
// Changing DPI changes how far your crosshair moves. This works out the Siege sens that cancels it out.
function sensCalc(activeDpi) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('sensCalc') || '{}'); } catch {}
  const b = H.el(`<div class="block stack" style="gap:12px">
    <h3 style="margin:0">Keep your aim the same</h3>
    <p class="note" style="margin:0">Changed your DPI? Enter what you used before and the app works out the Siege sens that feels identical.</p>
    <div class="calc-grid">
      <label>Old DPI<input type="number" id="oDpi" min="50" max="42000" value="${saved.oldDpi ?? 400}"></label>
      <label>Old Siege sens<input type="number" id="oSens" min="1" max="100" value="${saved.oldSens ?? ''}" placeholder="e.g. 10"></label>
      <label>New DPI<input type="number" id="nDpi" min="50" max="42000" value="${activeDpi}"></label>
    </div>
    <div class="calc-out" id="calcOut"></div></div>`);
  const out = b.querySelector('#calcOut');
  const calc = () => {
    const oDpi = +b.querySelector('#oDpi').value, oSens = +b.querySelector('#oSens').value, nDpi = +b.querySelector('#nDpi').value;
    try { localStorage.setItem('sensCalc', JSON.stringify({ oldDpi: oDpi, oldSens: oSens || undefined })); } catch {}
    if (!oDpi || !oSens || !nDpi) { out.innerHTML = '<span class="note" style="margin:0">Fill in your old Siege sens to see the answer.</span>'; return; }
    const exact = oSens * oDpi / nDpi;
    const whole = Math.max(1, Math.min(100, Math.round(exact)));
    const off = Math.abs(whole - exact) / exact * 100;
    out.innerHTML = `<div class="calc-big">Set Siege sens to <b>${whole}</b></div>
      <div class="note" style="margin:0">Exact match is ${exact.toFixed(2)}. ${off < 0.5 ? 'Siege takes whole numbers and this one lands spot on.' : `Siege only takes whole numbers, so ${whole} is ${off.toFixed(1)}% ${whole > exact ? 'faster' : 'slower'}. Doubling or halving your old DPI always lands exactly.`} Set both horizontal and vertical sens to this. Your ADS sliders stay the same.</div>`;
  };
  b.querySelectorAll('input').forEach(i => i.oninput = calc);
  calc();
  return b;
}

// ---------------------------------------------------------------- test tools
const T = { stamps: [], peak: 0, timer: null, clicks: {}, last: {}, flags: {} };
const CLICK_NAMES = ['Left', 'Wheel', 'Right', 'Back', 'Forward'];

function renderTest(p) {
  p.appendChild(H.el(`<div><h2>Test your mouse</h2><p class="lead">Check that the polling rate is real and that no button double clicks. Nothing here changes your settings.</p></div>`));
  const grid = H.el('<div class="panel-grid"><div class="stack" id="tL"></div><div class="stack" id="tR"></div></div>');
  p.appendChild(grid);

  const rate = H.el(`<div class="block stack" style="gap:12px"><h3 style="margin:0">Polling rate</h3>
    <div class="test-pad" id="ratePad"><span>Move the mouse in fast circles in here</span></div>
    <div class="row"><div><div class="calc-big" id="rateNow">0 Hz</div><div class="note" style="margin:0">right now</div></div><span class="spacer"></span>
      <div style="text-align:right"><div class="calc-big" id="ratePeak">0 Hz</div><div class="note" style="margin:0">highest seen</div></div></div>
    <p class="note" style="margin:0">${M.cfg ? `Your mouse is set to ${fmtDpi(M.cfg.rate)} Hz. ` : ''}Windows can limit what apps see, so a reading a bit under your setting is normal. A reading near it confirms it works.</p></div>`);
  grid.querySelector('#tL').appendChild(rate);
  const pad = rate.querySelector('#ratePad');
  const now = rate.querySelector('#rateNow'), peak = rate.querySelector('#ratePeak');
  T.stamps = [];
  const push = e => {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (list.length ? list : [e])) T.stamps.push(ev.timeStamp);
  };
  if ('onpointerrawupdate' in window) pad.addEventListener('pointerrawupdate', push);
  else pad.addEventListener('pointermove', push);
  clearInterval(T.timer);
  T.timer = setInterval(() => {
    if (!document.body.contains(pad)) { clearInterval(T.timer); return; }
    const t = performance.now();
    T.stamps = T.stamps.filter(x => t - x < 500);
    const hz = T.stamps.length * 2;
    T.peak = Math.max(T.peak, hz);
    now.textContent = `${fmtDpi(hz)} Hz`;
    peak.textContent = `${fmtDpi(T.peak)} Hz`;
  }, 250);

  const clk = H.el(`<div class="block stack" style="gap:12px"><h3 style="margin:0">Double click check</h3>
    <div class="test-pad" id="clickPad"><span>Click every button in here, as fast as you like</span></div>
    <table class="info-table" id="clickTable"></table>
    <div class="row"><p class="note" style="margin:0">Two clicks closer than 40 ms is faster than a finger can go, so it gets flagged. If one shows up, raise Debounce one step on the Sensor page.</p><span class="spacer"></span><button class="btn small" id="clickReset">Reset</button></div></div>`);
  grid.querySelector('#tR').appendChild(clk);
  const cpad = clk.querySelector('#clickPad'), table = clk.querySelector('#clickTable');
  const draw = () => {
    table.innerHTML = CLICK_NAMES.map((n, i) => `<tr><td>${n}</td><td>${T.clicks[i] || 0} click${T.clicks[i] === 1 ? "" : "s"}${T.last[i] ? ` · last gap ${T.last[i]} ms` : ''}${T.flags[i] ? ` · <span class="warn-text">${T.flags[i]} double click${T.flags[i] > 1 ? 's' : ''}</span>` : ''}</td></tr>`).join('');
  };
  const downAt = {};
  cpad.addEventListener('mousedown', e => {
    e.preventDefault();
    const b = e.button, t = e.timeStamp;
    T.clicks[b] = (T.clicks[b] || 0) + 1;
    if (downAt[b] != null) {
      const gap = Math.round(t - downAt[b]);
      T.last[b] = gap;
      if (gap < 40) T.flags[b] = (T.flags[b] || 0) + 1;
    }
    downAt[b] = t;
    cpad.classList.add('hit'); setTimeout(() => cpad.classList.remove('hit'), 80);
    draw();
  });
  for (const ev of ['contextmenu', 'auxclick', 'mouseup']) cpad.addEventListener(ev, e => e.preventDefault());
  clk.querySelector('#clickReset').onclick = () => { T.clicks = {}; T.last = {}; T.flags = {}; draw(); };
  draw();
}

// ---------------------------------------------------------------- buttons
function describeButton(b) {
  switch (b.type) {
    case BUTTON_TYPE.Off: return 'Off';
    case BUTTON_TYPE.Mouse: return MOUSE_KEYS.find(k => k[1] === b.param)?.[0] ?? 'Mouse button';
    case BUTTON_TYPE.DPI: return ({ 0x0100: 'DPI cycle', 0x0200: 'DPI up', 0x0300: 'DPI down' })[b.param] ?? 'DPI';
    case BUTTON_TYPE.ScrollWheel: return b.param === 0x0100 ? 'Scroll up' : 'Scroll down';
    case BUTTON_TYPE.TiltWheel: return b.param === 0x0100 ? 'Scroll left' : 'Scroll right';
    case BUTTON_TYPE.RateSwitch: return 'Switch polling rate';
    case BUTTON_TYPE.Fire: return `Rapid fire (${b.param >> 8}x)`;
    case BUTTON_TYPE.DPILock: return 'Sniper DPI';
    case BUTTON_TYPE.Macro: return 'Macro';
    case BUTTON_TYPE.Combo: {
      const ev = b.combo ?? [];
      if (ev.length === 1 && ev[0].kind === 2) return MEDIA.find(m => m[1] === ev[0].code)?.[0] ?? 'Media key';
      return ev.map(e => (e.kind === 0 ? Object.entries(MOD_NAMES).filter(([bit]) => e.code & bit).map(([, n]) => n).join(' + ') : e.kind === 2 ? 'Media key' : H.HID_NAMES[e.code] ?? `Key ${e.code}`)).join(' + ') || 'Key combo';
    }
    default: return 'Custom';
  }
}

function mouseSvg(sel) {
  const zone = (idx, d, label, lx, ly) => {
    const b = M.cfg.buttons.find(x => x.index === idx);
    if (!b) return '';
    return `<g class="mb${sel === idx ? ' sel' : ''}" data-i="${idx}" tabindex="0" role="button" aria-label="${BUTTON_NAMES[idx]}">
      <path d="${d}"/><text x="${lx}" y="${ly}" class="mb-name">${BUTTON_NAMES[idx]}</text><text x="${lx}" y="${ly + 16}" class="mb-act">${H.esc(describeButton(b))}</text></g>`;
  };
  return `<svg viewBox="0 0 420 380" class="mouse-svg" role="group" aria-label="Your mouse, click a button to change it">
    <path class="mouse-body" d="M210 20 C140 20 120 80 118 150 L116 270 C116 330 160 360 210 360 C260 360 304 330 304 270 L302 150 C300 80 280 20 210 20 Z"/>
    ${zone(0, 'M206 24 C150 26 124 80 122 150 L206 150 Z', '', 20, 70)}
    ${zone(1, 'M214 24 C270 26 296 80 298 150 L214 150 Z', '', 320, 70)}
    ${zone(2, 'M200 60 h20 a6 6 0 0 1 6 6 v44 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 v-44 a6 6 0 0 1 6 -6 Z', '', 320, 185)}
    ${zone(4, 'M112 160 h10 v44 h-10 a4 4 0 0 1 -4 -4 v-36 a4 4 0 0 1 4 -4 Z', '', 20, 175)}
    ${zone(3, 'M112 212 h10 v44 h-10 a4 4 0 0 1 -4 -4 v-36 a4 4 0 0 1 4 -4 Z', '', 20, 245)}
  </svg>`;
}

function renderButtons(p) {
  const c = M.cfg;
  if (!c.buttons.some(b => b.index === M.button)) M.button = c.buttons[0].index;
  const grid = H.el('<div class="panel-grid" style="grid-template-columns:minmax(300px,420px) 1fr"><div class="block" id="mLeft"></div><div class="stack" id="mRight"></div></div>');
  p.appendChild(H.el(`<div><h2>Buttons</h2><p class="lead">Click a button on the mouse, then choose what it does. Changes save straight away.</p></div>`));
  p.appendChild(grid);
  const left = grid.querySelector('#mLeft');
  left.innerHTML = mouseSvg(M.button);
  left.querySelectorAll('.mb').forEach(g => {
    const pick = () => { M.button = +g.dataset.i; refresh(); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  const b = c.buttons.find(x => x.index === M.button);
  const right = grid.querySelector('#mRight');
  right.appendChild(H.el(`<div class="row"><div><h3 style="margin:0 0 4px">${BUTTON_NAMES[b.index]}</h3><p class="note" style="margin:0">Right now: <b style="color:var(--text)">${H.esc(describeButton(b))}</b></p></div><span class="spacer"></span><button class="btn small" id="mbReset">Back to default</button></div>`));
  const def = M.dev.model?.buttons.find(x => x.index === b.index)?.default;
  right.querySelector('#mbReset').onclick = () => def && setAction(b, +def[0], parseInt(def[1], 16));
  right.appendChild(buttonPicker(b));
}

function leftClickGuard(b, type, param) {
  const isLeft = x => x.type === BUTTON_TYPE.Mouse && x.param === 0x0100;
  if (isLeft(b) && !(type === BUTTON_TYPE.Mouse && param === 0x0100) && !M.cfg.buttons.some(x => x !== b && isLeft(x))) {
    H.toast('Give another button left click first, otherwise you could lock yourself out of clicking.', true);
    return false;
  }
  return true;
}

function setAction(b, type, param) {
  if (!leftClickGuard(b, type, param)) return;
  const name = describeButton({ type, param, combo: b.combo });
  return save(async () => { await M.dev.setButton(b.index, type, param); b.type = type; b.param = param; }, `${BUTTON_NAMES[b.index]} now does: ${name}`);
}

function setCombo(b, events, label) {
  if (!leftClickGuard(b, BUTTON_TYPE.Combo, 0)) return;
  return save(async () => { await M.dev.setCombo(b.index, events); b.type = BUTTON_TYPE.Combo; b.param = 0; b.combo = events; }, `${BUTTON_NAMES[b.index]} now does: ${label}`);
}

function buttonPicker(b) {
  const wrap = H.el('<div class="block"><div class="picker"><div class="picker-tabs"></div><div class="picker-body"></div></div></div>');
  const tabs = [['mouse', 'Mouse buttons'], ['dpi', 'DPI'], ['scroll', 'Scrolling'], ['key', 'Keyboard key'], ['media', 'Media and system'], ['other', 'Other']];
  const tabsEl = wrap.querySelector('.picker-tabs'), body = wrap.querySelector('.picker-body');
  const list = items => {
    const g = H.el('<div class="keys-grid"></div>');
    for (const [name, on, fn] of items) { const k = H.el(`<button class="k${on ? ' on' : ''}">${H.esc(name)}</button>`); k.onclick = fn; g.appendChild(k); }
    return g;
  };
  const show = t => {
    M.pickTab = t;
    tabsEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
    body.innerHTML = '';
    if (t === 'mouse') body.appendChild(list(MOUSE_KEYS.map(([n, v]) => [n, b.type === 1 && b.param === v, () => setAction(b, BUTTON_TYPE.Mouse, v)])));
    if (t === 'dpi') {
      body.appendChild(list([['DPI cycle', 0x0100], ['DPI up', 0x0200], ['DPI down', 0x0300]].map(([n, v]) => [n, b.type === 2 && b.param === v, () => setAction(b, BUTTON_TYPE.DPI, v)])));
      const sn = H.el(`<div class="stack" style="gap:8px;margin-top:18px"><div class="sec-title" style="margin:0">Sniper DPI</div><p class="note" style="margin:0">Drops to this DPI while you hold the button, then goes back.</p>
        <div class="row"><input type="number" min="50" max="${M.dev.model?.maxDpi ?? 42000}" step="50" value="400" style="width:110px"><button class="btn small">Use sniper DPI</button></div></div>`);
      sn.querySelector('button').onclick = () => setAction(b, BUTTON_TYPE.DPILock, +sn.querySelector('input').value || 400);
      body.appendChild(sn);
    }
    if (t === 'scroll') body.appendChild(list([['Scroll up', BUTTON_TYPE.ScrollWheel, 0x0100], ['Scroll down', BUTTON_TYPE.ScrollWheel, 0x0200], ['Scroll left', BUTTON_TYPE.TiltWheel, 0x0100], ['Scroll right', BUTTON_TYPE.TiltWheel, 0x0200]].map(([n, ty, v]) => [n, b.type === ty && b.param === v, () => setAction(b, ty, v)])));
    if (t === 'media') body.appendChild(list(MEDIA.map(([n, code]) => [n, b.type === 5 && b.combo?.length === 1 && b.combo[0].kind === 2 && b.combo[0].code === code, () => setCombo(b, [{ kind: 2, code }], n)])));
    if (t === 'key') body.appendChild(comboCapture(b));
    if (t === 'other') {
      body.appendChild(list([['Switch polling rate', b.type === 7, () => setAction(b, BUTTON_TYPE.RateSwitch, 0)], ['Turn off', b.type === 0, () => setAction(b, BUTTON_TYPE.Off, 0)]]));
      const fire = H.el(`<div class="stack" style="gap:8px;margin-top:18px"><div class="sec-title" style="margin:0">Rapid fire</div><p class="note" style="margin:0">Clicks left button several times per press. Don't use this in Siege, it can count as automation.</p>
        <div class="row"><label class="row" style="gap:6px">Clicks <input type="number" min="2" max="255" value="3" id="fc" style="width:70px"></label><label class="row" style="gap:6px">Gap <input type="number" min="1" max="255" value="20" id="fi" style="width:70px"> ms</label><button class="btn small">Use rapid fire</button></div></div>`);
      fire.querySelector('button').onclick = () => setAction(b, BUTTON_TYPE.Fire, ((+fire.querySelector('#fc').value & 255) << 8) | (+fire.querySelector('#fi').value & 255));
      body.appendChild(fire);
    }
  };
  for (const [id, name] of tabs) { const x = H.el(`<button data-t="${id}">${name}</button>`); x.onclick = () => show(id); tabsEl.appendChild(x); }
  show(M.pickTab ?? 'mouse');
  return wrap;
}

function comboCapture(b) {
  const node = H.el(`<div class="stack" style="gap:10px"><p class="note" style="margin:0">Make this button type a key or shortcut, like F or Ctrl + C.</p>
    <button class="capture" style="width:100%;background:none">Click here, then press the key or shortcut</button>
    <div class="row" id="cShow"></div><div class="row"><button class="btn primary small" id="cUse" disabled>Use this</button><button class="btn small" id="cClear">Start over</button></div></div>`);
  let mods = 0, key = 0, listening = false;
  const cap = node.querySelector('.capture');
  const draw = () => {
    const parts = Object.entries(MOD_NAMES).filter(([bit]) => mods & bit).map(([, n]) => n);
    if (key) parts.push(H.HID_NAMES[key] ?? `Key ${key}`);
    node.querySelector('#cShow').innerHTML = parts.length ? parts.map(x => `<span class="k on">${H.esc(x)}</span>`).join('<span class="note">+</span>') : '<span class="note">Nothing yet</span>';
    node.querySelector('#cUse').disabled = !parts.length;
  };
  const onKey = e => {
    if (!document.body.contains(node)) { window.removeEventListener('keydown', onKey, true); return; }
    const hid = H.CODE_TO_HID[e.code];
    if (!hid) return;
    e.preventDefault(); e.stopPropagation();
    if (MODS[hid]) mods |= MODS[hid]; else key = hid;
    draw();
  };
  cap.onclick = () => {
    if (listening) return;
    listening = true; cap.classList.add('listening'); cap.textContent = 'Listening… press the key or shortcut';
    window.addEventListener('keydown', onKey, true);
  };
  node.querySelector('#cClear').onclick = () => { mods = 0; key = 0; draw(); };
  node.querySelector('#cUse').onclick = () => {
    window.removeEventListener('keydown', onKey, true);
    // one event per modifier, the same way the official driver stores shortcuts (5 keys max)
    const ev = Object.keys(MOD_NAMES).map(Number).filter(bit => mods & bit).map(bit => ({ kind: 0, code: bit })).slice(0, 4);
    if (key) ev.push({ kind: 1, code: key });
    const label = node.querySelector('#cShow').textContent.replace(/\s*\+\s*/g, ' + ');
    setCombo(b, ev, label);
  };
  draw();
  return node;
}

// ---------------------------------------------------------------- sensor
function renderSensor(p) {
  const c = M.cfg, dev = M.dev, model = dev.model;
  p.appendChild(H.el(`<div><h2>Sensor and polling</h2><p class="lead">How the mouse tracks and how often it reports to your PC. Changes save straight away.</p></div>`));
  const grid = H.el('<div class="panel-grid"><div class="stack" id="sL"></div><div class="stack" id="sR"></div></div>');
  p.appendChild(grid);
  const L = grid.querySelector('#sL'), R = grid.querySelector('#sR');
  const seg = (title, hint, opts, value, onPick) => {
    const b = H.el(`<div class="block stack" style="gap:10px"><h3 style="margin:0">${title}</h3><div class="seg"></div><p class="note" style="margin:0">${hint}</p></div>`);
    for (const [v, label] of opts) { const x = H.el(`<button class="${v === value ? 'on' : ''}">${label}</button>`); x.onclick = () => onPick(v, label); b.querySelector('.seg').appendChild(x); }
    return b;
  };
  const rates = RATES.filter(r => r <= (dev.maxRate ?? 8000));
  L.appendChild(seg('Polling rate', 'Higher is smoother but uses more CPU and battery. If Siege stutters on your laptop, try 2000 or 1000 Hz.', rates.map(r => [r, r >= 1000 ? `${r / 1000}K` : `${r}`]), c.rate,
    v => save(async () => { await dev.setRate(v); c.rate = v; }, `Polling rate set to ${v} Hz`)));
  const lodOpts = LOD[dev.sensor] ?? LOD['3950'];
  L.appendChild(seg('Lift-off distance', 'How high you can lift the mouse before it stops tracking. Lower is better if you lift and reset your mouse often.', lodOpts, c.lod,
    (v, label) => save(async () => { await dev.setLod(v); c.lod = v; }, `Lift-off distance set to ${label}`)));
  L.appendChild(seg('Sensor mode', 'High performance tracks better. Low power saves battery. Over 1000 Hz the mouse switches to its top mode on its own.', [[0, 'Low power'], [1, 'High performance']], c.sensorMode > 1 ? 1 : c.sensorMode,
    (v, label) => save(async () => { await dev.setSensorMode(v); c.sensorMode = v; }, `${label} mode on`)));

  const t = H.el('<div class="block stack"></div>');
  const tg = (label, hint, value, fn, show = true) => {
    if (!show) return;
    const x = H.el(`<div><label class="toggle ok"><input type="checkbox" ${value ? 'checked' : ''}><span class="sw"></span><span>${label}</span></label><p class="note">${hint}</p></div>`);
    x.querySelector('input').onchange = e => fn(e.target.checked);
    t.appendChild(x);
  };
  tg('Motion sync', 'Lines up sensor readings with polling for smoother movement. Adds a tiny delay, many pros leave it off.', c.motionSync,
    on => save(async () => { await dev.setMotionSync(on); c.motionSync = on; }, `Motion sync ${on ? 'on' : 'off'}`), model?.motionSync !== false);
  tg('Angle snapping', 'Straightens your movements. Leave this off for aiming, it fights small corrections.', c.angle,
    on => save(async () => { await dev.setAngle(on); c.angle = on; }, `Angle snapping ${on ? 'on' : 'off'}`));
  tg('Ripple control', 'Smooths jitter at very high DPI. Leave off at normal DPI, it adds delay.', c.ripple,
    on => save(async () => { await dev.setRipple(on); c.ripple = on; }, `Ripple control ${on ? 'on' : 'off'}`));
  tg('20K FPS scanning', 'The sensor takes 20,000 pictures a second for sharper tracking. Uses more battery.', c.fps20k,
    on => save(async () => { await dev.setFps20k(on); c.fps20k = on; }, `20K FPS ${on ? 'on' : 'off'}`), !!model?.fps20k || c.fps20k !== null);
  R.appendChild(t);

  const deb = model?.maxDebounce ?? 15;
  const d = H.el(`<div class="block field"><label>Click debounce</label><div class="val">${c.debounce}<small>ms</small></div>
    <input type="range" class="plain" min="0" max="${deb}" step="1" value="${c.debounce}" style="--p:${(c.debounce / deb) * 100}%">
    <div class="hint">How long the mouse ignores switch bounce after a click. Lower feels snappier. If you ever get accidental double clicks, raise it.</div></div>`);
  let dt;
  d.querySelector('input').oninput = e => {
    const v = +e.target.value;
    d.querySelector('.val').innerHTML = `${v}<small>ms</small>`; e.target.style.setProperty('--p', `${(v / deb) * 100}%`);
    clearTimeout(dt); dt = setTimeout(() => save(async () => { await dev.setDebounce(v); c.debounce = v; }, `Debounce set to ${v} ms`), 300);
  };
  R.appendChild(d);

  if (model?.angleTune || c.angleTune !== null) {
    const v0 = c.angleTune ?? 0;
    const a = H.el(`<div class="block field"><label>Angle tuning</label><div class="val">${v0}<small>°</small></div>
      <input type="range" class="plain" min="-30" max="30" step="1" value="${v0}" style="--p:${((v0 + 30) / 60) * 100}%">
      <div class="hint">Rotates the sensor's idea of straight to match how you hold the mouse. Most people leave it at 0.</div></div>`);
    let at;
    a.querySelector('input').oninput = e => {
      const v = +e.target.value;
      a.querySelector('.val').innerHTML = `${v}<small>°</small>`; e.target.style.setProperty('--p', `${((v + 30) / 60) * 100}%`);
      clearTimeout(at); at = setTimeout(() => save(async () => { await dev.setAngleTune(v); c.angleTune = v; }, `Angle set to ${v}°`), 300);
    };
    R.appendChild(a);
  }
  if (!dev.wired) {
    const sl = H.el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Sleep after</h3><select></select><p class="note" style="margin:0">How long the mouse waits before sleeping to save battery.</p></div>');
    const sel = sl.querySelector('select');
    for (const [v, label] of SLEEP) sel.appendChild(H.el(`<option value="${v}" ${v === c.sleep ? 'selected' : ''}>${label}</option>`));
    sel.onchange = () => save(async () => { await dev.setSleep(+sel.value); c.sleep = +sel.value; }, `Sleeps after ${SLEEP.find(s => s[0] === +sel.value)[1]}`);
    R.appendChild(sl);
  }
}

// ---------------------------------------------------------------- info
function renderInfo(p) {
  const dev = M.dev;
  p.appendChild(H.el(`<div><h2>Mouse settings</h2><p class="lead">Device details, reset and help.</p></div>`));
  const grid = H.el('<div class="panel-grid"><div class="stack" id="iL"></div><div class="stack" id="iR"></div></div>');
  p.appendChild(grid);
  const pname = dev.dev.productName || '';
  const model = (pname.match(/\b([VRXK]\d+[A-Z]*)\b/i)?.[1] || 'V8').toUpperCase();
  const rows = [['Name', `Attack Shark ${model}`], ['Model', model], ['Connection', dev.wired ? 'Cable' : 'Wireless receiver'], ['Battery', M.battery ? `${M.battery.level}%${M.battery.charging ? ', charging' : ''}` : dev.wired ? 'Charging from cable' : 'Unknown'], ['Firmware', M.fw || 'Unknown'], ['Sensor', `PAW${dev.sensor}`]];
  grid.querySelector('#iL').appendChild(H.el(`<div class="block"><table class="info-table">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${H.esc(v)}</td></tr>`).join('')}</table></div>`));
  const R = grid.querySelector('#iR');
  const diag = H.el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Something not working?</h3><p class="note" style="margin:0">Copies a short technical report you can paste to whoever is helping you.</p><button class="btn" style="align-self:flex-start">Copy diagnostic info</button></div>');
  diag.querySelector('button').onclick = async () => {
    const info = { app: 'X68 Control mouse', product: dev.dev.productName, vid: dev.dev.vendorId, pid: dev.dev.productId, info: M.info, sensor: dev.sensor, fw: M.fw, cfg: M.cfg, trace: dev.trace };
    await navigator.clipboard.writeText(JSON.stringify(info, null, 1));
    H.toast('Copied. Paste it into your chat.');
  };
  R.appendChild(diag);
  const rs = H.el('<div class="block stack" style="gap:10px"><h3 style="margin:0">Factory reset</h3><p class="note" style="margin:0">Puts DPI, buttons and sensor settings back to how the mouse came out of the box.</p><button class="btn danger" style="align-self:flex-start">Reset mouse</button></div>');
  rs.querySelector('button').onclick = () => H.modal(`<h2>Reset the mouse?</h2><p>DPI stages, button changes and sensor settings go back to factory defaults. This can't be undone.</p><div class="row"><button class="btn danger" data-a="go">Reset mouse</button><button class="btn" data-a="no">Cancel</button></div>`, (card, close) => {
    card.querySelector('[data-a=no]').onclick = close;
    card.querySelector('[data-a=go]').onclick = () => { close(); save(async () => { await dev.factoryReset(); M.cfg = await dev.loadAll(); }, 'Mouse reset to factory settings'); };
  });
  R.appendChild(rs);
}
