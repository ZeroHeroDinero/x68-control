// A pretend keyboard so the app can be previewed without the X68 plugged in (open with ?demo).
import { SLOTS, encodeMacro, decodeMacro } from './protocol.js';
import { LAYOUT } from './keymap.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class MockX68 {
  constructor() {
    this.multiplier = 100;
    this.precision = '0.01';
    this.supportsTopDz = true;
    this.version = 0x0517;
    this.deviceId = 2270;
    this.profile = 0;
    this.listeners = new Set();
    this.profiles = [0, 1, 2, 3].map(() => this._fresh());
    this.rate = 8000;
    this.options = { system: 'win', fnIndex: 0, antiMistouch: false, rtStab: 0, wasdSwap: false };
    this.light = { effect: 4, speed: 2, bright: 3, option: 0, rainbow: true, rgb: 0xffffff };
    this.macros = {};
    this.patterns = {};
  }
  _fresh() {
    const keys = [];
    for (let p = 0; p < SLOTS; p++) keys.push({ mode: 0, rt: false, press: 2.0, release: 2.0, bottomDz: 0.3, topDz: 0.3, rtPress: 0.3, rtRelease: 0.3, dksTravel: 1.0, dksRows: [0, 0, 0, 0], mtTime: 200, snapWith: 0, switchType: 0 });
    for (const p of [14, 9, 15, 21]) Object.assign(keys[p], { press: 0.4, rt: true, rtPress: 0.15, rtRelease: 0.15 });
    const base = new Array(SLOTS * 4).fill(0);
    for (const k of LAYOUT) base.splice(k.pos * 4, 4, ...(k.label === 'Fn' ? [10, 1, 0, 0] : [0, 0, k.hid, 0]));
    const fn = new Array(SLOTS * 4).fill(0);
    LAYOUT.filter(k => k.y === 0 && k.hid >= 30 && k.hid <= 46).forEach((k, i) => fn.splice(k.pos * 4, 4, 0, 0, 58 + i, 0));
    return { keys, subs: [base, [...base], [...base], [...base]], fn };
  }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async identify() { await sleep(120); return { deviceId: this.deviceId, version: this.version, multiplier: 100 }; }
  async getProfile() { return this.profile; }
  async setProfile(p) { await sleep(150); this.profile = p; }
  async getRate() { return this.rate; }
  async setRate(r) { this.rate = r; }
  async getDebounce() { return 0; }
  async setDebounce() {}
  async getOptions() { return { ...this.options }; }
  async setOptions(o) { this.options = { ...o }; await sleep(60); }
  async getLight() { return { ...this.light }; }
  async setLight(l) { this.light = { ...l }; await sleep(40); }
  async factoryReset() { await sleep(600); this.profiles = [0, 1, 2, 3].map(() => this._fresh()); }
  async getKeyMatrix(profile, sub = 0) { await sleep(60); return [...this.profiles[profile].subs[sub]]; }
  async setKey(profile, pos, action, sub = 0) { this.profiles[profile].subs[sub].splice(pos * 4, 4, ...action); await sleep(60); }
  async getFnMatrix(profile) { return [...this.profiles[profile].fn]; }
  async setFnKey(profile, pos, action) { this.profiles[profile].fn.splice(pos * 4, 4, ...action); await sleep(60); }
  async getMacro(i) { return this.macros[i] ? decodeMacro(new Uint8Array(encodeMacro(this.macros[i]))) : { repeat: 1, steps: [] }; }
  async setMacro(i, m) { this.macros[i] = m; await sleep(100); }
  async readSwitches() { await sleep(250); return structuredClone(this.profiles[this.profile].keys); }
  async writeSwitches(keys) { await sleep(400); this.profiles[this.profile].keys = structuredClone(keys); }
  async getPattern(slot) { return this.patterns[slot] ?? new Array(SLOTS * 3).fill(0); }
  async setPattern(slot, data) { this.patterns[slot] = [...data]; await sleep(100); }
  async startCalibration() { await sleep(800); }
  async stopCalibration() {}
  async readLiveTravel() { await sleep(120); return new Array(SLOTS).fill(0).map(() => (Math.random() < 0.08 ? 3.4 : 0)); }
  async setDepthReports(on) {
    clearInterval(this._depth);
    if (!on) return;
    let t = 0;
    this._depth = setInterval(() => {
      t += 0.25;
      const v = Math.max(0, Math.sin(t) * 3.6);
      const raw = Math.round(v * 100);
      for (const fn of this.listeners) fn({ reportId: 5, data: new Uint8Array([27, raw & 255, raw >> 8, 14]) });
    }, 40);
  }
  async close() { clearInterval(this._depth); }
}
