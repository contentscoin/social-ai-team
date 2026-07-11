// 질문지 기반 온보딩 — 한 질문씩 LLM 왕복하는 인터뷰를 없앤다.
// 1차: 고정 질문지(즉시, LLM 없음) → 운영자가 아는 것만 선택 답변
// 2차: 답변+레퍼런스 분석을 읽고 "필요한 후속 질문만" 한 번에 생성 (LLM 1회, 실패 시 건너뜀)
// 최종: 전체 답변을 한 번에 합성 → brand-style.md + kr-voice-profile.md 초안 (LLM 1회)
const fs = require('fs');
const path = require('path');
const { runCmd } = require('./proc');
const config = require('./config');

// ---- 1차 질문지 (렌더러가 폼으로 그린다 — 전부 선택 답변) ------------------------------
const QUESTIONNAIRE = [
  {
    section: 'A. 브랜드 기본', items: [
      { id: 'name', q: '브랜드/업체명', type: 'text', ph: '예: 온도 로스터리' },
      { id: 'offer', q: '무엇을 파나요? 대표 제품·서비스 2-3개', type: 'textarea', ph: '예: 싱글오리진 원두 구독, 홈카페 클래스' },
      { id: 'diff', q: '남들과 다른 한 가지 (차별점)', type: 'textarea', ph: '예: 로스팅 후 48시간 내 배송' },
      { id: 'never', q: '절대 하지 않는 것 / 피하고 싶은 이미지', type: 'text', ph: '예: 과장 광고, 저가 이미지' },
    ],
  },
  {
    section: 'B. 타깃', items: [
      { id: 'who', q: '주 고객은 누구인가요? (연령대·상황)', type: 'text', ph: '예: 25-40 홈카페 입문자' },
      { id: 'moment', q: '고객이 우리를 찾는 순간·고민', type: 'textarea', ph: '예: 카페 커피값이 부담될 때, 선물 고를 때' },
    ],
  },
  {
    section: 'C. 톤 · 보이스', items: [
      { id: 'personality', q: '브랜드 성격 (복수 선택)', type: 'multi', options: ['따뜻한', '전문적인', '장난기 있는', '미니멀', '프리미엄', '친근한', '대담한', '차분한'] },
      { id: 'register', q: '말투', type: 'choice', options: ['해요체 (친근)', '합쇼체 (격식)', '과감한 반말톤', '상황에 따라 섞어서'] },
      { id: 'emoji', q: '이모지 사용', type: 'choice', options: ['적극 사용', '최소한만', '사용 안 함'] },
      { id: 'banned', q: '금지 표현·단어', type: 'text', ph: '예: 대박, 미쳤다, 갓성비' },
    ],
  },
  {
    section: 'D. 비주얼', items: [
      { id: 'colors', q: '브랜드 컬러 (hex나 색 이름, 모르면 비워두세요)', type: 'text', ph: '예: #C96F4A 테라코타, 크림' },
      { id: 'mood', q: '비주얼 무드 (복수 선택)', type: 'multi', options: ['밝고 화사', '차분한 톤', '빈티지', '모던', '자연광 느낌', '스튜디오 촬영 느낌'] },
    ],
  },
  {
    section: 'E. 채널 · 운영', items: [
      { id: 'channels', q: '운영할 채널 (복수 선택)', type: 'multi', options: ['Instagram', 'Threads', 'X', 'Facebook', 'LinkedIn', '네이버 블로그', 'TikTok'] },
      { id: 'goal', q: '이번 달 최우선 목표', type: 'choice', options: ['브랜드 인지도', '팔로워 성장', '문의·판매 전환', '단골 소통'] },
      { id: 'freq', q: '주당 발행 가능 횟수', type: 'choice', options: ['1-2회', '3-4회', '5회 이상'] },
    ],
  },
  {
    section: 'F. 자유', items: [
      { id: 'pillars', q: '꼭 다뤄줬으면 하는 주제', type: 'textarea', ph: '예: 원두 지식, 홈카페 레시피, 매장 일상' },
      { id: 'refs', q: '참고 계정·경쟁사', type: 'text', ph: '예: @moment_coffee, 프릳츠' },
    ],
  },
];

