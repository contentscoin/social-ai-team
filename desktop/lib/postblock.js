// 포스트 블록 탐색 — 레인 파일들에서 특정 포스트의 본문 블록을 찾는다.
// pub:copy / pub2:draft (main.js)와 promptlab(VISUAL DIRECTION 추출)이 공유.
// 종료 앵커는 시작과 동종(POST/ID/1레벨 헤딩)만 — 본문 내부의 ##·---에서 끊기지 않는다.
const fs = require('fs');
const path = require('path');

const normText = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function findPostBlock(dir, lane, topic) {
  const laneDir = path.resolve(dir, 'outputs', lane);
  if (!laneDir.startsWith(path.resolve(dir) + path.sep)) return { ok: false, error: 'path escape' };
  const t = normText(topic).slice(0, 24);
  if (!t) return { ok: false, error: '토픽이 비어 있습니다' };
  let files = [];
  try { files = fs.readdirSync(laneDir).filter((f) => /\.(md|txt)$/i.test(f)); } catch { /* no lane */ }
  const anchorRe = /^(POST\s*\d+\b.*|[A-Z]{1,2}-\d+\b.*|#\s.*)$/gm; // 동종 앵커만
  for (const f of files) {
    const text = fs.readFileSync(path.join(laneDir, f), 'utf8');
    const anchors = [...text.matchAll(anchorRe)].map((m) => m.index);
    anchors.push(text.length);
    for (let i = 0; i < anchors.length - 1; i++) {
      const block = text.slice(anchors[i], anchors[i + 1]);
      if (normText(block).includes(t)) return { ok: true, text: block.trim(), file: f };
    }
    // 앵커가 없는 단일 포스트 파일: 파일 전체가 토픽을 담으면 통째로
    if (!anchors.length || anchors[0] === text.length) {
      if (normText(text).includes(t)) return { ok: true, text: text.trim(), file: f };
    }
  }
  return { ok: false, error: '해당 포스트의 산출 파일을 찾지 못했습니다 — 카피가 생성됐는지 확인하세요' };
}

// 카피 계약 필드: 작가들이 남긴 영문 VISUAL DIRECTION — 렌더 프롬프트의 1급 재료
function findVisualDirection(dir, lane, topic) {
  const r = findPostBlock(dir, lane, topic);
  if (!r.ok) return null;
  const m = r.text.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?VISUAL DIRECTION(?:\*\*)?\s*[:：]\s*(.+(?:\n(?![A-Z*#-]).+)*)/im);
  return m ? m[1].replace(/\n\s*/g, ' ').trim().slice(0, 600) : null;
}

module.exports = { findPostBlock, findVisualDirection, normText };
