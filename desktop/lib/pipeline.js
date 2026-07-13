// Pipeline stage runner — the app IS the human gate layer.
// Automated stages run `claude -p` headless in the client folder and stream logs;
// interview-style stages open an interactive terminal running /content-director.
const { spawn } = require('child_process');
const { runCmd, envWithPath, isWin } = require('./proc');
const config = require('./config');
const { makeParser, finalText } = require('./stream');

const isMac = process.platform === 'darwin';

let current = null;

// Stage prompts speak the team's contract language: the director skill defines
// the real behavior; these prompts just select the route and forbid gate-waiting
// (the operator approves in the app between stages).
const STAGES = {
  calendar: {
    label: '콘텐츠 캘린더 생성',
    prompt:
      'content-director 스킬의 Route B 1단계만 수행: content-calendar 스킬을 인라인 실행해 context/content-calendar.md를 생성하라. ' +
      '완료 후 반드시 기계 판독용 인덱스도 저장하라: context/calendar-index.json — 형식 {"posts":[{"id","week","day","platform","pillar","format","objective","topic","angle","visual","notes"}]} 로 모든 포스트를 빠짐없이 포함 (JSON 외 다른 내용 금지). ' +
      '운영자 승인 게이트에서 대기하지 말고 캘린더를 완성해 요약만 출력하고 종료하라 (승인은 앱에서 진행한다). ' +
      'context/brand-style.md가 없으면 아무것도 만들지 말고 BRAND MISSING 한 줄만 출력하라.',
  },
  copy: {
    label: '카피 병렬 팬아웃',
    prompt:
      'content-director 스킬의 Route B 3단계만 수행: context/content-calendar.md에 등장하는 플랫폼을 확인하고 ' +
      'copywriter 에이전트를 플랫폼별로 병렬 디스패치하라 (instagram/facebook, linkedin, threads, x, naver 중 캘린더에 있는 것만). ' +
      '전부 돌아오면 Phase 3 핸드오프 검증을 수행하고 플랫폼별 결과 요약만 출력하고 종료하라. 승인 게이트는 앱에서 진행한다.',
  },
  shortform: {
    label: '릴스/스토리보드 제작',
    prompt:
      'content-director 스킬의 Route G만 수행: 캘린더의 Format 컬럼으로 레인을 배정하고 video-producer 에이전트를 디스패치하라 ' +
      '(reel 슬롯 → reels-script, 캠페인/광고 스팟 → ad-storyboard). 이미지 생성 레인은 실행하지 말라. ' +
      '결과가 돌아오면 핸드오프 검증 후 요약만 출력하고 종료하라.',
  },
  visuals: {
    label: '비주얼 브리프 (1차 호출)',
    prompt:
      'creative-designer 에이전트를 Invocation 1 (Brief)로 디스패치하라: 카피 파일들의 VISUAL DIRECTION 필드를 수집해 ' +
      '포스트별 CREATIVE BRIEF를 작성해 반환받아 출력하고 종료하라. 각 브리프는 반드시 sop/creative-designer/prompt-packs/image-prompt-pack.md의 ' +
      '골격(SUBJECT→SETTING→COMPOSITION→LIGHTING→STYLE→COLOR→TEXT RULE)을 따른 영문 최종 생성 프롬프트 1개로 끝나야 한다 — ' +
      '기획 언어(목표/필러/앵글) 금지, 이미지 내 한글 텍스트 금지. 이미지 생성은 하지 말라 (브리프 승인은 앱에서 진행한다).',
  },
  'visuals-generate': {
    label: '비주얼 생성 (2차 호출 — 브리프 승인 후)',
    prompt:
      '운영자가 앱에서 CREATIVE BRIEF를 승인했다. creative-designer 에이전트를 Invocation 2 (Generation)로 디스패치하라: ' +
      '승인된 브리프의 최종 프롬프트 그대로 생성하라. 렌더 경로 우선순위는 Codex 계열 이미지 생성이 기본이다: ' +
      '① ima2 (ChatGPT OAuth, ima2 serve 자동 기동) → ② codex MCP 위임/codex_render.sh → ③ Nano Banana MCP (편집·앵커링 작업은 Nano Banana 전용). ' +
      'image-qa SOP를 적용한 뒤 파일 목록과 QA 결과만 출력하고 종료하라.',
  },
  compliance: {
    label: '컴플라이언스 게이트',
    prompt:
      'content-director 스킬의 Phase 4만 수행: compliance-reviewer 에이전트를 디스패치해 kr-guardrail-check를 outputs/ 전체에 실행시켜라. ' +
      '판정표(PASS/WARN/BLOCK)와 사유 요약만 출력하고 종료하라. WARN 서명과 BLOCK 재작업 결정은 앱에서 진행한다.',
  },
  review: {
    label: '월말 성과 리뷰',
    prompt:
      'content-director 스킬의 Route C 1단계만 수행: social-performance-review 스킬을 인라인 실행하라. ' +
      '데이터 입력이 필요하면 outputs/reviews/ 안의 CSV·이미지 파일을 찾아 사용하고, 없으면 REVIEW DATA MISSING 한 줄만 출력하고 종료하라.',
  },
};

