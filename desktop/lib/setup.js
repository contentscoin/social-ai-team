// Setup wizard backend — "설치했을 때 적용": skills → ~/.claude, Codex CLI + OAuth, MCP 등록
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const isWin = process.platform === 'win32';

// Where the bundled skills/agents/sop live. Packaged: resources/payload. Dev: repo root.
function payloadRoot() {
  const packaged = path.join(process.resourcesPath || '', 'payload');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  const repo = path.resolve(__dirname, '..', '..');
  return {
    skills: path.join(repo, 'skills'),
    agents: path.join(repo, '.claude', 'agents'),
    sop: path.join(repo, 'sop'),
    dev: true,
  };
}

function payloadPaths() {
  const root = payloadRoot();
  if (root.dev) return root;
  return {
    skills: path.join(root, 'skills'),
    agents: path.join(root, 'agents'),
    sop: path.join(root, 'sop'),
  };
}

function which(cmd) {
  return new Promise((resolve) => {
    execFile(isWin ? 'where' : 'which', [cmd], (err, stdout) => {
      resolve(err ? null : stdout.split(/\r?\n/)[0].trim() || null);
    });
  });
}

function run(cmd, args, onLine, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: isWin, ...opts });
    let out = '';
    const feed = (buf) => {
      const text = buf.toString();
      out += text;
      text.split(/\r?\n/).filter(Boolean).forEach((l) => onLine && onLine(l));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => resolve({ ok: false, code: -1, out: out + e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, out }));
  });
}

async function checkEnvironment() {
  const [claude, codex, node] = await Promise.all([which('claude'), which('codex'), which('node')]);
  let codexAuthed = false;
  if (codex) {
    const r = await run('codex', ['login', 'status'], null);
    codexAuthed = /logged in using/i.test(r.out);
  }
  const skillsInstalled = fs.existsSync(path.join(CLAUDE_DIR, 'skills', 'content-director', 'SKILL.md'));
  const agentsInstalled = fs.existsSync(path.join(CLAUDE_DIR, 'agents', 'copywriter.md'));
  return {
    platform: process.platform,
    node: !!node,
    claude: !!claude,
    codex: !!codex,
    codexAuthed,
    skillsInstalled,
    agentsInstalled,
    claudeInstallUrl: 'https://code.claude.com/docs/en/quickstart',
  };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

async function installSkills() {
  const p = payloadPaths();
  const installed = [];
  for (const name of fs.readdirSync(p.skills)) {
    const src = path.join(p.skills, name);
    if (!fs.statSync(src).isDirectory()) continue;
    copyDir(src, path.join(CLAUDE_DIR, 'skills', name));
    installed.push(name);
  }
  copyDir(p.agents, path.join(CLAUDE_DIR, 'agents'));
  // sop payload is copied into each client folder at creation time (workspace.js);
  // keep a master copy next to skills for reference.
  copyDir(p.sop, path.join(CLAUDE_DIR, 'social-ai-team-sop'));
  return { ok: true, skills: installed, agents: fs.readdirSync(path.join(CLAUDE_DIR, 'agents')) };
}

async function installCodexCli(onLine) {
  if (await which('codex')) return { ok: true, already: true };
  onLine && onLine('Installing @openai/codex via npm…');
  return run('npm', ['install', '-g', '@openai/codex'], onLine);
}

// PC에는 브라우저가 있으므로 표준 OAuth 로그인 사용 (로컬 콜백 서버 방식).
// 브라우저가 안 열리는 환경이면 --device-auth 코드 흐름으로 폴백.
async function codexOAuthLogin(onLine) {
  if (!(await which('codex'))) return { ok: false, out: 'codex CLI not installed' };
  const status = await run('codex', ['login', 'status'], null);
  if (/logged in using/i.test(status.out)) return { ok: true, already: true };
  onLine && onLine('Opening browser for Codex OAuth…');
  const r = await run('codex', ['login'], onLine);
  if (r.ok) return r;
  onLine && onLine('Browser flow failed — falling back to device code. Open the URL shown below and enter the code.');
  return run('codex', ['login', '--device-auth'], onLine);
}

async function registerCodexMcp(onLine) {
  if (!(await which('claude'))) return { ok: false, out: 'claude CLI not installed' };
  // User-scope registration so every client folder sees mcp__codex__codex.
  const r = await run('claude', ['mcp', 'add', '-s', 'user', 'codex', '--', 'codex', 'mcp-server'], onLine);
  if (!r.ok && /already exists/i.test(r.out)) return { ok: true, already: true };
  return r;
}

module.exports = { checkEnvironment, installSkills, installCodexCli, codexOAuthLogin, registerCodexMcp, payloadPaths };
