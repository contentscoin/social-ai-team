// Social AI Team Desktop — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, protocol } = require('electron');
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
const locks = require('./lib/lock');
const history = require('./lib/history');
const chatlog = require('./lib/chatlog');
const autopilot = require('./lib/autopilot');
const proc = require('./lib/proc');
const secrets = require('./lib/secrets');
const render = require('./lib/render');
const pubdirect = require('./lib/pubdirect');

// 중복 실행 방지 — 두 인스턴스가 settings/gates/clients.json을 서로 밟는다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}
// Windows 토스트 알림에 필요 (electron-builder appId와 동일해야 함)
app.setAppUserModelId('kr.contentscoin.socialaiteam');
// 앱 종료 시 실행 중인 CLI 자식들을 고아로 남기지 않는다
app.on('before-quit', () => {
  try { pipeline.stopCurrent(); } catch { /* gone */ }
  try { chat.stopCurrent(); } catch { /* gone */ }
  try { proc.killAll(); } catch { /* gone */ }
});

// ---- 프로세스 레벨 오류는 파일 + 렌더러 로그로 남긴다 (조용한 죽음 금지) ----------
process.on('uncaughtException', (e) => {
  applog.write('main-crash', (e && e.stack) || String(e));
  if (win && !win.isDestroyed()) {
    try { send('log', { source: 'main-error', line: '메인 프로세스 예외: ' + (e && e.message || e) }); } catch { /* window gone */ }
  } else {
    try { dialog.showErrorBox('Social AI Team — 내부 오류', String(e && e.stack || e).slice(0, 1000)); } catch { /* headless */ }
  }
});
process.on('unhandledRejection', (e) => {
  applog.write('main-rejection', (e && e.stack) || String(e));
  try { send('log', { source: 'main-error', line: '메인 프로세스 unhandled rejection: ' + (e && e.message || e) }); } catch { /* window gone */ }
});

// 실패를 {ok:false, error}로 정규화 — IPC reject가 렌더러 상태를 어긋내지 않게
const safe = (fn) => async (...a) => {
  try { return await fn(...a); }
  catch (e) {
    applog.write('ipc-error', (e && e.stack) || String(e));
    return { ok: false, error: String(e && e.message || e) };
  }
};

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
  // 워크스페이스 파일에서 온 링크가 앱 창을 원격 페이지로 끌고 가지 못하게 —
  // window.api(IPC 전체)가 붙은 창에서의 원격 내비게이션은 곧 원격 코드에 CLI 실행 권한
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => { win = null; });
  // 렌더러가 죽거나 멈추면 백지 창으로 방치하지 않는다
  win.webContents.on('render-process-gone', (_e, details) => {
    applog.write('renderer-gone', JSON.stringify(details));
    if (win && !win.isDestroyed()) win.webContents.reload();
  });
  win.on('unresponsive', () => applog.write('renderer-unresponsive', 'window unresponsive'));
}

