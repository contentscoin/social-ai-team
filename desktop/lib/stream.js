// Claude stream-json(NDJSON) 이벤트 파서 — chat.js와 pipeline.js가 공유한다.
// CLI 버전에 따라 두 가지 형태가 온다:
//  (a) 완성 블록: {"type":"assistant","message":{"content":[{type:"text"|"tool_use",...}]}}
//  (b) 델타:     {"type":"stream_event","event":{"type":"content_block_delta",...}}
// 어느 쪽이 와도 onEvent로 통일된 이벤트를 흘리고, 최종 result를 수집한다.
//
// onEvent(ev) 이벤트 모양 (렌더러 chat:stream / stage 활동 피드가 소비):
//   {kind:'start', model}                     — system/init
//   {kind:'text', text}                       — 어시스턴트 텍스트 (블록 또는 델타)
//   {kind:'tool', name, target}               — 도구 실행 시작 (Write/Bash/Task…)
//   {kind:'done', ok, costUsd, durationMs}    — result 이벤트
//   {kind:'raw', text}                        — JSON이 아닌 줄 (stderr 등)

// 도구 호출을 운영자가 읽을 수 있는 한 줄로 — 활동 피드용
function toolTarget(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return String(input.file_path).split(/[\\/]/).slice(-2).join('/');
  if (input.command) return String(input.command).slice(0, 60);
  if (input.subagent_type) return `${input.subagent_type}${input.description ? ' — ' + input.description : ''}`.slice(0, 80);
  if (input.description) return String(input.description).slice(0, 80);
  if (input.pattern) return String(input.pattern).slice(0, 60);
  if (input.skill) return String(input.skill);
  return '';
}

const TOOL_LABEL = {
  Write: '파일 작성', Edit: '파일 수정', Read: '파일 읽기', Bash: '명령 실행',
  Glob: '파일 탐색', Grep: '내용 검색', Task: '에이전트 디스패치', Skill: '스킬 실행',
  WebFetch: '웹 조회', WebSearch: '웹 검색', TodoWrite: '작업 목록',
};
function toolLabel(name) { return TOOL_LABEL[name] || name; }

// 라인 파서 팩토리. 반환된 함수를 runCmd의 onLine으로 넘긴다.
// state.final 에 result 이벤트가 쌓인다 (없으면 null).
function makeParser(onEvent) {
  const state = { final: null, sessionId: null, sawStream: false, textParts: [] };
  const emit = (ev) => { try { onEvent && onEvent(ev); } catch { /* 소비자 오류는 파서를 죽이지 않는다 */ } };

  const feed = (line) => {
    let ev;
    try { ev = JSON.parse(line); } catch { emit({ kind: 'raw', text: line }); return; }
    if (!ev || typeof ev !== 'object') { emit({ kind: 'raw', text: line }); return; }
    state.sawStream = true;
    if (ev.session_id) state.sessionId = ev.session_id;

    if (ev.type === 'system' && ev.subtype === 'init') {
      emit({ kind: 'start', model: ev.model || '' });
      return;
    }
    if (ev.type === 'result') {
      state.final = ev;
      emit({ kind: 'done', ok: !ev.is_error, costUsd: ev.total_cost_usd, durationMs: ev.duration_ms });
      return;
    }
    // (a) 완성 블록 형태
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'text' && block.text) {
          state.textParts.push(block.text);
          emit({ kind: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          emit({ kind: 'tool', name: toolLabel(block.name), target: toolTarget(block.name, block.input) });
        }
      }
      return;
    }
    // (b) 델타 형태 (--include-partial-messages 계열)
    if (ev.type === 'stream_event' && ev.event) {
      const e = ev.event;
      if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') {
        emit({ kind: 'tool', name: toolLabel(e.content_block.name), target: '' });
      } else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && e.delta.text) {
        state.textParts.push(e.delta.text);
        emit({ kind: 'text', text: e.delta.text });
      }
      return;
    }
    // user(도구 결과) 등 나머지는 조용히 통과
  };

  feed.state = state;
  return feed;
}

// result 이벤트/수집 텍스트에서 최종 응답을 뽑는다 — result가 없으면 텍스트 조각 합본
function finalText(state) {
  if (state.final && typeof state.final.result === 'string' && state.final.result) return state.final.result;
  return state.textParts.join('').trim();
}

module.exports = { makeParser, finalText, toolLabel, toolTarget };