function runStage(dir, stage, opts = {}, onLine) {
  const spec = STAGES[stage];
  if (!spec) return Promise.resolve({ ok: false, code: -1, out: `unknown stage: ${stage}`, tail: `unknown stage: ${stage}` });
  if (current) return Promise.resolve({ ok: false, code: -1, out: '다른 단계가 이미 실행 중입니다', tail: '다른 단계가 이미 실행 중입니다' });

  const extra = opts.extraContext ? `\n\n추가 지시: ${opts.extraContext}` : '';
  // 프롬프트는 stdin으로 (Windows 개행 안전 — proc.js 참조).
  // stream-json으로 실행해 도구 활동을 읽을 수 있는 로그로, 최종 비용/소요를 결과에 싣는다.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--add-dir', dir];
  const model = config.getModels().claude; // 파이프라인은 항상 Claude — 모델만 선택 적용
  if (model) args.push('--model', model);
  const stdinText = spec.prompt + extra;
  const AUTH_FAIL = /Invalid authentication credentials|Failed to authenticate|status.?401|Not logged in|Unauthorized/i;
  let parser;
  const prettyFeed = () => {
    // NDJSON 이벤트를 운영자가 읽는 활동 라인으로 변환해 onLine에 흘린다
    parser = makeParser((ev) => {
      if (!onLine) return;
      if (ev.kind === 'start') onLine(`[시작] 모델 ${ev.model || '(기본)'}`);
      else if (ev.kind === 'tool') onLine(`▸ ${ev.name}${ev.target ? ' — ' + ev.target : ''}`);
      else if (ev.kind === 'text') ev.text.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
      else if (ev.kind === 'done') onLine(`[완료] ${typeof ev.costUsd === 'number' ? '$' + ev.costUsd.toFixed(4) + ' · ' : ''}${ev.durationMs ? Math.round(ev.durationMs / 1000) + 's' : ''}`);
      else if (ev.kind === 'raw') onLine(ev.text);
    });
    return parser;
  };
  const runOnce = (env) => runCmd('claude', args, prettyFeed(), {
    cwd: dir,
    env,
    stdinText,
    onSpawn: (child) => { current = child; },
  }).then((r) => {
    current = null;
    // 최종 result 이벤트에서 비용/소요/응답 텍스트를 결과에 부착
    const st = parser && parser.state;
    const resultText = st ? finalText(st) : '';
    const fin = st && st.final;
    return {
      ...r,
      ok: r.ok && !(fin && fin.is_error),
      resultText,
      costUsd: fin && fin.total_cost_usd,
      durationMs: fin && fin.duration_ms,
      tail: resultText ? resultText.slice(-500) : r.tail,
    };
  });

  return runOnce().then(async (r) => {
    if (!r.ok && AUTH_FAIL.test(r.out)) {
      if (process.env.ANTHROPIC_API_KEY) {
        // 흔한 원인: PC에 남은 무효한 ANTHROPIC_API_KEY가 구독 로그인을 가로챔 → 키 없이 1회 재시도
        onLine && onLine('[auth] ANTHROPIC_API_KEY 환경변수로 401 발생 — 키 없이 구독 로그인으로 재시도합니다.');
        const retry = await runOnce({ ANTHROPIC_API_KEY: undefined });
        if (retry.ok) {
          onLine && onLine('[auth] 재시도 성공. PC의 ANTHROPIC_API_KEY 환경변수가 무효한 값입니다 — 시스템 환경변수에서 제거를 권합니다.');
          return retry;
        }
        r = retry;
      }
      onLine && onLine('[auth] claude CLI 인증 실패 — "디렉터와 대화 (터미널)" 버튼으로 터미널을 열어 claude에 로그인(/login)한 뒤 다시 실행하세요.');
      return { ...r, tail: 'claude CLI 인증 실패 (401). 터미널에서 claude /login 후 재시도. ANTHROPIC_API_KEY 환경변수가 있다면 유효한지 확인/제거하세요.' };
    }
    return r;
  });
}

