// Pipeline stage runner — the app IS the human gate layer.
// Automated stages run `claude -p` headless in the client folder and stream logs;
// interview-style stages open an interactive terminal running /content-director.
const { spawn } = require('child_process');
const { runCmd, envWithPath, isWin } = require('./proc');

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
      '포스트별 CREATIVE BRIEF만 작성해 반환받아 출력하고 종료하라. 이미지 생성은 하지 말라 (브리프 승인은 앱에서 진행한다).',
  },
  'visuals-generate': {
    label: '비주얼 생성 (2차 호출 — 브리프 승인 후)',
    prompt:
      '운영자가 앱에서 CREATIVE BRIEF를 승인했다. creative-designer 에이전트를 Invocation 2 (Generation)로 디스패치하라: ' +
      '승인된 브리프대로 생성하고 (렌더 경로 우선순위: Nano Banana MCP → codex MCP 위임 → codex_render.sh), ' +
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
  if (!spec) return Promise.resolve({ ok: false, out: `unknown stage: ${stage}` });
  if (current) return Promise.resolve({ ok: false, out: 'another stage is already running' });

  const extra = opts.extraContext ? `\n\n추가 지시: ${opts.extraContext}` : '';
  const args = [
    '-p', spec.prompt + extra,
    '--permission-mode', 'acceptEdits',
    '--add-dir', dir,
  ];
  const AUTH_FAIL = /Invalid authentication credentials|Failed to authenticate|status.?401/i;
  const runOnce = (env) => runCmd('claude', args, onLine, {
    cwd: dir,
    env,
    onSpawn: (child) => { current = child; },
  }).then((r) => { current = null; return r; });

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
function openInteractiveTerminal(dir, engineOrCmd) {
  let cmd;
  if (engineOrCmd === 'codex') cmd = 'codex';
  else if (engineOrCmd === 'claude' || !engineOrCmd) cmd = 'claude "/content-director"';
  else cmd = engineOrCmd; // explicit command string (e.g. "ima2 setup")
  const env = envWithPath();
  if (isWin) {
    // `start`의 인용 규칙이 spawn 인자 이스케이프와 충돌하므로 임시 .cmd 스크립트를 경유한다.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const script = path.join(os.tmpdir(), `sat-terminal-${Date.now()}.cmd`);
    fs.writeFileSync(script, `@echo off\r\ncd /d "${dir}"\r\n${cmd}\r\n`);
    spawn('cmd', ['/c', 'start', '', 'cmd', '/k', script], { detached: true, shell: false, env });
  } else if (isMac) {
    const script = `tell application "Terminal" to do script "cd ${JSON.stringify(dir)} && ${cmd}"`;
    spawn('osascript', ['-e', script], { detached: true, env });
  } else {
    const term = process.env.TERMINAL || 'x-terminal-emulator';
    spawn(term, ['-e', `bash -lc 'cd ${JSON.stringify(dir)} && ${cmd}; exec bash'`], { detached: true, env });
  }
  return { ok: true };
}

module.exports = { STAGES, runStage, stopCurrent, openInteractiveTerminal };
