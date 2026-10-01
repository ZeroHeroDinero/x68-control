// Talks to the Attack Shark X68 HE over WebHID.
// Every message is a 64-byte feature report (report id 0) with a checksum byte.

export const VID = 0x3151;
export const PID = 0x502d;
export const SLOTS = 128; // key slots in the keyboard's matrix

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Magnetic switch setting codes (sub-commands of 0x65 / 0xE5)
export const OP = {
  PRESS: 0, RELEASE: 1, RT_PRESS: 2, RT_RELEASE: 3, DKS_TRAVEL: 4, MT_TIME: 5,
  BOTTOM_DZ: 6, MODE: 7, DKS_ROW: 8, SNAP: 9, DKS_TABLE: 10, TOP_DZ: 251, SWITCH: 252, LIVE: 254,
};
const U16_OPS = new Set([OP.PRESS, OP.RELEASE, OP.RT_PRESS, OP.RT_RELEASE, OP.DKS_TRAVEL, OP.BOTTOM_DZ]);

export const MODE = { NORMAL: 0, DKS: 2, MT: 3, TGL_HOLD: 4, TGL_RAPID: 5, SNAP: 7 };

export const LIGHT_EFFECTS = [
  'Off', 'Static', 'Breathing', 'Neon', 'Wave', 'Ripple', 'Raindrop', 'Snake', 'Reactive', 'Converge',
  'Sine wave', 'Kaleidoscope', 'Line wave', 'Custom pattern', 'Laser', 'Circle wave', 'Dazzle', 'Rain down',
  'Meteor', 'Reactive off', 'Music 3', 'Screen color', 'Music', 'Train', 'Fireworks', 'User color',
];

export const RATES = [8000, 4000, 2000, 1000, 500, 250, 125];

