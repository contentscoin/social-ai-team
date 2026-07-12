// 일괄 비주얼 렌더 — 오토파일럿의 visuals-generate와 "일괄 비주얼 생성" 버튼이 공유한다.
// 핵심: 파이프라인(creative-designer 에이전트)은 앱 설정의 프로바이더 키를 못 본다.
// 여기서 앱 렌더 엔진(lib/render.js — 설정 키를 읽음)을 직접 돌려 실제 이미지를 만든다.
// 포스트마다 프롬프트를 컴파일하고, 포맷에 따라 여러 장(캐러셀)을 생성한다.
const board = require('./board');
const promptlab = require('./promptlab');
const render = require('./render');

// 포맷 문자열로 캐러셀 여부·기본 장수 추정 — 대부분의 SNS는 여러 장을 쓴다
function inferCount(post, fallback) {
  const f = String(post.format || '').toLowerCase() + ' ' + String(post.headerRaw || '');
  if (/carousel|캐러셀|여러\s*장|다중|슬라이드|slide|묶음|album/i.test(f)) return 5;
  if (/single|단일|1\s*장|피드|feed/i.test(f)) return 1;
  return fallback || 1;
}
// 세로 4:5가 인스타 피드 점유에 유리 — 스토리/릴스형은 9:16
function inferSize(post) {
  const f = String(post.format || '').toLowerCase();
  if (/story|스토리|9:16|세로영상/i.test(f)) return 'story';
  if (/1:1|정방|square/i.test(f)) return 'square';
  return 'portrait';
}

// opts: { provider?, count?(고정 장수 강제), ima2?, stopped?(), onlyMissing?(기본 true) }
async function renderAll(dir, opts, onLine) {
  const b = board.buildBoard(dir);
  const provider = opts.provider || render.defaultImageProvider({ ima2: opts.ima2 });
  // 사진형 이미지가 필요한 포스트: 카피가 생겼고(stage ≥ copy) 릴스가 아닌 것.
  // onlyMissing이면 이미 렌더 이미지가 있는 카드는 건너뛴다 (재실행 시 중복·비용 방지).
  const onlyMissing = opts.onlyMissing !== false;
  const targets = (b.posts || []).filter((p) =>
    !p.isReel &&
    ['copy', 'visual', 'review', 'ready'].includes(p.stage) &&
    (!onlyMissing || !p.thumb));
  if (!targets.length) {
    return { ok: true, provider, rendered: 0, results: [], note: '렌더할 포스트가 없습니다 (카피가 있고 아직 이미지가 없는 사진형 포스트 대상)' };
  }
  onLine && onLine(`[비주얼] ${targets.length}개 포스트 · 프로바이더 ${provider}`);
  const results = [];
  for (const p of targets) {
    if (opts.stopped && opts.stopped()) { onLine && onLine('[비주얼] 중지됨'); break; }
    const cid = `${p.chId || 'etc'}-${p.n}`;
    const count = Number(opts.count) > 0 ? Number(opts.count) : inferCount(p, 1);
    const size = inferSize(p);
    const brief = [p.topic, p.visual && `비주얼 디렉션: ${p.visual}`, p.angle && `앵글: ${p.angle}`, p.pillar && `필러: ${p.pillar}`].filter(Boolean).join('\n');
    onLine && onLine(`[비주얼] ${cid} — ${count}장 (${size}) 준비`);
    let prompt = brief, negative = null;
    try {
      const c = await promptlab.compile(dir, { kind: 'image', provider, topic: p.topic, channel: p.channel, format: p.format, lane: p.lane, prompt: brief, size }, onLine);
      if (c && c.ok && c.prompt) { prompt = c.prompt; negative = c.negative || null; }
    } catch { /* 컴파일 실패 시 브리프 원문으로 진행 */ }
    try {
      const r = await render.generate(dir, { kind: 'image', provider, prompt, negative, base: cid, size, count, stopped: opts.stopped }, onLine);
      results.push({ uid: p.uid, id: cid, ok: !!r.ok, files: r.files || [], count: (r.files || []).length, error: r.error });
      onLine && onLine(r.ok ? `[비주얼] ✔ ${cid} — ${(r.files || []).length}장` : `[비주얼] ✖ ${cid} — ${r.error}`);
    } catch (e) {
      results.push({ uid: p.uid, id: cid, ok: false, files: [], error: String(e && e.message || e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const total = results.reduce((n, r) => n + (r.files ? r.files.length : 0), 0);
  return {
    ok: okCount > 0,
    provider, rendered: okCount, images: total, results,
    resultText: `${okCount}/${targets.length} 포스트 · 총 ${total}장 생성 (${provider})`,
  };
}

module.exports = { renderAll, inferCount, inferSize };
