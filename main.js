const { app, BrowserWindow, session, shell, Menu, ipcMain, Tray, Notification, nativeImage } = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const VID = 0x3151;
const PID = 0x502d;
const MOUSE_VIDS = [0x3554]; // Attack Shark V8 and the rest of its mouse family
const allowed = d => (d.vendorId === VID && d.productId === PID) || MOUSE_VIDS.includes(d.vendorId);

let win = null;
let tray = null;
let quitting = false;
const kbState = { connected: false, profile: 0 };
const mouseState = { connected: false, wired: true, level: null, charging: false, lowWarned: false };
const AUTO_DEFAULT = { enabled: false, game: 1, normal: 0 };
const auto = () => ({ ...AUTO_DEFAULT, ...(readPrefs().auto || {}) });
const startHidden = process.argv.includes('--hidden');

// small settings file for things only the app needs to remember
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } };
const writePrefs = p => { try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...p })); } catch {} };

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(body) {
  if (Notification.isSupported()) new Notification({ title: 'X68 Control', body, silent: true, icon: path.join(__dirname, 'build', 'icon.png') }).show();
}

function buildTrayMenu() {
  if (!tray) return;
  const startup = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  const profiles = [0, 1, 2, 3].map(p => ({
    label: `Keyboard profile ${p + 1}`,
    type: 'radio',
    checked: kbState.connected && kbState.profile === p,
    enabled: kbState.connected,
    click: () => win?.webContents.send('tray-profile', p),
  }));
  const a = auto();
  const battery = mouseState.connected && !mouseState.wired && mouseState.level != null
    ? [{ label: `Mouse battery ${mouseState.level}%${mouseState.charging ? ' (charging)' : ''}`, enabled: false }, { type: 'separator' }] : [];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open X68 Control', click: showWindow },
    { type: 'separator' },
    ...battery,
    ...(kbState.connected ? profiles : [{ label: 'Keyboard not connected', enabled: false }]),
    { label: `Switch to profile ${a.game + 1} when Siege opens`, type: 'checkbox', checked: a.enabled,
      click: i => setAuto({ enabled: i.checked }) },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: startup,
      click: i => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }); buildTrayMenu(); } },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  const tip = ['X68 Control'];
  if (kbState.connected) tip.push(`Keyboard profile ${kbState.profile + 1}`);
  if (battery.length) tip.push(`Mouse ${mouseState.level}%`);
  tray.setToolTip(tip.join(' · '));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  buildTrayMenu();
  ipcMain.on('tray-state', (_e, s) => {
    const changed = s.connected !== kbState.connected || s.profile !== kbState.profile;
    Object.assign(kbState, { connected: !!s.connected, profile: s.profile ?? 0 });
    if (changed) buildTrayMenu();
    if (s.announce && s.connected && !win?.isVisible()) notify(`Keyboard profile ${kbState.profile + 1} is on`);
  });
  ipcMain.on('mouse-state', (_e, m) => {
    const before = JSON.stringify([mouseState.connected, mouseState.wired, mouseState.level, mouseState.charging]);
    Object.assign(mouseState, { connected: !!m.connected, wired: !!m.wired, level: m.level ?? null, charging: !!m.charging });
    if (mouseState.connected && !mouseState.wired && mouseState.level != null && !mouseState.charging) {
      if (mouseState.level <= 15 && !mouseState.lowWarned) {
        mouseState.lowWarned = true;
        notify(`Mouse battery is at ${mouseState.level}%. Plug in the cable to charge, it keeps working while it charges.`);
      }
      if (mouseState.level >= 25) mouseState.lowWarned = false;
    }
    if (mouseState.charging) mouseState.lowWarned = false;
    if (JSON.stringify([mouseState.connected, mouseState.wired, mouseState.level, mouseState.charging]) !== before) buildTrayMenu();
  });
  ipcMain.handle('auto-get', () => auto());
  ipcMain.handle('auto-set', (_e, a) => setAuto(a));
  setInterval(checkSiege, 4000);
}

// ---------------------------------------------------------------- Siege auto-switch
// Every few seconds, look for Siege in the list of running programs. When it starts, the
// keyboard moves to the game profile. When it closes, it goes back to the normal one.
const siege = { running: false, applied: false, switchedByUs: false };

function setAuto(a) {
  writePrefs({ auto: { ...auto(), ...a } });
  buildTrayMenu();
  win?.webContents.send('auto-changed', auto());
  return auto();
}

function siegeRunning() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/NH', '/FO', 'CSV'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      resolve(!err && /"RainbowSix[^"]*\.exe"/i.test(out));
    });
  });
}

async function checkSiege() {
  const a = auto();
  if (!a.enabled) { siege.running = false; siege.applied = false; return; }
  const running = await siegeRunning();
  if (running && !siege.running) { siege.applied = false; siege.switchedByUs = false; }
  siege.running = running;
  if (running && !siege.applied && kbState.connected) {
    siege.applied = true;
    if (kbState.profile !== a.game) { siege.switchedByUs = true; win?.webContents.send('tray-profile', a.game); }
  }
  if (!running && siege.switchedByUs) {
    siege.switchedByUs = false;
    siege.applied = false;
    if (kbState.connected && kbState.profile !== a.normal) win?.webContents.send('tray-profile', a.normal);
  }
}

function createWindow() {
  win = new BrowserWindow({
    show: !startHidden,
    width: 1380,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#1b1f26',
    title: 'X68 Control',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });

  // Closing the window keeps the app in the taskbar corner. Quit from the icon's menu.
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readPrefs().trayHintShown) {
      writePrefs({ trayHintShown: true });
      notify('Still running in the taskbar corner. Right-click the icon to switch profiles or quit.');
    }
  });
  Menu.setApplicationMenu(null);

  const ses = win.webContents.session;

  // Only our keyboard and Attack Shark mice are ever offered to the page.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const match = details.deviceList.find(allowed);
    callback(match ? match.deviceId : '');
  });
  ses.setPermissionCheckHandler((wc, permission) => ['hid', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission));
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(['clipboard-sanitized-write', 'clipboard-read'].includes(permission)));
  // backups go straight to the Downloads folder
  ses.on('will-download', (e, item) => item.setSavePath(path.join(app.getPath('downloads'), item.getFilename())));
  ses.setDevicePermissionHandler(details => {
    if (details.deviceType !== 'hid') return false;
    return allowed(details.device);
  });

  // Links open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  setupUpdates(win);
}

// Updates come from GitHub releases. They download quietly, then the app asks before installing.
function setupUpdates(win) {
  const send = s => { if (!win.isDestroyed()) win.webContents.send('update-status', s); };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', i => send({ state: 'downloading', version: i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'latest' }));
  autoUpdater.on('download-progress', p => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => send({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => send({ state: 'error', message: String(e?.message || e).slice(0, 200) }));
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', () => (app.isPackaged ? autoUpdater.checkForUpdates().catch(() => null) : send({ state: 'latest' })));
  ipcMain.handle('update-install', () => { quitting = true; autoUpdater.quitAndInstall(false, true); });
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}

// Only one copy runs. Opening it again just brings the window back.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.setAppUserModelId('gg.siegeiq.x68control');
  app.whenReady().then(() => { createWindow(); createTray(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {});
}
