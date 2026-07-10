// API 키·토큰 저장소 — ~/.social-ai-team/secrets.json (0600)
// 발행 채널 토큰과 렌더 프로바이더 키를 로컬에만 보관한다. 값은 렌더러로 마스킹해서만 보낸다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team');
const FILE = path.join(DIR, 'secrets.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
  catch {
    if (fs.existsSync(FILE)) { try { fs.renameSync(FILE, FILE + '.corrupt-' + Date.now()); } catch { /* best effort */ } }
    return {};
  }
}
function save(all) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  try { fs.chmodSync(FILE, 0o600); } catch { /* windows: ACL 상속 */ }
}

// ns: 'x' | 'facebook' | 'threads' | 'linkedin' | 'openai' | 'runway' | 'higgsfield' | 'comfyui' | 'custom-video'
function get(ns) { return load()[ns] || {}; }
function set(ns, values) {
  const all = load();
  all[ns] = { ...(all[ns] || {}) };
  for (const [k, v] of Object.entries(values || {})) {
    const s = String(v == null ? '' : v).trim();
    if (s) all[ns][k] = s; else delete all[ns][k];
  }
  if (!Object.keys(all[ns]).length) delete all[ns];
  save(all);
  return masked(ns);
}
// 렌더러 표시용 — 앞 4자만 남기고 가린다
function masked(ns) {
  const v = get(ns);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    // URL·ID류는 그대로 보여줘도 된다 (비밀 아님)
    out[k] = /url|id$|^user|^page|^person|workflow/i.test(k)
      ? val
      : (val.length > 8 ? val.slice(0, 4) + '…' + val.slice(-2) : '••••');
  }
  return out;
}
function has(ns, keys) {
  const v = get(ns);
  return (keys || []).every((k) => !!v[k]);
}

module.exports = { get, set, masked, has };
