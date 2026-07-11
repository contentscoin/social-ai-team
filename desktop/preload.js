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
    stop: () => ipcRenderer.invoke('chat:stop'),
    history: (dir) => ipcRenderer.invoke('chat:history', dir),
    reset: (dir) => ipcRenderer.invoke('chat:reset', dir),
  },
  auto: {
    run: (dir) => ipcRenderer.invoke('auto:run', dir),
    stop: () => ipcRenderer.invoke('auto:stop'),
    status: () => ipcRenderer.invoke('auto:status'),
  },
  hist: {
    list: (dir) => ipcRenderer.invoke('hist:list', dir),
  },
  render: {
    providers: (envHint) => ipcRenderer.invoke('render:providers', envHint),
    generate: (dir, job) => ipcRenderer.invoke('render:generate', dir, job),
  },
  prompt: {
    compile: (dir, job) => ipcRenderer.invoke('prompt:compile', dir, job),
  },
  ref: {
    analyze: (dir, urls) => ipcRenderer.invoke('ref:analyze', dir, urls),
  },
  packs: {
    list: () => ipcRenderer.invoke('packs:list'),
    delete: (file) => ipcRenderer.invoke('packs:delete', file),
    ocSearch: (query) => ipcRenderer.invoke('oc:search', query),
    ocLoad: (pack) => ipcRenderer.invoke('oc:load', pack),
  },
  sec: {
    get: (ns) => ipcRenderer.invoke('sec:get', ns),
    set: (ns, values) => ipcRenderer.invoke('sec:set', ns, values),
    invalidateChannels: () => ipcRenderer.invoke('sec:invalidateChannels'),
  },
  pub2: {
    draft: (dir, lane, topic) => ipcRenderer.invoke('pub2:draft', dir, lane, topic),
    status: () => ipcRenderer.invoke('pub2:status'),
    publishNow: (dir, payload) => ipcRenderer.invoke('pub2:publishNow', dir, payload),
    schedule: (dir, payload) => ipcRenderer.invoke('pub2:schedule', dir, payload),
    queue: (dir) => ipcRenderer.invoke('pub2:queue', dir),
    cancel: (dir, qid) => ipcRenderer.invoke('pub2:cancel', dir, qid),
    test: (channel) => ipcRenderer.invoke('pub2:test', channel),
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
  onChatStream: (cb) => subscribe('chat:stream', cb),
  onAuto: (cb) => subscribe('auto', cb),
});

// 구독 해제자를 반환 — 재구독 패턴에서 리스너가 누적되지 않게
function subscribe(channel, cb) {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}
