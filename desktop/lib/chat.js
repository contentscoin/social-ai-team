// In-app conversation with the team director — no external terminal, no native PTY.
// Each turn spawns the selected CLI headless in the client folder and resumes the
// prior session so context carries across turns.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { runCmd, killTree } = require('./proc');
const config = require('./config');
const { makeParser, finalText } = require('./stream');

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

// 대화 턴 타임아웃 — 디렉터가 서브에이전트를 돌리면 오래 걸리므로 넉넉히, 그러나 무한 대기는 금지
const TURN_TIMEOUT_MS = 20 * 60 * 1000;
// 진행 중인 채팅 프로세스 — 중지 버튼이 죽일 수 있게 추적
let currentChild = null;
function stopCurrent() {
  if (!currentChild) return { ok: true, wasRunning: false };
  killTree(currentChild);
  currentChild = null;
  return { ok: true, wasRunning: true };
}

async function claudeTurn(dir, userMsg, onLine, onEvent) {
  // 프롬프트는 stdin으로 — Windows cmd.exe의 개행/퍼센트 파손을 원천 차단 (proc.js 참조)
  // stream-json으로 실행해 텍스트/도구 활동을 onEvent로 실시간 중계한다 (--verbose 필수).
  let parser;
  const attempt = async (sid) => {
    const prompt = sid ? userMsg : claudeSeed(userMsg);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--add-dir', dir];
    const model = config.getModels().claude;
    if (model) args.push('--model', model);
    if (sid) args.push('--resume', sid);
    parser = makeParser(onEvent);
    const feed = (line) => { parser(line); onLine && onLine(line); };
    const runOpts = (env) => ({
      cwd: dir, stdinText: prompt, env,
      timeoutMs: TURN_TIMEOUT_MS,
      onSpawn: (c) => { currentChild = c; },
    });
    let r = await runCmd('claude', args, feed, runOpts());
    currentChild = null;
    if (!r.ok && AUTH_FAIL.test(r.out) && process.env.ANTHROPIC_API_KEY) {
      onLine && onLine('[auth] ANTHROPIC_API_KEY로 401 — 키 없이 재시도합니다.');
      parser = makeParser(onEvent);
      const feed2 = (line) => { parser(line); onLine && onLine(line); };
      r = await runCmd('claude', args, feed2, runOpts({ ANTHROPIC_API_KEY: undefined }));
      currentChild = null;
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
  const st = parser.state;
  const text = finalText(st);
  const newSid = (st.final && st.final.session_id) || st.sessionId;
  if (newSid) config.setSession(dir, newSid);
  if (text && (!st.final || !st.final.is_error)) {
    return {
      ok: true, text, engine: 'claude',
      costUsd: st.final && st.final.total_cost_usd, durationMs: st.final && st.final.duration_ms,
    };
  }
  // 스트림이 전혀 안 온 경우(구버전 CLI 등) — 단발 JSON 형식으로 폴백 파싱
  if (!st.sawStream) {
    const json = parseClaudeJson(r.out);
    if (json && (json.result || json.session_id)) {
      if (json.session_id) config.setSession(dir, json.session_id);
      // is_error 응답을 정상 답변으로 위장시키지 않는다
      return { ok: !json.is_error, text: json.result || '(빈 응답)', engine: 'claude', costUsd: json.total_cost_usd, durationMs: json.duration_ms };
    }
  }
  if (!r.ok && AUTH_FAIL.test(r.out)) {
    return { ok: false, text: 'Claude 인증 실패 (401). 사이드바에서 Codex로 바꾸거나, 터미널에서 `claude` 로그인 후 다시 시도하세요.', engine: 'claude' };
  }
  return { ok: false, text: (text || r.tail || r.out || '응답을 파싱하지 못했습니다').slice(-1200), engine: 'claude' };
}

async function codexTurn(dir, userMsg, onLine, onEvent) {
  const outFile = path.join(os.tmpdir(), `sat-codex-${Date.now()}.txt`);
  // 세션은 폴더별 × 엔진별로 저장. 'codex-started'(구버전 마커)면 id가 없어 --last로 폴백하는데,
  // --last는 전역 최근 세션이라 다른 클라이언트의 대화를 이어받을 수 있다 — 그래서
  // stdout 배너에서 session id를 캡처해 이 폴더의 id로 저장하고, 이후엔 id로 resume한다.
  const saved = config.getSession(dir, 'codex');
  const model = config.getModels().codex;
  // exec 레벨 옵션(-C, -o 등)은 반드시 resume 서브커맨드 앞에 — 뒤에 두면
  // "unexpected argument '-C' found"로 죽는다. 프롬프트는 '-' 인자 + stdin (개행 안전).
  const buildArgs = (resumeArg, extra = [], useModel = true) => {
    const a = ['exec', '-C', dir, '--skip-git-repo-check', '--color', 'never', '-o', outFile, ...extra];
    if (model && useModel) a.push('-c', `model="${model}"`);
    if (resumeArg) a.push('resume', resumeArg);
    a.push('-');
    return a;
  };
  const UUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
  let capturedId = null;
  // codex는 stream-json이 없으므로 stdout 라인을 그대로 활동 피드로 중계 + 세션 id 캡처
  const feed = (line) => {
    if (!capturedId && /session/i.test(line)) {
      const m = line.match(UUID_RE);
      if (m) capturedId = m[1];
    }
    onLine && onLine(line);
    if (onEvent && line.trim()) { try { onEvent({ kind: 'raw', text: line }); } catch { /* 소비자 보호 */ } }
  };
  const runOpts = { cwd: dir, stdinText: userMsg, timeoutMs: TURN_TIMEOUT_MS, onSpawn: (c) => { currentChild = c; } };
  const resumeArg = saved && saved !== 'codex-started' ? saved : (saved === 'codex-started' ? '--last' : null);
  let r = await runCmd('codex', buildArgs(resumeArg), feed, runOpts);
  currentChild = null;
  let configHint = '';
  if (!r.ok && /Error loading config/i.test(r.out)) {
    onLine && onLine('[chat] config.toml 파싱 실패 — 사용자 설정을 무시하고 재시도합니다.');
    configHint = '\n\n(참고: ~/.codex/config.toml에 이 codex 버전이 모르는 값이 있습니다. 수정하면 이 우회가 필요 없습니다.)';
    r = await runCmd('codex', buildArgs(resumeArg, ['--ignore-user-config']), feed, runOpts);
    currentChild = null;
  }
  // ChatGPT 계정 codex는 일부 모델 지정을 400으로 거부한다 — 모델 없이 재시도하고 안내
  if (!r.ok && model && /model.*(is )?not supported|invalid_request_error/i.test(r.out)) {
    onLine && onLine(`[chat] 모델 "${model}"이(가) 이 codex 계정에서 지원되지 않음 — 기본 모델로 재시도합니다.`);
    configHint = `\n\n(참고: 설정에서 선택한 Codex 모델 "${model}"은(는) 현재 로그인 계정에서 지원되지 않아 기본 모델로 진행했습니다. 설정 → 엔진에서 Codex 모델을 비우거나 계정이 지원하는 모델로 바꾸세요.)`;
    r = await runCmd('codex', buildArgs(resumeArg, [], false), feed, runOpts);
    currentChild = null;
  }
  if (!r.ok && resumeArg && /No such session|session.*not found|unexpected argument/i.test(r.out)) {
    // 저장된 세션이 사라졌거나 이 codex 버전이 id resume을 모름 — 새 대화로 재시작
    onLine && onLine('[chat] 이전 codex 세션을 이어받지 못해 새 대화로 시작합니다.');
    config.clearSession(dir, 'codex');
    r = await runCmd('codex', buildArgs(null), feed, runOpts);
    currentChild = null;
  }
  // 실패한 첫 턴을 started로 마킹하면 다음 턴 resume이 헛돈다 — 성공시에만 저장.
  // id를 캡처했으면 id로(다른 클라이언트와 안 섞임), 못 했으면 구버전 --last 방식 유지.
  if (r.ok) config.setSession(dir, capturedId || 'codex-started', 'codex');
  let text = '';
  try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); } catch { /* no file */ }
  if (!text) text = (r.tail || r.out || '(응답 없음)').slice(-1200);
  if (!r.ok && AUTH_FAIL.test(r.out)) {
    return { ok: false, text: 'Codex 인증 실패 — 설정의 "Codex 로그인 (OAuth)"으로 로그인 후 다시 시도하세요.', engine: 'codex' };
  }
  return { ok: r.ok, text: text + (r.ok ? configHint : ''), engine: 'codex' };
}

async function send(dir, userMsg, onLine, onEvent) {
  const engine = config.getEngine();
  return engine === 'codex' ? codexTurn(dir, userMsg, onLine, onEvent) : claudeTurn(dir, userMsg, onLine, onEvent);
}

function reset(dir) { config.clearSession(dir); return { ok: true }; }

module.exports = { send, reset, stopCurrent };
