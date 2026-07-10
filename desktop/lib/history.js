// 실행 기록 — ~/.social-ai-team/history.json: 스테이지/채팅/오토파일럿 실행의
// 시간·소요·비용·결과를 남긴다. 워크스페이스 폴더에 쓰지 않는 이유: outputs/context에
// 쓰면 fs.watch가 보드 리빌드를 돌려 기록 한 줄마다 리렌더가 도는 루프가 생긴다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.social-ai-team');
const FILE = path.join(DIR, 'history.json');
const CAP = 500;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j.runs) ? j : { runs: [] };
  } catch { return { runs: [] }; }
}

// entry: { dir, kind:'stage'|'chat'|'autopilot', stage?, engine, model, ok, ms, costUsd?, startedAt, note? }
function append(entry) {
  try {
    const h = load();
    h.runs.push({ ...entry, at: new Date().toISOString() });
    if (h.runs.length > CAP) h.runs = h.runs.slice(-CAP);
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(h, null, 2));
    fs.renameSync(tmp, FILE);
  } catch { /* 기록 실패가 실행을 막으면 안 된다 */ }
}

// 워크스페이스별 최근 기록 + 이번 달 비용 합계
function forDir(dir, limit = 60) {
  const h = load();
  const runs = h.runs.filter((r) => r.dir === dir).slice(-limit).reverse();
  const month = new Date().toISOString().slice(0, 7);
  let monthCost = 0;
  for (const r of h.runs) {
    if (r.dir === dir && String(r.at || '').startsWith(month) && typeof r.costUsd === 'number') monthCost += r.costUsd;
  }
  return { runs, monthCost: Math.round(monthCost * 10000) / 10000 };
}

module.exports = { append, forDir };
