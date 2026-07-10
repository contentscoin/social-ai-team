// OpenCrab MCP 클라이언트 — opencrab.sh의 팩 마켓에서 프롬프트/이미지/영상 팩을 검색·로드한다.
// 프로토콜: JSON-RPC 2.0 (initialize → tools/call). 엔드포인트는 사용자 시크릿
// (settings → 렌더 → OpenCrab, 예: https://opencrab.sh/api/mcp/<token>).
// 로드한 팩은 ~/.social-ai-team/packs/에 저장돼 promptlab 컴파일러가 참조한다.
const secrets = require('./secrets');
const promptlab = require('./promptlab');

async function rpc(endpoint, id, method, params, timeoutMs = 30_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`MCP 호출 실패 (HTTP ${res.status})`);
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error.message || 'MCP 오류');
    return payload.result;
  } finally { clearTimeout(t); }
}

function endpointOrThrow() {
  const ep = secrets.get('opencrab').endpoint;
  if (!ep) throw new Error('OpenCrab MCP 엔드포인트가 없습니다 — 설정 → 렌더에서 입력하세요');
  let u;
  try { u = new URL(ep); } catch { throw new Error('엔드포인트 URL 형식이 올바르지 않습니다'); }
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) throw new Error('HTTPS 엔드포인트만 지원합니다');
  return ep;
}

async function init(ep) {
  return rpc(ep, 1, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'social-ai-team-desktop', version: '0.11.0' },
  });
}
function textOf(result) {
  const item = result && result.content && result.content.find((c) => c.type === 'text' && c.text);
  return item ? item.text : null;
}

// 팩 검색 — 기본 질의는 프롬프트/이미지/영상 관련
async function search(query) {
  const ep = endpointOrThrow();
  await init(ep);
  const result = await rpc(ep, 2, 'tools/call', {
    name: 'opencrab_search_packs',
    arguments: query && query.trim() ? { query: query.trim() } : {},
  });
  if (result.isError) throw new Error('OpenCrab 검색 도구가 오류를 반환했습니다');
  const text = textOf(result);
  if (!text) throw new Error('검색 응답에 텍스트 결과가 없습니다');
  const payload = JSON.parse(text);
  const packs = (Array.isArray(payload.packs) ? payload.packs : []).map((p) => ({
    id: p.package_id || p.id || '',
    title: p.title || '(제목 없음)',
    category: p.category || 'general',
    description: p.description || '',
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [],
    docs: (p.snapshot && p.snapshot.documents) || p.docs || 0,
  }));
  return { ok: true, total: payload.total || packs.length, packs };
}

// 팩 내용 로드 — 서버의 콘텐츠 도구를 탐색해 시도, 없으면 메타데이터를 참조 노트로 저장
const CONTENT_TOOL_CANDIDATES = /get_pack|pack_content|export_pack|pack_docs|fetch_pack|load_pack|pack_detail/i;
async function load(pack) {
  const ep = endpointOrThrow();
  await init(ep);
  let tools = [];
  try {
    const tl = await rpc(ep, 3, 'tools/list', {});
    tools = (tl && tl.tools) || [];
  } catch { /* tools/list 미지원 서버 */ }
  const contentTool = tools.find((t) => CONTENT_TOOL_CANDIDATES.test(t.name || ''));
  let body = '';
  let via = 'metadata';
  if (contentTool) {
    try {
      const result = await rpc(ep, 4, 'tools/call', {
        name: contentTool.name,
        arguments: { package_id: pack.id, id: pack.id },
      }, 60_000);
      const text = textOf(result);
      if (text && !result.isError) { body = text.slice(0, 400 * 1024); via = contentTool.name; }
    } catch { /* 메타데이터 폴백 */ }
  }
  if (!body) {
    body = `# ${pack.title} (OpenCrab 팩 — 메타데이터)\n\n` +
      `- 카테고리: ${pack.category}\n- 태그: ${(pack.tags || []).join(', ')}\n- 문서 수: ${pack.docs}\n\n${pack.description}\n\n` +
      `(이 서버는 팩 본문 도구를 제공하지 않아 메타데이터만 저장했습니다. 컴파일러가 참조 노트로 사용합니다.)`;
  }
  const saved = promptlab.savePack(`opencrab-${pack.title}`, body);
  return { ok: true, file: saved.file, via };
}

module.exports = { search, load };
