// 전략 추출 — 클라이언트의 컨텍스트·산출물을 읽어 "채널별 × 주제별" 재사용 전략 문서를 만든다.
// context/strategy/ 에 저장하고, OpenCrab 인제스트(opencrab.js)가 이 파일들을 지식팩에 올린다.
const fs = require('fs');
const path = require('path');
const { runCmd } = require('./proc');
const config = require('./config');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// 클라이언트에서 이미 확보된 재료 목록 (전략 추출의 입력)
function sources(dir) {
  const ctx = (f) => path.join(dir, 'context', f);
  const cand = [
    ['brand-style.md', ctx('brand-style.md')],
    ['kr-voice-profile.md', ctx('kr-voice-profile.md')],
    ['content-calendar.md', ctx('content-calendar.md')],
    ['references/site-analysis.md', ctx('references/site-analysis.md')],
    ['onboarding-answers.md', ctx('onboarding-answers.md')],
  ];
  return cand.filter(([, p]) => fs.existsSync(p)).map(([name, p]) => ({ name, path: p }));
}

// context/strategy/ 의 전략 파일 목록 (인제스트 대상)
function listStrategies(dir) {
  const d = path.join(dir, 'context', 'strategy');
  try {
    return fs.readdirSync(d).filter((f) => /\.md$/i.test(f)).map((f) => {
      const p = path.join(d, f);
      const text = read(p);
      const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
      // 채널·주제 태그 추출 (파일명 규약 channel-*.md / topic-*.md + 헤더)
      const kind = /^channel-/i.test(f) ? 'channel' : (/^topic-/i.test(f) ? 'topic' : 'general');
      return { file: f, path: p, title: title.trim(), kind, chars: text.length, text };
    });
  } catch { return []; }
}

// claude로 전략 문서 생성 — 채널별 파일 + 주제별 파일 + 인덱스
async function extract(dir, onLine) {
  const src = sources(dir);
  if (!src.length) return { ok: false, error: '전략을 뽑을 재료가 없습니다 — 먼저 온보딩(brand-style)과 캘린더를 준비하세요' };
  fs.mkdirSync(path.join(dir, 'context', 'strategy'), { recursive: true });
  // 이전 실행이 남긴 파일로 성공을 오판하지 않게, 실행 전 파일 목록을 스냅샷
  const before = new Set(listStrategies(dir).map((m) => m.file));
  onLine && onLine(`[전략] 재료 ${src.length}개로 채널별·주제별 전략 추출 중…`);
  const model = config.getModels().claude;
  const args = ['-p', '--permission-mode', 'acceptEdits', '--add-dir', dir];
  if (model) args.push('--model', model);
  const prompt =
    `클라이언트 폴더 ${dir} 의 context 자료(${src.map((s) => s.name).join(', ')})를 모두 읽고, ` +
    `추후 재사용할 수 있는 소셜 콘텐츠 전략을 context/strategy/ 에 markdown으로 정리하라.\n\n` +
    `[산출물]\n` +
    `1) 채널별 전략 — 각 운영 채널마다 context/strategy/channel-<채널>.md (예: channel-instagram.md). ` +
    `각 파일 구성: 채널 역할·목표 / 콘텐츠 포맷 믹스(피드·릴스·캐러셀·스레드 체인 등) / 후킹·구성 패턴 / 게시 리듬 / 성과 지표 / 이 브랜드에 맞는 구체 예시 3개.\n` +
    `2) 주제별(콘텐츠 필러) 전략 — 각 필러마다 context/strategy/topic-<주제>.md. ` +
    `구성: 이 주제를 다루는 앵글 5개 / 채널별 변주 / 시리즈화 아이디어 / 금지·주의 / 예시 훅 5개.\n` +
    `3) context/strategy/index.md — 만든 전략 파일 목록과 한 줄 요약 표.\n\n` +
    `[규칙] 브랜드 보이스·컴플라이언스(표시광고법·#AI생성)를 반영하라. 각 파일 맨 위에 제목(# ...)을 넣어라. ` +
    `추측이 필요한 부분은 "(가설 — 검증 필요)"로 표시하라. 완료 후 생성한 파일 목록만 출력하고 종료하라. 운영자에게 질문하지 말라.`;
  const r = await runCmd('claude', args, (l) => onLine && onLine(l), { cwd: dir, stdinText: prompt, timeoutMs: 8 * 60_000 });
  const made = listStrategies(dir);
  const fresh = made.filter((m) => !before.has(m.file));
  // claude가 실패(비정상 종료/타임아웃)했고 이번 실행에서 새로 생긴 파일도 없으면 실패로 본다
  // — 이전 실행이 남긴 파일 존재만으로 성공을 오판하지 않게
  if (!r.ok && !fresh.length) {
    return { ok: false, error: '전략 추출이 실패했습니다' + (r.timedOut ? ' (시간 초과)' : '') + (r.tail ? ` — ${String(r.tail).slice(-150)}` : '') };
  }
  if (!made.length) {
    return { ok: false, error: '전략 파일이 생성되지 않았습니다' + (r.tail ? ` (${String(r.tail).slice(-150)})` : '') };
  }
  onLine && onLine(`[전략] ✔ ${made.length}개 전략 파일 생성`);
  return {
    ok: true,
    count: made.length,
    channels: made.filter((m) => m.kind === 'channel').length,
    topics: made.filter((m) => m.kind === 'topic').length,
    files: made.map(({ file, title, kind, chars }) => ({ file, title, kind, chars })),
  };
}

module.exports = { extract, listStrategies, sources };
