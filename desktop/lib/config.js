// App settings + per-client conversation session ids
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team');
const FILE = path.join(DIR, 'settings.json');

const DEFAULTS = { engine: 'claude', sessions: {}, models: { claude: '', codex: '' } }; // engine: 'claude' | 'codex'; model '' = CLI 기본값

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

function getEngine() { return load().engine; }
function setEngine(engine) {
  if (engine !== 'claude' && engine !== 'codex') return load();
  const cfg = load(); cfg.engine = engine; return save(cfg);
}

function getModels() { const c = load(); return { claude: '', codex: '', ...(c.models || {}) }; }
function setModel(engine, model) {
  if (engine !== 'claude' && engine !== 'codex') return getModels();
  const cfg = load();
  cfg.models = { claude: '', codex: '', ...(cfg.models || {}) };
  cfg.models[engine] = String(model || '').trim();
  save(cfg);
  return cfg.models;
}

// Claude session id per client dir (Codex uses `resume --last`, no id needed)
function getSession(dir) { return load().sessions[dir] || null; }
function setSession(dir, id) {
  const cfg = load();
  if (id) cfg.sessions[dir] = id; else delete cfg.sessions[dir];
  return save(cfg);
}
function clearSession(dir) { return setSession(dir, null); }

module.exports = { load, getEngine, setEngine, getModels, setModel, getSession, setSession, clearSession };
