// 클라이언트별 채팅 기록 — ~/.social-ai-team/chatlogs/<sha1(dir)>.json
// CLI 세션은 폴더별로 살아있는데 화면 기록만 사라지는 desync를 없앤다.
// 워크스페이스 폴더에 쓰지 않는 이유: fs.watch가 보드 리빌드를 돌린다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(os.homedir(), '.social-ai-team', 'chatlogs');
const CAP = 200;

function fileFor(dir) {
  return path.join(DIR, crypto.createHash('sha1').update(String(dir)).digest('hex').slice(0, 16) + '.json');
}

function list(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(fileFor(dir), 'utf8'));
    return Array.isArray(j.messages) ? j.messages : [];
  } catch { return []; }
}

// msg: { role:'user'|'dir', text, engine?, ok? }
function append(dir, msg) {
  try {
    const messages = list(dir);
    messages.push({ ...msg, text: String(msg.text || '').slice(0, 20000), at: new Date().toISOString() });
    const trimmed = messages.slice(-CAP);
    fs.mkdirSync(DIR, { recursive: true });
    const p = fileFor(dir);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ dir, messages: trimmed }, null, 2));
    fs.renameSync(tmp, p);
  } catch { /* 기록 실패가 채팅을 막으면 안 된다 */ }
}

function clear(dir) {
  try { fs.unlinkSync(fileFor(dir)); } catch { /* no file */ }
  return { ok: true };
}

module.exports = { list, append, clear };
