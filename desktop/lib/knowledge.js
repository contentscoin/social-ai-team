// 지식 베이스 — OpenCrab에서 가져온 프로젝트/워크플로우/문서를 클라이언트의
// context/knowledge/ 에 저장하고, 모든 LLM 작업(파이프라인·채팅·컴파일·전략·온보딩)이
// 참조하도록 프롬프트 주입 헬퍼(hint/excerpt)를 제공한다.
const fs = require('fs');
const path = require('path');

const REL = path.join('context', 'knowledge');
const FILE_CAP = 512 * 1024; // 지식 문서는 참조 노트다 — 거대 파일 금지

function dirOf(dir) { return path.join(dir, 'context', 'knowledge'); }

function safeName(name, fallback) {
  return String(name).replace(/[^\w가-힣 .-]/g, '').trim().slice(0, 60) || fallback;
}

// kind: 'project' | 'workflow' | 'doc' — 파일명 규약 opencrab-<kind>-<이름>.md
function save(dir, kind, name, body) {
  const d = dirOf(dir);
  fs.mkdirSync(d, { recursive: true });
  const file = `opencrab-${kind}-${safeName(name, kind)}.md`;
  fs.writeFileSync(path.join(d, file), String(body).slice(0, FILE_CAP));
  return { ok: true, file, rel: path.join(REL, file) };
}

function list(dir) {
  try {
    return fs.readdirSync(dirOf(dir)).filter((f) => /\.md$/i.test(f)).map((f) => {
      const p = path.join(dirOf(dir), f);
      const text = fs.readFileSync(p, 'utf8');
      const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/i, '');
      const kind = (f.match(/^opencrab-(project|workflow|doc)-/i) || [])[1] || 'doc';
      return { file: f, title: title.trim().slice(0, 80), kind, chars: text.length };
    });
  } catch { return []; }
}

function remove(dir, file) {
  const p = path.join(dirOf(dir), path.basename(file)); // 경로 탈출 방지
  try { fs.unlinkSync(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// 파일을 직접 읽을 수 있는 claude 작업용 — 지식이 있을 때만 한 줄 지시를 덧붙인다
function hint(dir) {
  const items = list(dir);
  if (!items.length) return '';
  const names = items.slice(0, 8).map((i) => i.file).join(', ');
  return `\n\n[지식 베이스] context/knowledge/ 에 OpenCrab에서 가져온 지식 문서 ${items.length}개가 있다 (${names}${items.length > 8 ? ' 외' : ''}). ` +
    '이번 작업과 관련된 내용(전략·톤·포맷·워크플로우 등)이 있으면 반드시 읽고 반영하라.';
}

// 파일 접근 없이 프롬프트에 인라인으로 넣는 발췌 (promptlab 컴파일 등) — 예산 내 절단
function excerpt(dir, budget = 4000) {
  let out = '';
  for (const it of list(dir)) {
    if (out.length >= budget) break;
    try {
      const text = fs.readFileSync(path.join(dirOf(dir), it.file), 'utf8');
      out += `\n\n===== KNOWLEDGE: ${it.title} (${it.kind}) =====\n` + text.slice(0, budget - out.length);
    } catch { /* skip */ }
  }
  return out.trim();
}

module.exports = { save, list, remove, hint, excerpt, REL };
