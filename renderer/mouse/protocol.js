// Talks to Attack Shark mice on the 0x3554 platform (V8 and siblings) over WebHID.
// Every message is a 16-byte output report with report id 8:
//   [command, 0, addressHigh, addressLow, length, data x10, checksum]
// The mouse keeps its settings in a small memory. Single settings are stored as
// [value, 0x55 - value] so the mouse can tell a real value from an empty slot.

import { MOUSE_DB } from './models.js';

export const REPORT_ID = 8;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const CMD = {
  Hello: 1, DriverStatus: 2, Online: 3, Battery: 4, Write: 7, Read: 8, FactoryReset: 9,
  StatusChanged: 10, GetProfile: 14, SetProfile: 15, Version: 18, DongleVersion: 29,
  GetLongRange: 23, SetLongRange: 22,
};

// Memory addresses (from the official driver's map).
export const ADDR = {
  ReportRate: 0, StageCount: 2, CurrentStage: 4, KeyOperation: 8, LOD: 10, DPI: 12, DPIColor: 44,
  KeyFunction: 96, DebounceTime: 169, MotionSync: 171, SleepTime: 173, Angle: 175, Ripple: 177,
  PerformanceState: 181, Performance: 183, SensorMode: 185, AngleTune: 189, AngleTuneState: 191,
  FPS20K: 225, ShortcutKey: 256, DPI3955: 6912, End: 6997,
};

export const BUTTON_TYPE = {
  Off: 0, Mouse: 1, DPI: 2, TiltWheel: 3, Fire: 4, Combo: 5, Macro: 6, RateSwitch: 7, Light: 8,
  Profile: 9, DPILock: 10, ScrollWheel: 11,
};

export const RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
const rateToByte = hz => (hz <= 1000 ? 1000 / hz : (hz / 2000) * 16);
const byteToRate = b => (b >= 16 ? (b / 16) * 2000 : b ? 1000 / b : 1000);

function checksum(bytes) {
  let s = REPORT_ID;
  for (let i = 0; i < 15; i++) s += bytes[i];
  return (85 - s) & 255;
}
// Little blocks of data carry their own trailing check byte: 0x55 minus the sum.
const blockCheck = arr => (85 - arr.reduce((a, b) => a + b, 0)) & 255;

export class Mouse {
  constructor(dev) {
    this.dev = dev;
    this.mem = new Uint8Array(16384).fill(255);
    this.queue = Promise.resolve();
    this.waiter = null;
    this.listeners = new Set();
    this.trace = [];
    this.info = { cid: 0, mid: 0, type: 0 };
    this.model = null;
    this._onReport = e => this._handle(e);
    dev.addEventListener('inputreport', this._onReport);
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _log(dir, b) {
    this.trace.push(`${dir} ${Array.from(b.slice(0, 16), x => x.toString(16).padStart(2, '0')).join(' ')}`);
    if (this.trace.length > 60) this.trace.shift();
  }

  _handle(e) {
    if (e.reportId !== REPORT_ID) return;
    const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    this._log('<', d);
    if ((d[0] === CMD.Read || d[0] === CMD.Write) && d[1] === 0) {
      const addr = (d[2] << 8) | d[3];
      const len = d[4] & 15;
      for (let i = 0; i < len; i++) this.mem[addr + i] = d[5 + i];
    }
    if (this.waiter && this.waiter.match(d)) { const w = this.waiter; this.waiter = null; w.resolve(d); return; }
    for (const fn of this.listeners) fn(d);
  }

  _run(task) {
    const p = this.queue.then(task, task);
    this.queue = p.catch(() => {});
    return p;
  }

  // Send one 16-byte message and wait for the mouse to echo it back.
  async _exchange(bytes) {
    const out = new Uint8Array(16);
    out.set(bytes.slice(0, 15));
    out[15] = checksum(out);
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = new Promise(resolve => {
        // the reply repeats the command and address; status byte 1 means "not supported"
        this.waiter = { match: d => d[0] === out[0] && (d[1] === 1 || (d[2] === out[2] && d[3] === out[3])), resolve };
      });
      this._log('>', out);
      await this.dev.sendReport(REPORT_ID, out);
      const d = await Promise.race([reply, sleep(250).then(() => null)]);
      if (d) return d;
    }
    this.waiter = null;
    throw new Error('The mouse did not answer. If it is wireless, move it to wake it up.');
  }

  cmd(command, payload = []) {
    const b = new Array(15).fill(0);
    b[0] = command;
    b[4] = payload.length;
    payload.forEach((v, i) => { b[5 + i] = v & 255; });
    return this._run(() => this._exchange(b));
  }

