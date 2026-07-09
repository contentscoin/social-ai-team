// Setup wizard backend — "설치했을 때 적용": skills → ~/.claude, Codex CLI + OAuth, MCP 등록
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCmd, resolveCmd } = require('./proc');

let openExternal = () => {};
try {
  const { shell } = require('electron');
  openExternal = (u) => shell.openExternal(u).catch(() => {});
} catch { /* running outside electron (tests) */ }

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_USER_CONFIG = path.join(HOME, '.claude.json');

// Where the bundled skills/agents/sop live. Packaged: resources/payload. Dev: repo root.
function payloadPaths() {
  const packaged = path.join(process.resourcesPath || '', 'payload');
  if (process.resourcesPath && fs.existsSync(packaged)) {
    return {
      skills: path.join(packaged, 'skills'),
      agents: path.join(packaged, 'agents'),
      sop: path.join(packaged, 'sop'),
    };
  }
  const repo = path.resolve(__dirname, '..', '..');
  return {
    skills: path.join(repo, 'skills'),
    agents: path.join(repo, '.claude', 'agents'),
    sop: path.join(repo, 'sop'),
    dev: true,
  };
}

async function cliVersion(name) {
  const abs = resolveCmd(name);
  const r = await runCmd(name, ['--version'], null, { timeoutMs: 15000 });
  return { found: r.ok, path: abs || (r.ok ? name + ' (PATH)' : null), version: r.ok ? r.out.trim().split(/\r?\n/)[0] : null };
}

