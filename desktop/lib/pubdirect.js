// 직접 발행 엔진 — Blotato 없이 공식 API로 발행한다.
// 지원: X(텍스트+이미지, OAuth 1.0a 직접 서명) / Facebook 페이지(텍스트+이미지) /
//       Threads(텍스트 — 이미지는 공개 URL 필수라 수동 안내) / LinkedIn(텍스트).
// Instagram·네이버는 API 제약(공개 이미지 URL 필수/미제공)으로 수동 체크리스트 유지.
// 예약: context/publish-queue.json + 60초 스케줄러 (앱 재시작에도 유지).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secrets = require('./secrets');
const publishlog = require('./publishlog');

// ---- 공용 HTTP ---------------------------------------------------------------------
async function http(url, opts, timeoutMs = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally { clearTimeout(t); }
}
const fail = (channel, msg) => ({ ok: false, channel, error: String(msg).slice(0, 400) });

// ---- OAuth 1.0a (X) — 외부 의존성 없이 HMAC-SHA1 서명 --------------------------------
function pctEnc(s) { return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function oauth1Header(method, url, extraParams, creds, testOverrides) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: (testOverrides && testOverrides.nonce) || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: (testOverrides && testOverrides.timestamp) || String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...(extraParams || {}) };
  const paramStr = Object.keys(all).sort().map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`).join('&');
  const base = [method.toUpperCase(), pctEnc(url), pctEnc(paramStr)].join('&');
  const key = `${pctEnc(creds.apiSecret)}&${pctEnc(creds.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => `${pctEnc(k)}="${pctEnc(oauth[k])}"`).join(', ');
}

