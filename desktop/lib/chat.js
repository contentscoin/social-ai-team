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

async function claudeTurn(dir, userMsg, onLine) {
  const sid = config.getSession(dir);
  const prompt = sid ? userMsg : claudeSeed(userMsg);
  const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--add-dir', dir];
  if (sid) args.push('--resume', sid);

  const runOnce = (env) => runCmd('claude', args, onLine, { cwd: dir, env });
  let r = await runOnce();
  if (!r.ok && AUTH_FAIL.test(r.out) && process.env.ANTHROPIC_API_KEY) {
    onLine && onLine('[auth] ANTHROPIC_API_KEY로 401 — 키 없이 재시도합니다.');
    r = await runOnce({ ANTHROPIC_API_KEY: undefined });
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
  const base = ['exec'];
  if (started) base.push('resume', '--last');
  base.push('-C', dir, '--skip-git-repo-check', '--color', 'never', '-o', outFile, userMsg);

  const r = await runCmd('codex', base, onLine, { cwd: dir });
  config.setSession(dir, 'codex-started');
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch { /* no file */ }
  if (!text) text = (r.tail || r.out || '(응답 없음)').slice(-1200);
  if (!r.ok && AUTH_FAIL.test(r.out)) {
    return { ok: false, text: 'Codex 인증 실패 — 사이드바 "Codex 로그인 (OAuth)"으로 로그인 후 다시 시도하세요.', engine: 'codex' };
  }
  return { ok: r.ok, text, engine: 'codex' };
}

async function send(dir, userMsg, onLine) {
  const engine = config.getEngine();
  return engine === 'codex' ? codexTurn(dir, userMsg, onLine) : claudeTurn(dir, userMsg, onLine);
}

function reset(dir) { config.clearSession(dir); return { ok: true }; }

module.exports = { send, reset };
