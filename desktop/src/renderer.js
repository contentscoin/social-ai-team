/* Renderer — talks to main via window.api (preload bridge) */
let currentClient = null;
let running = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function setBadge(li, ok) {
  const b = li.querySelector('.badge');
  b.textContent = ok ? 'OK' : '없음';
  b.className = 'badge ' + (ok ? 'ok' : 'no');
}

// ---- Setup panel ------------------------------------------------------------
async function refreshSetup() {
  const s = await window.api.setup.check();
  for (const li of $$('#setup-checks li')) setBadge(li, !!s[li.dataset.k]);
  $('#btn-install-codex').disabled = s.codex;
  $('#btn-codex-login').disabled = !s.codex || s.codexAuthed;
}

function reportResult(label, r) {
  if (r.ok) {
    log('setup', `${label} 완료${r.already ? ' (이미 되어 있음)' : ''}${r.via ? ` [${r.via}]` : ''}`);
  } else {
    log('setup', `${label} 실패:`);
    log('setup', r.tail || r.out || '원인 불명 — 로그 확인');
    alert(`${label} 실패\n\n${(r.tail || r.out || '').slice(-400)}`);
  }
}

$('#btn-install-skills').onclick = async () => {
  const r = await window.api.setup.installSkills();
  if (r.ok) log('setup', `스킬 ${r.skills.length}종 + 에이전트 설치 완료`);
  else reportResult('스킬 설치', r);
  refreshSetup();
};
$('#btn-install-codex').onclick = async () => {
  const r = await window.api.setup.installCodex();
  reportResult('Codex 설치', r);
  refreshSetup();
};
$('#btn-codex-login').onclick = async () => {
  switchTab('logs');
  log('setup', 'Codex OAuth 시작 — 브라우저가 자동으로 열립니다. 안 열리면 로그의 URL을 직접 여세요.');
  const r = await window.api.setup.codexLogin();
  reportResult('Codex 로그인', r);
  refreshSetup();
};
$('#btn-register-mcp').onclick = async () => {
  switchTab('logs');
  const r = await window.api.setup.registerMcp();
  reportResult('codex MCP 등록', r);
};

// ---- Clients ------------------------------------------------------------------
async function refreshClients() {
  const clients = await window.api.ws.list();
  const ul = $('#client-list');
  ul.innerHTML = '';
  for (const c of clients) {
    const li = document.createElement('li');
    li.textContent = c.name;
    li.className = currentClient && currentClient.dir === c.dir ? 'active' : '';
    li.onclick = () => selectClient(c);
    ul.appendChild(li);
  }
}

$('#btn-new-client').onclick = async () => {
  const name = prompt('클라이언트 이름 (영문/한글):');
  if (!name) return;
  const r = await window.api.ws.create(name);
  if (r.ok) { await refreshClients(); selectClient(r); }
};
$('#btn-add-folder').onclick = async () => {
  const r = await window.api.ws.pickFolder();
  if (r && r.ok) { await refreshClients(); selectClient(r); }
};

async function selectClient(c) {
  currentClient = c;
  $('#client-name').textContent = c.name;
  $('#btn-open-folder').disabled = false;
  $('#btn-terminal').disabled = false;
  await refreshClients();
  await refreshDashboard();
  await refreshOutputs();
}

$('#btn-open-folder').onclick = () => currentClient && window.api.ws.openFolder(currentClient.dir);
$('#btn-terminal').onclick = () => currentClient && window.api.pipe.openTerminal(currentClient.dir);

// ---- Dashboard ------------------------------------------------------------------
async function refreshDashboard() {
  if (!currentClient) return;
  const s = await window.api.ws.status(currentClient.dir);
  for (const li of $$('#foundation-status li')) setBadge(li, !!s[li.dataset.k]);
  const ul = $('#workflow-items');
  ul.innerHTML = '';
  if (!s.statusItems.length) ul.innerHTML = '<li class="hint">아직 기록 없음 — 첫 단계를 실행하세요</li>';
  for (const item of s.statusItems) {
    const li = document.createElement('li');
    li.className = item.done ? 'done' : '';
    li.textContent = `${item.done ? '✅' : '⬜'} ${item.label}`;
    ul.appendChild(li);
  }
}

// ---- Stages ------------------------------------------------------------------
for (const btn of $$('#stage-buttons button')) {
  btn.onclick = async () => {
    if (!currentClient) { alert('클라이언트를 먼저 선택하세요'); return; }
    if (running) { alert('다른 단계가 실행 중입니다'); return; }
    running = true;
    btn.classList.add('running');
    $('#btn-stop').disabled = false;
    switchTab('logs');
    log(btn.dataset.stage, `▶ ${btn.textContent} 시작 — ${currentClient.name}`);
    const r = await window.api.pipe.runStage(currentClient.dir, btn.dataset.stage, {});
    log(btn.dataset.stage, r.ok ? '✔ 완료' : `✖ 종료 코드 ${r.code}`);
    running = false;
    btn.classList.remove('running');
    $('#btn-stop').disabled = true;
    await refreshDashboard();
    await refreshOutputs();
  };
}
$('#btn-stop').onclick = async () => { await window.api.pipe.stop(); };

// ---- Outputs ------------------------------------------------------------------
async function refreshOutputs() {
  if (!currentClient) return;
  const lanes = await window.api.ws.outputs(currentClient.dir);
  const box = $('#outputs-list');
  box.innerHTML = '';
  for (const [lane, files] of Object.entries(lanes)) {
    if (!files.length) continue;
    const h = document.createElement('h4');
    h.textContent = `outputs/${lane}`;
    box.appendChild(h);
    for (const rel of files) {
      const d = document.createElement('div');
      d.className = 'file';
      d.textContent = rel.split(/[\\/]/).pop();
      d.onclick = async () => {
        const r = await window.api.ws.readFile(currentClient.dir, rel);
        const pv = $('#outputs-preview');
        if (!r.ok) { pv.innerHTML = `<p class="hint">${r.error}</p>`; return; }
        pv.innerHTML = '';
        if (r.kind === 'image') {
          const img = document.createElement('img');
          img.src = r.dataUrl;
          pv.appendChild(img);
        } else {
          const pre = document.createElement('pre');
          pre.textContent = r.text;
          pv.appendChild(pre);
        }
      };
      box.appendChild(d);
    }
  }
  if (!box.children.length) box.innerHTML = '<p class="hint">산출물이 아직 없습니다</p>';
}

// ---- Tabs & logs ------------------------------------------------------------------
function switchTab(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const b of $$('.tab-body')) b.classList.toggle('active', b.id === `tab-${name}`);
}
for (const t of $$('.tab')) t.onclick = () => switchTab(t.dataset.tab);

function log(source, line) {
  const pane = $('#log-pane');
  const span = document.createElement('span');
  span.innerHTML = `<span class="src">[${source}]</span> `;
  pane.appendChild(span);
  pane.appendChild(document.createTextNode(line + '\n'));
  pane.scrollTop = pane.scrollHeight;
}
window.api.onLog(({ source, line }) => log(source, line));

// ---- boot ------------------------------------------------------------------
refreshSetup();
refreshClients();
