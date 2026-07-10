// Manual publish log — context/publish-log.json: { published: { [uid]: iso } }
// 수동 발행 채널(네이버 등)에서 "발행함" 체크의 영속 기록. 보드 카드에 발행 칩으로 반영.
const fs = require('fs');
const path = require('path');

function file(dir) { return path.join(dir, 'context', 'publish-log.json'); }
function load(dir) {
  try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return { published: {} }; }
}
function mark(dir, uid, on) {
  const log = load(dir);
  log.published = log.published || {};
  if (on) log.published[uid] = new Date().toISOString();
  else delete log.published[uid];
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify(log, null, 2));
  return log;
}
module.exports = { load, mark };
