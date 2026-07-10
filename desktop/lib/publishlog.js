// Manual publish log — context/publish-log.json: { published: { [uid]: iso } }
// 수동 발행 채널(네이버 등)에서 "발행함" 체크의 영속 기록. 보드 카드에 발행 칩으로 반영.
const fs = require('fs');
const path = require('path');

function file(dir) { return path.join(dir, 'context', 'publish-log.json'); }
function load(dir) {
  const p = file(dir);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    // 파일이 있는데 깨졌으면 조용히 빈 값으로 덮지 말고 백업 후 새로 시작
    if (fs.existsSync(p)) { try { fs.renameSync(p, p + '.corrupt-' + Date.now()); } catch { /* best effort */ } }
    return { published: {} };
  }
}
function mark(dir, uid, on) {
  const log = load(dir);
  log.published = log.published || {};
  if (on) log.published[uid] = new Date().toISOString();
  else delete log.published[uid];
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  // 원자적 교체 — watch 디바운스로 도는 buildBoard가 부분 기록을 읽지 않게
  const tmp = file(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2));
  fs.renameSync(tmp, file(dir));
  return log;
}
module.exports = { load, mark };
