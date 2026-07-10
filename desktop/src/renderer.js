/* ══ 온에어 데스크 renderer — IIFE 섹션: util/state/rail/topbar/channels/board/gates/sheets/dock/drawer/settings/boot ══ */
(() => {
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const relTime = (ms) => {
  const d = Date.now() - ms;
  if (d < 60e3) return '방금'; if (d < 3600e3) return Math.floor(d / 60e3) + '분 전';
  if (d < 86400e3) return Math.floor(d / 3600e3) + '시간 전'; return Math.floor(d / 86400e3) + '일 전';
};
const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

// ---- state --------------------------------------------------------------------
const S = {
  clients: [], client: null, board: null, prevStages: new Map(),
  gates: null, engine: 'claude', view: 'timeline',
  running: null, runStart: 0, lastRunStart: {}, runTimer: null,
  filter: null, chips: [], chatBusy: false, env: null, blotato: false,
  tickers: {}, logLines: 0,
};
const STAGE_LABEL = { planned: '기획', copy: '카피', visual: '비주얼/영상', review: '검수', ready: '발행준비' };
const STAGE2COL = { calendar: 'planned', copy: 'copy', shortform: 'visual', visuals: 'visual', 'visuals-generate': 'visual', compliance: 'review', review: 'ready' };
const CH_NAME = { instagram: '인스타그램', facebook: '페이스북', linkedin: '링크드인', threads: '스레드', x: 'X', naver: '네이버 블로그', tiktok: '틱톡', etc: '기타' };
const CH_MONO = { instagram: 'IG', facebook: 'FB', linkedin: 'IN', threads: 'TH', x: 'X', naver: 'N', tiktok: 'TT', etc: '?' };

// ---- toast / popover -------------------------------------------------------------
function toast(msg) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = msg;
  $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), 4200);
}
let popTarget = null;
function popover(anchor, html) {
  const p = $('#popover');
  if (popTarget === anchor && !p.classList.contains('hidden')) { hidePopover(); return false; }
  popTarget = anchor;
  p.innerHTML = html; p.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 12) + 'px';
  p.style.top = (r.top - p.offsetHeight - 8 > 0 ? r.top - p.offsetHeight - 8 : r.bottom + 8) + 'px';
  return true;
}
function hidePopover() { $('#popover').classList.add('hidden'); popTarget = null; }
document.addEventListener('click', (e) => { if (popTarget && !$('#popover').contains(e.target) && e.target !== popTarget && !popTarget.contains(e.target)) hidePopover(); });

