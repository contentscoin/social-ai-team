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

// ---- 쓰기 경로: 프로젝트 생성 + 전략 인제스트 -----------------------------------------
// 주의: 검증된 opencrab.sh 클라이언트는 전부 읽기 전용(opencrab_search_packs)이라, 쓰기 도구
// 이름을 하드코딩하지 않는다. tools/list로 발견해 이름/스키마 패턴으로 매칭하고, 없으면
// 정직하게 "이 엔드포인트는 읽기 전용 — 팩 업로드(CLI)로 인제스트" 안내로 폴백한다.
async function listTools(ep) {
  try { const tl = await rpc(ep, 3, 'tools/list', {}); return (tl && tl.tools) || []; }
  catch { return []; }
}
function schemaProps(t) { return (t && t.inputSchema && t.inputSchema.properties) || {}; }
function pickTool(tools, nameRe, opts = {}) {
  const cands = tools.filter((t) => nameRe.test(String(t.name || '')));
  // 본문 필드(text/content/document/source)가 있는 도구를 우선
  if (opts.needsBody) {
    const withBody = cands.find((t) => Object.keys(schemaProps(t)).some((k) => /text|content|document|body|source/i.test(k)));
    if (withBody) return withBody;
  }
  return cands[0] || null;
}
async function callTool(ep, name, args, id = 5) {
  const result = await rpc(ep, id, 'tools/call', { name, arguments: args });
  if (result && result.isError) throw new Error(`${name} 도구 오류`);
  const text = textOf(result);
  try { return text ? JSON.parse(text) : (result || {}); } catch { return { raw: text }; }
}

// 프로젝트(팩) 생성 시도 — 발견된 create 도구가 있으면 호출, 없으면 null(폴백)
async function createProject(name, meta) {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const createT = pickTool(tools, /(create|new)[_-]?(pack|project|kb|knowledge|base|space)/i);
  if (!createT) return { ok: false, unsupported: true, tools: tools.map((t) => t.name), error: '이 엔드포인트에 프로젝트/팩 생성 도구가 없습니다 (읽기 전용일 수 있음)' };
  const props = schemaProps(createT);
  const args = {};
  // 스키마의 title/name/category/description 필드에 맞춰 채운다
  for (const [k] of Object.entries(props)) {
    if (/title|name/i.test(k)) args[k] = name;
    else if (/desc/i.test(k)) args[k] = meta && meta.description || `${name} — 소셜 콘텐츠 전략 지식팩`;
    else if (/categor/i.test(k)) args[k] = meta && meta.category || 'social-strategy';
    else if (/visib/i.test(k)) args[k] = 'private';
  }
  if (!Object.keys(args).length) args.title = name;
  const res = await callTool(ep, createT.name, args, 6);
  const id = res.package_id || res.project_id || res.id || res.pack_id || res.space || null;
  return { ok: true, tool: createT.name, id, raw: res };
}

// 전략 문서 인제스트 — 발견된 ingest/add 도구로 문서를 하나씩 올린다
async function ingest(items, projectId) {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const ingestT = pickTool(tools, /(ingest|add|upsert|import|upload)[_-]?(doc|document|content|text|node|pack)?/i, { needsBody: true });
  if (!ingestT) {
    return { ok: false, unsupported: true, tools: tools.map((t) => t.name), ingested: 0,
      error: '이 엔드포인트에 인제스트(쓰기) 도구가 없습니다 — opencrab.sh는 읽기 전용일 수 있습니다. 이 경우 전략 파일은 로컬(context/strategy/)에 남고, OpenCrab CLI의 팩 업로드로 올려야 합니다.' };
  }
  const props = schemaProps(ingestT);
  const keys = Object.keys(props);
  const bodyKey = keys.find((k) => /text|content|document|body/i.test(k)) || 'text';
  // 대상 프로젝트 필드를 먼저 확정 — pack/project/space/tenant/kb
  const projKey = keys.find((k) => /pack|project|space|tenant|kb/i.test(k));
  // 소스 필드는 projKey와 겹치지 않게: source 우선, 그다음 순수 id/title/name (단 projKey 제외)
  const srcKey = keys.find((k) => /source/i.test(k))
    || keys.find((k) => k !== projKey && k !== bodyKey && /(^|_)(id|title|name)$/i.test(k))
    || keys.find((k) => k !== projKey && k !== bodyKey && /source|id|title|name/i.test(k));
  const LIMIT = 200 * 1024;
  let ok = 0, truncated = 0; const fails = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const full = String(it.text || '');
    const body = full.length > LIMIT ? full.slice(0, LIMIT) : full;
    if (full.length > LIMIT) truncated++;
    const args = { [bodyKey]: body };
    if (srcKey && srcKey !== projKey) args[srcKey] = it.source || it.title || `doc-${i + 1}`;
    if (projKey && projectId) args[projKey] = projectId;
    if (props.metadata) args.metadata = { title: it.title, kind: it.kind, channel: it.channel, topic: it.topic };
    // id 충돌 방지 — init(1)/list(3)/create(6)와 안 겹치게 20부터
    try { await callTool(ep, ingestT.name, args, 20 + i); ok++; }
    catch (e) { fails.push(`${it.title || i}: ${e.message}`); }
  }
  return { ok: ok > 0, tool: ingestT.name, ingested: ok, total: items.length, fails, truncated,
    note: truncated ? `${truncated}개 문서가 200KB로 잘렸습니다` : undefined };
}

