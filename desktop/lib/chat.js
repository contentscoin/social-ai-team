// In-app conversation with the team director — no external terminal, no native PTY.
// Each turn spawns the selected CLI headless in the client folder and resumes the
// prior session so context carries across turns.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { runCmd } = require('./proc');
const config = require('./config');

const AUTH_FAIL = /Invalid authentication credentials|Failed to authenticate|status.?401|Not logged in|Unauthorized/i;

// Seed instruction so the first Claude turn takes on the director role for this client.
function claudeSeed(userMsg) {
  return (
    'You are the team director for this client folder. Run the content-director skill ' +
    '(~/.claude/skills/content-director/SKILL.md): read it and act as the Korean-speaking ' +
    'social content director. Read context/*.md first for state. Converse in Korean. ' +
    'Do NOT auto-run destructive or publishing steps without the operator confirming in this chat.\n\n' +
    '운영자 메시지: ' + userMsg
  );
}

function parseClaudeJson(out) {
  // --output-format json prints one JSON object; be tolerant of extra lines.
  const trimmed = out.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.lastIndexOf('{');
  if (start >= 0) { try { return JSON.parse(trimmed.slice(start)); } catch { /* nope */ } }
  return null;
}

const SESSION_GONE = /No conversation found|session.*not found|Unknown session|resume.*failed/i;

async function claudeTurn(dir, userMsg, onLine) {
  // 프롬프트는 stdin으로 — Windows cmd.exe의 개행/퍼센트 파손을 원천 차단 (proc.js 참조)
  const attempt = async (sid) => {
    const prompt = sid ? userMsg : claudeSeed(userMsg);
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--add-dir', dir];
    const model = config.getModels().claude;
    if (model) args.push('--model', model);
    if (sid) args.push('--resume', sid);
    let r = await runCmd('claude', args, onLine, { cwd: dir, stdinText: prompt });
    if (!r.ok && AUTH_FAIL.test(r.out) && process.env.ANTHROPIC_API_KEY) {
      onLine && onLine('[auth] ANTHROPIC_API_KEY로 401 — 키 없이 재시도합니다.');
      r = await runCmd('claude', args, onLine, { cwd: dir, stdinText: prompt, env: { ANTHROPIC_API_KEY: undefined } });
    }
    return r;
  };

  let sid = config.getSession(dir);
  let r = await attempt(sid);
  if (!r.ok && sid && SESSION_GONE.test(r.out)) {
    // CLI 쪽에서 세션이 사라짐(캐시 정리/업데이트) — 새 대화로 자동 재시작
    onLine && onLine('[chat] 이전 세션이 만료되어 새 대화로 재시작합니다.');
    config.clearSession(dir);
    sid = null;
    r = await attempt(null);
  }
  const json = parseClaudeJson(r.out);
  if (json && (json.result || json.session_id)) {
    if (json.session_id) config.setSession(dir, json.session_id);
    return { ok: true, text: json.result || '(빈 응답)', engine: 'claude' };
  }
  if (!r.ok && AUTH_FAIL.test(r.out)) {
    return { ok: false, text: 'Claude 인증 실패 (401). 사이드바에서 Codex로 바꾸거나, 터미널에서 `claude` 로그인 후 다시 시도하세요.', engine: 'claude' };
  }
  return { ok: false, text: (r.tail || r.out || '응답을 파싱하지 못했습니다').slice(-1200), engine: 'claude' };
}

async function codexTurn(dir, userMsg, onLine) {
  const outFile = path.join(os.tmpdir(), `sat-codex-${Date.now()}.txt`);
  const started = config.getSession(dir) === 'codex-started';
  // exec 레벨 옵션(-C, -o 등)은 반드시 resume 서브커맨드 앞에 — 뒤에 두면
  // "unexpected argument '-C' found"로 죽는다
  const model = config.getModels().codex;
  // 프롬프트는 '-' 인자 + stdin으로 전달 (개행 안전)
  const buildArgs = (extra = []) => {
    const a = ['exec', '-C', dir, '--skip-git-repo-check', '--color', 'never', '-o', outFile, ...extra];
    if (model) a.push('-c', `model="${model}"`);
    if (started) a.push('resume', '--last');
    a.push('-');
    return a;
  };
  let r = await runCmd('codex', buildArgs(), onLine, { cwd: dir, stdinText: userMsg });
  let configHint = '';
  if (!r.ok && /Error loading config/i.test(r.out)) {
    onLine && onLine('[chat] config.toml 파싱 실패 — 사용자 설정을 무시하고 재시도합니다.');
    configHint = '\n\n(참고: ~/.codex/config.toml에 이 codex 버전이 모르는 값이 있습니다. 수정하면 이 우회가 필요 없습니다.)';
    r = await runCmd('codex', buildArgs(['--ignore-user-config']), onLine, { cwd: dir, stdinText: userMsg });
  }
  if (r.ok) config.setSession(dir, 'codex-started'); // 실패한 첫 턴을 started로 마킹하면 다음 턴 resume이 헛돈다
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch { /* no file */ }
  if (!text) text = (r.tail || r.out || '(응답 없음)').slice(-1200);
  if (!r.ok && AUTH_FAIL.test(r.out)) {
    return { ok: false, text: 'Codex 인증 실패 — 설정의 "Codex 로그인 (OAuth)"으로 로그인 후 다시 시도하세요.', engine: 'codex' };
  }
  return { ok: r.ok, text: text + (r.ok ? configHint : ''), engine: 'codex' };
}

async function send(dir, userMsg, onLine) {
  const engine = config.getEngine();
  return engine === 'codex' ? codexTurn(dir, userMsg, onLine) : claudeTurn(dir, userMsg, onLine);
}

function reset(dir) { config.clearSession(dir); return { ok: true }; }

module.exports = { send, reset };
