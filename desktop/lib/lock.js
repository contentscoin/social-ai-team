// 워크스페이스별 CLI 뮤텍스 — 같은 클라이언트 폴더에서 채팅 턴·스테이지 실행·오토파일럿이
// 동시에 CLI를 돌리면 세션/파일이 서로 밟힌다. 실행 전 acquire, finally에서 release.
const locks = new Map(); // dir -> { owner, since }

function acquire(dir, owner) {
  const cur = locks.get(dir);
  if (cur) return { ok: false, owner: cur.owner, since: cur.since };
  locks.set(dir, { owner, since: Date.now() });
  return { ok: true };
}
function release(dir, owner) {
  const cur = locks.get(dir);
  if (cur && cur.owner === owner) locks.delete(dir);
}
function holder(dir) { return locks.get(dir) || null; }

// 사용자 안내문 — 누가 잡고 있는지 한국어로
const OWNER_LABEL = { chat: '디렉터 채팅', stage: '파이프라인 단계', autopilot: '오토파일럿', onboard: '질문지 온보딩', reference: '레퍼런스 사이트 분석' };
function busyMessage(dir) {
  const h = holder(dir);
  if (!h) return null;
  const mins = Math.round((Date.now() - h.since) / 60000);
  return `${OWNER_LABEL[h.owner] || h.owner}이(가) 이미 실행 중입니다${mins >= 1 ? ` (${mins}분째)` : ''}. 끝나면 다시 시도하세요.`;
}

module.exports = { acquire, release, holder, busyMessage };
