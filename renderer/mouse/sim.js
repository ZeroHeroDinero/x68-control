// A pretend V8 that speaks the real protocol. Used for the preview mode (?demo) and for tests.
const REPORT_ID = 8;

export class SimMouseDevice {
  constructor({ mid = 18, type = 1 } = {}) {
    this.vendorId = 0x3554;
    this.productId = 0xf50d;
    this.productName = 'ATTACK SHARK V8 (preview)';
    this.opened = true;
    this.collections = [{ usagePage: 0xff02, usage: 2, inputReports: [{ reportId: 8 }], outputReports: [{ reportId: 8 }], featureReports: [] }];
    this.mid = mid; this.type = type;
    this.mem = new Uint8Array(16384).fill(255);
    this.listeners = [];
    this.badChecksums = 0;
    const put = (a, v) => { this.mem[a] = v; this.mem[a + 1] = (85 - v) & 255; };
    put(0, 1); put(2, 4); put(4, 1); put(10, 1); put(169, 4); put(171, 1); put(173, 6); put(175, 0); put(177, 0); put(185, 1); put(225, 0); put(189, 0); put(191, 1);
    const dpis = [400, 800, 1600, 3200, 6400, 12800, 26000, 42000];
    const cols = [0xff0000, 0x46fd1f, 0x0000ff, 0xfcff29, 0x55fdfe, 0xf820fe, 0xffffff, 0xff8800];
    dpis.forEach((d, i) => {
      let val, ex = 0;
      if (d >= 30100) { val = Math.round(d / 2 / 50) - 1; ex = 17; } else val = Math.round(d / 50) - 1;
      const hi = (val >> 8) & 3;
      const b = [val & 255, val & 255, (hi << 2) | (hi << 6) | ((ex | (ex << 4)) & 255)];
      b.push((85 - b.reduce((x, y) => x + y, 0)) & 255);
      this.mem.set(b, 12 + i * 4);
      const c = [(cols[i] >> 16) & 255, (cols[i] >> 8) & 255, cols[i] & 255];
      c.push((85 - c.reduce((x, y) => x + y, 0)) & 255);
      this.mem.set(c, 44 + i * 4);
    });
    [[1, 0x0100], [1, 0x0200], [1, 0x0400], [1, 0x0800], [1, 0x1000]].forEach(([t, p], i) => {
      const b = [t, p >> 8, p & 255];
      b.push((85 - b.reduce((x, y) => x + y, 0)) & 255);
      this.mem.set(b, 96 + i * 4);
    });
  }
  addEventListener(t, fn) { if (t === 'inputreport') this.listeners.push(fn); }
  removeEventListener(t, fn) { this.listeners = this.listeners.filter(f => f !== fn); }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    let s = id; for (let i = 0; i < 15; i++) s += b[i];
    if (((s + b[15]) & 255) !== 85) this.badChecksums++;
    const r = new Uint8Array(16); r.set(b.slice(0, 5));
    const addr = (b[2] << 8) | b[3], len = b[4] & 15;
    if (b[0] === 1) { r[9] = 124; r[10] = this.mid; r[11] = this.type; }
    if (b[0] === 3) r[5] = 1;
    if (b[0] === 4) { r[5] = 87; r[6] = 0; }
    if (b[0] === 18) { r[5] = 3; r[6] = 0x01; }
    if (b[0] === 8) for (let i = 0; i < len; i++) r[5 + i] = this.mem[addr + i];
    if (b[0] === 7) for (let i = 0; i < len; i++) this.mem[addr + i] = b[5 + i];
    setTimeout(() => this.listeners.forEach(fn => fn({ reportId: REPORT_ID, data: new DataView(r.buffer) })), 3);
  }
}
