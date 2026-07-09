// Client workspace management — one folder per client (SETUP.md convention)
const fs = require('fs');
const os = require('os');
const path = require('path');
const setup = require('./setup');

const HOME = os.homedir();
const ROOT = path.join(HOME, 'SocialAITeam');           // default clients root
const REGISTRY = path.join(ROOT, 'clients.json');

function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return { clients: [] }; }
}
function saveRegistry(reg) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
}

function listClients() {
  const reg = loadRegistry();
  reg.clients = reg.clients.filter((c) => fs.existsSync(c.dir));
  return reg.clients;
}

function seedClientFolder(dir) {
  for (const sub of ['context', 'assets/products', 'assets/lifestyle', 'outputs']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  // Arm the SOP hook (image-qa + codex render lane) — social-creative-designer Phase 0 reads sop/creative-designer/
  const p = setup.payloadPaths();
  if (fs.existsSync(p.sop)) fs.cpSync(p.sop, path.join(dir, 'sop'), { recursive: true });
}

function createClient(name) {
  const safe = String(name || '').trim().replace(/[^\w가-힣 -]/g, '').replace(/\s+/g, '-').toLowerCase();
  if (!safe) return { ok: false, error: 'invalid name' };
  const dir = path.join(ROOT, safe);
  fs.mkdirSync(dir, { recursive: true });
  seedClientFolder(dir);
  const reg = loadRegistry();
  if (!reg.clients.find((c) => c.dir === dir)) reg.clients.push({ name: safe, dir });
  saveRegistry(reg);
  return { ok: true, name: safe, dir };
}

function addExisting(dir) {
  seedClientFolder(dir); // idempotent — only fills gaps
  const name = path.basename(dir);
  const reg = loadRegistry();
  if (!reg.clients.find((c) => c.dir === dir)) reg.clients.push({ name, dir });
  saveRegistry(reg);
  return { ok: true, name, dir };
}

// Parse context/workflow-status.md checkboxes + key context files into a dashboard model
function readStatus(dir) {
  const ctx = (f) => fs.existsSync(path.join(dir, 'context', f));
  const statusPath = path.join(dir, 'context', 'workflow-status.md');
  let items = [];
  let raw = '';
  if (fs.existsSync(statusPath)) {
    raw = fs.readFileSync(statusPath, 'utf8');
    items = [...raw.matchAll(/^- \[( |x)\] (.+)$/gm)].map((m) => ({ done: m[1] === 'x', label: m[2] }));
  }
  return {
    brand: ctx('brand-style.md'),
    voiceProfile: ctx('kr-voice-profile.md'),
    calendar: ctx('content-calendar.md'),
    statusItems: items,
    statusRaw: raw,
  };
}

const OUTPUT_LANES = ['captions', 'linkedin', 'threads', 'x', 'naver', 'creatives', 'videos', 'storyboards', 'compliance', 'reviews'];

function listOutputs(dir) {
  const lanes = {};
  for (const lane of OUTPUT_LANES) {
    const p = path.join(dir, 'outputs', lane);
    lanes[lane] = fs.existsSync(p)
      ? fs.readdirSync(p).filter((f) => !f.startsWith('.')).map((f) => path.join('outputs', lane, f))
      : [];
  }
  return lanes;
}

function readOutputFile(dir, rel) {
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(path.resolve(dir) + path.sep)) return { ok: false, error: 'path escape blocked' };
  if (!fs.existsSync(abs)) return { ok: false, error: 'not found' };
  const stat = fs.statSync(abs);
  if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'file too large' };
  const ext = path.extname(abs).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return { ok: true, kind: 'image', dataUrl: `data:image/${ext.slice(1)};base64,${fs.readFileSync(abs).toString('base64')}` };
  }
  return { ok: true, kind: 'text', text: fs.readFileSync(abs, 'utf8') };
}

module.exports = { listClients, createClient, addExisting, readStatus, listOutputs, readOutputFile };
