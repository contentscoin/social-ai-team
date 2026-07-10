// Persistent app log — ~/.social-ai-team/logs/app-YYYY-MM-DD.log (최근 7일 보관)
// 렌더러/메인의 오류와 실행 로그를 파일로 남겨, 사용자가 지원 요청 시 그대로 전달할 수 있게 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team', 'logs');

function today() { return new Date().toISOString().slice(0, 10); }
function file() { return path.join(DIR, `app-${today()}.log`); }

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    const keep = 7;
    const files = fs.readdirSync(DIR).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(DIR, f));
  } catch { /* best effort */ }
}

function write(source, line) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    cleanup();
    fs.appendFileSync(file(), `${new Date().toISOString()} [${source}] ${String(line).slice(0, 4000)}\n`);
  } catch { /* logging must never throw */ }
}

function tailOf(p, maxBytes) {
  try {
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}
// 신고용 복사 — 자정 직후에도 재현 정보가 잘리지 않게 어제+오늘을 합쳐 최대 256KB
function tail(maxBytes = 256 * 1024) {
  const y = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const parts = [
    tailOf(path.join(DIR, `app-${y}.log`), Math.floor(maxBytes / 2)),
    tailOf(file(), maxBytes),
  ].filter(Boolean);
  return parts.join('\n----- (날짜 경계) -----\n').slice(-maxBytes) || '(로그 없음)';
}

module.exports = { DIR, write, tail, file };
