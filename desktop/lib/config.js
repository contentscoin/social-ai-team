// App settings + per-client conversation session ids
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team');
const FILE = path.join(DIR, 'settings.json');

const DEFAULTS = { engine: 'claude', sessions: {}, models: { claude: '', codex: '' } }; // engine: 'claude' | 'codex'; model '' = CLI 기본값

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; }
  catch {
    // 깨진 설정은 조용히 덮지 말고 백업 후 기본값으로 (세션/모델 복구 여지)
    if (fs.existsSync(FILE)) { try { fs.renameSync(FILE, FILE + '.corrupt-' + Date.now()); } catch { /* best effort */ } }
    return { ...DEFAULTS };
  }
}
function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  // 원자적 교체 — 쓰다 만 파일이 모든 세션/설정을 날리지 않게
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, FILE);
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

// 클라이언트 폴더별 × 엔진별 세션 — 과거 버전은 단일 문자열이었으므로 마이그레이션:
// 'codex-started' 류는 codex 슬롯으로, 나머지는 claude 세션 id로 취급한다.
function normSessions(v) {
  if (!v) return {};
  if (typeof v === 'string') return v.startsWith('codex') ? { codex: v } : { claude: v };
  return v;
}
function getSession(dir, engine = 'claude') {
  return normSessions(load().sessions[dir])[engine] || null;
}
function setSession(dir, id, engine = 'claude') {
  const cfg = load();
  const s = normSessions(cfg.sessions[dir]);
  if (id) s[engine] = id; else delete s[engine];
  if (Object.keys(s).length) cfg.sessions[dir] = s; else delete cfg.sessions[dir];
  return save(cfg);
}
// engine 미지정 시 두 엔진 모두 삭제 (대화 초기화 버튼)
function clearSession(dir, engine) {
  if (engine) return setSession(dir, null, engine);
  const cfg = load();
  delete cfg.sessions[dir];
  return save(cfg);
}

module.exports = { load, getEngine, setEngine, getModels, setModel, getSession, setSession, clearSession };