export class X68 {
  constructor(cmdDevice, eventDevices = []) {
    this.dev = cmdDevice;
    this.eventDevices = eventDevices;
    this.queue = Promise.resolve();
    this.busyUntil = 0;
    this.listeners = new Set();
    this.multiplier = 100;
    this.version = 0;
    this.deviceId = 0;
    this.supportsTopDz = false;
    this.trace = [];
    this._onReport = e => this._handleReport(e);
    for (const d of [cmdDevice, ...eventDevices]) d.addEventListener('inputreport', this._onReport);
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _handleReport(e) {
    const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    // [15,1,0] = keyboard busy writing, [15,0,0] = done
    if (d[0] === 15 && d[1] === 1 && d[2] === 0) this.busyUntil = Date.now() + 3000;
    if (d[0] === 15 && d[1] === 0 && d[2] === 0) this.busyUntil = 0;
    for (const fn of this.listeners) fn({ reportId: e.reportId, data: d });
  }

  // Serialise every exchange so two commands never interleave.
  _run(task) {
    const p = this.queue.then(task, task);
    this.queue = p.catch(() => {});
    return p;
  }

  async _waitIdle() {
    const start = Date.now();
    while (Date.now() < this.busyUntil && Date.now() - start < 4000) await sleep(50);
  }

  _frame(bytes, checksum) {
    const buf = new Uint8Array(64);
    buf.set(bytes.slice(0, 64));
    if (checksum === 7) buf[7] = 255 - (sum(buf, 0, 7) & 255);
    if (checksum === 8) buf[8] = 255 - (sum(buf, 0, 8) & 255);
    return buf;
  }

  async _send(bytes, checksum = 7, pre = 10) {
    await this._waitIdle();
    if (pre) await sleep(pre);
    const f = this._frame(bytes, checksum);
    this._log('>', f);
    await this.dev.sendFeatureReport(0, f);
  }

  _log(dir, bytes) {
    this.trace.push(`${dir} ${Array.from(bytes.slice(0, 20), b => b.toString(16).padStart(2, '0')).join(' ')}`);
    if (this.trace.length > 80) this.trace.shift();
  }

  async _read(pre = 10) {
    if (pre) await sleep(pre);
    const r = await this.dev.receiveFeatureReport(0);
    const out = new Uint8Array(r.buffer, r.byteOffset, r.byteLength);
    this._log('<', out);
    return out;
  }

  send(bytes, checksum = 7) { return this._run(() => this._send(bytes, checksum)); }
  query(bytes, checksum = 7) {
    return this._run(async () => { await this._send(bytes, checksum); return this._read(); });
  }
  // Several request/response pairs as one uninterrupted job.
  batch(fn) { return this._run(() => fn({ send: (b, c = 7) => this._send(b, c), query: async (b, c = 7) => { await this._send(b, c); return this._read(); } })); }
  pause(ms) { return this._run(() => sleep(ms)); }

  // ---------- identity ----------
  async identify() {
    const r = await this.query([0x8f]);
    if (r[0] !== 0x8f) throw new Error('The keyboard did not answer. Unplug it, plug it back in, then try again.');
    this.deviceId = new DataView(r.buffer, r.byteOffset).getUint32(1, true);
    this.version = (r[8] << 8) | r[7];
    const f = await this.query([0xe6]);
    if (f[1] === 170) {
      this.multiplier = [100, 200, 1000][f[2]] ?? 100;
      this.precision = ['0.01', '0.005', '0.001'][f[2]] ?? '0.01';
    } else {
      const v = this.version;
      this.multiplier = v >= 768 && v < 1280 ? 100 : v >= 1280 ? 200 : 10;
      this.precision = this.multiplier >= 200 ? '0.005' : this.multiplier === 100 ? '0.01' : '0.1';
    }
    this.supportsTopDz = this.version >= 1024;
    return { deviceId: this.deviceId, version: this.version, multiplier: this.multiplier };
  }

  // ---------- simple settings ----------
  async getProfile() { return (await this.query([132]))[1]; }
  async setProfile(p) { await this.send([4, p]); await this.pause(300); }

  async getRate() { return RATES[(await this.query([131]))[2]]; }
  async setRate(hz) { await this.send([3, 0, RATES.indexOf(hz)]); await this.pause(150); }

  async getDebounce() { return (await this.query([134]))[1]; }
  async setDebounce(v) { await this.send([6, v]); await this.pause(100); }

  async getOptions() {
    const r = await this.query([137]);
    return {
      system: ['win', 'mac', 'ios', 'android'][r[1]] ?? 'win',
      fnIndex: r[2],
      antiMistouch: !!r[3],
      rtStab: r[4] > 5 ? 0 : r[4] * 25,
      wasdSwap: r[5] === 1,
    };
  }
  async setOptions(o) {
    const sys = { win: 0, mac: 1, ios: 2, android: 3 }[o.system] ?? 0;
    await this.send([9, sys, o.fnIndex ?? 0, o.antiMistouch ? 1 : 0, Math.round((o.rtStab ?? 0) / 25), o.wasdSwap ? 1 : 0]);
    await this.pause(100);
  }

  async getLight() {
    const r = await this.query([135]);
    const low = r[4] & 15;
    let rgb = (r[5] << 16) | (r[6] << 8) | r[7];
    if (rgb === 16449530) rgb = 0xffffff;
    return { effect: r[1], speed: 4 - r[2], bright: r[3], option: r[4] >> 4, rainbow: low === 8, rgb };
  }
  async setLight(l) {
    let opt = (l.option << 4) | (l.rainbow ? 8 : 7);
    if (l.effect === 13) opt = l.option << 4;
    if (l.effect === 22 || l.effect === 20) opt = (l.option << 4) | (l.rainbow ? 0 : 4);
    if (l.effect === 21) opt = 0;
    let rgb = l.rgb === 0xffffff ? 16449530 : l.rgb;
    const b = [7, l.effect, 4 - l.speed, l.bright, opt, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    if (l.effect === 13) { b[5] = 0; b[6] = 200; b[7] = 200; }
    await this.send(b, 8);
    await this.pause(100);
  }

  async factoryReset() { await this.send([1]); await this.pause(2500); }

  // ---------- key mapping ----------
  async getKeyMatrix(profile, sub = 0) {
    return this.batch(async io => {
      const out = [];
      for (let c = 0; c < 8; c++) out.push(...await io.query([138, profile, 255, c, sub]));
      return out.slice(0, SLOTS * 4);
    });
  }
  async setKey(profile, pos, action, sub = 0) {
    await this.send([10, profile, pos, 0, 0, 1, sub, 0, ...action]);
    await this.pause(100);
  }
  async getFnMatrix(profile, sys = 0) {
    return this.batch(async io => {
      const out = [];
      for (let c = 0; c < 8; c++) out.push(...await io.query([144, sys, profile, 255, c]));
      return out.slice(0, SLOTS * 4);
    });
  }
  async setFnKey(profile, pos, action, sys = 0) {
    await this.send([16, sys, profile, pos, 0, 0, 0, 0, ...action]);
    await this.pause(100);
  }

  // ---------- macros ----------
  async getMacro(index) {
    return this.batch(async io => {
      let buf = [];
      for (let c = 0; c < 4; c++) {
        const r = await io.query([139, index, c]);
        buf.push(...r);
        if (hasZeroRun(r)) break;
      }
      return decodeMacro(new Uint8Array(buf));
    });
  }
  async setMacro(index, macro) {
    const bytes = encodeMacro(macro);
    let used = 0;
    for (let n = 0; n < 5; n++) if (bytes.slice(n * 56, n * 56 + 56).some(v => v)) used = n + 1;
    await this.batch(async io => {
      for (let n = 0; n < used; n++) {
        const chunk = pad(bytes.slice(n * 56, n * 56 + 56), 56);
        await io.send([11, index, n, 56, n === used - 1 ? 1 : 0, 0, 0, 0, ...chunk]);
      }
    });
    await this.pause(150);
  }

  // ---------- magnetic switches ----------
  async readOp(op, chunks) {
    return this.batch(async io => {
      const out = [];
      for (let c = 0; c < chunks; c++) {
        const r = await io.query([229, op, 1, c]);
        if (op === OP.LIVE && r[0] === 229 && r[1] === op && r[2] === 1 && r[3] === c) out.push(...new Array(64).fill(0));
        else out.push(...r);
      }
      return out;
    });
  }
  async readU16(op) { return toU16(await this.readOp(op, 4)).slice(0, SLOTS); }
  async readU8(op) { return (await this.readOp(op, 2)).slice(0, SLOTS); }

  // Reads every per-key switch setting into an array of 128 key records.
  async readSwitches() {
    const m = this.multiplier;
    const mode = await this.readU8(OP.MODE);
    const press = await this.readU16(OP.PRESS);
    const release = await this.readU16(OP.RELEASE);
    const bottom = await this.readU16(OP.BOTTOM_DZ);
    const rtPress = await this.readU16(OP.RT_PRESS);
    const rtRelease = await this.readU16(OP.RT_RELEASE);
    const dksTravel = await this.readU16(OP.DKS_TRAVEL);
    const dksTable = await this.readOp(OP.DKS_TABLE, 8);
    const mt = await this.readU8(OP.MT_TIME);
    const snap = await this.readU8(OP.SNAP);
    const sw = await this.readU8(OP.SWITCH);
    const top = this.supportsTopDz ? await this.readU8(OP.TOP_DZ) : new Array(SLOTS).fill(0);
    const keys = [];
    for (let p = 0; p < SLOTS; p++) {
      keys.push({
        mode: mode[p] & 127,
        rt: (mode[p] & 128) === 128,
        press: press[p] / m,
        release: release[p] / m,
        bottomDz: bottom[p] / m,
        topDz: top[p] / m,
        rtPress: rtPress[p] / m,
        rtRelease: rtRelease[p] / m,
        dksTravel: dksTravel[p] / m,
        dksRows: [0, 1, 2, 3].map(i => dksTable[i * 128 + p] ?? 0),
        mtTime: mt[p] * 10,
        snapWith: snap[p],
        switchType: sw[p],
      });
    }
    return keys;
  }

  // Writes the listed settings for all 128 keys in one go, the way the official driver does.
  // `fields` is a set of names: press, release, bottomDz, rtPress, rtRelease, dksTravel, mode, mtTime, snapWith, topDz, switchType
  // `dksKeys` lists key slots whose DKS rows changed.
  async writeSwitches(keys, fields, dksKeys = []) {
    const m = this.multiplier;
    const plan = [];
    if (fields.has('mode')) plan.push({ op: OP.MODE, data: keys.map(k => (k.mode & 127) | (k.rt ? 128 : 0)) });
    const u16 = (op, f) => fields.has(f) && plan.push({ op, data: u16Bytes(keys.map(k => Math.round(k[f] * m))) });
    u16(OP.PRESS, 'press');
    u16(OP.RELEASE, 'release');
    u16(OP.RT_PRESS, 'rtPress');
    u16(OP.RT_RELEASE, 'rtRelease');
    u16(OP.BOTTOM_DZ, 'bottomDz');
    u16(OP.DKS_TRAVEL, 'dksTravel');
    if (fields.has('mtTime')) plan.push({ op: OP.MT_TIME, data: keys.map(k => Math.round(k.mtTime / 10)) });
    if (fields.has('snapWith')) plan.push({ op: OP.SNAP, data: keys.map(k => k.snapWith) });
    if (fields.has('topDz') && this.supportsTopDz) plan.push({ op: OP.TOP_DZ, data: keys.map(k => Math.round(k.topDz * m)) });
    const singles = dksKeys.map(p => ({ op: OP.DKS_ROW, pos: p, data: keys[p].dksRows }));
    const switchPlan = fields.has('switchType') ? [{ op: OP.SWITCH, data: keys.map(k => k.switchType) }] : [];
    const all = [...plan, ...singles, ...switchPlan];
    if (!all.length) return;
    await this.batch(async io => {
      for (let i = 0; i < all.length; i++) {
        const step = all[i];
        const isLast = i === all.length - 1;
        if (step.pos !== undefined) {
          await io.send([101, step.op, 0, step.pos, isLast ? 1 : 0, 0, 0, 0, ...step.data]);
          continue;
        }
        const chunks = Math.ceil(step.data.length / 56);
        for (let c = 0; c < chunks; c++) {
          const part = pad(step.data.slice(c * 56, c * 56 + 56), 56);
          await io.send([101, step.op, 1, c, isLast && c === chunks - 1 ? 1 : 0, 0, 0, 0, ...part]);
        }
      }
    });
    await this.pause(600);
  }

  // ---------- per-key RGB patterns ----------
  async getPattern(slot) {
    return this.batch(async io => {
      const out = [];
      for (let c = 0; c < 6; c++) out.push(...await io.query([140, slot, 255, c]));
      return out.slice(0, SLOTS * 3);
    });
  }
  async setPattern(slot, rgbBytes) {
    const data = pad(rgbBytes, SLOTS * 3);
    await this.batch(async io => {
      for (let c = 0; c < 7; c++) {
        const part = pad(data.slice(c * 56, c * 56 + 56), 56);
        await io.send([12, slot, 255, c, c === 6 ? 378 - 56 * 6 : 56, c === 6 ? 1 : 0, 0, 0, ...part]);
      }
    });
    await this.pause(150);
  }

  // ---------- calibration and live depth ----------
  async startCalibration() {
    await this.send([28, 1]); await this.pause(2000);
    await this.send([28, 0]); await this.pause(100);
    await this.send([30, 1]); await this.pause(100);
  }
  async stopCalibration() { await this.send([30, 0]); await this.pause(300); }
  async readLiveTravel() { return toU16(await this.readOp(OP.LIVE, 4)).slice(0, SLOTS).map(v => v / this.multiplier); }
  async setDepthReports(on) { await this.send([27, on ? 1 : 0]); await this.pause(100); }

  async close() {
    for (const d of [this.dev, ...this.eventDevices]) {
      d.removeEventListener('inputreport', this._onReport);
      try { if (d.opened) await d.close(); } catch {}
    }
  }
}

// ---------- helpers ----------
function sum(a, from, to) { let s = 0; for (let i = from; i < to; i++) s += a[i]; return s; }
function pad(arr, len) { const a = Array.from(arr); while (a.length < len) a.push(0); return a.slice(0, len); }
function toU16(bytes) { const out = []; for (let i = 0; i + 1 < bytes.length; i += 2) out.push(bytes[i] | (bytes[i + 1] << 8)); return out; }
function u16Bytes(vals) { const out = []; for (const v of vals) { const n = Math.max(0, Math.min(65535, v | 0)); out.push(n & 255, n >> 8); } return out; }
function hasZeroRun(r) { for (let i = 0; i <= r.length - 4; i++) if (!r[i] && !r[i + 1] && !r[i + 2] && !r[i + 3]) return true; return false; }

// Macro wire format. Events alternate: action, delay.
// action: { type:'key', code, down } | { type:'mouse', button:0..4, down }
export function encodeMacro({ repeat = 1, steps = [] }) {
  const out = [repeat & 255, repeat >> 8];
  for (const s of steps) {
    const delay = Math.max(1, Math.min(65535, Math.round(s.delay ?? 10)));
    const code = s.type === 'mouse' ? 240 + (s.button ?? 0) : s.code;
    out.push(code);
    if (delay <= 127) out.push(s.down ? delay + 128 : delay);
    else out.push(s.down ? 128 : 0, delay & 255, delay >> 8);
  }
  return pad(out, 256);
}

export function decodeMacro(t) {
  const steps = [];
  const repeat = t[0] | (t[1] << 8);
  let s = 2;
  let n = t.slice(s, s + 4);
  s += 4;
  while (s < t.length) {
    if (n[0] === 249) {
      // mouse move: skip, keep delay alignment
      if (n[1] === 0) s += 2;
    } else {
      const down = n[1] > 127;
      const step = n[0] >= 240 && n[0] <= 244 ? { type: 'mouse', button: n[0] - 240, down } : { type: 'key', code: n[0], down };
      let delay;
      if (n[1] & 127) { delay = n[1] & 127; s -= 2; } else { delay = n[2] | (n[3] << 8); }
      step.delay = delay;
      if (step.type === 'mouse' || (n[0] >= 4 && n[0] <= 239)) steps.push(step);
    }
    n = t.slice(s, s + 4);
    if (!n[0] && !n[1] && !n[2] && !n[3]) break;
    s += 4;
  }
  return { repeat, steps };
}

// Find and open the keyboard's command and event interfaces.
export async function openKeyboard(devices) {
  const ours = devices.filter(d => d.vendorId === VID && d.productId === PID);
  const isCmd = d => d.collections.some(c => c.usagePage === 0xff00 + 0xff && c.usage === 2 && c.featureReports.length);
  const isEvt = d => d.collections.some(c => c.usagePage === 0xffff && c.usage === 1);
  const cmd = ours.find(isCmd) ?? ours.find(d => d.collections.some(c => c.featureReports.length));
  if (!cmd) return null;
  if (!cmd.opened) await cmd.open();
  const events = [];
  for (const d of ours) {
    if (d === cmd || !isEvt(d)) continue;
    try { if (!d.opened) await d.open(); events.push(d); } catch {}
  }
  return new X68(cmd, events);
}