// ---- 프로젝트·워크플로우 단위 가져오기 ------------------------------------------------
// 서버마다 도구 이름이 다르다(opencrab_project_manage / list_workflows 등) — 팩과 동일하게
// tools/list 발견 기반으로 매칭하고, manage형 도구는 action 필드에 동사를 채운다.
function fillAction(props, args, verb) {
  const key = Object.keys(props).find((k) => /^(action|operation|op|mode|command)$/i.test(k));
  if (!key) return;
  const en = props[key] && props[key].enum;
  if (Array.isArray(en) && en.length) {
    const hit = en.find((v) => new RegExp(verb, 'i').test(String(v)));
    args[key] = hit || en[0];
  } else args[key] = verb;
}
// 응답에서 엔티티 배열을 관대하게 찾는다 — 최상위 배열 또는 이름이 맞는 첫 배열 필드
function pickArray(res, keyRe) {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== 'object') return [];
  for (const [k, v] of Object.entries(res)) if (keyRe.test(k) && Array.isArray(v)) return v;
  for (const v of Object.values(res)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
}
function normEntity(p) {
  return {
    id: String(p.project_id || p.workflow_id || p.package_id || p.id || p.slug || p.name || ''),
    name: String(p.name || p.title || '(이름 없음)').slice(0, 120),
    description: String(p.description || p.summary || '').slice(0, 300),
    docs: p.documents || p.docs || p.doc_count || p.nodes || 0,
  };
}

async function listProjects() {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const t = pickTool(tools, /list[_-]?projects?\b/i) || pickTool(tools, /project[_-]?(manage|list)/i);
  if (!t) return { ok: false, unsupported: true, error: '이 엔드포인트에 프로젝트 목록 도구가 없습니다', tools: tools.map((x) => x.name) };
  const args = {};
  fillAction(schemaProps(t), args, 'list');
  const res = await callTool(ep, t.name, args, 7);
  const projects = pickArray(res, /projects?|items|packs|results|data/i).map(normEntity).filter((p) => p.id || p.name);
  return { ok: true, tool: t.name, projects };
}

async function listWorkflows() {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const t = pickTool(tools, /list[_-]?workflows?\b/i) || pickTool(tools, /workflow[_-]?(manage|list)/i);
  if (!t) return { ok: false, unsupported: true, error: '이 엔드포인트에 워크플로우 목록 도구가 없습니다', tools: tools.map((x) => x.name) };
  const args = {};
  fillAction(schemaProps(t), args, 'list');
  const res = await callTool(ep, t.name, args, 8);
  const workflows = pickArray(res, /workflows?|items|results|data/i).map(normEntity).filter((w) => w.id || w.name);
  return { ok: true, tool: t.name, workflows };
}

// 스키마 키에 프로젝트/워크플로우 id를 실어 보낸다 — 필드명이 서버마다 달라 패턴 매칭
function fillId(props, args, idRe, value) {
  const key = Object.keys(props).find((k) => idRe.test(k));
  if (key) args[key] = value;
  return key;
}

const BODY_CAP = 400 * 1024;
const DOC_LIMIT = 30;