app.whenReady().then(() => {
  applog.write('boot', `v${app.getVersion()} ${process.platform}/${process.arch} electron ${process.versions.electron}`);
  // sat:// — 워크스페이스 이미지/영상을 렌더러 <img>/<video>로 직접 서빙 (IPC dataURL보다 훨씬 가볍다).
  // 등록된 클라이언트 폴더 내부의 미디어 파일만 허용.
  protocol.registerFileProtocol('sat', (req, cb) => {
    try {
      const u = new URL(req.url);
      const dir = decodeURIComponent(u.searchParams.get('d') || '');
      const rel = decodeURIComponent(u.searchParams.get('p') || '');
      const known = workspace.listClients().some((c) => c.dir === dir);
      const abs = path.resolve(dir, rel);
      if (!known || !abs.startsWith(path.resolve(dir) + path.sep) || !/\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(abs)) { cb({ error: -10 }); return; }
      cb({ path: abs });
    } catch { cb({ error: -2 }); }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  initAutoUpdate();
  pubdirect.startScheduler({ send, notify, pushBoard: () => pushBoard() });
}).catch((e) => {
  applog.write('boot-fail', (e && e.stack) || String(e));
  try { dialog.showErrorBox('Social AI Team 시작 실패', String(e && e.message || e)); } catch { /* headless */ }
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const send = (channel, payload) => {
  if (channel === 'log' && payload) applog.write(payload.source || 'log', payload.line || '');
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// OS 알림 — 창이 포커스를 잃은 동안 끝난 장시간 작업을 놓치지 않게
function notify(title, body) {
  try {
    if (win && !win.isDestroyed() && win.isFocused()) return; // 보고 있으면 토스트로 충분
    if (Notification.isSupported()) new Notification({ title, body: String(body || '').slice(0, 140) }).show();
  } catch { /* 알림 실패는 치명적이지 않다 */ }
}

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
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000); // 장시간 켜둔 앱도 갱신
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
ipcMain.handle('setup:check', safe(() => setup.checkEnvironment()));
ipcMain.handle('setup:installSkills', safe(() => setup.installSkills()));
ipcMain.handle('setup:installCodex', safe(() => setup.installCodexCli((line) => send('log', { source: 'setup', line }))));
ipcMain.handle('setup:codexLogin', safe(() => setup.codexOAuthLogin((line) => send('log', { source: 'setup', line }))));
ipcMain.handle('setup:registerMcp', safe(async () => {
  const r = await setup.registerCodexMcp((line) => send('log', { source: 'setup', line }));
  channelCache = { at: 0, data: null }; // ~/.claude.json changed — re-detect channel connections
  return r;
}));
ipcMain.handle('setup:installIma2', safe(() => setup.installIma2((line) => send('log', { source: 'setup', line }))));
ipcMain.handle('setup:ima2Setup', safe(() => pipeline.openInteractiveTerminal(app.getPath('home'), 'ima2 setup')));

// ---- Workspace (clients) ---------------------------------------------------
ipcMain.handle('ws:list', safe(() => workspace.listClients()));
ipcMain.handle('ws:create', safe((_e, name) => workspace.createClient(name)));
ipcMain.handle('ws:pickFolder', safe(async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : workspace.addExisting(r.filePaths[0]);
}));
ipcMain.handle('ws:status', safe((_e, dir) => (dir ? workspace.readStatus(dir) : { statusItems: [], statusRaw: '' })));
ipcMain.handle('ws:outputs', safe((_e, dir) => workspace.listOutputs(dir)));
ipcMain.handle('ws:readFile', safe((_e, dir, rel) => workspace.readOutputFile(dir, rel)));
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
    w.on('error', (e) => {
      applog.write('watch-error', p + ': ' + (e && e.message || e));
      try { w.close(); } catch { /* gone */ }
      watchedPaths.delete(p);
      setTimeout(() => { if (watchDir && p.startsWith(watchDir)) addWatch(p, handler); }, 3000); // 재장전 시도
    });
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
  // 재귀 워처가 에러로 죽으면(EPERM, 폴더 재생성 등) 3초 후 재장전 — 보드가 조용히 멎지 않게
  const armRecursive = (t) => {
    try { fs.mkdirSync(t, { recursive: true }); } catch { /* exists */ }
    const w = fs.watch(t, { recursive: true }, onFsEvent);
    w.on('error', (e) => {
      applog.write('watch-error', t + ': ' + (e && e.message || e));
      try { w.close(); } catch { /* gone */ }
      const i = watchers.indexOf(w);
      if (i >= 0) watchers.splice(i, 1);
      setTimeout(() => {
        if (watchDir !== dir) return; // 이미 다른 워크스페이스로 이동
        try { watchers.push(armRecursive(t)); pushBoard(); } catch { /* 다음 에러 때 재시도 */ }
      }, 3000);
    });
    return w;
  };
  for (const t of targets) {
    try { fs.mkdirSync(t, { recursive: true }); } catch { /* exists */ }
    try {
      watchers.push(armRecursive(t));
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
ipcMain.handle('pub:mark', safe((_e, dir, uid, on) => {
  const r = publishlog.mark(dir, uid, on);
  setTimeout(pushBoard, 200);
  return { ok: true, ...r };
}));
// 레인의 모든 텍스트 파일을 스캔해 해당 포스트의 블록을 찾는다 (복사·직접 발행 초안·프롬프트 컴파일 공용).
const { findPostBlock } = require('./lib/postblock');
ipcMain.handle('pub:copy', safe((_e, dir, lane, topic) => {
  const r = findPostBlock(dir, lane, topic);
  if (!r.ok) return r;
  clipboard.writeText(r.text);
  return { ok: true, chars: r.text.length, file: r.file };
}));

// ---- 직접 발행 (Blotato 대체) ------------------------------------------------------
// 발행 초안 — 블록에서 계약 필드(VISUAL DIRECTION 등)를 걷어내 실제 게시 본문만 남긴다.
// 운영자가 발행 전에 textarea에서 최종 확인·수정한다 (사람 게이트).
const CONTRACT_LINE = /^\s*(?:\*\*)?(VISUAL DIRECTION|BLOTATO FLAG|INFOGRAPHIC|PASS|WARN|BLOCK|Char count|글자수|문자수)\b.*$/gim;
ipcMain.handle('pub2:draft', safe((_e, dir, lane, topic) => {
  const r = findPostBlock(dir, lane, topic);
  if (!r.ok) return r;
  const cleaned = r.text.replace(CONTRACT_LINE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { ok: true, text: cleaned, file: r.file };
}));
ipcMain.handle('pub2:status', safe(() => pubdirect.status()));
ipcMain.handle('pub2:publishNow', safe(async (_e, dir, payload) => {
  const r = await pubdirect.publishNow(dir, payload);
  if (r.ok) { send('log', { source: 'publish', line: `✔ ${payload.channel} 발행 — ${r.url || r.id || 'ok'}`, dir }); setTimeout(pushBoard, 300); }
  else send('log', { source: 'publish', line: `✖ ${payload.channel} 발행 실패 — ${r.error}`, dir });
  return r;
}));
ipcMain.handle('pub2:schedule', safe((_e, dir, payload) => pubdirect.schedule(dir, payload)));
ipcMain.handle('pub2:queue', safe((_e, dir) => pubdirect.listQueue(dir)));
ipcMain.handle('pub2:cancel', safe((_e, dir, qid) => pubdirect.cancel(dir, qid)));
ipcMain.handle('pub2:test', safe((_e, channel) => pubdirect.test(channel)));

// ---- Channel connection check (직접 발행 토큰 + 레거시 Blotato MCP) -----------------
let channelCache = { at: 0, data: null };
ipcMain.handle('channels:check', () => {
  if (channelCache.data && Date.now() - channelCache.at < 10 * 60 * 1000) return channelCache.data;
  let blotato = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    blotato = Object.keys(cfg.mcpServers || {}).some((k) => /blotato/i.test(k));
  } catch { /* no config */ }
  channelCache = { at: Date.now(), data: { blotato, direct: pubdirect.status() } };
  return channelCache.data;
});
// 토큰 저장 시 채널 캐시 무효화 — 배지가 바로 갱신되게
ipcMain.handle('sec:invalidateChannels', () => { channelCache = { at: 0, data: null }; return { ok: true }; });

// ---- Pipeline stages -------------------------------------------------------
const autovisual = require('./lib/autovisual');
// 워크스페이스별 비주얼 렌더 중단 플래그 — 프로세스 전역 하나면 다른 dir의 렌더를 함께 죽인다.
const renderStops = new Map(); // dir → true(중단 요청)
const stopRender = (dir) => { if (dir) renderStops.set(dir, true); };
const armRender = (dir) => { renderStops.set(dir, false); };
const isRenderStopped = (dir) => renderStops.get(dir) === true;
// ima2 설치 여부 힌트 — 렌더 프로바이더 기본값 선택에 필요 (동기 바이너리 확인).
// checkEnvironment()는 async라 여기선 쓸 수 없다 — proc.resolveCmd로 동기 감지.
function envHint() {
  let ima2 = false;
  try { ima2 = !!proc.resolveCmd('ima2'); } catch { /* PATH 밖 */ }
  return { ima2 };
}

// 공용 실행기 — 수동 실행(pipe:runStage)과 오토파일럿이 같은 계측(이벤트/기록/알림)을 쓴다.
// 잠금은 호출자 책임: 수동은 'stage', 오토파일럿은 런 전체에 'autopilot'을 잡고 들어온다.
async function execStage(dir, stage, opts) {
  const startedAt = Date.now();
  send('stage', { state: 'start', stage, startedAt, dir });
  try {
    // visuals-generate 는 앱 렌더 엔진으로 라우팅 — 파이프라인 에이전트는 앱 설정의 키를
    // 못 보기 때문. 앱 엔진은 설정 키를 쓰고 포스트당 여러 장(캐러셀)을 만든다.
    if (stage === 'visuals-generate') {
      armRender(dir);
      const r = await autovisual.renderAll(dir, {
        ...envHint(), count: (opts && opts.count) || 0, stopped: () => isRenderStopped(dir),
      }, (line) => send('log', { source: stage, line, dir }));
      history.append({
        dir, kind: 'stage', stage, engine: r.provider || 'render', model: '',
        ok: !!r.ok, ms: Date.now() - startedAt, startedAt, note: r.resultText || r.note,
      });
      if (Date.now() - startedAt > 30_000) notify(`비주얼 생성 ${r.ok ? '완료' : '실패'}`, r.resultText || r.note || '');
      return { ...r, tail: r.resultText || r.note, startedAt };
    }
    const r = await pipeline.runStage(dir, stage, opts, (line) => send('log', { source: stage, line, dir }));
    const label = (pipeline.STAGES[stage] || {}).label || stage;
    history.append({
      dir, kind: 'stage', stage, engine: 'claude', model: config.getModels().claude,
      ok: !!r.ok, ms: Date.now() - startedAt, costUsd: typeof r.costUsd === 'number' ? r.costUsd : undefined, startedAt,
    });
    // 30초 넘게 걸린 작업만 OS 알림 — 즉시 끝난 것까지 울리면 소음
    if (Date.now() - startedAt > 30_000) notify(`${label} ${r.ok ? '완료' : '실패'}`, r.ok ? '보드에서 결과를 확인하세요.' : String(r.tail || '').slice(0, 140));
    return { ...r, startedAt };
  } catch (e) {
    return { ok: false, code: -1, out: String(e && e.message || e), tail: String(e && e.message || e), startedAt };
  } finally {
    send('stage', { state: 'end', stage, startedAt, dir });
    setTimeout(pushBoard, 300); // stages write files — refresh the board promptly
  }
}
ipcMain.handle('pipe:runStage', async (_e, dir, stage, opts) => {
  const lock = locks.acquire(dir, 'stage');
  if (!lock.ok) {
    const msg = locks.busyMessage(dir);
    return { ok: false, code: -1, out: msg, tail: msg, startedAt: Date.now() };
  }
  try { return await execStage(dir, stage, opts); }
  finally { locks.release(dir, 'stage'); }
});
ipcMain.handle('pipe:stop', (_e, dir) => { stopRender(dir); return pipeline.stopCurrent(); });
// 일괄 비주얼 렌더 — "일괄 비주얼 생성" 버튼 (오토파일럿 없이 수동으로 전 포스트 이미지 생성)
ipcMain.handle('render:batch', async (_e, dir, opts) => {
  const lock = locks.acquire(dir, 'stage');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  armRender(dir);
  const startedAt = Date.now();
  send('stage', { state: 'start', stage: 'visuals-generate', startedAt, dir });
  try {
    const r = await autovisual.renderAll(dir, { ...envHint(), ...(opts || {}), stopped: () => isRenderStopped(dir) }, (line) => send('log', { source: 'visuals-generate', line, dir }));
    history.append({ dir, kind: 'stage', stage: 'visuals-generate', engine: r.provider || 'render', model: '', ok: !!r.ok, ms: Date.now() - startedAt, startedAt, note: r.resultText || r.note });
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    locks.release(dir, 'stage');
    send('stage', { state: 'end', stage: 'visuals-generate', startedAt, dir });
    setTimeout(pushBoard, 300);
  }
});
ipcMain.handle('pipe:openTerminal', safe((_e, dir) =>
  pipeline.openInteractiveTerminal(dir, config.getEngine(), (msg) => send('log', { source: 'terminal-error', line: msg, dir }))));

// ---- Autopilot — 승인 게이트 앞까지 자동 진행 -----------------------------------
ipcMain.handle('auto:run', async (_e, dir) => {
  const lock = locks.acquire(dir, 'autopilot');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  const startedAt = Date.now();
  try {
    const r = await autopilot.run(dir, {
      buildBoard: (d) => board.buildBoard(d),
      runStage: (d, s) => execStage(d, s, {}),
      onEvent: (ev) => {
        send('auto', ev);
        if (ev.state === 'paused') notify('오토파일럿 대기', ev.message || '승인 도장이 필요합니다.');
        else if (ev.state === 'done') notify('오토파일럿 완료', ev.message || '');
        else if (ev.state === 'failed') notify('오토파일럿 실패', ev.message || '');
      },
    });
    history.append({
      dir, kind: 'autopilot', engine: 'claude', model: config.getModels().claude,
      ok: r.state !== 'failed', ms: Date.now() - startedAt, startedAt,
      note: `${r.state}${r.ran && r.ran.length ? ' — ' + r.ran.join(',') : ''}`,
    });
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { locks.release(dir, 'autopilot'); }
});
ipcMain.handle('auto:stop', () => autopilot.stop(() => { stopRender(autopilot.status().dir); pipeline.stopCurrent(); }));
ipcMain.handle('auto:status', () => autopilot.status());

// ---- 실행 기록 ----------------------------------------------------------------
ipcMain.handle('hist:list', safe((_e, dir) => history.forDir(dir)));

// ---- 인앱 렌더 엔진 (이미지/영상 실물 생성) ----------------------------------------
const renderInFlight = new Set();
ipcMain.handle('render:providers', safe((_e, envHint) => render.availability(envHint || {})));
ipcMain.handle('render:generate', async (_e, dir, job) => {
  const key = `${dir}::${job && job.base}`;
  if (renderInFlight.has(key)) return { ok: false, error: '이 카드의 렌더가 이미 진행 중입니다' };
  renderInFlight.add(key);
  const startedAt = Date.now();
  try {
    // refAbs 검증 — 워크스페이스 밖 파일 참조 차단
    if (job && job.refRel) {
      const abs = path.resolve(dir, job.refRel);
      if (!abs.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(abs)) return { ok: false, error: '참조 이미지를 찾을 수 없습니다' };
      job.refAbs = abs;
    }
    const r = await render.generate(dir, job, (line) => send('log', { source: 'render', line, dir }));
    history.append({
      dir, kind: 'stage', stage: `render-${job.kind}`, engine: job.provider, model: '',
      ok: !!r.ok, ms: Date.now() - startedAt, startedAt, note: (job.prompt || '').slice(0, 60),
    });
    if (r.ok) {
      send('log', { source: 'render', line: `✔ ${r.rel}`, dir });
      if (Date.now() - startedAt > 30_000) notify('렌더 완료', r.rel);
      setTimeout(pushBoard, 300); // 새 파일 → 카드 썸네일 즉시 반영
    }
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { renderInFlight.delete(key); }
});

// ---- 시크릿 (채널 토큰·렌더 키) ---------------------------------------------------
ipcMain.handle('sec:get', safe((_e, ns) => secrets.masked(ns)));
ipcMain.handle('sec:set', safe((_e, ns, values) => secrets.set(ns, values)));

// ---- 프롬프트 컴파일러 + 팩 -------------------------------------------------------
const promptlab = require('./lib/promptlab');
const opencrab = require('./lib/opencrab');
ipcMain.handle('prompt:compile', safe((_e, dir, job) =>
  promptlab.compile(dir, job, (line) => send('log', { source: 'prompt', line, dir }))));
ipcMain.handle('packs:list', safe(() => promptlab.listPacks().map(({ name, file, source, size }) => ({ name, file, source, size }))));
ipcMain.handle('packs:delete', safe((_e, file) => promptlab.deletePack(file)));
ipcMain.handle('oc:search', safe((_e, query) => opencrab.search(query)));
ipcMain.handle('oc:load', safe((_e, pack) => opencrab.load(pack)));

// ---- OpenCrab 프로젝트·워크플로우 단위 가져오기 → 클라이언트 지식 베이스 ----------------
const knowledge = require('./lib/knowledge');
ipcMain.handle('oc:projects', safe(() => opencrab.listProjects()));
ipcMain.handle('oc:workflows', safe(() => opencrab.listWorkflows()));
ipcMain.handle('oc:importProject', safe(async (_e, dir, project) => {
  send('log', { source: 'opencrab', line: `프로젝트 가져오는 중: ${project.name}`, dir });
  const r = await opencrab.fetchProject(project);
  if (!r.ok) return r;
  const s = knowledge.save(dir, 'project', project.name, r.body);
  send('log', { source: 'opencrab', line: `✔ ${s.rel} (문서 ${r.docs || 0}개, 도구 ${r.via})`, dir });
  setTimeout(pushBoard, 300);
  return { ok: true, file: s.file, rel: s.rel, via: r.via, docs: r.docs };
}));
ipcMain.handle('oc:importWorkflow', safe(async (_e, dir, workflow) => {
  send('log', { source: 'opencrab', line: `워크플로우 가져오는 중: ${workflow.name}`, dir });
  const r = await opencrab.fetchWorkflow(workflow);
  if (!r.ok) return r;
  const s = knowledge.save(dir, 'workflow', workflow.name, r.body);
  send('log', { source: 'opencrab', line: `✔ ${s.rel} (도구 ${r.via})`, dir });
  setTimeout(pushBoard, 300);
  return { ok: true, file: s.file, rel: s.rel, via: r.via };
}));
ipcMain.handle('know:list', safe((_e, dir) => knowledge.list(dir)));
ipcMain.handle('know:delete', safe((_e, dir, file) => knowledge.remove(dir, file)));

// ---- 전략 추출 + OpenCrab 인제스트 -------------------------------------------------
const strategy = require('./lib/strategy');
// 1) 채널별·주제별 전략 문서 생성 (claude, context/strategy/)
ipcMain.handle('strat:extract', async (_e, dir) => {
  const lock = locks.acquire(dir, 'stage');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  const startedAt = Date.now();
  try {
    const r = await strategy.extract(dir, (line) => send('log', { source: 'strategy', line, dir }));
    history.append({ dir, kind: 'stage', stage: 'strategy', engine: 'claude', model: config.getModels().claude, ok: !!r.ok, ms: Date.now() - startedAt, startedAt, note: r.ok ? `${r.count}개 전략` : r.error });
    if (r.ok && Date.now() - startedAt > 30_000) notify('전략 추출 완료', `채널 ${r.channels} · 주제 ${r.topics}`);
    setTimeout(pushBoard, 300);
    return r;
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  finally { locks.release(dir, 'stage'); }
});
ipcMain.handle('strat:list', safe((_e, dir) => strategy.listStrategies(dir).map(({ file, title, kind, chars }) => ({ file, title, kind, chars }))));
// 2) 전략을 OpenCrab 프로젝트로 인제스트 (발견 기반, 폴백 안내 포함)
ipcMain.handle('strat:ingest', safe(async (_e, dir, projectName) => {
  const items = strategy.listStrategies(dir).map((s) => ({
    text: s.text, title: s.title, source: s.file, kind: s.kind,
    channel: s.kind === 'channel' ? s.title : undefined, topic: s.kind === 'topic' ? s.title : undefined,
  }));
  if (!items.length) return { ok: false, error: '인제스트할 전략 파일이 없습니다 — 먼저 전략 추출을 실행하세요' };
  send('log', { source: 'opencrab', line: `프로젝트 생성 시도: ${projectName} (전략 ${items.length}개)`, dir });
  const proj = await opencrab.createProject(projectName, { category: 'social-strategy' });
  if (proj.unsupported) send('log', { source: 'opencrab', line: `프로젝트 생성 도구 없음 — 발견된 도구: ${(proj.tools || []).join(', ') || '없음'}`, dir });
  const projectId = proj.ok ? proj.id : null;
  const ing = await opencrab.ingest(items, projectId);
  send('log', { source: 'opencrab', line: ing.ok ? `✔ 인제스트 ${ing.ingested}/${ing.total} (도구 ${ing.tool})` : `✖ ${ing.error || '인제스트 실패'}`, dir });
  return {
    ok: ing.ok, projectId, projectTool: proj.tool, ingestTool: ing.tool,
    ingested: ing.ingested || 0, total: items.length,
    unsupported: proj.unsupported || ing.unsupported || false,
    note: ing.error || (proj.unsupported ? '엔드포인트에 쓰기 도구가 없어 전략은 로컬(context/strategy/)에만 남았습니다.' : undefined),
    fails: ing.fails,
  };
}));

// ---- 레퍼런스 사이트 분석 (온보딩 준비 레인) ---------------------------------------
const reference = require('./lib/reference');
ipcMain.handle('ref:analyze', async (_e, dir, urls) => {
  // claude가 같은 폴더에 파일을 쓴다 — 채팅/스테이지와 상호 배제
  const lock = locks.acquire(dir, 'reference');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  const startedAt = Date.now();
  try {
    const r = await reference.analyze(dir, urls, (line) => send('log', { source: 'reference', line, dir }));
    history.append({
      dir, kind: 'stage', stage: 'reference', engine: 'claude', model: config.getModels().claude,
      ok: !!r.ok && !r.partial, ms: Date.now() - startedAt, startedAt, note: (urls || []).join(', ').slice(0, 80),
    });
    if (r.ok && Date.now() - startedAt > 30_000) notify('레퍼런스 분석 완료', r.brandDrafted ? 'brand-style.md 초안이 생성됐습니다' : '분석 리포트가 준비됐습니다');
    setTimeout(pushBoard, 300);
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { locks.release(dir, 'reference'); }
});

// ---- 질문지 온보딩 (1차 폼 → 2차 일괄 후속질문 → 일괄 합성) -------------------------
const onboard = require('./lib/onboard');
ipcMain.handle('ob:questions', safe(() => onboard.QUESTIONNAIRE));
ipcMain.handle('ob:followups', async (_e, dir, answers) => {
  const lock = locks.acquire(dir, 'onboard');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  try { return await onboard.followups(dir, answers, (line) => send('log', { source: 'onboard', line, dir })); }
  catch (e) { return { ok: true, questions: [], note: String(e && e.message || e) }; }
  finally { locks.release(dir, 'onboard'); }
});
ipcMain.handle('ob:finalize', async (_e, dir, answers, followupAnswers) => {
  const lock = locks.acquire(dir, 'onboard');
  if (!lock.ok) return { ok: false, error: locks.busyMessage(dir) };
  const startedAt = Date.now();
  try {
    const r = await onboard.finalize(dir, answers, followupAnswers, (line) => send('log', { source: 'onboard', line, dir }));
    history.append({
      dir, kind: 'stage', stage: 'onboard', engine: 'claude', model: config.getModels().claude,
      ok: !!r.ok, ms: Date.now() - startedAt, startedAt, note: '질문지 온보딩',
    });
    if (r.ok && Date.now() - startedAt > 30_000) notify('온보딩 완료', 'brand-style.md가 준비됐습니다');
    setTimeout(pushBoard, 300);
    return r;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { locks.release(dir, 'onboard'); }
});

// ---- Engine + in-app director chat -----------------------------------------
ipcMain.handle('cfg:getEngine', safe(() => config.getEngine()));
ipcMain.handle('cfg:setEngine', safe((_e, engine) => config.setEngine(engine).engine));
ipcMain.handle('cfg:getModels', safe(() => config.getModels()));
ipcMain.handle('cfg:setModel', safe((_e, engine, model) => config.setModel(engine, model)));
ipcMain.handle('chat:send', async (_e, dir, msg) => {
  const lock = locks.acquire(dir, 'chat');
  if (!lock.ok) return { ok: false, text: locks.busyMessage(dir), engine: config.getEngine() };
  const startedAt = Date.now();
  try {
    chatlog.append(dir, { role: 'user', text: msg });
    const r = await chat.send(
      dir, msg,
      (line) => send('log', { source: 'chat', line, dir }),
      (ev) => send('chat:stream', { dir, ev }),
    );
    chatlog.append(dir, { role: 'dir', text: r.text, engine: r.engine, ok: r.ok });
    history.append({
      dir, kind: 'chat', engine: r.engine, model: config.getModels()[r.engine] || '',
      ok: !!r.ok, ms: Date.now() - startedAt, costUsd: typeof r.costUsd === 'number' ? r.costUsd : undefined,
      startedAt, note: String(msg).slice(0, 80),
    });
    return r;
  } catch (e) {
    return { ok: false, text: String(e && e.message || e), engine: config.getEngine() };
  } finally { locks.release(dir, 'chat'); }
});
ipcMain.handle('chat:stop', () => chat.stopCurrent());
ipcMain.handle('chat:history', safe((_e, dir) => chatlog.list(dir)));
ipcMain.handle('chat:reset', safe((_e, dir) => { chatlog.clear(dir); return chat.reset(dir); }));