// ---- X (Twitter) --------------------------------------------------------------------
// 주의: v1.1 media/upload은 2025-06 폐기 — v2 media/upload을 쓴다 (OAuth 1.0a 그대로 지원).
// 2026-02부터 발행은 종량제(포스트당 $0.015, URL 포함 시 $0.20) — 콘솔에서 크레딧 충전 필요.
async function xUploadMedia(creds, absPath) {
  const url = 'https://api.x.com/2/media/upload';
  const form = new FormData();
  form.append('media', new Blob([fs.readFileSync(absPath)]), path.basename(absPath));
  form.append('media_category', 'tweet_image');
  // multipart body는 서명에 포함되지 않는다 — oauth 파라미터만
  const r = await http(url, { method: 'POST', headers: { Authorization: oauth1Header('POST', url, {}, creds) }, body: form }, 120_000);
  const id = r.json && ((r.json.data && r.json.data.id) || r.json.media_id_string);
  if (!r.ok || !id) throw new Error('X 미디어 업로드 실패: ' + ((r.json && (r.json.detail || JSON.stringify(r.json.errors || r.json))) || r.status).toString().slice(0, 200));
  return String(id);
}
async function publishX({ text, imageAbs }) {
  const c = secrets.get('x');
  if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret) return fail('x', 'X API 키 4종이 필요합니다 — 설정 → 채널');
  try {
    const body = { text };
    if (imageAbs) body.media = { media_ids: [await xUploadMedia(c, imageAbs)] };
    const url = 'https://api.x.com/2/tweets';
    // JSON body 요청 — 서명 파라미터는 oauth만
    const r = await http(url, {
      method: 'POST',
      headers: { Authorization: oauth1Header('POST', url, {}, c), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const msg = (r.json && (r.json.detail || (r.json.errors && JSON.stringify(r.json.errors)))) || `HTTP ${r.status}`;
      return fail('x', r.status === 402 || /credit/i.test(String(msg)) ? 'X API 크레딧이 부족합니다 (console.x.com에서 충전) — ' + msg : msg);
    }
    const id = r.json && r.json.data && r.json.data.id;
    return { ok: true, channel: 'x', id, url: id ? `https://x.com/i/status/${id}` : null };
  } catch (e) { return fail('x', e.message); }
}
async function testX() {
  const c = secrets.get('x');
  if (!c.apiKey) return { ok: false, error: '키 없음' };
  const url = 'https://api.x.com/2/users/me';
  const r = await http(url, { headers: { Authorization: oauth1Header('GET', url, {}, c) } });
  return r.ok ? { ok: true, detail: r.json && r.json.data && ('@' + r.json.data.username) } : { ok: false, error: (r.json && r.json.detail) || `HTTP ${r.status}` };
}

// ---- Facebook 페이지 ------------------------------------------------------------------
const FB_VER = 'v25.0';
async function publishFacebook({ text, imageAbs }) {
  const c = secrets.get('facebook');
  if (!c.pageId || !c.pageToken) return fail('facebook', '페이지 ID와 페이지 액세스 토큰이 필요합니다 — 설정 → 채널');
  try {
    if (imageAbs) {
      const form = new FormData();
      form.append('source', new Blob([fs.readFileSync(imageAbs)]), path.basename(imageAbs));
      form.append('caption', text);
      form.append('access_token', c.pageToken);
      const r = await http(`https://graph.facebook.com/${FB_VER}/${c.pageId}/photos`, { method: 'POST', body: form }, 120_000);
      if (!r.ok) return fail('facebook', (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`);
      return { ok: true, channel: 'facebook', id: r.json.post_id || r.json.id };
    }
    const r = await http(`https://graph.facebook.com/${FB_VER}/${c.pageId}/feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, access_token: c.pageToken }),
    });
    if (!r.ok) return fail('facebook', (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`);
    return { ok: true, channel: 'facebook', id: r.json.id };
  } catch (e) { return fail('facebook', e.message); }
}
async function testFacebook() {
  const c = secrets.get('facebook');
  if (!c.pageToken) return { ok: false, error: '토큰 없음' };
  const r = await http(`https://graph.facebook.com/${FB_VER}/${c.pageId || 'me'}?fields=name&access_token=${encodeURIComponent(c.pageToken)}`, {});
  return r.ok ? { ok: true, detail: r.json && r.json.name } : { ok: false, error: (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}` };
}

// ---- Threads --------------------------------------------------------------------------
// 이미지는 공개 URL이 필수(바이너리 업로드 미지원) — 텍스트만 직접 발행, 이미지 포스트는 수동 안내.
// 스토리라인은 댓글형 체인(첫 글 → reply_to_id로 이어붙임)이 흔하다 — segments로 지원.
const TH_BASE = 'https://graph.threads.net/v1.0';
async function threadsPost(c, text, replyToId) {
  // 컨테이너 생성 → (미디어면 status 대기) → 발행. reply_to_id면 앞 글에 이어붙는 답글.
  const q = new URLSearchParams({ media_type: 'TEXT', text, access_token: c.token });
  if (replyToId) q.set('reply_to_id', replyToId);
  const mk = await http(`${TH_BASE}/${c.userId}/threads?${q.toString()}`, { method: 'POST' });
  if (!mk.ok || !mk.json || !mk.json.id) throw new Error((mk.json && mk.json.error && mk.json.error.message) || `HTTP ${mk.status}`);
  const pub = await http(`${TH_BASE}/${c.userId}/threads_publish?creation_id=${mk.json.id}&access_token=${encodeURIComponent(c.token)}`, { method: 'POST' });
  if (!pub.ok || !pub.json || !pub.json.id) throw new Error((pub.json && pub.json.error && pub.json.error.message) || `HTTP ${pub.status}`);
  return pub.json.id;
}
// 본문을 체인 세그먼트로 분리 — 명시 segments 우선.
// threads-writer 스킬의 "Post 1/[n]:" / "1/3" 마커, "---", 빈 줄 2개를 경계로 인식하고
// 각 조각 앞머리의 번호 마커는 제거한다 (실제 게시 본문에는 "Post 1/3" 표기가 없어야).
const TH_MARKER = /^\s*(?:post\s*)?\d+\s*\/\s*\[?\d*\]?\s*[:.)]?\s*/i;
function splitThreadSegments(text, segments) {
  const clean = (s) => String(s).replace(TH_MARKER, '').trim();
  if (Array.isArray(segments) && segments.length) return segments.map(clean).filter(Boolean);
  const parts = String(text).split(/\n\s*(?:---+|===+)\s*\n|\n(?=\s*(?:post\s*)?\d+\s*\/\s*\[?\d)|\n{2,}/i);
  const out = parts.map(clean).filter(Boolean);
  return out.length ? out : [clean(text)];
}
async function publishThreads({ text, segments }) {
  const c = secrets.get('threads');
  if (!c.userId || !c.token) return fail('threads', 'Threads 사용자 ID와 토큰이 필요합니다 — 설정 → 채널');
  const parts = splitThreadSegments(text, segments).filter((p) => p.length);
  if (!parts.length) return fail('threads', '발행할 본문이 없습니다');
  try {
    // 500자 초과 세그먼트는 안내 (Threads 제한) — 자르지 않고 실패시켜 운영자가 손보게
    const tooLong = parts.findIndex((p) => p.length > 500);
    if (tooLong >= 0) return fail('threads', `${tooLong + 1}번째 세그먼트가 500자를 초과합니다 (${parts[tooLong].length}자) — 나눠주세요`);
    let firstId = null, prevId = null, published = 0;
    for (let i = 0; i < parts.length; i++) {
      const id = await threadsPost(c, parts[i], i === 0 ? null : prevId);
      if (i === 0) firstId = id;
      prevId = id; published++;
      if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 1200)); // 컨테이너 처리 여유
    }
    return {
      ok: true, channel: 'threads', id: firstId, chain: published,
      url: firstId ? `https://www.threads.net/t/${firstId}` : null,
    };
  } catch (e) { return fail('threads', e.message); }
}
async function testThreads() {
  const c = secrets.get('threads');
  if (!c.token) return { ok: false, error: '토큰 없음' };
  const r = await http(`https://graph.threads.net/v1.0/me?fields=username&access_token=${encodeURIComponent(c.token)}`, {});
  return r.ok ? { ok: true, detail: r.json && ('@' + r.json.username) } : { ok: false, error: (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}` };
}

// ---- LinkedIn ---------------------------------------------------------------------------
// 현행 /rest/posts + LinkedIn-Version 헤더. 이미지: initializeUpload → PUT 바이너리 → urn 첨부.
// 토큰은 60일 만료·프로그램 갱신 불가(솔로 앱) — 만료 시 재발급 필요.
const LI_VER = '202601';
const liHeaders = (token) => ({
  Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  'X-Restli-Protocol-Version': '2.0.0', 'LinkedIn-Version': LI_VER,
});
// little-format 예약 문자를 이스케이프 — 본문이 서식 문법으로 오해받지 않게
function liEscape(s) { return String(s).replace(/[\\(){}\[\]<>@|~_*]/g, (m) => '\\' + m); }
async function publishLinkedIn({ text, imageAbs }) {
  const c = secrets.get('linkedin');
  if (!c.personId || !c.token) return fail('linkedin', 'LinkedIn person ID와 토큰이 필요합니다 — 설정 → 채널');
  const author = `urn:li:person:${c.personId}`;
  try {
    let mediaUrn = null;
    if (imageAbs) {
      const init = await http('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST', headers: liHeaders(c.token),
        body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      });
      const v = init.json && init.json.value;
      if (!init.ok || !v || !v.uploadUrl) return fail('linkedin', '이미지 업로드 초기화 실패: ' + ((init.json && init.json.message) || init.status));
      const put = await fetch(v.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${c.token}` }, body: fs.readFileSync(imageAbs) });
      if (!put.ok) return fail('linkedin', `이미지 PUT 실패 HTTP ${put.status}`);
      mediaUrn = v.image;
    }
    const body = {
      author,
      commentary: liEscape(text),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (mediaUrn) body.content = { media: { id: mediaUrn } };
    const res = await fetch('https://api.linkedin.com/rest/posts', { method: 'POST', headers: liHeaders(c.token), body: JSON.stringify(body) });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (JSON.parse(await res.text()).message) || msg; } catch { /* empty body */ }
      return fail('linkedin', res.status === 401 ? '토큰이 만료됐습니다 (60일) — 재발급 후 설정에 저장하세요: ' + msg : msg);
    }
    const urn = res.headers.get('x-restli-id'); // 201 응답의 포스트 URN은 헤더로 온다
    return { ok: true, channel: 'linkedin', id: urn };
  } catch (e) { return fail('linkedin', e.message); }
}
async function testLinkedIn() {
  const c = secrets.get('linkedin');
  if (!c.token) return { ok: false, error: '토큰 없음' };
  const r = await http('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${c.token}` } });
  return r.ok ? { ok: true, detail: r.json && r.json.name } : { ok: false, error: `HTTP ${r.status}` };
}

// ---- 디스패치 + 상태 ----------------------------------------------------------------------
const PUBLISHERS = { x: publishX, facebook: publishFacebook, threads: publishThreads, linkedin: publishLinkedIn };
const TESTERS = { x: testX, facebook: testFacebook, threads: testThreads, linkedin: testLinkedIn };

// 채널별 직접 발행 가능 여부 (허브 배지·발행 패널이 소비)
function status() {
  return {
    x: { connected: secrets.has('x', ['apiKey', 'apiSecret', 'accessToken', 'accessSecret']), image: true },
    facebook: { connected: secrets.has('facebook', ['pageId', 'pageToken']), image: true },
    threads: { connected: secrets.has('threads', ['userId', 'token']), image: false, chain: true, imageNote: 'Threads API는 공개 이미지 URL만 받아 이미지 포스트는 수동 발행. 텍스트는 댓글형 체인(스토리라인) 발행 지원' },
    linkedin: { connected: secrets.has('linkedin', ['personId', 'token']), image: true },
    instagram: { connected: false, manualOnly: true, note: 'Instagram API는 공개 이미지 URL + 비즈니스 계정 필수 — 수동 발행 체크리스트 사용' },
    naver: { connected: false, manualOnly: true, note: '네이버 블로그는 공개 API 미제공 — 수동 발행 체크리스트 사용' },
  };
}

async function publishNow(dir, { uid, channel, text, imageRel, segments }) {
  const fn = PUBLISHERS[channel];
  if (!fn) return fail(channel, '이 채널은 직접 발행을 지원하지 않습니다 — 수동 체크리스트를 사용하세요');
  const hasSegs = Array.isArray(segments) && segments.length > 1;
  if ((!text || !text.trim()) && !hasSegs) return fail(channel, '발행할 본문이 비어 있습니다');
  let imageAbs = null;
  if (imageRel) {
    const abs = path.resolve(dir, imageRel);
    if (abs.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(abs)) imageAbs = abs;
  }
  const r = await fn({ text: (text || '').trim(), imageAbs, segments });
  if (r.ok && uid) {
    try {
      const log = publishlog.mark(dir, uid, true);
      // 발행 URL/ID도 남긴다 (수동 mark와 구분되는 직접 발행 기록)
      if (r.id || r.url) {
        log.direct = log.direct || {};
        log.direct[uid] = { channel, id: r.id || null, url: r.url || null, at: new Date().toISOString() };
        const p = path.join(dir, 'context', 'publish-log.json');
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(log, null, 2));
        fs.renameSync(tmp, p);
      }
    } catch { /* 기록 실패해도 발행은 성공 */ }
  }
  return r;
}

