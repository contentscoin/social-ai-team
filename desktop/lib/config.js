// App settings + per-client conversation session ids
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team');
const FILE = path.join(DIR, 'settings.json');

const DEFAULTS = { engine: 'claude', sessions: {} }; // engine: 'claude' | 'codex'

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

// Claude session id per client dir (Codex uses `resume --last`, no id needed)
function getSession(dir) { return load().sessions[dir] || null; }
function setSession(dir, id) {
  const cfg = load();
  if (id) cfg.sessions[dir] = id; else delete cfg.sessions[dir];
  return save(cfg);
}
function clearSession(dir) { return setSession(dir, null); }

module.exports = { load, getEngine, setEngine, getSession, setSession, clearSession };
