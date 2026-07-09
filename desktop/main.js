// Social AI Team Desktop — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const setup = require('./lib/setup');
const workspace = require('./lib/workspace');
const pipeline = require('./lib/pipeline');
const fs = require('fs');
const os = require('os');
const config = require('./lib/config');
const chat = require('./lib/chat');
const board = require('./lib/board');
const gates = require('./lib/gates');

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
ipcMain.handle('ws:board', (_e, dir) => board.buildBoard(dir));

// ---- Live board: watch the client folder, push board updates -----------------
let watchers = [];
let watchDir = null;
let watchTimer = null;
let building = false;
function pushBoard() {
  if (!watchDir || building) return;
  building = true;
  try { send('board:update', board.buildBoard(watchDir)); } catch { /* transient fs state */ }
  building = false;
}
function onFsEvent() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(pushBoard, 500);
}
ipcMain.handle('ws:watch', (_e, dir) => {
  for (const w of watchers) { try { w.close(); } catch { /* gone */ } }
  watchers = [];
  watchDir = dir;
  if (!dir) return { ok: true, watching: false };
  const targets = [path.join(dir, 'outputs'), path.join(dir, 'context')];
  for (const t of targets) {
    try { fs.mkdirSync(t, { recursive: true }); } catch { /* exists */ }
    try {
      watchers.push(fs.watch(t, { recursive: true }, onFsEvent));
    } catch {
      // Linux: no recursive watch — watch lane subdirs individually
      try {
        watchers.push(fs.watch(t, onFsEvent));
        for (const sub of fs.readdirSync(t)) {
          const p = path.join(t, sub);
          try { if (fs.statSync(p).isDirectory()) watchers.push(fs.watch(p, onFsEvent)); } catch { /* skip */ }
        }
      } catch { /* unwatchable */ }
    }
  }
  return { ok: true, watching: watchers.length > 0 };
});

// ---- Gates (approval stamps) ---------------------------------------------------
ipcMain.handle('gates:get', (_e, dir) => gates.computeGates(board.buildBoard(dir), gates.load(dir)));
ipcMain.handle('gates:approve', (_e, dir, entry) => {
  gates.approve(dir, entry);
  return gates.computeGates(board.buildBoard(dir), gates.load(dir));
});

// ---- Channel connection check (Blotato MCP presence) ----------------------------
let channelCache = { at: 0, data: null };
ipcMain.handle('channels:check', () => {
  if (channelCache.data && Date.now() - channelCache.at < 10 * 60 * 1000) return channelCache.data;
  let blotato = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    blotato = Object.keys(cfg.mcpServers || {}).some((k) => /blotato/i.test(k));
  } catch { /* no config */ }
  channelCache = { at: Date.now(), data: { blotato } };
  return channelCache.data;
});

// ---- Pipeline stages -------------------------------------------------------
ipcMain.handle('pipe:runStage', async (_e, dir, stage, opts) => {
  const startedAt = Date.now();
  send('stage', { state: 'start', stage, startedAt });
  const r = await pipeline.runStage(dir, stage, opts, (line) => send('log', { source: stage, line }));
  send('stage', { state: 'end', stage, ok: r.ok, startedAt });
  setTimeout(pushBoard, 300); // stages write files — refresh the board promptly
  return { ...r, startedAt };
});
ipcMain.handle('pipe:stop', () => pipeline.stopCurrent());
ipcMain.handle('pipe:openTerminal', (_e, dir) => pipeline.openInteractiveTerminal(dir, config.getEngine()));

// ---- Engine + in-app director chat -----------------------------------------
ipcMain.handle('cfg:getEngine', () => config.getEngine());
ipcMain.handle('cfg:setEngine', (_e, engine) => config.setEngine(engine).engine);
ipcMain.handle('chat:send', (_e, dir, msg) => chat.send(dir, msg, (line) => send('log', { source: 'chat', line })));
ipcMain.handle('chat:reset', (_e, dir) => chat.reset(dir));