// ---- 예약 큐 + 스케줄러 --------------------------------------------------------------------
function queueFile(dir) { return path.join(dir, 'context', 'publish-queue.json'); }
function loadQueue(dir) {
  try { return JSON.parse(fs.readFileSync(queueFile(dir), 'utf8')); } catch { return { items: [] }; }
}
function saveQueue(dir, q) {
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  const tmp = queueFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(q, null, 2));
  fs.renameSync(tmp, queueFile(dir));
}
function schedule(dir, { uid, channel, text, imageRel, segments, when }) {
  const at = new Date(when);
  if (!(at instanceof Date) || isNaN(at)) return { ok: false, error: '예약 시각이 올바르지 않습니다' };
  if (at.getTime() < Date.now() - 60_000) return { ok: false, error: '과거 시각으로는 예약할 수 없습니다' };
  const q = loadQueue(dir);
  const qid = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  q.items.push({ qid, uid, channel, text, imageRel: imageRel || null, segments: Array.isArray(segments) ? segments : null, when: at.toISOString(), status: 'pending', createdAt: new Date().toISOString() });
  saveQueue(dir, q);
  return { ok: true, qid, when: at.toISOString() };
}
function listQueue(dir) {
  const q = loadQueue(dir);
  // 최근 완료/실패 20건 + 대기 전부
  const pending = q.items.filter((i) => i.status === 'pending');
  const past = q.items.filter((i) => i.status !== 'pending').slice(-20);
  return { pending, past };
}
function cancel(dir, qid) {
  const q = loadQueue(dir);
  const it = q.items.find((i) => i.qid === qid && i.status === 'pending');
  if (!it) return { ok: false, error: '대기 중인 예약을 찾지 못했습니다' };
  it.status = 'cancelled';
  saveQueue(dir, q);
  return { ok: true };
}

