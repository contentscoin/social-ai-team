const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setup: {
    check: () => ipcRenderer.invoke('setup:check'),
    installSkills: () => ipcRenderer.invoke('setup:installSkills'),
    installCodex: () => ipcRenderer.invoke('setup:installCodex'),
    codexLogin: () => ipcRenderer.invoke('setup:codexLogin'),
    registerMcp: () => ipcRenderer.invoke('setup:registerMcp'),
  },
  ws: {
    list: () => ipcRenderer.invoke('ws:list'),
    create: (name) => ipcRenderer.invoke('ws:create', name),
    pickFolder: () => ipcRenderer.invoke('ws:pickFolder'),
    status: (dir) => ipcRenderer.invoke('ws:status', dir),
    outputs: (dir) => ipcRenderer.invoke('ws:outputs', dir),
    readFile: (dir, rel) => ipcRenderer.invoke('ws:readFile', dir, rel),
    openFolder: (dir) => ipcRenderer.invoke('ws:openFolder', dir),
  },
  pipe: {
    runStage: (dir, stage, opts) => ipcRenderer.invoke('pipe:runStage', dir, stage, opts),
    stop: () => ipcRenderer.invoke('pipe:stop'),
    openTerminal: (dir) => ipcRenderer.invoke('pipe:openTerminal', dir),
  },
  onLog: (cb) => ipcRenderer.on('log', (_e, payload) => cb(payload)),
});
