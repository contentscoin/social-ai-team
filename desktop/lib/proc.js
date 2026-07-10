// Shared process runner — GUI apps don't inherit the terminal PATH, and Node's
// spawn(shell:true) joins args WITHOUT quoting. Both bite hard on Windows.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const HOME = os.homedir();

function extraDirs() {
  const d = [];
  if (isWin) {
    if (process.env.APPDATA) d.push(path.join(process.env.APPDATA, 'npm'));
    d.push(path.join(HOME, '.local', 'bin'));
    if (process.env.LOCALAPPDATA) d.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs'));
    d.push('C:\\Program Files\\nodejs');
  } else {
    d.push('/usr/local/bin', '/opt/homebrew/bin');
    d.push(path.join(HOME, '.local', 'bin'), path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.claude', 'local'));
  }
  return d.filter((x) => { try { return fs.existsSync(x); } catch { return false; } });
}

function envWithPath(extra = {}) {
  const sep = isWin ? ';' : ':';
  const PATH = [...extraDirs(), process.env.PATH || process.env.Path || ''].join(sep);
  const env = { ...process.env, PATH, ...extra };
  if (isWin) env.Path = PATH;
  // extra values of undefined mean "remove this var" (e.g. drop a stale API key)
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env;
}

// Absolute path of a CLI if we can find it in the usual install dirs; else null (PATH fallback).
function resolveCmd(name) {
  const exts = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of extraDirs()) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* skip */ }
    }
  }
  return null;
}

function quoteArg(s) {
  s = String(s);
  if (isWin) {
    // cmd.exe는 따옴표 안에서도 개행에서 명령을 끊는다 — 개행 인자는 stdinText로 가야
    // 하지만, 실수로 들어와도 명령 주입이 되지 않게 공백으로 방어 치환한다.
    s = s.replace(/\r?\n/g, ' ');
    // CommandLineToArgvW rules: double embedded quotes inside a quoted arg.
    return /[ \t"&|<>^()%!;,=]/.test(s) || s === '' ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  return /[^\w@%+=:,./-]/.test(s) || s === '' ? "'" + s.replace(/'/g, "'\\''") + "'" : s;
}

// 살아있는 자식 프로세스 레지스트리 — 앱 종료 시 고아로 남기지 않는다 (main의 before-quit이 killAll 호출)
const liveChildren = new Set();
function killTree(child) {
  try {
    // Windows: 셸만 죽이면 손자(claude/codex/npm)가 살아남아 파이프를 물고 있다 — 트리째 종료
    if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill();
  } catch { /* already gone */ }
}
function killAll() { for (const c of [...liveChildren]) killTree(c); }

// Run `name args...` through the platform shell with real quoting and an augmented PATH.
// Resolves {ok, code, out, tail, cmd, timedOut?}. Never rejects.
// opts.stdinText — 프롬프트 등 자유 텍스트는 반드시 이걸로 전달할 것: Windows cmd.exe는
// 따옴표 안에서도 개행에서 명령을 끊고 %VAR%를 확장하므로, 개행/퍼센트가 있는 텍스트를
// 인자로 넘기면 잘리거나 주입된다. stdin은 셸을 거치지 않아 안전하다.
function runCmd(name, args, onLine, opts = {}) {
  const cmd = opts.absolute || resolveCmd(name) || name;
  const line = [quoteArg(cmd), ...args.map(quoteArg)].join(' ');
  return new Promise((resolve) => {
    let child;
    let settled = false;
    const settle = (r) => { if (settled) return; settled = true; if (child) liveChildren.delete(child); resolve(r); };
    const hasStdin = opts.stdinText != null;
    try {
      child = spawn(line, [], {
        shell: true,
        windowsHide: true,
        env: envWithPath(opts.env || {}),
        cwd: opts.cwd,
        stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      settle({ ok: false, code: -1, out: e.message, tail: e.message, cmd });
      return;
    }
    liveChildren.add(child);
    if (hasStdin) {
      // EPIPE는 비동기 'error' 이벤트로 온다 — 리스너가 없으면 프로세스가 통째로 죽는다
      // (CLI 미설치로 즉시 종료된 셸에 프롬프트를 쓰는 순간 발생)
      child.stdin.on('error', () => { /* 이미 닫힌 stdin — close 핸들러가 실패를 보고한다 */ });
      try { child.stdin.write(String(opts.stdinText)); child.stdin.end(); } catch { /* closed early */ }
    }
    let out = '';
    let timedOut = false;
    // stream-json 등 라인 프로토콜을 위해 청크 경계에서 라인이 쪼개지지 않게 스트림별로 버퍼링
    const OUT_CAP = 1536 * 1024;
    const append = (text) => {
      out += text;
      if (out.length > OUT_CAP) out = '…(앞부분 생략)…\n' + out.slice(-(OUT_CAP - 64 * 1024));
    };
    let restOut = '', restErr = '';
    const feed = (which) => (buf) => {
      const text = buf.toString();
      append(text);
      if (!onLine) return;
      const parts = ((which === 'e' ? restErr : restOut) + text).split(/\r?\n/);
      const rest = parts.pop();
      if (which === 'e') restErr = rest; else restOut = rest;
      parts.filter(Boolean).forEach((l) => onLine(l));
    };
    child.stdout.on('data', feed('o'));
    child.stderr.on('data', feed('e'));
    const flushRest = () => {
      if (!onLine) return;
      for (const rest of [restOut, restErr]) if (rest && rest.trim()) onLine(rest);
      restOut = restErr = '';
    };
    if (opts.timeoutMs) setTimeout(() => {
      if (settled) return;
      timedOut = true;
      if (onLine) onLine(`[timeout ${opts.timeoutMs}ms — 프로세스 종료]`);
      killTree(child);
      // 손자가 파이프를 물고 살아남으면 close가 영영 안 온다 — 5초 후 강제 resolve
      setTimeout(() => settle({
        ok: false, code: -1, timedOut: true, out,
        tail: (out + `\n[timeout: ${opts.timeoutMs}ms — 강제 종료]`).slice(-500), cmd,
      }), 5000);
    }, opts.timeoutMs);
    child.on('error', (e) => settle({ ok: false, code: -1, out: out + e.message, tail: (out + e.message).slice(-500), cmd }));
    // 주의: 결과 객체는 IPC로 렌더러에 그대로 전달된다 — ChildProcess 같은
    // 직렬화 불가 핸들을 넣으면 "An object could not be cloned"로 죽는다
    child.on('close', (code) => {
      flushRest();
      settle({
        ok: code === 0 && !timedOut, code, timedOut, out,
        tail: (timedOut ? out + `\n[timeout: ${opts.timeoutMs}ms]` : out).slice(-500), cmd,
      });
    });
    if (opts.onSpawn) opts.onSpawn(child);
  });
}

module.exports = { isWin, extraDirs, envWithPath, resolveCmd, quoteArg, runCmd, killTree, killAll };