function stopCurrent() {
  if (!current) return { ok: true, wasRunning: false };
  try {
    if (isWin && current.pid) spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true });
    else current.kill();
  } catch { /* already gone */ }
  current = null;
  return { ok: true, wasRunning: true };
}

// Interactive stages (brand onboarding interview, free-form direction) — open a real terminal.
// `engineOrCmd`: 'claude' | 'codex' picks the default command; a full string overrides it.
// onError(msg): 비동기 spawn 실패를 UI로 알리는 콜백 (main.js가 토스트/로그로 중계)
function openInteractiveTerminal(dir, engineOrCmd, onError) {
  let cmd;
  if (engineOrCmd === 'codex') cmd = 'codex';
  else if (engineOrCmd === 'claude' || !engineOrCmd) cmd = 'claude "/content-director"';
  else cmd = engineOrCmd; // explicit command string (e.g. "ima2 setup")
  const env = envWithPath();
  const report = (e) => { try { onError && onError(`터미널 열기 실패: ${e && e.message || e}`); } catch { /* no-op */ } };
  try {
    if (isWin) {
      // `start`의 인용 규칙이 spawn 인자 이스케이프와 충돌하므로 임시 .cmd 스크립트를 경유한다.
      // cmd.exe는 배치 파일을 시스템 코드페이지(한국어 PC는 CP949)로 읽으므로 chcp 65001을
      // 먼저 선언해야 한글 경로가 안 깨진다. %는 배치 확장을 막게 %%로 이스케이프.
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const script = path.join(os.tmpdir(), `sat-terminal-${Date.now()}.cmd`);
      const dirEsc = dir.replace(/%/g, '%%');
      fs.writeFileSync(script, `@echo off\r\nchcp 65001 >nul\r\ncd /d "${dirEsc}"\r\n${cmd}\r\n`);
      const p = spawn('cmd', ['/c', 'start', '', 'cmd', '/k', script], { detached: true, shell: false, env });
      p.on('error', report);
      setTimeout(() => { try { fs.unlinkSync(script); } catch { /* in use */ } }, 60_000);
    } else if (isMac) {
      // AppleScript 문자열 안에 셸 명령을 넣으므로 두 겹 이스케이프가 필요하다:
      // 1) 셸용 — 경로는 단일따옴표로, 2) AppleScript용 — 백슬래시와 큰따옴표를 \로.
      const shellDir = `'${String(dir).replace(/'/g, `'\\''`)}'`;
      const shellLine = `cd ${shellDir} && ${cmd}`;
      const asEsc = shellLine.replace(/[\\"]/g, (m) => '\\' + m);
      const script = `tell application "Terminal" to do script "${asEsc}"`;
      const p = spawn('osascript', ['-e', script], { detached: true, env });
      p.on('error', report);
    } else {
      const term = process.env.TERMINAL || 'x-terminal-emulator';
      const shellDir = `'${String(dir).replace(/'/g, `'\\''`)}'`;
      const inner = `cd ${shellDir} && ${cmd}; exec bash`;
      const p = spawn(term, ['-e', `bash -lc '${inner.replace(/'/g, `'\\''`)}'`], { detached: true, env });
      p.on('error', report);
    }
  } catch (e) {
    report(e);
    return { ok: false, error: String(e && e.message || e) };
  }
  return { ok: true };
}

module.exports = { STAGES, runStage, stopCurrent, openInteractiveTerminal };