// 프로젝트의 문서/노드를 모아 markdown 지식 문서 하나로 조립한다.
// 경로: 문서 목록/검색 도구 → (있으면) 문서별 본문 도구 → 메타데이터 폴백.
async function fetchProject(project) {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const listT = pickTool(tools, /(list|search)[_-]?(documents?|docs|sources?|nodes?)\b/i);
  let body = '';
  let via = 'metadata';
  let count = 0;
  if (listT) {
    const props = schemaProps(listT);
    const args = {};
    fillAction(props, args, 'list');
    const projKey = fillId(props, args, /project|pack|space|tenant|kb/i, project.id || project.name);
    // 검색형 도구는 질의가 필수일 수 있다 — 프로젝트명을 질의로
    if (Object.keys(props).some((k) => /^(query|q|search)$/i.test(k)) && !projKey) {
      args[Object.keys(props).find((k) => /^(query|q|search)$/i.test(k))] = project.name;
    } else if (props.query) args.query = args.query || project.name;
    try {
      const res = await callTool(ep, listT.name, args, 9);
      const docs = pickArray(res, /documents?|docs|sources?|nodes?|items|results/i).slice(0, DOC_LIMIT);
      const getT = pickTool(tools, /get[_-]?(node[_-]?context|documents?|docs?|source)\b/i);
      for (let i = 0; i < docs.length && body.length < BODY_CAP; i++) {
        const d = docs[i];
        const title = d.title || d.name || d.source || d.id || `문서 ${i + 1}`;
        let text = String(d.text || d.content || d.body || d.summary || d.snippet || '');
        if (getT && d.id) {
          try {
            const gp = schemaProps(getT);
            const ga = {};
            fillId(gp, ga, /(^|_)(id|node|document|doc)/i, d.id);
            fillId(gp, ga, /project|pack|space|tenant|kb/i, project.id || project.name);
            const full = await callTool(ep, getT.name, ga, 40 + i);
            const fullText = typeof full === 'string' ? full
              : String(full.text || full.content || full.context || full.body || (full.raw || ''));
            if (fullText && fullText.length > text.length) text = fullText;
          } catch { /* 목록의 요약으로 진행 */ }
        }
        if (!text) continue;
        body += `\n\n## ${title}\n${text.slice(0, BODY_CAP - body.length)}`;
        count++;
      }
      if (count) via = listT.name;
    } catch { /* 메타데이터 폴백 */ }
  }
  if (!body) {
    body = `\n\n- id: ${project.id || '-'}\n- 문서 수: ${project.docs || '-'}\n\n${project.description || ''}\n\n` +
      `(이 서버에서 프로젝트 문서를 읽을 수 없어 메타데이터만 저장했습니다.)`;
  }
  const header = `# ${project.name} (OpenCrab 프로젝트)\n\n> 출처: OpenCrab MCP · 도구 ${via} · 가져온 시각 ${new Date().toISOString()}\n`;
  return { ok: true, title: project.name, body: header + body, via, docs: count };
}

// 워크플로우 정의를 가져와 markdown 지식 문서로 저장할 본문을 만든다.
async function fetchWorkflow(workflow) {
  const ep = endpointOrThrow();
  await init(ep);
  const tools = await listTools(ep);
  const t = pickTool(tools, /(get|export|detail)[_-]?workflows?\b/i) || pickTool(tools, /workflow[_-]?(manage|get|detail|export)/i);
  let body = '';
  let via = 'metadata';
  if (t) {
    try {
      const props = schemaProps(t);
      const args = {};
      fillAction(props, args, 'get|export|show|detail');
      fillId(props, args, /workflow|(^|_)id$|name/i, workflow.id || workflow.name);
      const res = await callTool(ep, t.name, args, 10);
      const text = typeof res === 'string' ? res
        : (res.raw || (Object.keys(res).length ? '```json\n' + JSON.stringify(res, null, 2).slice(0, BODY_CAP) + '\n```' : ''));
      if (text) { body = `\n\n## 워크플로우 정의\n${String(text).slice(0, BODY_CAP)}`; via = t.name; }
    } catch { /* 메타데이터 폴백 */ }
  }
  if (!body) {
    body = `\n\n- id: ${workflow.id || '-'}\n\n${workflow.description || ''}\n\n` +
      `(이 서버에서 워크플로우 정의를 읽을 수 없어 메타데이터만 저장했습니다.)`;
  }
  const header = `# ${workflow.name} (OpenCrab 워크플로우)\n\n> 출처: OpenCrab MCP · 도구 ${via} · 가져온 시각 ${new Date().toISOString()}\n`;
  return { ok: true, title: workflow.name, body: header + body, via };
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

module.exports = { search, load, createProject, ingest, listProjects, listWorkflows, fetchProject, fetchWorkflow };
