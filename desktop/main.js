// Social AI Team Desktop — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
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
const publishlog = require('./lib/publishlog');
const applog = require('./lib/applog');

// ---- 프로세스 레벨 오류는 파일 + 렌더러 로그로 남긴다 (조용한 죽음 금지) ----------
process.on('uncaughtException', (e) => {
  applog.write('main-crash', (e && e.stack) || String(e));
  try { send('log', { source: 'main-error', line: '메인 프로세스 예외: ' + (e && e.message || e) }); } catch { /* window gone */ }
});
process.on('unhandledRejection', (e) => {
  applog.write('main-rejection', (e && e.stack) || String(e));
  try { send('log', { source: 'main-error', line: '메인 프로세스 unhandled rejection: ' + (e && e.message || e) }); } catch { /* window gone */ }
});

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* dep missing in dev */ }

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1180,
    minHeight: 680,
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

const send = (channel, payload) => {
  if (channel === 'log' && payload) applog.write(payload.source || 'log', payload.line || '');
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---- 렌더러 오류 수집 + 로그 파일 접근 --------------------------------------------
ipcMain.handle('app:log', (_e, source, line) => { applog.write(source, line); return { ok: true }; });
ipcMain.handle('app:openLogs', () => { shell.openPath(applog.DIR); return { ok: true }; });
ipcMain.handle('app:copyLogs', () => {
  const t = applog.tail();
  clipboard.writeText(t);
  return { ok: true, chars: t.length };
});

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
ipcMain.handle('setup:registerMcp', async () => {
  const r = await setup.registerCodexMcp((line) => send('log', { source: 'setup', line }));
  channelCache = { at: 0, data: null }; // ~/.claude.json changed — re-detect channel connections
  return r;
});
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
ipcMain.handle('ws:board', (_e, dir) => {
  try { return board.buildBoard(dir); }
  catch (e) { return { hasCalendar: false, posts: [], stages: board.STAGES, channels: [], lanes: {}, foundation: {}, compliance: { pass: 0, warn: 0, block: 0 }, error: String(e && e.message || e) }; }
});

// ---- Live board: watch the client folder, push board updates -----------------
let watchers = [];
let watchedPaths = new Set();
let watchDir = null;
let watchTimer = null;
let building = false;
function pushBoard() {
  if (!watchDir || building) return;
  building = true;
  try { send('board:update', { dir: watchDir, board: board.buildBoard(watchDir) }); } catch { /* transient fs state */ }
  building = false;
}
function addWatch(p, handler) {
  if (watchedPaths.has(p)) return;
  try {
    const w = fs.watch(p, handler);
    w.on('error', () => { try { w.close(); } catch { /* gone */ } watchedPaths.delete(p); });
    watchers.push(w);
    watchedPaths.add(p);
  } catch { /* unwatchable */ }
}
function rescanSubdirs(parent) {
  try {
    for (const sub of fs.readdirSync(parent)) {
      const p = path.join(parent, sub);
      try { if (fs.statSync(p).isDirectory()) addWatch(p, onFsEvent); } catch { /* skip */ }
    }
  } catch { /* gone */ }
}
function onFsEvent() {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(pushBoard, 500);
}
ipcMain.handle('ws:watch', (_e, dir) => {
  clearTimeout(watchTimer);
  for (const w of watchers) { try { w.close(); } catch { /* gone */ } }
  watchers = []; watchedPaths = new Set();
  watchDir = dir;
  if (!dir) return { ok: true, watching: false };
  const targets = [path.join(dir, 'outputs'), path.join(dir, 'context')];
  for (const t of targets) {
    try { fs.mkdirSync(t, { recursive: true }); } catch { /* exists */ }
    try {
      const w = fs.watch(t, { recursive: true }, onFsEvent);
      w.on('error', () => { try { w.close(); } catch { /* gone */ } });
      watchers.push(w);
    } catch {
      // Linux: no recursive watch — watch parent + subdirs, rescan for lanes created later
      addWatch(t, () => { rescanSubdirs(t); onFsEvent(); });
      rescanSubdirs(t);
    }
  }
  return { ok: true, watching: watchers.length > 0 };
});

// ---- Gates (approval stamps) ---------------------------------------------------
ipcMain.handle('gates:get', (_e, dir) => {
  try { return gates.computeGates(board.buildBoard(dir), gates.load(dir)); }
  catch (e) { return { nodes: [], current: 0, approvals: [], error: String(e && e.message || e) }; }
});
ipcMain.handle('gates:approve', (_e, dir, entry) => {
  try {
    const b = board.buildBoard(dir);
    gates.approve(dir, { ...entry, calendarHash: b.calendarHash });
    return gates.computeGates(b, gates.load(dir));
  } catch (e) { return { nodes: [], current: 0, approvals: [], error: String(e && e.message || e) }; }
});

// ---- Manual publish (네이버 등) --------------------------------------------------
ipcMain.handle('pub:mark', (_e, dir, uid, on) => {
  const r = publishlog.mark(dir, uid, on);
  setTimeout(pushBoard, 200);
  return r;
});
// 파일에서 해당 포스트 블록을 추출해 클립보드에 복사 (네이버 에디터 붙여넣기용)
ipcMain.handle('pub:copy', (_e, dir, rel, topic) => {
  try {
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(path.resolve(dir) + path.sep)) return { ok: false, error: 'path escape' };
    const text = fs.readFileSync(abs, 'utf8');
    // 토픽이 등장하는 블록(직전 구분선/앵커부터 다음 구분선/앵커까지)을 잘라낸다
    let block = text;
    const idx = topic ? text.indexOf(String(topic).slice(0, 20)) : -1;
    if (idx >= 0) {
      const anchors = /^(---+|#{1,3}\s|POST\s*\d+|[A-Z]{1,2}-\d+\b)/gm;
      let start = 0, end = text.length, m;
      while ((m = anchors.exec(text))) {
        if (m.index <= idx) start = m.index;
        else { end = m.index; break; }
      }
      block = text.slice(start, end).trim();
    }
    clipboard.writeText(block);
    return { ok: true, chars: block.length };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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
  try {
    const r = await pipeline.runStage(dir, stage, opts, (line) => send('log', { source: stage, line }));
    return { ...r, startedAt };
  } catch (e) {
    return { ok: false, out: String(e && e.message || e), tail: String(e && e.message || e), startedAt };
  } finally {
    send('stage', { state: 'end', stage, startedAt });
    setTimeout(pushBoard, 300); // stages write files — refresh the board promptly
  }
});
ipcMain.handle('pipe:stop', () => pipeline.stopCurrent());
ipcMain.handle('pipe:openTerminal', (_e, dir) => pipeline.openInteractiveTerminal(dir, config.getEngine()));

// ---- Engine + in-app director chat -----------------------------------------
ipcMain.handle('cfg:getEngine', () => config.getEngine());
ipcMain.handle('cfg:setEngine', (_e, engine) => config.setEngine(engine).engine);
ipcMain.handle('cfg:getModels', () => config.getModels());
ipcMain.handle('cfg:setModel', (_e, engine, model) => config.setModel(engine, model));
ipcMain.handle('chat:send', (_e, dir, msg) => chat.send(dir, msg, (line) => send('log', { source: 'chat', line })));
ipcMain.handle('chat:reset', (_e, dir) => chat.reset(dir));
