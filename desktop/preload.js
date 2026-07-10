const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
    installSkills: () => ipcRenderer.invoke('setup:installSkills'),
    installCodex: () => ipcRenderer.invoke('setup:installCodex'),
    codexLogin: () => ipcRenderer.invoke('setup:codexLogin'),
    registerMcp: () => ipcRenderer.invoke('setup:registerMcp'),
    installIma2: () => ipcRenderer.invoke('setup:installIma2'),
    ima2Setup: () => ipcRenderer.invoke('setup:ima2Setup'),
  },
  ws: {
    list: () => ipcRenderer.invoke('ws:list'),
    create: (name) => ipcRenderer.invoke('ws:create', name),
    pickFolder: () => ipcRenderer.invoke('ws:pickFolder'),
    status: (dir) => ipcRenderer.invoke('ws:status', dir),
    outputs: (dir) => ipcRenderer.invoke('ws:outputs', dir),
    readFile: (dir, rel) => ipcRenderer.invoke('ws:readFile', dir, rel),
    openFolder: (dir) => ipcRenderer.invoke('ws:openFolder', dir),
    board: (dir) => ipcRenderer.invoke('ws:board', dir),
    watch: (dir) => ipcRenderer.invoke('ws:watch', dir),
  },
  gates: {
    get: (dir) => ipcRenderer.invoke('gates:get', dir),
    approve: (dir, entry) => ipcRenderer.invoke('gates:approve', dir, entry),
  },
  channels: {
    check: () => ipcRenderer.invoke('channels:check'),
  },
  pub: {
    mark: (dir, uid, on) => ipcRenderer.invoke('pub:mark', dir, uid, on),
    copy: (dir, rel, topic) => ipcRenderer.invoke('pub:copy', dir, rel, topic),
  },
  app: {
    log: (source, line) => ipcRenderer.invoke('app:log', source, line),
    openLogs: () => ipcRenderer.invoke('app:openLogs'),
    copyLogs: () => ipcRenderer.invoke('app:copyLogs'),
  },
  pipe: {
    runStage: (dir, stage, opts) => ipcRenderer.invoke('pipe:runStage', dir, stage, opts),
    stop: () => ipcRenderer.invoke('pipe:stop'),
    openTerminal: (dir) => ipcRenderer.invoke('pipe:openTerminal', dir),
  },
  engine: {
    get: () => ipcRenderer.invoke('cfg:getEngine'),
    set: (engine) => ipcRenderer.invoke('cfg:setEngine', engine),
    getModels: () => ipcRenderer.invoke('cfg:getModels'),
    setModel: (engine, model) => ipcRenderer.invoke('cfg:setModel', engine, model),
  },
  chat: {
    send: (dir, msg) => ipcRenderer.invoke('chat:send', dir, msg),
    reset: (dir) => ipcRenderer.invoke('chat:reset', dir),
  },
  update: {
    version: () => ipcRenderer.invoke('update:version'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
  },
  onLog: (cb) => subscribe('log', cb),
  onUpdate: (cb) => subscribe('update', cb),
  onBoard: (cb) => subscribe('board:update', cb),
  onStage: (cb) => subscribe('stage', cb),
});

// 구독 해제자를 반환 — 재구독 패턴에서 리스너가 누적되지 않게
function subscribe(channel, cb) {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}
