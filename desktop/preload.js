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
  onLog: (cb) => ipcRenderer.on('log', (_e, payload) => cb(payload)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, payload) => cb(payload)),
  onBoard: (cb) => ipcRenderer.on('board:update', (_e, payload) => cb(payload)),
  onStage: (cb) => ipcRenderer.on('stage', (_e, payload) => cb(payload)),
});
