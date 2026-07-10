// 오토파일럿 — 승인 게이트 앞까지 파이프라인 단계를 자동으로 이어 달린다.
// 원칙: 도장(승인)이 필요한 경계는 절대 건너뛰지 않는다. 증거가 이미 있는 단계는
// 재실행하지 않는다(재실행은 수동 버튼으로). 이미지 생성(visuals-generate)은 비용이
// 들므로 visuals 노드 도장 없이는 진입하지 않는다.
const gates = require('./gates');

const ORDER = ['calendar', 'copy', 'shortform', 'visuals', 'visuals-generate', 'compliance'];
// 단계 실행 전에 도장이 찍혀 있어야 하는 게이트 노드
const REQUIRES = {
  copy: 'calendar',
  shortform: 'copy',
  visuals: 'copy',
  'visuals-generate': 'visuals',
};
const NODE_LABEL = { calendar: '캘린더', copy: '카피', visuals: '비주얼 브리프', compliance: '컴플라이언스' };

let state = { running: false, dir: null, stage: null };
let stopped = false;

function status() { return { ...state }; }

// deps: { buildBoard(dir), runStage(dir, stage) → Promise<r>, onEvent(ev), stopStage() }
async function run(dir, deps) {
  if (state.running) return { ok: false, error: '오토파일럿이 이미 실행 중입니다' };
  state = { running: true, dir, stage: null };
  stopped = false;
  const ran = [];
  const emit = (ev) => { try { deps.onEvent && deps.onEvent({ ...ev, dir }); } catch { /* 소비자 보호 */ } };
  const finish = (result) => {
    state = { running: false, dir: null, stage: null };
    emit({ state: result.state, ...result });
    return { ok: true, ...result, ran };
  };

  emit({ state: 'start' });
  try {
    for (const stage of ORDER) {
      if (stopped) return finish({ state: 'stopped' });
      // 매 반복마다 보드/게이트를 새로 읽는다 — 직전 단계가 파일을 썼다
      const b = deps.buildBoard(dir);
      const g = gates.computeGates(b, gates.load(dir));
      const node = g.nodes.find((n) => n.stage === stage);
      if (node && node.done) { emit({ state: 'skip', stage }); continue; } // 증거 있음 — 건너뜀
      const req = REQUIRES[stage];
      if (req) {
        const reqNode = g.nodes.find((n) => n.key === req);
        if (!reqNode || !reqNode.approved) {
          return finish({
            state: 'paused', stage, needStamp: req,
            message: `${NODE_LABEL[req] || req} 승인 도장이 필요합니다. 도장을 찍고 오토파일럿을 다시 시작하세요.`,
          });
        }
      }
      state.stage = stage;
      emit({ state: 'stage', stage });
      const r = await deps.runStage(dir, stage);
      if (stopped) return finish({ state: 'stopped', stage });
      if (!r || !r.ok) {
        return finish({
          state: 'failed', stage,
          message: `${stage} 단계가 실패했습니다: ${String((r && (r.resultText || r.tail)) || '알 수 없는 오류').slice(-300)}`,
        });
      }
      ran.push(stage);
    }
    // 컴플라이언스까지 완주 — BLOCK 여부를 마지막 보드로 확인
    const b = deps.buildBoard(dir);
    const blocks = (b.compliance && b.compliance.block) || 0;
    return finish({
      state: 'done',
      message: blocks > 0
        ? `완주했지만 BLOCK ${blocks}건 — 재작업이 필요합니다. 보드에서 확인하세요.`
        : '컴플라이언스까지 완료. 발행 게이트만 남았습니다.',
    });
  } catch (e) {
    return finish({ state: 'failed', stage: state.stage, message: String(e && e.message || e) });
  }
}

function stop(stopStage) {
  stopped = true;
  try { stopStage && stopStage(); } catch { /* already gone */ }
  return { ok: true, wasRunning: state.running };
}

module.exports = { run, stop, status, ORDER };