function parseJsonLoose(out) {
  try { return JSON.parse(String(out).trim()); } catch { /* fall through */ }
  const m = String(out).match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}
function answersToMd(title, answers) {
  const lines = [`## ${title}`];
  for (const sec of QUESTIONNAIRE) {
    for (const it of sec.items) {
      const v = answers[it.id];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      lines.push(`- ${it.q}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : `## ${title}\n- (답변 없음)`;
}
function refContext(dir) {
  const p = path.join(dir, 'context', 'references', 'site-analysis.md');
  try { return fs.readFileSync(p, 'utf8').slice(0, 6000); } catch { return ''; }
}
async function claude(dir, prompt, timeoutMs) {
  const model = config.getModels().claude;
  const args = ['-p', '--permission-mode', 'acceptEdits', '--add-dir', dir];
  if (model) args.push('--model', model);
  return runCmd('claude', args, null, { cwd: dir, stdinText: prompt, timeoutMs });
}

// 2차 — 답변의 공백·모순만 겨냥한 후속 질문을 한 번에 생성 (없으면 빈 배열)
async function followups(dir, answers, onLine) {
  const ref = refContext(dir);
  onLine && onLine('[onboard] 후속 질문 생성 중… (한 번에 묶어서 나옵니다)');
  const prompt =
    `너는 브랜드 온보딩 디렉터다. 아래 1차 질문지 답변을 읽고, 콘텐츠 팀 운영에 꼭 필요한데 ` +
    `비었거나 모호하거나 서로 충돌하는 부분에 대해서만 후속 질문을 만들어라.\n\n` +
    `[규칙]\n- 최대 6개. 답변이 충분하면 더 적게, 완벽하면 0개.\n` +
    `- 각 질문은 독립적으로 답할 수 있어야 한다 (질문 간 의존 금지 — 한 번에 다 답한다).\n` +
    `- 선택지로 답할 수 있는 건 choice로 (options 3-5개 + 운영자가 직접 쓸 수도 있음).\n` +
    `- 이미 답한 것을 다시 묻지 말라. 레퍼런스 분석에 있는 것도 다시 묻지 말라.\n` +
    `- 출력은 JSON 배열만: [{"id":"f1","q":"질문","type":"text|choice","options":["..."]}]\n\n` +
    `[1차 답변]\n${answersToMd('1차 질문지 답변', answers)}\n` +
    (ref ? `\n[레퍼런스 사이트 분석 (이미 아는 정보)]\n${ref}\n` : '');
  const r = await claude(dir, prompt, 3 * 60_000);
  if (!r.ok) return { ok: true, questions: [], note: '후속 질문 생성 실패 — 1차 답변만으로 진행합니다' };
  // claude -p 기본 출력은 텍스트 — JSON 배열을 관대하게 추출
  const arr = parseJsonLoose(r.out);
  const questions = (Array.isArray(arr) ? arr : [])
    .filter((x) => x && typeof x.q === 'string' && x.q.length > 3)
    .slice(0, 6)
    .map((x, i) => ({
      id: String(x.id || 'f' + (i + 1)),
      q: x.q.slice(0, 200),
      type: x.type === 'choice' && Array.isArray(x.options) && x.options.length ? 'choice' : 'text',
      options: Array.isArray(x.options) ? x.options.slice(0, 6).map((o) => String(o).slice(0, 80)) : undefined,
    }));
  return { ok: true, questions };
}

// 최종 — 전체 답변을 한 번에 합성 (인터뷰 없이 온보딩 완료)
async function finalize(dir, answers, followupAnswers, onLine) {
  const ctxDir = path.join(dir, 'context');
  fs.mkdirSync(ctxDir, { recursive: true });
  // 답변 원본 기록 — 재실행·감사용
  const record =
    `# 온보딩 질문지 답변 (자동 기록)\n\n수집: ${new Date().toISOString()}\n\n` +
    answersToMd('1차 질문지', answers) + '\n\n' +
    (Object.keys(followupAnswers || {}).length
      ? '## 2차 후속 질문 답변\n' + Object.entries(followupAnswers).map(([q, a]) => `- ${q}: ${a}`).join('\n')
      : '## 2차 후속 질문 답변\n- (없음)');
  fs.writeFileSync(path.join(ctxDir, 'onboarding-answers.md'), record);
  const brandPath = path.join(ctxDir, 'brand-style.md');
  const hasBrand = fs.existsSync(brandPath);
  const brandMtime0 = hasBrand ? fs.statSync(brandPath).mtimeMs : 0;
  const hasVoice = fs.existsSync(path.join(ctxDir, 'kr-voice-profile.md'));
  const ref = refContext(dir);
  onLine && onLine('[onboard] 답변 합성 중 — brand-style.md' + (hasVoice ? '' : ' + kr-voice-profile.md 초안') + ' 생성');
  const prompt =
    `클라이언트 폴더 ${dir} 의 context/onboarding-answers.md (질문지 답변)를 읽고` +
    (ref ? ` context/references/site-analysis.md 와 종합해` : '') + ` 온보딩 문서를 완성하라.\n\n` +
    `1) context/brand-style.md — ~/.claude/skills/brand-onboarding/SKILL.md 의 문서 구조를 따르라 (읽을 수 없으면 표준 구성: ` +
    `브랜드 개요/제품·서비스/차별점/타깃/톤·보이스/비주얼 아이덴티티(팔레트 hex 포함)/콘텐츠 필러/채널·운영 원칙/금지 사항). ` +
    (hasBrand ? `이미 존재하므로 답변과 충돌하는 부분만 갱신하고 나머지는 보존하라.\n` : `새로 작성하라.\n`) +
    (hasVoice ? '' :
      `2) context/kr-voice-profile.md — kr-voice-localizer 스킬의 프로파일 구조를 따라 초안을 작성하라 ` +
      `(말투/어미 다양화 규칙/이모지 정책/금지 표현/해시태그 정책). 맨 위에 "> ⚠ 질문지 기반 자동 초안 — 필요 시 /kr-voice-localizer 인테이크로 정밀화"를 넣어라.\n`) +
    `${hasVoice ? '2' : '3'}) 답변이 비어 있는 항목은 ${ref ? '레퍼런스 분석으로 보완하고, 그래도 없으면' : ''} 합리적 기본값을 쓰되 문서에 "(기본값 — 확인 필요)"로 표시하라.\n` +
    `완료 후 생성/수정한 파일 목록만 한 줄씩 출력하고 종료하라. 운영자에게 질문하지 말라.`;
  const r = await claude(dir, prompt, 6 * 60_000);
  // 성공 판정: 새로 생성됐거나(부재→존재), 기존 파일이 실제로 갱신됐거나, claude가 정상 종료
  // — 기존 brand-style이 있는 상태에서 claude가 실패했는데 "존재하니 성공"으로 위장하지 않게
  const brandNow = fs.existsSync(brandPath);
  const brandTouched = brandNow && (!hasBrand || (fs.statSync(brandPath).mtimeMs > brandMtime0));
  const brandOk = brandNow && (r.ok || brandTouched);
  if (!brandOk) {
    return {
      ok: false,
      error: '합성 실패 — 답변은 context/onboarding-answers.md에 저장됐습니다. 디렉터 채팅에서 "onboarding-answers.md로 brand-style.md를 만들어줘"로 재시도하세요.'
        + (r.tail ? ` (${String(r.tail).slice(-150)})` : ''),
    };
  }
  onLine && onLine('[onboard] ✔ 온보딩 완료');
  return {
    ok: true,
    brand: true,
    voiceDrafted: !hasVoice && fs.existsSync(path.join(ctxDir, 'kr-voice-profile.md')),
    record: 'context/onboarding-answers.md',
  };
}

module.exports = { QUESTIONNAIRE, followups, finalize };