  // ---------- memory ----------
  readRange(start, end) {
    return this._run(async () => {
      for (let a = start; a < end; a += 10) {
        const len = Math.min(10, end - a);
        await this._exchange([CMD.Read, 0, a >> 8, a & 255, len, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      }
    });
  }
  writeBytes(addr, data) {
    return this._run(async () => {
      for (let o = 0; o < data.length; o += 10) {
        const part = Array.from(data.slice(o, o + 10));
        const a = addr + o;
        const b = [CMD.Write, 0, a >> 8, a & 255, part.length, ...part];
        while (b.length < 15) b.push(0);
        const d = await this._exchange(b);
        if (d[1] === 1) throw new Error('The mouse refused that setting.');
        part.forEach((v, i) => { this.mem[a + i] = v; });
      }
    });
  }
  writeValue(addr, value) { return this.writeBytes(addr, [value & 255, (85 - value) & 255]); }
  valid(addr) { return ((this.mem[addr] + this.mem[addr + 1]) & 255) === 85; }

  // ---------- connect ----------
  async hello() {
    const r = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256));
    const d = await this.cmd(CMD.Hello, [...r, 0, 0]);
    this.info = { cid: d[9], mid: d[10], type: d[11] };
    this.wired = d[11] === 2 || d[11] === 3;
    this.maxRate = d[11] === 2 ? 1000 : 8000;
    this.model = MOUSE_DB.models.find(m => m.mids.includes(this.info.mid)) ?? null;
    return this.info;
  }
  async isOnline() {
    const d = await this.cmd(CMD.Online);
    return d[5] === 1;
  }
  async battery() {
    const d = await this.cmd(CMD.Battery);
    return { level: d[9] === 1 ? d[10] : d[5], charging: d[6] === 1 };
  }
  async version() {
    const d = await this.cmd(CMD.Version);
    return `${d[5]}.${d[6].toString(16).padStart(2, '0')}`;
  }
  async factoryReset() { await this.cmd(CMD.FactoryReset); await sleep(1500); }

  async loadAll() {
    this.mem.fill(255);
    await this.readRange(0, 256);
    await this.readRange(ADDR.ShortcutKey, ADDR.ShortcutKey + 32 * 6);
    await this.readRange(ADDR.DPI3955, ADDR.End);
    // Pick the DPI format: the official table first, the mouse's own memory as a fallback.
    if (this.model) this.sensor = this.model.sensor;
    else {
      const ok3955 = [0, 1].every(i => blockCheck(Array.from(this.mem.slice(ADDR.DPI3955 + i * 6, ADDR.DPI3955 + i * 6 + 5))) === this.mem[ADDR.DPI3955 + i * 6 + 5]);
      this.sensor = ok3955 ? '3955' : '3950';
    }
    this.sensorCfg = MOUSE_DB.sensors[this.sensor] ?? MOUSE_DB.sensors['3950'];
    return this.decode();
  }

