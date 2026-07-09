// Social AI Team Desktop — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const setup = require('./lib/setup');
const workspace = require('./lib/workspace');
const pipeline = require('./lib/pipeline');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dep missing in dev */ }

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Social AI Team',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  initAutoUpdate();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---- Auto update (electron-updater ← GitHub Releases) -----------------------
function initAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return; // dev run or dep missing
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('update', { state: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update', { state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send('update', { state: 'latest', version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send('update', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update', { state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => send('update', { state: 'error', message: String(e && e.message || e).slice(0, 300) }));
  // macOS unsigned builds cannot apply updates (Squirrel requires a signature) — the
  // error handler above surfaces that instead of crashing.
  autoUpdater.checkForUpdates().catch(() => {});
}
ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return { ok: false, message: 'updater unavailable (dev run)' };
  if (!app.isPackaged) return { ok: false, message: 'dev run — packaged app에서만 동작' };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e).slice(0, 300) }; }
});
ipcMain.handle('update:install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });

// ---- Setup wizard ----------------------------------------------------------
ipcMain.handle('setup:check', () => setup.checkEnvironment());
ipcMain.handle('setup:installSkills', () => setup.installSkills());
ipcMain.handle('setup:installCodex', () => setup.installCodexCli((line) => send('log', { source: 'setup', line })));
ipcMain.handle('setup:codexLogin', () => setup.codexOAuthLogin((line) => send('log', { source: 'setup', line })));
ipcMain.handle('setup:registerMcp', () => setup.registerCodexMcp((line) => send('log', { source: 'setup', line })));
ipcMain.handle('setup:installIma2', () => setup.installIma2((line) => send('log', { source: 'setup', line })));
ipcMain.handle('setup:ima2Setup', () => pipeline.openInteractiveTerminal(app.getPath('home'), 'ima2 setup'));

// ---- Workspace (clients) ---------------------------------------------------
ipcMain.handle('ws:list', () => workspace.listClients());
ipcMain.handle('ws:create', (_e, name) => workspace.createClient(name));
ipcMain.handle('ws:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : workspace.addExisting(r.filePaths[0]);
});
ipcMain.handle('ws:status', (_e, dir) => workspace.readStatus(dir));
ipcMain.handle('ws:outputs', (_e, dir) => workspace.listOutputs(dir));
ipcMain.handle('ws:readFile', (_e, dir, rel) => workspace.readOutputFile(dir, rel));
ipcMain.handle('ws:openFolder', (_e, dir) => shell.openPath(dir));

// ---- Pipeline stages -------------------------------------------------------
ipcMain.handle('pipe:runStage', (_e, dir, stage, opts) =>
  pipeline.runStage(dir, stage, opts, (line) => send('log', { source: stage, line }))
);
ipcMain.handle('pipe:stop', () => pipeline.stopCurrent());
ipcMain.handle('pipe:openTerminal', (_e, dir) => pipeline.openInteractiveTerminal(dir));