let timer = null;
let ticking = false;
// hooks: { send(channel,payload), notify(title,body), pushBoard(), listDirs?() }
function startScheduler(hooks) {
  const workspace = require('./workspace');
  const tick = async () => {
    if (ticking) return; // 발행이 1분보다 오래 걸려도 중첩 실행 금지
    ticking = true;
    try {
      const dirs = (hooks.listDirs ? hooks.listDirs() : workspace.listClients().map((c) => c.dir));
      for (const dir of dirs) {
        let q;
        try { q = loadQueue(dir); } catch { continue; }
        let changed = false;
        for (const it of q.items) {
          if (it.status !== 'pending' || new Date(it.when).getTime() > Date.now()) continue;
          it.status = 'publishing'; changed = true;
          saveQueue(dir, q);
          const r = await publishNow(dir, it);
          it.status = r.ok ? 'done' : 'failed';
          it.error = r.ok ? null : r.error;
          it.publishedAt = new Date().toISOString();
          try {
            hooks.send && hooks.send('pub2:done', { dir, qid: it.qid, uid: it.uid, channel: it.channel, ok: r.ok, error: it.error });
            hooks.notify && hooks.notify(r.ok ? '예약 발행 완료' : '예약 발행 실패', `${it.channel} — ${r.ok ? '게시됨' : it.error}`);
            hooks.pushBoard && hooks.pushBoard();
          } catch { /* 훅 실패는 큐를 깨지 않는다 */ }
        }
        if (changed) saveQueue(dir, q);
      }
    } catch { /* 다음 틱에 재시도 */ }
    ticking = false;
  };
  clearInterval(timer);
  timer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000); // 부팅 직후 밀린 예약 처리
}

async function test(channel) {
  const fn = TESTERS[channel];
  if (!fn) return { ok: false, error: '지원하지 않는 채널' };
  try { return await fn(); } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { status, publishNow, schedule, listQueue, cancel, startScheduler, test, _oauth1Header: oauth1Header };
