const { app, BrowserWindow, session, shell, Menu, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const VID = 0x3151;
const PID = 0x502d;
const MOUSE_VIDS = [0x3554]; // Attack Shark V8 and the rest of its mouse family
const allowed = d => (d.vendorId === VID && d.productId === PID) || MOUSE_VIDS.includes(d.vendorId);

function createWindow() {
  const win = new BrowserWindow({
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
    },
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
  ipcMain.handle('update-install', () => autoUpdater.quitAndInstall(false, true));
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
