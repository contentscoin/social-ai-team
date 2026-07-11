// 레퍼런스 사이트 분석 — 클라이언트 온보딩 준비 레인.
// URL을 받으면: ① 페이지 수집(제목/메타/헤딩/본문 텍스트 + 컬러 시그널) → context/references/ 스냅샷
// ② claude가 스냅샷을 종합해 site-analysis.md 작성, brand-style.md가 없으면 자동 초안 생성.
// SNS(인스타 등)는 JS 렌더링이라 수집이 빈약할 수 있다 — 홈페이지·블로그가 가장 잘 잡힌다.
const fs = require('fs');
const path = require('path');
const { runCmd } = require('./proc');
const config = require('./config');

const MAX_SITES = 5;
const FETCH_TIMEOUT = 20_000;
const MAX_HTML = 1.5 * 1024 * 1024;
const MAX_TEXT = 40 * 1024;

// ---- HTML → 텍스트 (외부 의존성 없이 — 완벽할 필요 없고 분석 재료면 충분) -----------------
function decodeEntities(s) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…' };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&([a-z]+);/gi, (_, n) => map[n.toLowerCase()] || ' ');
}
function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
}
function pick(re, html) { const m = html.match(re); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''; }
function pickAll(re, html, cap) {
  return [...html.matchAll(re)].map((m) => decodeEntities(m[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean).slice(0, cap);
}

async function fetchSite(rawUrl) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl); } catch { return { ok: false, url: rawUrl, error: 'URL 형식 오류' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, url: rawUrl, error: 'http(s)만 지원' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(u.toString(), {
      signal: ac.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialAITeam/0.14; brand-reference-fetch)', Accept: 'text/html,*/*' },
    });
    if (!res.ok) return { ok: false, url: u.toString(), error: `HTTP ${res.status}` };
    let html = await res.text();
    if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
    const text = htmlToText(html).slice(0, MAX_TEXT);
    // 컬러 시그널 — CSS/인라인의 hex를 빈도순으로 (팔레트 추정 재료)
    const counts = {};
    for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const c = '#' + m[1].toLowerCase();
      if (/^#(ffffff|000000|f{6}|0{6})$/.test(c)) continue;
      counts[c] = (counts[c] || 0) + 1;
    }
    const colors = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
    return {
      ok: true, url: u.toString(), host: u.hostname,
      title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html),
      description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html)
        || pick(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html),
      ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i, html),
      ogDesc: pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i, html),
      headings: pickAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, html, 20),
      colors, text,
      thin: text.length < 600, // JS 렌더링 등으로 본문이 빈약함 — 분석 시 참고
    };
  } catch (e) {
    return { ok: false, url: u.toString(), error: /abort/i.test(String(e)) ? '시간 초과 (20s)' : (e.message || String(e)) };
  } finally { clearTimeout(t); }
}

function snapshotMd(s) {
  return `# 레퍼런스 사이트 스냅샷 — ${s.host}\n\n` +
    `- URL: ${s.url}\n- 수집: ${new Date().toISOString()}\n` +
    `- 제목: ${s.title || s.ogTitle || '-'}\n- 설명: ${s.description || s.ogDesc || '-'}\n` +
    (s.colors.length ? `- 컬러 시그널 (빈도순): ${s.colors.join(' ')}\n` : '') +
    (s.thin ? `- ⚠ 본문이 빈약함 — JS 렌더링 사이트일 수 있음 (SNS 페이지는 수집이 제한됩니다)\n` : '') +
    (s.headings.length ? `\n## 헤딩\n${s.headings.map((h) => '- ' + h).join('\n')}\n` : '') +
    `\n## 본문 텍스트 (추출)\n${s.text}\n`;
}

// dir의 references 폴더에 스냅샷 저장 후 claude 종합 분석
async function analyze(dir, urls, onLine) {
  const list = [...new Set((urls || []).map((u) => String(u).trim()).filter(Boolean))].slice(0, MAX_SITES);
  if (!list.length) return { ok: false, error: '분석할 URL이 없습니다' };
  const refDir = path.join(dir, 'context', 'references');
  fs.mkdirSync(refDir, { recursive: true });
  const saved = [];
  const failed = [];
  for (const url of list) {
    onLine && onLine(`[reference] 수집 중 — ${url}`);
    const s = await fetchSite(url);
    if (!s.ok) { failed.push(`${s.url} (${s.error})`); onLine && onLine(`[reference] ✖ ${s.url} — ${s.error}`); continue; }
    const name = `site-${s.host.replace(/[^\w.-]/g, '_')}.md`;
    fs.writeFileSync(path.join(refDir, name), snapshotMd(s));
    saved.push({ name, host: s.host, thin: s.thin });
    onLine && onLine(`[reference] ✔ ${s.host}${s.thin ? ' (본문 빈약 — SNS/JS 사이트?)' : ''}`);
  }
  if (!saved.length) return { ok: false, error: '모든 사이트 수집에 실패했습니다: ' + failed.join(', ') };

  // claude 종합 — 실패해도 스냅샷은 남는다 (수동으로 온보딩 인터뷰에 활용 가능)
  const hasBrand = fs.existsSync(path.join(dir, 'context', 'brand-style.md'));
  onLine && onLine('[reference] 레퍼런스 종합 분석 중… (claude)');
  const model = config.getModels().claude;
  const args = ['-p', '--permission-mode', 'acceptEdits', '--add-dir', dir];
  if (model) args.push('--model', model);
  const prompt =
    `클라이언트 폴더 ${dir} 의 context/references/ 안 사이트 스냅샷(${saved.map((s) => s.name).join(', ')})을 모두 읽고 종합 분석하라.\n\n` +
    `1) context/references/site-analysis.md 를 작성하라 — 섹션: 브랜드 개요 / 제품·서비스 / 타깃 시그널 / ` +
    `톤·보이스 관찰(문장 스타일·호칭·이모지 사용) / 컬러·비주얼 시그널(스냅샷의 hex 후보 중 브랜드 컬러로 보이는 것과 근거) / ` +
    `콘텐츠 필러 후보 3-5개 / 활용 메모(캘린더·카피에 반영할 것들). 본문이 빈약한 스냅샷은 과대해석하지 말고 그렇다고 명시하라.\n` +
    (hasBrand
      ? `2) context/brand-style.md 가 이미 있으므로 수정하지 말라. 대신 site-analysis.md 끝에 "brand-style.md 갱신 제안" 섹션으로 차이점만 정리하라.\n`
      : `2) context/brand-style.md 가 없으므로 brand-onboarding 스킬의 문서 구조를 따라 초안을 생성하라. ` +
        `문서 맨 위에 "> ⚠ 레퍼런스 사이트 자동 분석 초안입니다 — 온보딩 인터뷰로 확정하세요"를 넣어라.\n`) +
    `3) 완료 후 생성/수정한 파일 목록만 한 줄씩 출력하고 종료하라.`;
  const r = await runCmd('claude', args, null, { cwd: dir, stdinText: prompt, timeoutMs: 6 * 60_000 });
  const analysisOk = fs.existsSync(path.join(refDir, 'site-analysis.md'));
  if (!r.ok && !analysisOk) {
    return {
      ok: true, partial: true, snapshots: saved.length, failed,
      note: '스냅샷은 저장됐지만 종합 분석(claude)이 실패했습니다 — 디렉터 채팅에서 "context/references를 분석해 brand-style 초안을 만들어줘"로 재시도하세요.',
    };
  }
  onLine && onLine('[reference] ✔ 분석 완료 — context/references/site-analysis.md');
  return {
    ok: true, snapshots: saved.length, failed,
    analysis: 'context/references/site-analysis.md',
    brandDrafted: !hasBrand && fs.existsSync(path.join(dir, 'context', 'brand-style.md')),
  };
}

module.exports = { analyze, fetchSite, htmlToText };
