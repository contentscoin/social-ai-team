// 프롬프트 컴파일러 — "기획 언어"를 "시각 언어"로 바꾼다.
// 재료: 브랜드 팔레트(brand-style.md) + 캘린더 필드 + 카피의 영문 VISUAL DIRECTION + 프롬프트 팩.
// 1차: claude -p 컴파일(엄격 JSON) → 실패 시 2차: 규칙 기반 템플릿 조립 (오프라인 폴백).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCmd } = require('./proc');
const config = require('./config');
const { findVisualDirection } = require('./postblock');

// ---- 팩 로딩 ----------------------------------------------------------------------
const BUILTIN_DIR = path.join(__dirname, '..', 'packs');
const USER_DIR = path.join(os.homedir(), '.social-ai-team', 'packs');

function listPacks() {
  const packs = [];
  const scan = (dir, source) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(md|txt|json)$/i.test(f)) continue;
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        if (st.size > 512 * 1024) continue; // 팩은 참조 노트다 — 거대 파일 제외
        packs.push({ name: f.replace(/\.(md|txt|json)$/i, ''), file: f, source, size: st.size, path: p });
      }
    } catch { /* 폴더 없음 */ }
  };
  scan(BUILTIN_DIR, 'builtin');
  scan(USER_DIR, 'user');
  return packs;
}
function deletePack(file) {
  // 사용자 팩만 삭제 가능 (내장 팩은 앱 자산)
  const p = path.join(USER_DIR, path.basename(file));
  try { fs.unlinkSync(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message } };
}
function savePack(name, content) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const safe = String(name).replace(/[^\w가-힣 .-]/g, '').slice(0, 80) || 'pack';
  const p = path.join(USER_DIR, safe + '.md');
  fs.writeFileSync(p, String(content).slice(0, 512 * 1024));
  return { ok: true, file: safe + '.md' };
}
// kind에 맞는 팩 본문을 합쳐 컴파일 컨텍스트로 (예산 내 절단)
function packContext(kind, budget = 9000) {
  const want = kind === 'video' ? /video|영상|모션|motion/i : (kind === 'svg' ? /svg|디자인|design|typo/i : /image|이미지|photo|프롬프트|prompt/i);
  const all = listPacks();
  const picked = all.filter((p) => want.test(p.name) || want.test(p.file));
  // 매칭이 없으면 이름과 무관하게 전부 (사용자가 팩 이름을 자유롭게 지었을 수 있다)
  const use = picked.length ? picked : all;
  let out = '';
  for (const p of use) {
    if (out.length > budget) break;
    try { out += `\n\n===== PACK: ${p.name} (${p.source}) =====\n` + fs.readFileSync(p.path, 'utf8').slice(0, budget - out.length); } catch { /* skip */ }
  }
  return out.trim();
}

// ---- 브랜드 컨텍스트 추출 ------------------------------------------------------------
function brandContext(dir) {
  let md = '';
  try { md = fs.readFileSync(path.join(dir, 'context', 'brand-style.md'), 'utf8'); } catch { /* 없음 */ }
  if (!md) return { palette: [], summary: '' };
  const palette = [...new Set([...md.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]))].slice(0, 6);
  // 요약: 무드/톤/타깃 관련 줄만 앞쪽에서 추림
  const lines = md.split(/\r?\n/).filter((l) => /무드|톤|mood|tone|타깃|target|personality|퍼스낼리티|스타일|aesthetic|팔레트|color/i.test(l)).slice(0, 12);
  return { palette, summary: lines.join('\n').slice(0, 1200) };
}

// ---- 규칙 기반 폴백 컴파일러 -----------------------------------------------------------
const RECIPES = {
  image: {
    product: { comp: 'centered product hero shot with clean margins', light: 'bright even softbox studio lighting', style: 'premium product photography, high-end brand campaign look' },
    lifestyle: { comp: 'rule of thirds, subject on the right third, generous negative space on the left for headline overlay', light: 'soft window light from the left, gentle shadows', style: 'editorial lifestyle photography, shot on 50mm, natural film grain' },
    food: { comp: 'top-down flat lay with 15% padding at frame edges', light: 'overcast diffused daylight, true-to-life colors', style: 'vibrant food photography, appetizing texture detail' },
  },
  videoCam: 'Slow dolly-in toward the subject',
  videoAtmo: 'light shifts warmer, dust particles drifting softly in the light beam',
};
function templateCompile(job, brand, vd) {
  const paletteStr = brand.palette.length ? `, brand color tones ${brand.palette.join(' ')}` : '';
  if (job.kind === 'video') {
    const base = vd || job.prompt || job.topic || 'the subject in the keyframe';
    return {
      prompt: `${RECIPES.videoCam} as the scene comes alive: ${base}. Subtle natural motion only — steam, light, or fabric. ${RECIPES.videoAtmo}. No new objects, no scene cuts, no text.`,
      negative: '',
      via: 'template',
    };
  }
  const fmt = /food|음식|카페|베이커리|디저트/i.test(job.prompt + ' ' + (job.topic || '')) ? 'food'
    : (/product|제품|언박싱|상세/i.test(job.prompt + ' ' + (job.format || '')) ? 'product' : 'lifestyle');
  const r = RECIPES.image[fmt];
  const subject = vd || job.prompt || job.topic || 'the described scene';
  return {
    prompt: `${subject}. ${r.comp}, ${r.light}, ${r.style}${paletteStr}, 4:5 crop safety with key elements inside the central 80%, absolutely no text, letters, or logos in the image.`,
    negative: 'deformed hands, extra fingers, watermark, garbled text, low quality, oversaturated, AI artifacts',
    via: 'template',
  };
}