// ---- overlay stack -----------------------------------------------------------------
function openSheet(id) { $('#overlay').classList.remove('hidden'); $$('#overlay > .sheet, #overlay > .fullscreen').forEach((s) => s.classList.add('hidden')); $(id).classList.remove('hidden'); }
function closeOverlay() {
  if (typeof currentStampReset === 'function') currentStampReset(); // ESC 중 도장 진행 취소
  S.approveNode = null;
  $('#overlay').classList.add('hidden'); $$('#overlay > *').forEach((s) => s.classList.add('hidden'));
}
$('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) closeOverlay(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hidePopover(); closeOverlay(); } });

// ---- rail: clients ------------------------------------------------------------------
async function refreshClients() {
  S.clients = await window.api.ws.list();
  const box = $('#rail-clients'); box.innerHTML = '';
  for (const c of S.clients) {
    const a = document.createElement('div');
    a.className = 'avatar' + (S.client && S.client.dir === c.dir ? ' active' : '');
    a.textContent = c.name.slice(0, 2).toUpperCase();
    a.title = c.name;
    a.onclick = () => {
      if (S.running) { toast('실행 중에는 클라이언트를 전환할 수 없습니다'); return; }
      if (S.chatBusy) { toast('디렉터 응답을 기다리는 중에는 전환할 수 없습니다'); return; }
      selectClient(c);
    };
    box.appendChild(a);
  }
}
$('#rail-add').onclick = (e) => {
  if (popover(e.currentTarget, `
  <div style="display:flex;flex-direction:column;gap:8px;min-width:180px">
    <button id="pop-new">+ 새 클라이언트</button>
    <button id="pop-pick">기존 폴더 추가</button>
  </div>`)) bindAddPop();
};
function bindAddPop() {
  // Electron 렌더러에는 window.prompt가 없다 — 팝오버 인라인 입력 사용
  $('#pop-new').onclick = () => {
    $('#popover').innerHTML = `<b>새 클라이언트</b>
      <input id="pop-name" placeholder="이름 (영문/한글)" style="width:100%;margin-top:8px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--text);font-size:12.5px">
      <button id="pop-create" style="margin-top:8px;width:100%">만들기</button>`;
    const go = async () => {
      const name = $('#pop-name').value.trim();
      if (!name) return;
      hidePopover();
      const r = await window.api.ws.create(name);
      if (r.ok) { await refreshClients(); selectClient(r); }
      else toast('생성 실패: ' + (r.error || '이름을 확인하세요'));
    };
    $('#pop-create').onclick = go;
    $('#pop-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#pop-name').focus();
  };
  $('#pop-pick').onclick = async () => {
    hidePopover();
    const r = await window.api.ws.pickFolder();
    if (r && r.ok) { await refreshClients(); selectClient(r); }
  };
}
$('#rail-folder').onclick = () => S.client && window.api.ws.openFolder(S.client.dir);
$('#rail-term').onclick = () => S.client && window.api.pipe.openTerminal(S.client.dir);
$('#rail-settings').onclick = () => openSettings();

async function selectClient(c) {
  S.client = c; S.filter = null; S.prevStages = new Map();
  $('#tb-name').textContent = c.name;
  $('#tb-path').textContent = c.dir;
  $('#rail-folder').disabled = $('#rail-term').disabled = false;
  $('#chat-log').innerHTML = ''; S.chips = []; renderChips();
  await refreshClients();
  await window.api.ws.watch(c.dir);
  await refreshBoard(true);
}

// ---- topbar -------------------------------------------------------------------------
for (const b of $$('#view-seg button')) b.onclick = () => {
  S.view = b.dataset.view;
  $$('#view-seg button').forEach((x) => x.classList.toggle('active', x === b));
  renderHero(); // 뷰 표시/숨김의 단일 진실 공급원 (히어로 상태 존중)
};
for (const b of $$('#engine-seg button')) b.onclick = async () => {
  if (S.running) { toast('실행 중에는 엔진을 바꿀 수 없습니다'); return; }
  S.engine = await window.api.engine.set(b.dataset.engine);
  applyEngine();
};
function applyEngine() {
  $$('#engine-seg button').forEach((x) => x.classList.toggle('active', x.dataset.engine === S.engine));
  const m = (S.models || {})[S.engine];
  $('#dock-engine').textContent = (S.engine === 'codex' ? 'Codex' : 'Claude') + (m ? ` · ${m}` : '');
}
$('#tb-update').onclick = () => window.api.update.install();
$('#tb-drawer').onclick = () => openDrawer();

function setRunning(stage) {
  S.running = stage;
  $('#tb-running').classList.toggle('hidden', !stage);
  if (stage) {
    S.runStart = Date.now();
    clearInterval(S.runTimer);
    S.runTimer = setInterval(() => {
      const d = fmtDur(Date.now() - S.runStart);
      $('#tb-running-label').textContent = `${stage} 실행 중 · ${d}`;
      const ctaLabel = $('#gate-cta span');
      if (S.running && ctaLabel) ctaLabel.textContent = `중지 · ${d}`;
    }, 1000);
    $('#tb-running-label').textContent = `${stage} 실행 중`;
  } else clearInterval(S.runTimer);
  renderGateBar();
}

// ---- channels (존 A) -------------------------------------------------------------------
function donutSVG(pass, warn, block, size = 40) {
  const total = Math.max(pass + warn + block, 1);
  const C = 2 * Math.PI * 15;
  let off = 0;
  const seg = (n, color) => {
    const len = (n / total) * C;
    const s = `<circle cx="20" cy="20" r="15" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 20 20)"/>`;
    off += len; return n ? s : '';
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="var(--raised)" stroke-width="6"/>${seg(pass, 'var(--ok)')}${seg(warn, 'var(--warn)')}${seg(block, 'var(--bad)')}</svg>`;
}
function sparkSVG(posts, chKey) {
  const weeks = [0, 0, 0, 0, 0];
  for (const p of posts) { const w = parseInt(p.week) || 1; if (p.channel === chKey) weeks[Math.min(w, 5) - 1]++; }
  const max = Math.max(...weeks, 1);
  return `<svg width="80" height="22" viewBox="0 0 80 22">${weeks.map((v, i) =>
    `<rect x="${i * 16 + 2}" y="${20 - (v / max) * 16}" width="10" height="${(v / max) * 16 + 1}" rx="2" fill="var(--accent)" opacity="${v ? .85 : .18}"/>`).join('')}</svg>`;
}
function renderChannels() {
  const b = S.board; if (!b) return;
  $('#ct-count').textContent = b.posts.length || '–';
  $('#ct-donut').innerHTML = donutSVG(b.compliance.pass, b.compliance.warn, b.compliance.block);
  const ready = b.posts.filter((p) => p.stage === 'ready').length;
  $('#ct-ready').innerHTML = `<span style="color:var(--ok)">발행준비 ${ready}</span> / ${b.posts.length}`;
  $('#client-tile').onclick = () => setFilter(null);

  const box = $('#channel-scroll'); box.innerHTML = '';
  for (const ch of b.channels) {
    const el = $('#tpl-channel-card').content.firstElementChild.cloneNode(true);
    const color = `var(--ch-${ch.key})`;
    el.dataset.ch = ch.key;
    const tile = $('.mono-tile', el);
    tile.textContent = CH_MONO[ch.key] || '?';
    tile.style.background = `color-mix(in srgb, ${color} 16%, transparent)`;
    tile.style.color = color;
    $('.cc-name', el).textContent = CH_NAME[ch.key] || ch.key;
    const badge = $('.cc-badge', el);
    if (ch.publishRoute === 'manual') { badge.textContent = '수동 발행'; }
    else if (S.blotato) { badge.textContent = 'Blotato 자동'; badge.style.color = 'var(--ok)'; }
    else { badge.textContent = '연결 필요'; badge.style.color = 'var(--warn)'; el.classList.add('unplugged'); }
    $('.cc-count', el).textContent = ch.posts;
    $('.cc-ready', el).textContent = `발행준비 ${ch.byStage.ready}`;
    $('.cc-meter', el).innerHTML = S.board.stages.map((s) =>
      `<span class="m-${s}" style="width:${(ch.byStage[s] / ch.posts) * 100}%"></span>`).join('');
    $('.cc-spark', el).innerHTML = sparkSVG(b.posts, ch.key);
    $('.cc-dots', el).innerHTML = (ch.warn ? `<span class="dot WARN" title="WARN ${ch.warn}"></span>` : '') + (ch.block ? `<span class="dot BLOCK" title="BLOCK ${ch.block}"></span>` : '');
    const f = ch.files[0];
    $('.cc-row5', el).textContent = f ? `${f.name} · ${relTime(f.mtime)}` : '산출물 없음';
    el.classList.toggle('focus', S.filter === ch.key);
    el.classList.toggle('dim', !!S.filter && S.filter !== ch.key);
    el.onclick = () => setFilter(S.filter === ch.key ? null : ch.key);
    box.appendChild(el);
  }
  const ghost = document.createElement('button');
  ghost.className = 'ghost-card';
  ghost.innerHTML = `<svg><use href="#i-plus"/></svg><span class="small">채널 연결</span>`;
  ghost.onclick = (e) => {
    if (popover(e.currentTarget, `<b>채널은 캘린더에서 자동 인식됩니다</b><p class="muted" style="margin-top:6px">콘텐츠 캘린더의 Platform 값에 새 채널을 편성하면 카드가 생깁니다.</p><button id="pop-ask" style="margin-top:10px">디렉터에게 채널 편성 요청</button>`))
      $('#pop-ask').onclick = () => { hidePopover(); prefillChat('콘텐츠 캘린더에 새 채널을 편성하고 싶어. 어떤 채널이 좋을지 제안해줘: '); };
  };
  box.appendChild(ghost);
  drawWire();
}
function setFilter(ch) {
  S.filter = ch;
  const chip = $('#tb-filter');
  chip.classList.toggle('hidden', !ch);
  if (ch) { chip.textContent = (CH_NAME[ch] || ch) + ' ×'; chip.onclick = () => setFilter(null); }
  renderChannels(); renderBoardViews(false);
}
// 발행 경로 라이브 와이어 (채널 포커스 → 게이트 '발행' 노드)
function drawWire() {
  const layer = $('#wire-layer'); layer.innerHTML = '';
  if (!S.filter) return;
  try {
    const card = $(`.channel-card[data-ch="${S.filter}"]`);
    const target = $$('.gate-node').pop();
    if (!card || !target) return;
    const zr = $('#zone-channels').getBoundingClientRect();
    const cr = card.getBoundingClientRect(); const tr = target.getBoundingClientRect();
    const x1 = cr.left + cr.width / 2 - zr.left, y1 = cr.bottom - zr.top;
    const x2 = tr.left + 12 - zr.left, y2 = zr.height + 4;
    const manual = S.board.channels.find((c) => c.key === S.filter)?.publishRoute === 'manual';
    layer.innerHTML = `<path class="wire ${manual && !S.blotato ? 'manual' : (manual ? 'manual' : 'auto')}" d="M${x1},${y1} C${x1},${y1 + 40} ${x2},${y2 - 30} ${x2},${y2}"/>` +
      (manual ? `<text x="${(x1 + x2) / 2}" y="${y1 + 24}" fill="var(--warn)" font-size="10">수동 업로드</text>` : '');
  } catch { /* wire is decorative */ }
}

// ---- board (존 B) --------------------------------------------------------------------
async function refreshBoard(first) {
  if (!S.client) return;
  const b = await window.api.ws.board(S.client.dir);
  applyBoard(b, first);
  S.gates = await window.api.gates.get(S.client.dir);
  renderGateBar();
}
function applyBoard(b, first) {
  const prev = S.prevStages;
  S.board = b;
  const moved = [];
  for (const p of b.posts) {
    const was = prev.get(p.uid);
    if (was && was !== p.stage && b.stages.indexOf(p.stage) > b.stages.indexOf(was)) moved.push(p);
    prev.set(p.uid, p.stage);
  }
  renderChannels();
  renderBoardViews(!first && moved.length > 0, moved);
  renderHero();
  if (!first && moved.length) {
    const label = moved.length === 1 ? cardId(moved[0]) : `${cardId(moved[0])} 외 ${moved.length - 1}건`;
    toast(`${STAGE_LABEL[moved[0].stage]}로 이동 — ${label}`);
  }
}
function cardId(p) { return (CH_MONO[p.channel] || '?') + '-' + p.n; }
function makeCard(p) {
  const el = $('#tpl-post-card').content.firstElementChild.cloneNode(true);
  const color = `var(--ch-${p.channel})`;
  el.dataset.key = p.uid;
  el.style.borderLeftColor = color;
  const tile = $('.mono-tile', el);
  tile.textContent = CH_MONO[p.channel]; tile.style.background = `color-mix(in srgb, ${color} 16%, transparent)`; tile.style.color = color;
  $('.pc-id', el).textContent = cardId(p);
  $('.pc-when', el).textContent = `${p.week || '?'}주 ${p.day || ''}`;
  $('.pc-topic', el).textContent = p.topic || '(제목 없음)';
  $('.pc-format', el).textContent = p.format || '—';
  const v = $('.pc-verdict', el);
  if (p.verdict) v.classList.add(p.verdict); else v.remove();
  const idx = S.board.stages.indexOf(p.stage);
  $('.pc-dots', el).innerHTML = S.board.stages.map((s, i) =>
    `<span class="stage-dot ${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}" title="${STAGE_LABEL[s]}"></span>`).join('');
  if (p.verdict === 'BLOCK') el.classList.add('blocked');
  if (S.running && STAGE2COL[S.running] === p.stage) el.classList.add('running-card');
  if (S.filter && p.channel !== S.filter) el.classList.add('dim');
  el.onclick = () => openInspector(p);
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/sat-card', JSON.stringify({ uid: p.uid, id: cardId(p), topic: p.topic, stage: p.stage })));
  return el;
}
function renderBoardViews(flip, moved) {
  const b = S.board; if (!b) return;
  const rects = new Map();
  const flipRoot = S.view === 'kanban' ? '#kanban ' : '#timeline ';
  if (flip) for (const el of $$(flipRoot + '.post-card')) rects.set(el.dataset.key, el.getBoundingClientRect());
  // 타임라인
  const tl = $('#timeline'); tl.innerHTML = '';
  const weeks = {};
  for (const p of b.posts) (weeks[p.week || '?'] = weeks[p.week || '?'] || []).push(p);
  const DAY_IDX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 };
  for (const w of Object.keys(weeks).sort()) {
    const posts = weeks[w].sort((a, c) => (DAY_IDX[String(a.day).slice(0, 3).toLowerCase()] ?? 9) - (DAY_IDX[String(c.day).slice(0, 3).toLowerCase()] ?? 9));
    const done = posts.filter((p) => p.stage === 'ready').length;
    const sec = document.createElement('section');
    sec.className = 'week-section';
    sec.innerHTML = `<div class="week-head">${esc(w)}주차 <span class="muted">${posts.length}개</span><span class="week-bar"><span style="width:${(done / posts.length) * 100}%"></span></span></div>`;
    const grid = document.createElement('div'); grid.className = 'tl-grid';
    for (const p of posts) grid.appendChild(makeCard(p));
    sec.appendChild(grid); tl.appendChild(sec);
  }
  // 칸반
  const kb = $('#kanban'); kb.innerHTML = '';
  for (const s of b.stages) {
    const posts = b.posts.filter((p) => p.stage === s);
    const col = document.createElement('div'); col.className = 'kb-col'; col.dataset.col = s;
    const runningHere = S.running && STAGE2COL[S.running] === s;
    col.innerHTML = `<div class="kb-head">${STAGE_LABEL[s]} <span class="kb-count chip tiny">${posts.length}</span>
      <svg style="width:12px;height:12px;color:var(--faint)" title="상태는 outputs/ 파일 증거로 자동 계산됩니다"><use href="#i-lock"/></svg></div>` +
      (runningHere ? `<div class="kb-ticker" data-ticker="${s}">…</div>` : '');
    const cards = document.createElement('div'); cards.className = 'kb-cards';
    for (const p of posts) cards.appendChild(makeCard(p));
    if (s !== 'planned' && !posts.length && b.posts.length) {
      for (let i = 0; i < Math.min(2, b.posts.length); i++) { const g = document.createElement('div'); g.className = 'ghost-post'; cards.appendChild(g); }
    }
    col.appendChild(cards); kb.appendChild(col);
    col.addEventListener('dragover', (e) => e.preventDefault());
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      const key = (() => { try { return JSON.parse(e.dataTransfer.getData('text/sat-card')).uid; } catch { return null; } })();
      const el = $(`.post-card[data-key="${key}"]`, kb);
      if (el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 400); }
      toast('카드 상태는 파일 증거로 자동 계산됩니다 — 디렉터에게 작업을 지시하세요');
    });
  }
  // FLIP — 보이는 뷰만 (타임라인/칸반이 같은 data-key를 공유하므로 스코프 필수)
  if (flip && rects.size) {
    const root = S.view === 'kanban' ? '#kanban ' : '#timeline ';
    requestAnimationFrame(() => {
      let i = 0;
      for (const el of $$(root + '.post-card')) {
        const old = rects.get(el.dataset.key);
        if (!old || (!old.width && !old.height)) continue; // hidden-view zero rects
        const now = el.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if (!dx && !dy) continue;
        el.style.transform = `translate(${dx}px,${dy}px)`;
        el.style.transition = 'none';
        setTimeout(() => {
          el.style.transition = 'transform .35s cubic-bezier(.2,.8,.2,1)';
          el.style.transform = '';
        }, 80 * (i++ % 5) + 20);
      }
    });
  }
}
function renderHero() {
  const b = S.board;
  const hero = $('#hero');
  const showHero = !S.client || !b || !b.hasCalendar;
  hero.classList.toggle('hidden', !showHero);
  $('#timeline').classList.toggle('hidden', showHero || S.view !== 'timeline');
  $('#kanban').classList.toggle('hidden', showHero || S.view !== 'kanban');
  if (!showHero) return;
  if (!S.client) {
    hero.innerHTML = `<div class="hero-card"><h3>클라이언트로 시작하세요</h3><p>좌측 레일의 + 버튼으로 클라이언트 폴더를 만들면, 팀이 그 폴더 안에서 브랜드·캘린더·콘텐츠를 관리합니다.</p></div>`;
    return;
  }
  const f = b.foundation;
  const card = (title, done, desc, btns) => `
    <div class="hero-card"><h3>${title} <span class="badge ${done ? 'ok' : 'no'}" style="float:right">${done ? '완료' : '필요'}</span></h3><p>${desc}</p>
    <div class="btn-grid">${btns}</div></div>`;
  hero.innerHTML =
    card('① 브랜드 스타일', f.brand, '브랜드의 목소리·팔레트·필러를 담는 팀의 단일 진실 공급원입니다.',
      `<button data-act="chat" data-t="브랜드 온보딩 인터뷰를 시작해줘. 질문을 하나씩 해줘.">디렉터와 인터뷰</button><button data-act="term">터미널에서</button>`) +
    card('② 보이스 프로파일', f.voice, '해요체/합쇼체, 금지 표현, 이모지 정책 — 한국어 카피의 결을 잠급니다.',
      `<button data-act="chat" data-t="kr-voice-localizer 보이스 프로파일 인테이크를 시작해줘.">디렉터와 인터뷰</button>`) +
    card('③ 콘텐츠 캘린더', f.calendar, '이번 달 포스트 편성표. 이게 생기면 보드에 카드가 나타납니다.',
      `<button data-act="stage" data-s="calendar" ${f.brand ? '' : 'disabled title="브랜드 스타일이 먼저 필요합니다"'}>캘린더 생성 실행</button>`);
  for (const btn of $$('#hero button[data-act]')) {
    btn.onclick = () => {
      if (btn.dataset.act === 'chat') prefillChat(btn.dataset.t);
      else if (btn.dataset.act === 'term') window.api.pipe.openTerminal(S.client.dir);
      else if (btn.dataset.act === 'stage') runStage(btn.dataset.s);
    };
  }
}

// ---- gates (존 D) ----------------------------------------------------------------------
function renderGateBar() {
  const g = S.gates; const box = $('#gate-steps'); box.innerHTML = '';
  if (!g) { $('#gate-cta').disabled = true; return; }
  g.nodes.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'gate-node' + (i < g.current ? ' done' : '') + (i === g.current ? ' current' : '') + (n.blocked ? ' blockedd' : '');
    el.innerHTML = `<span class="gn-circle">${i < g.current ? '<svg><use href="#i-check"/></svg>' : (n.blocked ? '<svg><use href="#i-warn"/></svg>' : i + 1)}</span><span class="gn-label">${n.label}</span>` + (i < g.nodes.length - 1 ? `<span class="gn-link ${i < g.current ? 'done' : ''}"></span>` : '');
    el.title = n.approved ? '승인됨' : (n.done ? '증거 확인됨' : '대기');
    el.onclick = () => showGateInfo(el, n, i);
    box.appendChild(el);
  });
  renderCTA();
  drawWire();
}
function showGateInfo(el, n) {
  const appr = (S.gates.approvals || []).find((a) => a.node === n.key);
  popover(el, `<b>${n.label}</b><p class="muted" style="margin-top:4px">${n.done ? '파일 증거 확인됨' : '아직 산출물 없음'}${appr ? `<br>승인: ${new Date(appr.approvedAt).toLocaleString('ko-KR')}` : ''}</p>` + (n.stage && !S.running ? `<button id="pop-run" style="margin-top:8px">이 단계 실행</button>` : ''));
  const b = $('#pop-run'); if (b) b.onclick = () => { hidePopover(); runStage(n.stage); };
}
function renderCTA() {
  const cta = $('#gate-cta'); const label = $('span', cta); const icon = $('use', cta);
  cta.classList.remove('stop', 'approve');
  if (!S.client || !S.gates) { cta.disabled = true; label.textContent = '—'; return; }
  cta.disabled = false;
  if (S.running) {
    cta.classList.add('stop'); icon.setAttribute('href', '#i-stop');
    label.textContent = `중지 · ${fmtDur(Date.now() - S.runStart)}`;
    cta.onclick = async () => { await window.api.pipe.stop(); setRunning(null); };
    return;
  }
  icon.setAttribute('href', '#i-play');
  const n = S.gates.nodes[S.gates.current];
  const needsStamp = ['calendar', 'copy', 'compliance'].includes(n.key);
  if (n.key === 'foundation') { label.textContent = '온보딩 인터뷰 시작'; cta.onclick = () => prefillChat('브랜드 온보딩 인터뷰를 시작해줘. 질문을 하나씩 해줘.'); }
  else if (n.done && needsStamp && !n.approved) { cta.classList.add('approve'); icon.setAttribute('href', '#i-stamp'); label.textContent = `${n.label} 검토 → 승인`; cta.onclick = () => openApproveSheet(n); }
  else if (n.key === 'publish') {
    label.textContent = '발행 · 월말 리뷰';
    cta.onclick = (e) => {
      if (popover(e.currentTarget, `<b>발행 단계</b><p class="muted" style="margin:6px 0">Blotato 연결 시 자동 예약, 네이버는 수동 발행입니다.</p>
        <div style="display:flex;flex-direction:column;gap:6px">
        <button id="pop-pub">Blotato 발행 지시 (디렉터)</button>
        <button id="pop-review">월말 성과 리뷰 실행</button></div>`)) {
        $('#pop-pub').onclick = () => { hidePopover(); prefillChat('컴플라이언스를 통과한 콘텐츠를 /publisher로 Blotato에 스케줄해줘. 네이버 건은 수동 발행 체크리스트로 정리해줘.'); };
        $('#pop-review').onclick = () => { hidePopover(); runStage('review'); };
      }
    };
  }
  else if (n.stage) { label.textContent = `${n.label} 실행`; cta.onclick = (e) => confirmRun(e.currentTarget, n.stage, n.label); }
  else { cta.disabled = true; label.textContent = n.label; }
}
function confirmRun(anchor, stage, name) {
  popover(anchor, `<b>${name} 실행</b><p class="muted" style="margin:6px 0">팀이 클라이언트 폴더에서 작업을 시작합니다.</p>
    <input id="pop-extra" placeholder="추가 지시 (선택)" style="width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 9px;color:var(--text);font-size:12px">
    <button id="pop-go" style="margin-top:8px;width:100%">▶ 실행</button>`);
  $('#pop-go').onclick = () => { const extra = $('#pop-extra').value.trim(); hidePopover(); runStage(stage, extra); };
}
async function runStage(stage, extra) {
  if (S.running) { toast('다른 단계가 실행 중입니다'); return; }
  if (S.chatBusy) { toast('디렉터 응답을 기다리는 중입니다 — 잠시 후 실행하세요'); return; }
  setRunning(stage);
  switchDock('log');
  logLine(stage, `▶ 실행 시작 — ${S.client.name}`);
  try {
    const r = await window.api.pipe.runStage(S.client.dir, stage, extra ? { extraContext: extra } : {});
    S.lastRunStart[stage] = r.startedAt || Date.now() - 60000;
    logLine(stage, r.ok ? '✔ 완료' : `✖ 종료 코드 ${r.code}`);
    if (!r.ok && r.tail) toast(r.tail.slice(0, 120));
  } catch (e) {
    logLine(stage, '✖ 오류: ' + e.message);
  } finally {
    if (S.running === stage) setRunning(null);
  }
  await refreshBoard(false);
}
$('#gate-checklist').onclick = async (e) => {
  const st = await window.api.ws.status(S.client ? S.client.dir : '');
  const items = (st.statusItems || []).map((i) => `<div style="padding:2px 0">${i.done ? '✅' : '⬜'} ${esc(i.label)}</div>`).join('') || '<span class="muted">기록 없음</span>';
  popover(e.currentTarget, `<b>워크플로 체크리스트</b><div style="margin-top:8px;max-height:300px;overflow-y:auto;font-size:12px">${items}</div>`);
};

// ---- approval sheet + 도장 ------------------------------------------------------------------
function reopenApproveSheet(node) {
  const checked = new Set($$('.warn-sign').filter((c) => c.checked).map((c) => c.dataset.n));
  openApproveSheet(node);
  for (const c of $$('.warn-sign')) if (checked.has(c.dataset.n)) c.checked = true;
}
function openApproveSheet(node) {
  const sheet = $('#sheet-approve');
  const isCompliance = node.key === 'compliance';
  S.approveNode = node.key;
  let files = [];
  if (node.key === 'calendar') {
    files = [{ name: 'content-calendar.md', rel: 'context/content-calendar.md', mtime: Date.now(), lane: 'context' }];
  } else {
    const since = S.lastRunStart[node.stage] || Date.now() - 24 * 3600e3;
    for (const [lane, fl] of Object.entries(S.board.lanes || {})) for (const f of fl) if (f.mtime >= since) files.push({ ...f, lane });
    files.sort((a, b) => b.mtime - a.mtime);
    if (!files.length) { // 컷오프에 걸리는 파일이 없으면 최근 산출물로 폴백 — 빈 시트에 도장 찍게 하지 않는다
      for (const [lane, fl] of Object.entries(S.board.lanes || {})) for (const f of fl) files.push({ ...f, lane });
      files.sort((a, b) => b.mtime - a.mtime);
      files = files.slice(0, 12);
    }
  }
  const warnPosts = S.board.posts.filter((p) => p.verdict === 'WARN');
  const blockPosts = S.board.posts.filter((p) => p.verdict === 'BLOCK');

  sheet.innerHTML = `
    <div class="sheet-head"><h2>${node.label} 승인 게이트</h2>
      ${isCompliance ? `<span class="chip" style="color:var(--ok)">PASS ${S.board.compliance.pass}</span><span class="chip" style="color:var(--warn)">WARN ${S.board.compliance.warn}</span><span class="chip" style="color:var(--bad)">BLOCK ${S.board.compliance.block}</span>` : `<span class="chip">${files.length}개 파일</span>`}
      <button class="icon-btn" id="appr-close"><svg><use href="#i-close"/></svg></button></div>
    <div class="appr-split">
      <div class="appr-files">${isCompliance ? `
        ${blockPosts.map((p) => `<div class="verdict-row BLOCK"><span class="dot BLOCK"></span><b>${cardId(p)}</b> ${esc(p.topic.slice(0, 30))}<button class="chip" data-rework="${esc(p.uid)}" style="margin-left:auto">재작업 지시</button></div>`).join('')}
        ${warnPosts.map((p) => `<div class="verdict-row WARN"><input type="checkbox" class="warn-sign" data-n="${p.n}"><span class="dot WARN"></span><b>${cardId(p)}</b> ${esc(p.topic.slice(0, 30))}</div>`).join('')}
        ${warnPosts.length ? '<p class="muted small" style="margin:8px 0">WARN 사유를 확인했다면 각 항목에 서명(체크)하세요.</p>' : ''}
        <div style="margin-top:10px" id="appr-list"></div>` : '<div id="appr-list"></div>'}
      </div>
      <div class="appr-preview" id="appr-preview"><p class="muted">파일을 선택하면 미리보기가 열립니다</p></div>
    </div>
    <div class="appr-foot">
      <button id="appr-reject">반려 — 디렉터에게 수정 지시</button>
      <label class="small muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="appr-next" checked> 승인과 동시에 다음 단계 실행</label>
      <div style="flex:1"></div>
      <button class="stamp-btn" id="stamp"><span class="ring"></span><svg><use href="#i-stamp"/></svg><span>길게 눌러<br>승인</span></button>
    </div>`;
  const list = $('#appr-list', sheet);
  const preview = $('#appr-preview', sheet);
  const complianceFile = S.board.compliance.file;
  const showFiles = isCompliance && complianceFile ? [{ ...complianceFile, lane: 'compliance' }] : files;
  for (const f of showFiles.slice(0, 30)) {
    const row = $('#tpl-file-row').content.firstElementChild.cloneNode(true);
    $('.fr-name', row).textContent = f.name;
    $('.fr-time', row).textContent = relTime(f.mtime);
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/sat-file', f.rel));
    row.onclick = async () => {
      const r = await window.api.ws.readFile(S.client.dir, f.rel);
      preview.innerHTML = r.ok ? (r.kind === 'image' ? `<img src="${r.dataUrl}">` : `<pre>${esc(r.text)}</pre>`) : `<p class="muted">${esc(r.error)}</p>`;
    };
    list.appendChild(row);
  }
  if (showFiles[0]) list.firstElementChild && list.firstElementChild.click();
  $('#appr-close').onclick = closeOverlay;
  $('#appr-reject').onclick = () => { closeOverlay(); prefillChat(`${node.label} 산출물에 수정이 필요해: `); };
  for (const b of $$('[data-rework]', sheet)) b.onclick = () => {
    const p = S.board.posts.find((x) => x.uid === b.dataset.rework);
    closeOverlay(); prefillChat(`「${cardId(p)} · ${p.topic}」가 BLOCK 판정이야. 컴플라이언스 사유를 확인하고 재작업해줘.`);
  };
  bindStamp($('#stamp', sheet), node, isCompliance);
  openSheet('#sheet-approve');
}
function bindStamp(btn, node, isCompliance) {
  const canStamp = () => {
    // 시트가 열린 뒤 보드가 갱신될 수 있으므로 판정 수는 항상 라이브로 계산
    const blocks = S.board.posts.filter((p) => p.verdict === 'BLOCK').length;
    if (isCompliance && blocks > 0) return 'BLOCK 카드가 있어 승인할 수 없습니다 — 재작업이 먼저입니다';
    if (isCompliance && $$('.warn-sign').some((c) => !c.checked)) return 'WARN 항목에 모두 서명해야 승인할 수 있습니다';
    return null;
  };
  let timer = null, p = 0;
  const reset = () => { clearInterval(timer); timer = null; p = 0; btn.style.setProperty('--p', 0); };
  currentStampReset = reset;
  btn.addEventListener('pointerdown', () => {
    if (timer) return; // 멀티터치/펜 중복 진입 차단
    const why = canStamp();
    if (why) { toast(why); return; }
    timer = setInterval(async () => {
      p += 100 / (600 / 30);
      btn.style.setProperty('--p', Math.min(p, 100));
      if (p >= 100) {
        reset();
        btn.classList.add('stamped');
        const warnSigned = $$('.warn-sign').filter((c) => c.checked).map((c) => Number(c.dataset.n));
        S.gates = await window.api.gates.approve(S.client.dir, { node: node.key, signer: S.client.name, warnSigned });
        toast(`${node.label} 승인 완료`);
        setTimeout(async () => {
          closeOverlay();
          renderGateBar();
          if ($('#appr-next') && $('#appr-next').checked) {
            const next = S.gates.nodes[S.gates.current];
            if (next && next.stage && !S.running) runStage(next.stage);
          }
        }, 500);
      }
    }, 30);
  });
  btn.addEventListener('pointerup', reset);
  btn.addEventListener('pointerleave', reset);
  btn.addEventListener('pointercancel', reset);
}
let currentStampReset = null;

// ---- dock: chat / log / inspector ---------------------------------------------------------
function switchDock(name) {
  S.inspectorN = null;
  $$('#dock-seg button').forEach((b) => b.classList.toggle('active', b.dataset.dock === name));
  $('#dock-chat').classList.toggle('hidden', name !== 'chat');
  $('#dock-log').classList.toggle('hidden', name !== 'log');
  $('#dock-inspector').classList.add('hidden');
}
for (const b of $$('#dock-seg button')) b.onclick = () => switchDock(b.dataset.dock);

function addMsg(kind, text) {
  const d = document.createElement('div');
  d.className = `msg ${kind}`; d.textContent = text;
  $('#chat-log').appendChild(d);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
  return d;
}
function renderChips() {
  const box = $('#chat-chips'); box.innerHTML = '';
  S.chips.forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'chip'; s.textContent = c.label + ' ×';
    s.onclick = () => { S.chips.splice(i, 1); renderChips(); };
    box.appendChild(s);
  });
}
function prefillChat(text) {
  switchDock('chat');
  $('#chat-input').value = text;
  $('#chat-input').focus();
}
async function sendChat() {
  if (!S.client) { toast('클라이언트를 먼저 선택하세요'); return; }
  if (S.running) { toast('단계 실행 중에는 디렉터 대화를 보낼 수 없습니다 (같은 폴더를 동시에 편집하게 됩니다)'); return; }
  const input = $('#chat-input');
  let msg = input.value.trim();
  if (!msg || S.chatBusy) return;
  if (S.chips.length) msg = S.chips.map((c) => c.context).join('\n') + '\n\n' + msg;
  const dir = S.client.dir; // 전송 시점의 클라이언트 — 응답이 다른 클라이언트에 새지 않게
  S.chatBusy = true; $('#btn-chat-send').disabled = true;
  input.value = ''; S.chips = []; renderChips();
  addMsg('user', msg);
  const think = addMsg('think', '디렉터 작업 중…');
  const t0 = Date.now();
  const tick = setInterval(() => { think.textContent = `디렉터 작업 중… ${fmtDur(Date.now() - t0)}`; }, 1000);
  try {
    const r = await window.api.chat.send(dir, msg);
    if (S.client && S.client.dir === dir) addMsg(r.ok ? 'dir' : 'err', r.text);
  } catch (e) {
    addMsg('err', '전송 실패: ' + e.message);
  } finally {
    clearInterval(tick); think.remove();
    S.chatBusy = false; $('#btn-chat-send').disabled = false;
  }
  if (S.client && S.client.dir === dir) { input.focus(); await refreshBoard(false); }
}
$('#btn-chat-send').onclick = sendChat;
$('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); } });
$('#chat-reset').onclick = async () => {
  if (!S.client) return;
  if (S.chatBusy) { toast('응답을 기다리는 중에는 초기화할 수 없습니다'); return; }
  await window.api.chat.reset(S.client.dir);
  $('#chat-log').innerHTML = '';
  addMsg('think', '새 대화를 시작합니다 (세션 초기화)');
};
// 카드/파일 → 채팅 드롭
const ci = $('#chat-input');
ci.addEventListener('dragover', (e) => { e.preventDefault(); ci.classList.add('droptarget'); });
ci.addEventListener('dragleave', () => ci.classList.remove('droptarget'));
ci.addEventListener('drop', (e) => {
  e.preventDefault(); ci.classList.remove('droptarget');
  const card = e.dataTransfer.getData('text/sat-card');
  const file = e.dataTransfer.getData('text/sat-file');
  if (card) { const c = JSON.parse(card); S.chips.push({ label: c.id, context: `[카드 ${c.id} · ${c.topic} · 현재 단계 ${STAGE_LABEL[c.stage]}]` }); }
  if (file) { S.chips.push({ label: file.split(/[\\/]/).pop(), context: `[파일 ${file}]` }); }
  renderChips(); switchDock('chat'); ci.focus();
});

function logLine(source, line) {
  const pane = $('#log-pane');
  if (++S.logLines > 5000) { pane.textContent = ''; S.logLines = 0; }
  const atBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 40;
  const span = document.createElement('span');
  span.innerHTML = `<span class="src">[${esc(source)}]</span> `;
  pane.appendChild(span);
  pane.appendChild(document.createTextNode(line + '\n'));
  if (atBottom) pane.scrollTop = pane.scrollHeight;
  const t = $(`[data-ticker]`);
  if (t) t.textContent = line;
}

function openInspector(p) {
  S.inspectorN = p.uid;
  $('#dock-chat').classList.add('hidden'); $('#dock-log').classList.add('hidden');
  $$('#dock-seg button').forEach((b) => b.classList.remove('active'));
  const box = $('#dock-inspector');
  box.classList.remove('hidden');
  const color = `var(--ch-${p.channel})`;
  const stageIdx = S.board.stages.indexOf(p.stage);
  const evidence = (lane) => (S.board.lanes[lane] || []).slice(0, 2);
  const stepFiles = { planned: [], copy: evidence(p.lane), visual: p.isReel ? evidence('videos') : evidence('creatives'), review: evidence('compliance'), ready: [] };
  box.innerHTML = `
    <div class="insp-head"><button class="icon-btn" id="insp-back"><svg><use href="#i-back"/></svg></button>
      <span class="mono-tile" style="background:color-mix(in srgb, ${color} 16%, transparent);color:${color}">${CH_MONO[p.channel]}</span>
      <span class="insp-topic">${esc(p.topic)}</span>
      ${p.verdict ? `<span class="dot ${p.verdict}"></span>` : ''}</div>
    <div class="chip" style="align-self:flex-start">${STAGE_LABEL[p.stage]} 단계</div>
    <dl class="insp-meta">
      <dt>일정</dt><dd>${esc(p.week)}주차 ${esc(p.day)}</dd>
      <dt>필러</dt><dd>${esc(p.pillar || '—')}</dd>
      <dt>포맷</dt><dd>${esc(p.format || '—')}</dd>
      <dt>목표</dt><dd>${esc(p.objective || '—')}</dd>
      <dt>앵글</dt><dd>${esc(p.angle || '—')}</dd>
      <dt>비주얼</dt><dd>${esc(p.visual || '—')}</dd>
      ${p.notes ? `<dt>노트</dt><dd>${esc(p.notes)}</dd>` : ''}
    </dl>
    <div class="insp-steps">${S.board.stages.map((s, i) => `
      <div class="insp-step ${i <= stageIdx ? 'done' : ''}"><b style="min-width:70px">${STAGE_LABEL[s]}</b>
      <span>${(stepFiles[s] || []).map((f) => `<a href="#" class="insp-file" data-rel="${esc(f.rel)}" style="color:var(--info)">${esc(f.name)}</a>`).join('<br>') || '<span class="muted">—</span>'}</span></div>`).join('')}
    </div>
    <div id="insp-preview"></div>
    ${p.verdict && p.verdict !== 'PASS' ? `<div class="insp-verdict ${p.verdict}"><b>${p.verdict}</b> — 컴플라이언스 판정. 상세 사유는 검수 파일에서 확인하세요.</div>` : ''}
    <div class="insp-actions">
      <button id="insp-chat">디렉터에게 지시</button>
      <button id="insp-folder">레인 폴더 열기</button>
    </div>`;
  $('#insp-back').onclick = () => switchDock('chat');
  $('#insp-chat').onclick = () => { S.chips.push({ label: cardId(p), context: `[카드 ${cardId(p)} · ${p.topic} · 현재 단계 ${STAGE_LABEL[p.stage]}]` }); renderChips(); switchDock('chat'); $('#chat-input').focus(); };
  $('#insp-folder').onclick = () => window.api.ws.openFolder(S.client.dir + '/outputs/' + p.lane);
  for (const a of $$('.insp-file', box)) a.onclick = async (e) => {
    e.preventDefault();
    const r = await window.api.ws.readFile(S.client.dir, a.dataset.rel);
    $('#insp-preview').innerHTML = r.ok ? (r.kind === 'image' ? `<img src="${r.dataUrl}" style="max-width:100%;border-radius:8px">` : `<pre style="white-space:pre-wrap;font-size:11px;max-height:220px;overflow-y:auto;background:var(--card);border-radius:8px;padding:10px">${esc(r.text.slice(0, 6000))}</pre>`) : '';
  };
}

// ---- outputs drawer ------------------------------------------------------------------------
function openDrawer() {
  if (!S.client || !S.board) { toast('클라이언트를 먼저 선택하세요'); return; }
  const sheet = $('#sheet-drawer');
  const lanes = Object.entries(S.board.lanes).filter(([, f]) => f.length);
  sheet.innerHTML = `
    <div class="sheet-head"><h2>산출물 서랍</h2><input id="drawer-q" placeholder="파일명 검색" style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--text);font-size:12px;width:200px"><button class="icon-btn" id="drawer-close"><svg><use href="#i-close"/></svg></button></div>
    <div class="appr-split">
      <div class="appr-files" id="drawer-list">${lanes.map(([lane, files]) => `
        <div style="margin-bottom:10px"><b class="small" style="color:var(--accent-hover)">outputs/${lane}</b>
        ${files.map((f) => `<div class="file-row" draggable="true" data-rel="${esc(f.rel)}"><svg class="fi"><use href="#i-doc"/></svg><span class="fr-name ${Date.now() - f.mtime < 86400e3 ? 'new' : ''}">${esc(f.name)}</span><span class="fr-time muted small">${relTime(f.mtime)}</span></div>`).join('')}</div>`).join('') || '<p class="muted">산출물이 아직 없습니다</p>'}
      </div>
      <div class="appr-preview" id="drawer-preview"><p class="muted">파일을 선택하세요</p></div>
    </div>`;
  $('#drawer-close').onclick = closeOverlay;
  $('#drawer-q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    for (const row of $$('.file-row', sheet)) row.style.display = row.dataset.rel.toLowerCase().includes(q) ? '' : 'none';
  };
  for (const row of $$('.file-row', sheet)) {
    // 오버레이가 독을 덮어 드래그가 닿지 않으므로 '첨부' 버튼이 확실한 경로
    const attach = document.createElement('button');
    attach.className = 'chip'; attach.textContent = '첨부';
    attach.onclick = (e) => {
      e.stopPropagation();
      S.chips.push({ label: row.dataset.rel.split(/[\\/]/).pop(), context: `[파일 ${row.dataset.rel}]` });
      renderChips(); closeOverlay(); switchDock('chat'); $('#chat-input').focus();
    };
    row.appendChild(attach);
    row.onclick = async () => {
      const r = await window.api.ws.readFile(S.client.dir, row.dataset.rel);
      $('#drawer-preview').innerHTML = r.ok ? (r.kind === 'image' ? `<img src="${r.dataUrl}">` : `<pre>${esc(r.text)}</pre>`) : `<p class="muted">${esc(r.error)}</p>`;
    };
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/sat-file', row.dataset.rel));
  }
  openSheet('#sheet-drawer');
}

// ---- settings + wizard -----------------------------------------------------------------------
function envRows(s) {
  const rows = [
    ['claude', 'Claude Code CLI', s.claude], ['codex', 'Codex CLI', s.codex], ['codexAuthed', 'Codex 로그인', s.codexAuthed],
    ['ima2', 'ima2 (이미지·영상)', s.ima2], ['ima2Configured', 'ima2 OAuth 설정', s.ima2Configured],
    ['skillsInstalled', '스킬 17종', s.skillsInstalled], ['agentsInstalled', '에이전트 4종', s.agentsInstalled],
  ];
  return rows.map(([k, label, ok]) => `<div class="env-row">${label}<span class="badge ${ok ? 'ok' : 'no'}" data-env="${k}">${ok ? 'OK' : '없음'}</span></div>`).join('');
}
function envButtons() {
  return `<div class="btn-grid">
    <button data-setup="installSkills">스킬 설치/업데이트</button>
    <button data-setup="installCodex">Codex 설치</button>
    <button data-setup="codexLogin">Codex 로그인 (OAuth)</button>
    <button data-setup="registerMcp">Codex MCP 등록</button>
    <button data-setup="installIma2">ima2 설치</button>
    <button data-setup="ima2Setup">ima2 셋업 (터미널)</button>
  </div>`;
}
function bindSetupButtons(root, after) {
  for (const b of $$('[data-setup]', root)) b.onclick = async () => {
    b.disabled = true; const old = b.textContent; b.textContent = old + ' …';
    const r = await window.api.setup[b.dataset.setup]();
    b.disabled = false; b.textContent = old;
    if (r && r.ok === false) toast((r.tail || '실패').slice(0, 140));
    else toast(old + ' 완료');
    after && after();
  };
}
async function openSettings(section) {
  const s = S.env = await window.api.setup.check();
  const v = await window.api.update.version();
  const sheet = $('#sheet-settings');
  sheet.innerHTML = `
    <div class="sheet-head"><h2>설정</h2><button class="icon-btn" id="set-close"><svg><use href="#i-close"/></svg></button></div>
    <div class="settings-nav">
      <button data-sec="env" class="active">환경</button><button data-sec="engine">엔진</button><button data-sec="update">업데이트</button><button data-sec="about">정보</button>
    </div>
    <div class="sheet-body">
      <div data-body="env">${envRows(s)}${envButtons()}</div>
      <div data-body="engine" class="hidden">
        <p class="muted" style="margin-bottom:10px">앱 내 대화·외부 터미널의 엔진을 선택합니다. 파이프라인(팀 오케스트레이션)은 항상 Claude로 동작합니다.</p>
        <div class="seg" id="set-engine"><button data-engine="claude">Claude</button><button data-engine="codex">Codex</button></div>
        <div style="margin-top:18px;display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center">
          <b class="small">Claude 모델</b>
          <input id="set-model-claude" list="dl-claude" placeholder="기본값 (비워두면 CLI 기본 모델)"
            style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12.5px">
          <b class="small">Codex 모델</b>
          <input id="set-model-codex" list="dl-codex" placeholder="기본값 (비워두면 CLI 기본 모델)"
            style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text);font-size:12.5px">
        </div>
        <datalist id="dl-claude">
          <option value="sonnet">Sonnet — 빠르고 균형</option>
          <option value="opus">Opus — 고성능</option>
          <option value="haiku">Haiku — 초경량·저비용</option>
        </datalist>
        <datalist id="dl-codex">
          <option value="gpt-5.5-codex"></option>
          <option value="gpt-5.5"></option>
          <option value="gpt-5-codex"></option>
        </datalist>
        <p class="muted small" style="margin-top:10px">Claude 모델은 파이프라인 단계 실행과 Claude 대화에, Codex 모델은 Codex 대화에 적용됩니다. 목록에 없는 모델명도 직접 입력할 수 있습니다.</p>
      </div>
      <div data-body="update" class="hidden">
        <p>현재 버전 <b>v${esc(v)}</b></p>
        <div class="btn-grid"><button id="set-upd-check">업데이트 확인</button></div>
        <p id="set-upd-status" class="muted" style="margin-top:8px"></p>
      </div>
      <div data-body="about" class="hidden">
        <p><b>Social AI Team — 온에어 데스크</b></p>
        <p class="muted" style="margin-top:6px;line-height:1.7">스킬 17종 + 서브에이전트 4종으로 구성된 소셜 콘텐츠 팀의 컨트롤타워.<br>카드는 드래그로 옮기는 것이 아니라, 팀의 산출물 파일이 생기면 스스로 이동합니다.</p>
      </div>
    </div>`;
  $('#set-close').onclick = closeOverlay;
  for (const nb of $$('.settings-nav button', sheet)) nb.onclick = () => {
    $$('.settings-nav button', sheet).forEach((x) => x.classList.toggle('active', x === nb));
    $$('[data-body]', sheet).forEach((x) => x.classList.toggle('hidden', x.dataset.body !== nb.dataset.sec));
  };
  bindSetupButtons(sheet, () => refreshEnvBadges(sheet));
  for (const b of $$('#set-engine button')) { b.classList.toggle('active', b.dataset.engine === S.engine); b.onclick = async () => { S.engine = await window.api.engine.set(b.dataset.engine); applyEngine(); $$('#set-engine button').forEach((x) => x.classList.toggle('active', x.dataset.engine === S.engine)); }; }
  // 엔진별 모델 선택 — 입력 후 포커스 아웃/Enter 시 저장
  S.models = await window.api.engine.getModels();
  const bindModel = (id, engine) => {
    const inp = $(id);
    inp.value = S.models[engine] || '';
    const save = async () => {
      const v = inp.value.trim();
      if (v === (S.models[engine] || '')) return;
      S.models = await window.api.engine.setModel(engine, v);
      applyEngine();
      toast(`${engine === 'claude' ? 'Claude' : 'Codex'} 모델: ${v || '기본값'}`);
    };
    inp.addEventListener('change', save);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  };
  bindModel('#set-model-claude', 'claude');
  bindModel('#set-model-codex', 'codex');
  $('#set-upd-check').onclick = async () => { const r = await window.api.update.check(); $('#set-upd-status').textContent = r.ok ? '확인 중…' : r.message; };
  if (section) $(`.settings-nav button[data-sec="${section}"]`, sheet).click();
  openSheet('#sheet-settings');
}
async function refreshEnvBadges(root) {
  const s = S.env = await window.api.setup.check();
  const map = { claude: s.claude, codex: s.codex, codexAuthed: s.codexAuthed, ima2: s.ima2, ima2Configured: s.ima2Configured, skillsInstalled: s.skillsInstalled, agentsInstalled: s.agentsInstalled };
  for (const b of $$('[data-env]', root || document)) {
    const ok = !!map[b.dataset.env];
    b.className = 'badge ' + (ok ? 'ok' : 'no'); b.textContent = ok ? 'OK' : '없음';
  }
  updateHealth(s);
}
function updateHealth(s) {
  const core = s.claude && s.skillsInstalled && s.agentsInstalled;
  $('#health-dot').classList.toggle('ok', !!core);
}
async function maybeWizard() {
  const s = S.env = await window.api.setup.check();
  updateHealth(s);
  const core = s.claude && s.skillsInstalled && s.agentsInstalled;
  if (core || localStorage.getItem('wizardDone')) return;
  const wz = $('#wizard');
  wz.innerHTML = `<div class="wizard-card">
    <h2 style="text-align:center">출근 준비</h2>
    <p class="muted" style="text-align:center">소셜 콘텐츠 팀이 이 PC에서 일할 수 있게 준비합니다</p>
    <div class="wizard-steps"><span class="wz-step on"></span><span class="wz-step"></span><span class="wz-step"></span></div>
    <div id="wz-env">${envRows(s)}${envButtons()}</div>
    <div style="display:flex;gap:8px;justify-content:space-between">
      <button id="wz-skip">건너뛰기 (수동 설정)</button>
      <button id="wz-enter" class="cta" disabled>보드로 입장</button>
    </div></div>`;
  bindSetupButtons(wz, () => refreshEnvBadges(wz));
  const poll = setInterval(async () => {
    if (wz.classList.contains('hidden')) { clearInterval(poll); return; }
    await refreshEnvBadges(wz);
    const e = S.env;
    const okCore = e.claude && e.skillsInstalled && e.agentsInstalled;
    $('#wz-enter').disabled = !okCore;
    const steps = $$('.wz-step', wz);
    steps[0].classList.toggle('on', true);
    steps[1].classList.toggle('on', e.codexAuthed || e.ima2Configured);
    steps[2].classList.toggle('on', okCore);
  }, 3000);
  const done = () => { localStorage.setItem('wizardDone', '1'); closeOverlay(); };
  $('#wz-skip').onclick = done;
  $('#wz-enter').onclick = done;
  openSheet('#wizard');
}

// ---- main-process events --------------------------------------------------------------------
window.api.onLog(({ source, line }) => logLine(source, line));
window.api.onBoard((payload) => {
  const b = payload && payload.board ? payload.board : payload;
  const dir = payload && payload.dir;
  if (!S.client || (dir && dir !== S.client.dir)) return; // 다른 클라이언트의 잔여 푸시 무시
  applyBoard(b, false);
  window.api.gates.get(S.client.dir).then((g) => {
    S.gates = g; renderGateBar();
    // 열려 있는 승인 시트/인스펙터는 새 데이터로 재구성
    if (S.approveNode && !$('#sheet-approve').classList.contains('hidden')) {
      const fresh = g.nodes.find((n) => n.key === S.approveNode);
      if (fresh) reopenApproveSheet(fresh);
    }
    if (S.inspectorN != null && !$('#dock-inspector').classList.contains('hidden')) {
      const p = S.board.posts.find((x) => x.uid === S.inspectorN);
      if (p) openInspector(p);
    }
  });
});
window.api.onStage(({ state, stage }) => {
  if (state === 'start') setRunning(stage);
  else if (stage === S.running) setRunning(null); // 지연 도착한 이전 스테이지 end 무시
});
window.api.onUpdate(async (u) => {
  if (u.state === 'ready') { $('#tb-update').classList.remove('hidden'); }
  const el = $('#set-upd-status');
  if (el) {
    if (u.state === 'latest') el.textContent = '최신 버전입니다';
    else if (u.state === 'available') el.textContent = `v${u.version} 발견 — 다운로드 중…`;
    else if (u.state === 'downloading') el.textContent = `다운로드 중… ${u.percent}%`;
    else if (u.state === 'ready') el.textContent = `v${u.version} 준비 완료 — 재시작하면 적용됩니다`;
    else if (u.state === 'error') el.textContent = `업데이트 오류: ${u.message}`;
  }
});

// 채널 필터 와이어는 리사이즈/스크롤에서 재계산
let wireRaf = null;
const redrawWire = () => { if (!wireRaf) wireRaf = requestAnimationFrame(() => { wireRaf = null; drawWire(); }); };
window.addEventListener('resize', redrawWire);
$('#channel-scroll').addEventListener('scroll', redrawWire);

// ---- boot --------------------------------------------------------------------------------------
(async function boot() {
  S.engine = await window.api.engine.get();
  S.models = await window.api.engine.getModels();
  applyEngine();
  S.blotato = (await window.api.channels.check()).blotato;
  await refreshClients();
  renderHero();
  if (S.clients[0]) await selectClient(S.clients[0]);
  await maybeWizard();
})();
})();