  // ---------- DPI encoding ----------
  _dpiToRaw(dpi) {
    const range = this.sensorCfg.range;
    let r = range.length - 1;
    while (r > 0 && dpi < range[r].min) r--;
    const ex = range[r].DPIex;
    const div = r === 3 ? 4 : r === 1 || r === 2 ? 2 : 1;
    const val = Math.round(dpi / div / range[0].step) - 1;
    return { val, ex };
  }
  _rawToDpi(val, ex) {
    let n = (val + 1) * this.sensorCfg.range[0].step;
    if (ex & 1) n *= 2;
    if (ex & 2) n *= 2;
    return n;
  }
  _readStage(i) {
    if (this.sensor === '3955') {
      const a = ADDR.DPI3955 + i * 6, m = this.mem;
      const bits = m[a + 4];
      return this._rawToDpi(m[a] + (m[a + 1] << 8) + (((bits >> 2) & 3) << 16), bits & 3);
    }
    const a = ADDR.DPI + i * 4, m = this.mem;
    const bits = m[a + 2];
    return this._rawToDpi(m[a] + (((bits >> 2) & 3) << 8), bits & 3);
  }
  async setStageDpi(i, dpi) {
    const { val, ex } = this._dpiToRaw(dpi);
    const exByte = (ex | (ex << 4)) & 255;
    if (this.sensor === '3955') {
      const hi = (val >> 16) & 3;
      const b = [val & 255, (val >> 8) & 255, val & 255, (val >> 8) & 255, (hi << 2) | (hi << 6) | exByte, 0];
      b[5] = blockCheck(b.slice(0, 5));
      await this.writeBytes(ADDR.DPI3955 + i * 6, b);
    } else {
      const hi = (val >> 8) & 3;
      const b = [val & 255, val & 255, (hi << 2) | (hi << 6) | exByte, 0];
      b[3] = blockCheck(b.slice(0, 3));
      await this.writeBytes(ADDR.DPI + i * 4, b);
    }
  }
  async setStageColor(i, rgb) {
    const b = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 0];
    b[3] = blockCheck(b.slice(0, 3));
    await this.writeBytes(ADDR.DPIColor + i * 4, b);
  }

  // ---------- buttons ----------
  _readButton(index) {
    const a = ADDR.KeyFunction + index * 4, m = this.mem;
    const type = m[a];
    const param = type === BUTTON_TYPE.DPILock ? m[a + 1] | (m[a + 2] << 8) : (m[a + 1] << 8) | m[a + 2];
    const out = { type, param };
    if (type === BUTTON_TYPE.Combo) out.combo = this._readCombo(index);
    return out;
  }
  _readCombo(index) {
    const a = ADDR.ShortcutKey + index * 32, m = this.mem;
    const n = m[a];
    const ev = [];
    for (let i = 0; i < n / 2 && i < 10; i++) ev.push({ kind: m[a + 1 + i * 3] & 15, code: m[a + 2 + i * 3] | (m[a + 3 + i * 3] << 8) });
    return ev;
  }
  async setButton(index, type, param) {
    const b = [type, 0, 0, 0];
    if (type === BUTTON_TYPE.DPILock) { const { val } = this._dpiToRaw(param); b[1] = val & 255; b[2] = (val >> 8) & 255; }
    else { b[1] = (param >> 8) & 255; b[2] = param & 255; }
    b[3] = blockCheck(b.slice(0, 3));
    await this.writeBytes(ADDR.KeyFunction + index * 4, b);
  }
  // events: [{kind: 0 modifier bitmask | 1 key | 2 media, code}]
  async setCombo(index, events) {
    const b = [events.length * 2];
    for (const e of events) b.push(e.kind | 128, e.code & 255, (e.code >> 8) & 255);
    for (const e of [...events].reverse()) b.push(e.kind | 64, e.code & 255, (e.code >> 8) & 255);
    b.push(0);
    b[b.length - 1] = blockCheck(b.slice(0, -1));
    await this.writeBytes(ADDR.ShortcutKey + index * 32, b);
    await this.setButton(index, BUTTON_TYPE.Combo, 0);
  }

  // ---------- whole-config decode ----------
  decode() {
    const m = this.mem;
    const stages = [];
    for (let i = 0; i < 8; i++) stages.push({ dpi: this._readStage(i), color: (m[ADDR.DPIColor + i * 4] << 16) | (m[ADDR.DPIColor + i * 4 + 1] << 8) | m[ADDR.DPIColor + i * 4 + 2] });
    const buttons = (this.model?.buttons ?? [0, 1, 2, 3, 4].map(index => ({ index }))).map(b => ({ index: b.index, ...this._readButton(b.index) }));
    let angleTune = null;
    if (this.valid(ADDR.AngleTune) && this.valid(ADDR.AngleTuneState)) { angleTune = m[ADDR.AngleTune]; if (angleTune >= 128) angleTune -= 256; }
    return {
      rate: Math.min(byteToRate(m[ADDR.ReportRate]), this.maxRate ?? 8000),
      stageCount: Math.max(1, Math.min(8, m[ADDR.StageCount])),
      currentStage: m[ADDR.CurrentStage],
      stages,
      buttons,
      lod: m[ADDR.LOD],
      debounce: m[ADDR.DebounceTime],
      motionSync: m[ADDR.MotionSync] === 1,
      ripple: m[ADDR.Ripple] === 1,
      angle: m[ADDR.Angle] === 1,
      sensorMode: m[ADDR.SensorMode],
      sleep: m[ADDR.SleepTime],
      fps20k: this.valid(ADDR.FPS20K) ? m[ADDR.FPS20K] === 1 : null,
      angleTune,
    };
  }

  setRate(hz) { return this.writeValue(ADDR.ReportRate, rateToByte(hz)); }
  setStageCount(n) { return this.writeValue(ADDR.StageCount, n); }
  setCurrentStage(i) { return this.writeValue(ADDR.CurrentStage, i); }
  setLod(v) { return this.writeValue(ADDR.LOD, v); }
  setDebounce(ms) { return this.writeValue(ADDR.DebounceTime, ms); }
  setMotionSync(on) { return this.writeValue(ADDR.MotionSync, on ? 1 : 0); }
  setRipple(on) { return this.writeValue(ADDR.Ripple, on ? 1 : 0); }
  setAngle(on) { return this.writeValue(ADDR.Angle, on ? 1 : 0); }
  setSensorMode(v) { return this.writeValue(ADDR.SensorMode, v); }
  setSleep(v) { return this.writeValue(ADDR.SleepTime, v); }
  setFps20k(on) { return this.writeValue(ADDR.FPS20K, on ? 1 : 0); }
  async setAngleTune(deg) {
    await this.writeValue(ADDR.AngleTuneState, 1);
    await this.writeValue(ADDR.AngleTune, deg < 0 ? deg + 256 : deg);
  }

  async close() {
    this.dev.removeEventListener('inputreport', this._onReport);
    try { if (this.dev.opened) await this.dev.close(); } catch {}
  }
}

export function isOurMouse(d) {
  return MOUSE_DB.vid.includes(d.vendorId);
}
export function mouseFilters() {
  return MOUSE_DB.vid.flatMap(v => MOUSE_DB.pids.map(p => ({ vendorId: v, productId: p })));
}

// Find the control interface: one input and one output report, output id 8.
export async function openMouse(devices) {
  const ours = devices.filter(isOurMouse);
  const pick = ours.find(d => d.collections.some(c => c.inputReports.length === 1 && c.outputReports.length === 1 && c.outputReports[0].reportId === REPORT_ID))
    ?? ours.find(d => d.collections.some(c => c.outputReports.some(r => r.reportId === REPORT_ID)));
  if (!pick) return null;
  if (!pick.opened) await pick.open();
  return new Mouse(pick);
}