// ---- Claude 컴파일 (1차 경로) ----------------------------------------------------------
function parseJsonLoose(out) {
  try { return JSON.parse(out.trim()); } catch { /* fall through */ }
  const m = String(out).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nope */ } }
  return null;
}
async function claudeCompile(dir, job, brand, vd, onLine) {
  const packs = packContext(job.kind === 'video' ? 'video' : 'image');
  const target = job.kind === 'video'
    ? `${job.provider} (image-to-video/text-to-video 영상 모델)`
    : `${job.provider} (사진형 이미지 생성 모델)`;
  const instr =
    `너는 시니어 비주얼 프롬프트 엔지니어다. 아래 재료로 ${target}에 넣을 최종 생성 프롬프트를 만들어라.\n\n` +
    `[규칙]\n- 아래 프롬프트 팩의 골격과 뱅크를 따르라. 기획 언어(목표/필러/앵글)를 그대로 옮기지 말고 시각 언어로 번역하라.\n` +
    `- 프롬프트는 영어로 (브랜드/제품 고유명사는 원문 유지). 이미지면 텍스트 금지 규칙을 반드시 포함.\n` +
    `- 영상이면 카메라 1개 + 피사체 모션 1-2개 + 분위기 1개, 3문장 이내.\n` +
    `- 출력은 JSON 하나만: {"prompt":"...","negative":"..."} (negative는 이미지에만, 없으면 빈 문자열)\n\n` +
    `[포스트 재료]\n주제: ${job.topic || '-'}\n채널/포맷: ${job.channel || '-'} / ${job.format || '-'}\n운영자 브리프: ${job.prompt || '-'}\n` +
    (vd ? `카피라이터의 VISUAL DIRECTION (가장 중요한 재료): ${vd}\n` : '') +
    (brand.summary ? `\n[브랜드 무드]\n${brand.summary}\n` : '') +
    (brand.palette.length ? `브랜드 팔레트: ${brand.palette.join(' ')}\n` : '') +
    `\n[프롬프트 팩]\n${packs}`;
  const model = config.getModels().claude;
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', model);
  const r = await runCmd('claude', args, null, { cwd: dir, stdinText: instr, timeoutMs: 120_000 });
  if (!r.ok) return null;
  let outer = parseJsonLoose(r.out);
  // claude -p --output-format json은 {result: "..."} 래핑 — 내부 JSON을 다시 파싱
  const inner = outer && typeof outer.result === 'string' ? parseJsonLoose(outer.result) : outer;
  if (inner && typeof inner.prompt === 'string' && inner.prompt.length > 20) {
    onLine && onLine('[prompt] 컴파일 완료 (claude)');
    return { prompt: inner.prompt.trim().slice(0, 2000), negative: String(inner.negative || '').slice(0, 500), via: 'claude' };
  }
  return null;
}

// job: {kind:'image'|'video', provider, topic, channel, format, lane, prompt(운영자 브리프), size, duration}
async function compile(dir, job, onLine) {
  const brand = brandContext(dir);
  let vd = null;
  if (job.lane && job.topic) {
    try { vd = findVisualDirection(dir, job.lane, job.topic); } catch { /* 없음 */ }
    if (vd) onLine && onLine('[prompt] 카피의 VISUAL DIRECTION 발견 — 1급 재료로 사용');
  }
  // claude-svg 레인은 컴파일 대상이 아니다 — 자체 디자인 브리프를 쓴다 (render.js에서 팩 주입)
  if (job.provider === 'claude-svg') {
    return { ok: true, prompt: job.prompt, negative: '', via: 'svg-passthrough', vd };
  }
  onLine && onLine('[prompt] 프롬프트 컴파일 중…');
  try {
    const c = await claudeCompile(dir, job, brand, vd, onLine);
    if (c) return { ok: true, ...c, vd };
  } catch { /* 폴백으로 */ }
  onLine && onLine('[prompt] claude 컴파일 실패 — 템플릿 폴백 사용');
  return { ok: true, ...templateCompile(job, brand, vd), vd };
}

module.exports = { compile, listPacks, deletePack, savePack, packContext, brandContext };