async function checkEnvironment() {
  const [claude, codex, node, ima2] = await Promise.all([
    cliVersion('claude'), cliVersion('codex'), cliVersion('node'), cliVersion('ima2'),
  ]);
  let codexAuthed = false;
  if (codex.found) {
    const r = await runCmd('codex', ['login', 'status'], null, { timeoutMs: 20000 });
    codexAuthed = /logged in using/i.test(r.out);
  }
  // ima2 setup writes ~/.ima2 — presence is the "configured" signal (OAuth details live inside)
  const ima2Configured = ima2.found && fs.existsSync(path.join(HOME, '.ima2'));
  return {
    platform: process.platform,
    node: node.found,
    claude: claude.found,
    codex: codex.found,
    codexAuthed,
    ima2: ima2.found,
    ima2Configured,
    skillsInstalled: fs.existsSync(path.join(CLAUDE_DIR, 'skills', 'content-director', 'SKILL.md')),
    agentsInstalled: fs.existsSync(path.join(CLAUDE_DIR, 'agents', 'copywriter.md')),
    paths: { claude: claude.path, codex: codex.path, node: node.path, ima2: ima2.path },
    versions: { claude: claude.version, codex: codex.version, node: node.version, ima2: ima2.version },
    claudeInstallUrl: 'https://code.claude.com/docs/en/quickstart',
    nodeInstallUrl: 'https://nodejs.org/',
  };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

async function installSkills() {
  const p = payloadPaths();
  if (!fs.existsSync(p.skills)) return { ok: false, tail: `payload not found: ${p.skills}` };
  const installed = [];
  for (const name of fs.readdirSync(p.skills)) {
    const src = path.join(p.skills, name);
    if (!fs.statSync(src).isDirectory()) continue;
    copyDir(src, path.join(CLAUDE_DIR, 'skills', name));
    installed.push(name);
  }
  copyDir(p.agents, path.join(CLAUDE_DIR, 'agents'));
  copyDir(p.sop, path.join(CLAUDE_DIR, 'social-ai-team-sop'));
  return { ok: true, skills: installed, agents: fs.readdirSync(path.join(CLAUDE_DIR, 'agents')) };
}

async function installCodexCli(onLine) {
  if (resolveCmd('codex')) return { ok: true, already: true };
  const node = await cliVersion('node');
  if (!node.found) {
    return { ok: false, needNode: true, tail: 'Node.js가 없습니다 — https://nodejs.org 에서 LTS 설치 후 다시 시도하세요.' };
  }
  onLine && onLine('npm으로 @openai/codex 설치 중…');
  return runCmd('npm', ['install', '-g', '@openai/codex'], onLine, { timeoutMs: 300000 });
}

// PC에는 브라우저가 있으므로 표준 OAuth 우선. GUI에서 스폰된 프로세스가 브라우저를
// 못 여는 경우를 대비해, 출력에서 URL을 잡아 Electron이 직접 연다.
// 브라우저 콜백 흐름이 실패하면 디바이스 코드 흐름으로 폴백.
async function codexOAuthLogin(onLine) {
  if (!resolveCmd('codex') && !(await cliVersion('codex')).found) {
    return { ok: false, tail: 'codex CLI가 없습니다 — 먼저 "Codex 설치"를 실행하세요.' };
  }
  const status = await runCmd('codex', ['login', 'status'], null, { timeoutMs: 20000 });
  if (/logged in using/i.test(status.out)) return { ok: true, already: true };

  const urls = [];
  const sniff = (l) => {
    onLine && onLine(l);
    const m = l.match(/https?:\/\/\S+/);
    if (m && !urls.includes(m[0])) {
      urls.push(m[0]);
      openExternal(m[0]);
      onLine && onLine(`→ 브라우저에서 열었습니다: ${m[0]}`);
    }
  };
  const r = await runCmd('codex', ['login'], sniff, { timeoutMs: 300000 });
  if (r.ok) return { ...r, urls };
  onLine && onLine('브라우저 콜백 흐름 실패 — 디바이스 코드로 전환합니다. 아래 URL을 열고 코드를 입력하세요.');
  const r2 = await runCmd('codex', ['login', '--device-auth'], sniff, { timeoutMs: 600000 });
  return { ...r2, urls };
}

// user-scope MCP 등록: CLI 우선, 실패하면 ~/.claude.json에 직접 병합 (백업 후).
async function registerCodexMcp(onLine) {
  const codexPath = resolveCmd('codex') || 'codex';
  const r = await runCmd('claude', ['mcp', 'add', '-s', 'user', 'codex', '--', codexPath, 'mcp-server'], onLine, { timeoutMs: 60000 });
  if (r.ok || /already exists/i.test(r.out)) return { ok: true, via: 'cli', already: /already exists/i.test(r.out) };

  onLine && onLine('claude CLI 등록 실패 — ~/.claude.json에 직접 기록합니다.');
  try {
    let cfg = {};
    if (fs.existsSync(CLAUDE_USER_CONFIG)) {
      fs.copyFileSync(CLAUDE_USER_CONFIG, CLAUDE_USER_CONFIG + '.bak');
      cfg = JSON.parse(fs.readFileSync(CLAUDE_USER_CONFIG, 'utf8'));
    }
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.codex = { type: 'stdio', command: codexPath, args: ['mcp-server'], env: {} };
    fs.writeFileSync(CLAUDE_USER_CONFIG, JSON.stringify(cfg, null, 2));
    onLine && onLine(`기록 완료: ${CLAUDE_USER_CONFIG} (백업: .bak)`);
    return { ok: true, via: 'config', command: codexPath };
  } catch (e) {
    return { ok: false, tail: `CLI(${r.tail}) / 직접 기록(${e.message}) 모두 실패` };
  }
}

async function installIma2(onLine) {
  if (resolveCmd('ima2')) return { ok: true, already: true };
  const node = await cliVersion('node');
  if (!node.found) {
    return { ok: false, needNode: true, tail: 'Node.js가 없습니다 — https://nodejs.org 에서 LTS 설치 후 다시 시도하세요.' };
  }
  onLine && onLine('npm으로 ima2-gen 설치 중…');
  return runCmd('npm', ['install', '-g', 'ima2-gen'], onLine, { timeoutMs: 300000 });
}

module.exports = { checkEnvironment, installSkills, installCodexCli, codexOAuthLogin, registerCodexMcp, installIma2, payloadPaths };
