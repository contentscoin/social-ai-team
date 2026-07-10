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
    // CommandLineToArgvW rules: double embedded quotes inside a quoted arg.
    return /[ \t"&|<>^()%!;,=]/.test(s) || s === '' ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  return /[^\w@%+=:,./-]/.test(s) || s === '' ? "'" + s.replace(/'/g, "'\\''") + "'" : s;
}

// Run `name args...` through the platform shell with real quoting and an augmented PATH.
// Resolves {ok, code, out, tail, cmd}. Never rejects.
function runCmd(name, args, onLine, opts = {}) {
  const cmd = opts.absolute || resolveCmd(name) || name;
  const line = [quoteArg(cmd), ...args.map(quoteArg)].join(' ');
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(line, [], {
        shell: true,
        windowsHide: true,
        env: envWithPath(opts.env || {}),
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'], // no stdin — headless CLIs must not wait on it
      });
    } catch (e) {
      resolve({ ok: false, code: -1, out: e.message, tail: e.message, cmd });
      return;
    }
    let out = '';
    const feed = (buf) => {
      const text = buf.toString();
      out += text;
      if (onLine) text.split(/\r?\n/).filter(Boolean).forEach((l) => onLine(l));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    if (opts.timeoutMs) setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, opts.timeoutMs);
    child.on('error', (e) => resolve({ ok: false, code: -1, out: out + e.message, tail: (out + e.message).slice(-500), cmd }));
    // 주의: 결과 객체는 IPC로 렌더러에 그대로 전달된다 — ChildProcess 같은
    // 직렬화 불가 핸들을 넣으면 "An object could not be cloned"로 죽는다
    child.on('close', (code) => resolve({ ok: code === 0, code, out, tail: out.slice(-500), cmd }));
    if (opts.onSpawn) opts.onSpawn(child);
  });
}

module.exports = { isWin, extraDirs, envWithPath, resolveCmd, quoteArg, runCmd };
