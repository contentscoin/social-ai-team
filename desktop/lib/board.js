// Live production board data — parses context/content-calendar.md into post cards
// and infers each post's pipeline stage from file evidence in outputs/.
// Stages: planned → copy → visual → review → ready   (cards move themselves; no manual drag)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STAGES = ['planned', 'copy', 'visual', 'review', 'ready'];
// 경로 키 캐시 — 같은 파일의 재기록은 엔트리를 교체하므로 누적되지 않는다
const textCache = new Map(); // path → { mtimeMs, size, text }
let cacheBytes = 0;

// ---- helpers -----------------------------------------------------------------
function read(p, cap = 512 * 1024) {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile() || stat.size > cap) return '';
    return fs.readFileSync(p, 'utf8');
  } catch { return ''; }
}
function cachedRead(fp, st) {
  const hit = textCache.get(fp);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text;
  const t = read(fp);
  if (hit) cacheBytes -= hit.text.length;
  cacheBytes += t.length;
  textCache.set(fp, { mtimeMs: st.mtimeMs, size: st.size, text: t });
  if (cacheBytes > 12 * 1024 * 1024) { // 12MB 초과 시 오래된 절반 퇴출 (삽입 순)
    let n = Math.floor(textCache.size / 2);
    for (const [k, v] of textCache) {
      if (n-- <= 0) break;
      cacheBytes -= v.text.length;
      textCache.delete(k);
    }
  }
  return t;
}
function readLane(dir, lane) {
  const p = path.join(dir, 'outputs', lane);
  let text = '';
  const files = [];
  try {
    for (const f of fs.readdirSync(p)) {
      const fp = path.join(p, f);
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      files.push({ name: f, rel: path.join('outputs', lane, f), mtime: st.mtimeMs, size: st.size, _fp: fp });
    }
  } catch { /* lane absent */ }
  files.sort((a, b) => b.mtime - a.mtime);
  // aggregate cap: newest 40 text files / 2MB per lane — watch events must stay cheap
  // perFile: 파일별 정규화 텍스트 — 카드가 "내 카피가 어느 파일에 있는지"를 찾을 수 있게
  const perFile = [];
  let budget = 2 * 1024 * 1024, count = 0;
  for (const f of files) {
    if (!/\.(md|txt|json|srt)$/i.test(f.name)) { perFile.push({ rel: f.rel, name: f.name, norm: norm(f.name) }); continue; }
    if (++count > 40 || (budget -= f.size) < 0) break;
    const t = cachedRead(f._fp, { mtimeMs: f.mtime, size: f.size });
    text += '\n' + t;
    perFile.push({ rel: f.rel, name: f.name, norm: norm(f.name + ' ' + t) });
  }
  for (const f of files) delete f._fp;
  return { text, files, perFile };
}
// normalize for fuzzy topic matching (Korean + English, drop spaces/punctuation)
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
// does haystack contain a meaningful chunk of the topic?
function topicIn(haystackNorm, topic) {
  const t = norm(topic);
  if (!t) return false;
  if (haystackNorm.includes(t)) return true;
  if (t.length < 12) return false;
  // sliding 12-char windows — defends against writers trimming/reflowing titles
  for (let i = 0; i + 12 <= Math.min(t.length, 42); i += 6) {
    if (haystackNorm.includes(t.slice(i, i + 12))) return true;
  }
  return false;
}

// ---- calendar parsing ----------------------------------------------------------
// 필드 라인 — "- Format: reel"/"* **Format**: reel"처럼 리스트 마커·볼드 장식이 붙어도 잡는다
const F = (name) => new RegExp(`^\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${name}(?:\\*\\*)?\\s*[:：]\\s*(.+)$`, 'im');
const FIELD_RE = {
  platform: F('(?:Platform|플랫폼|채널)'),
  pillar: F('(?:Pillar|필러)'),
  format: F('(?:Format|형식|포맷)'),
  objective: F('(?:Objective|목표)'),
  topic: F('(?:Topic|주제|토픽)'),
  angle: F('(?:Angle|앵글)'),
  visual: F('(?:Visual direction|Visual|비주얼(?:\\s*디렉션)?)'),
  notes: F('(?:Notes|노트|비고)'),
};

function parsePostBlock(n, header, block) {
  const post = { n, week: '', day: '', platform: '', pillar: '', format: '', objective: '', topic: '', angle: '', visual: '', notes: '' };
  // canonical: "Week: 1 | Day: Mon" — demo variant: header "POST 1 — Week 3, Monday — Instagram — ..."
  const wk = block.match(/^Week:\s*(\S+)\s*\|\s*Day:\s*(\S+)/im) || header.match(/Week\s*(\d+)[,\s—-]+\s*(\w+)/i);
  if (wk) { post.week = String(wk[1]).replace(/^W/i, ''); post.day = wk[2]; }
  for (const [k, re] of Object.entries(FIELD_RE)) {
    const m = block.match(re);
    if (m) post[k === 'visual' ? 'visual' : k] = m[1].trim();
  }
  // header-line fallbacks (demo format: POST 1 — Week 3, Monday — Instagram — 브랜드 스토리 — single image — brand awareness)
  const parts = header.split(/\s+—\s+|\s+-\s+/).map((s) => s.trim());
  if (!post.platform) {
    const plat = parts.find((s) => /instagram|facebook|linkedin|threads|naver|x$|^x\b|tiktok/i.test(s));
    if (plat) post.platform = plat;
  }
  if (!post.format) {
    const fmt = parts.find((s) => /^(single image|carousel|reel|poll|text|long-form|video|릴스|캐러셀|이미지)/i.test(s));
    if (fmt) post.format = fmt;
  }
  if (!post.topic) {
    // 구분자(—/:)는 선택 — "IG-1 홈카페 라떼 아트"처럼 공백만 있는 헤더도 토픽으로 잡는다
    const tm = header.match(/^(?:POST\s*\d+|[A-Z]{1,2}-\d+)\s*[—:–-]?\s*(.+)$/i);
    if (tm) {
      const t = tm[1].split(/\s+—\s+/)[0].replace(/^Week\s*\d+[,\s]*/i, '').trim();
      if (t) post.topic = t;
    }
  }
  post.headerRaw = header;
  return post;
}

const ID_PLATFORM = { IG: 'Instagram', FB: 'Facebook', LI: 'LinkedIn', LN: 'LinkedIn', IN: 'LinkedIn', TH: 'Threads', X: 'X', NV: 'Naver Blog', NB: 'Naver Blog', TT: 'TikTok' };
// 렌더 엔진의 파일명 프리픽스 (render.js와 계약: `${chId}-${n}.png` → 카드 자동 매칭)
const CH_ID = { instagram: 'ig', facebook: 'fb', linkedin: 'li', threads: 'th', x: 'x', naver: 'nv', tiktok: 'tt', etc: 'etc' };
function parseCalendar(md) {
  const posts = [];
  // 앵커 두 형태: "POST 12 …" 또는 채널-ID "IG-4 …" (헤딩/볼드 장식 허용)
  const anchors = [...md.matchAll(/^#{0,4}\s*\**\s*(?:POST\s*(\d+)|(IG|FB|LI|LN|IN|TH|X|NV|NB|TT)-(\d+))\b\**\s*(.*)$/gim)];
  for (let i = 0; i < anchors.length; i++) {
    const m = anchors[i];
    const start = m.index + m[0].length;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : Math.min(md.length, start + 2500);
    const n = Number(m[1] || m[3]);
    const header = (m[2] ? m[2] + '-' + m[3] + ' ' : 'POST ' + n + ' ') + (m[4] || '');
    const post = parsePostBlock(n, header, md.slice(start, end));
    if (m[2] && !post.platform) post.platform = ID_PLATFORM[m[2].toUpperCase()] || m[2];
    posts.push(post);
  }
  if (posts.length) return dedupe(posts);
  // fallback 1: 헤더 매핑 테이블 — 모든 표를 스캔해 "캘린더 시그니처"가 가장 강한 표를 채택
  // (판정표/요약표가 '주제' 유사 헤더를 가져도 week/day/platform/format 시그니처가 없으면 탈락)
  const lines = md.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|.*\|/.test(lines[i]) || !/^\|[\s:|-]+\|/.test(lines[i + 1] || '')) continue;
    const headers = lines[i].split('|').slice(1, -1).map((h) => h.trim().toLowerCase());
    const col = (...keys) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
    // ID 컬럼은 앵커드 매칭 — 'notes'가 'no'에 걸리는 부분 문자열 오탐 방지
    const cId = headers.findIndex((h) => ['id', '#', 'no', 'no.'].includes(h) || h.startsWith('번호'));
    const cTopic = col('topic', '주제', '토픽', '제목');
    if (cTopic < 0) continue;
    const cWeek = col('week', '주차'), cDay = col('day', '요일', '날짜', 'date'),
      cPlat = col('platform', '채널', '플랫폼'), cPil = col('pillar', '필러'),
      cFmt = col('format', '형식', '포맷'), cObj = col('objective', '목표');
    const signature = [cWeek, cDay, cPlat, cFmt, cPil].filter((c) => c >= 0).length;
    if (signature < 2) continue; // 캘린더 표가 아님
    const rows = [];
    for (let r = i + 2; r < lines.length && /^\|.*\|/.test(lines[r]); r++) {
      const cells = lines[r].split('|').slice(1, -1).map((c) => c.trim().replace(/\*\*/g, ''));
      const idCell = cId >= 0 ? (cells[cId] || '') : '';
      const idm = idCell.match(/^([A-Za-z]{1,2})-?(\d+)|^(\d+)$/);
      if (cId >= 0 && !idm) continue;
      const at = (c) => (c >= 0 && cells[c]) || '';
      if (!at(cTopic)) continue;
      rows.push({
        n: Number((idm && (idm[2] || idm[3])) || rows.length + 1),
        week: at(cWeek).replace(/^W/i, ''), day: at(cDay),
        platform: at(cPlat) || (idm && idm[1] ? (ID_PLATFORM[idm[1].toUpperCase()] || '') : ''),
        pillar: at(cPil), format: at(cFmt), objective: at(cObj),
        topic: at(cTopic), angle: '', visual: '', notes: '', headerRaw: idCell,
      });
    }
    if (rows.length && (!best || signature > best.signature || (signature === best.signature && rows.length > best.rows.length))) {
      best = { signature, rows };
    }
  }
  return dedupe(best ? best.rows : posts);
}
function dedupe(posts) {
  const seen = new Map();
  for (const p of posts) {
    const key = p.n + '|' + norm(p.topic).slice(0, 24);
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()].sort((a, b) => a.n - b.n);
}

// ---- platform → lane mapping -----------------------------------------------------
function laneOf(platform) {
  const p = String(platform).toLowerCase();
  if (/instagram|facebook|tiktok/.test(p)) return 'captions';
  if (/linkedin/.test(p)) return 'linkedin';
  if (/threads/.test(p)) return 'threads';
  if (/naver|네이버/.test(p)) return 'naver';
  if (/^x\b|x\/|twitter|(^|\W)x(\W|$)/.test(p)) return 'x';
  return 'captions';
}
function channelKey(platform) {
  const p = String(platform).toLowerCase();
  if (/instagram/.test(p)) return 'instagram';
  if (/facebook/.test(p)) return 'facebook';
  if (/linkedin/.test(p)) return 'linkedin';
  if (/threads/.test(p)) return 'threads';
  if (/naver|네이버/.test(p)) return 'naver';
  if (/tiktok/.test(p)) return 'tiktok';
  if (/twitter|^x\b|(^|\W)x(\W|$)/.test(p)) return 'x';
  return 'etc';
}

// ---- verdict parsing ---------------------------------------------------------------
const VERDICT_RANK = { PASS: 1, WARN: 2, BLOCK: 3 };
function lineCitesPostNumber(line, n) {
  // 원본 라인에서 숫자를 경계까지 정확히 비교 — norm 기반 includes('post1')는 POST 10~19에 오탐
  for (const m of line.matchAll(/POST\s*#?0*(\d+)/gi)) if (Number(m[1]) === n) return true;
  for (const m of line.matchAll(/\b[A-Z]{1,2}-0*(\d+)\b/g)) if (Number(m[1]) === n) return true;
  return false;
}
function verdictFor(complianceRaw, post) {
  if (!complianceRaw) return null;
  const lines = complianceRaw.split(/\r?\n/).filter((l) => /PASS|WARN|BLOCK/.test(l));
  let worst = null;
  for (const line of lines) {
    const ln = norm(line);
    const byTopic = topicIn(ln, post.topic);
    // fallback: "POST n"/"IG-n" 인용 + 레인/플랫폼 동시 언급 (실제 판정표 형태)
    const byNumber = lineCitesPostNumber(line, post.n) && (ln.includes(post.lane) || ln.includes(norm(post.platform)));
    if (byTopic || byNumber) {
      const m = line.match(/BLOCK|WARN|PASS/);
      if (m && (!worst || VERDICT_RANK[m[0]] > VERDICT_RANK[worst])) worst = m[0];
    }
  }
  return worst;
}

// ---- main entry ----------------------------------------------------------------------
// 기계 판독용 인덱스 — 마크다운 형식과 무관하게 보드를 보장하는 1순위 소스.
// 단, md가 인덱스보다 새로우면(인덱스를 안 만드는 경로로 재생성됨) 낡은 인덱스를 무시한다.
function loadIndex(dir) {
  try {
    const ixPath = path.join(dir, 'context', 'calendar-index.json');
    const mdPath = path.join(dir, 'context', 'content-calendar.md');
    try {
      const ixM = fs.statSync(ixPath).mtimeMs;
      const mdM = fs.statSync(mdPath).mtimeMs;
      if (mdM > ixM + 2000) return null; // md가 더 새로움 — 인덱스 스테일
    } catch { /* 둘 중 하나 없음 — 아래 파싱 시도 */ }
    const j = JSON.parse(read(ixPath));
    if (!Array.isArray(j.posts) || !j.posts.length) return null;
    return j.posts.map((p, i) => {
      const id = String(p.id || '');
      const idm = id.match(/^([A-Za-z]{1,2})-?(\d+)/);
      // 스키마 드리프트 허용 — 모델이 platform 대신 channel, n 대신 no/number로 쓰는 경우
      const nRaw = Number(p.n || p.no || p.number || (idm && idm[2]));
      return {
        n: Number.isFinite(nRaw) && nRaw > 0 ? nRaw : i + 1,
        week: String(p.week || '').replace(/^W/i, ''),
        day: String(p.day || ''),
        platform: p.platform || p.channel || (idm && ID_PLATFORM[idm[1].toUpperCase()]) || '',
        pillar: p.pillar || '', format: p.format || '', objective: p.objective || '',
        topic: p.topic || '', angle: p.angle || '', visual: p.visual || '', notes: p.notes || '',
        headerRaw: id,
      };
    });
  } catch { return null; }
}

function buildBoard(dir) {
  const calMd = read(path.join(dir, 'context', 'content-calendar.md'));
  const indexPosts = loadIndex(dir);
  const posts = indexPosts || (calMd ? parseCalendar(calMd) : []);

  const lanes = {};
  for (const lane of ['captions', 'linkedin', 'threads', 'x', 'naver', 'videos', 'storyboards', 'creatives', 'compliance', 'reviews']) {
    lanes[lane] = readLane(dir, lane);
    lanes[lane].norm = norm(lanes[lane].text);
  }
  const statusRaw = read(path.join(dir, 'context', 'workflow-status.md'));
  const publishedLane = /Published via Blotato[^\n]*\[x\]|\[x\][^\n]*Published via Blotato/i.test(statusRaw)
    || /^- \[x\].*Blotato.*scheduled/im.test(statusRaw);

  const cards = posts.map((post) => {
    const lane = laneOf(post.platform);
    const isReel = /reel|video|영상|릴스|shorts|tiktok/i.test(post.format + ' ' + (post.headerRaw || ''));
    const copyDone = topicIn(lanes[lane].norm, post.topic);
    // 렌더 엔진 산출물 — `${chId}-${n}` 프리픽스 파일명으로 이 포스트에 직접 매칭
    const chId = CH_ID[channelKey(post.platform)] || 'etc';
    const rendPrefix = new RegExp(`^${chId}-0*${post.n}(?![0-9])`, 'i');
    const renders = (lanes.creatives.files || []).filter((f) => rendPrefix.test(f.name) && /\.(png|jpe?g|webp)$/i.test(f.name));
    const videoRenders = (lanes.videos.files || []).filter((f) => rendPrefix.test(f.name) && /\.(mp4|webm|mov)$/i.test(f.name));
    const visualDone = isReel
      ? videoRenders.length > 0 || topicIn(lanes.videos.norm, post.topic) || topicIn(lanes.storyboards.norm, post.topic)
      : renders.length > 0 || (lanes.creatives.files.length > 0 && topicIn(norm(lanes.creatives.text), post.topic));
    const verdict = verdictFor(lanes.compliance.text, { ...post, lane });

    let stage = 'planned';
    if (copyDone) stage = 'copy';
    if (copyDone && visualDone) stage = 'visual';
    // verdicts only promote posts that actually have copy evidence — a stale
    // compliance file must not mark an unwritten post publish-ready
    if (copyDone && (verdict === 'WARN' || verdict === 'BLOCK')) stage = 'review';
    if (copyDone && verdict === 'PASS') stage = 'ready';

    // 이 포스트의 근거 파일들 — 인스펙터/카드에서 바로 열 수 있게 (레인 첫 파일이 아니라 실제 매칭)
    const matchFiles = (laneObj, kind, limit) => (laneObj.perFile || [])
      .filter((pf) => topicIn(pf.norm, post.topic)).slice(0, limit)
      .map((pf) => ({ rel: pf.rel, kind }));
    const files = [...matchFiles(lanes[lane], 'copy', 2)];
    if (isReel) files.push(...matchFiles(lanes.videos, 'video', 1), ...matchFiles(lanes.storyboards, 'board', 1));
    files.push(...renders.slice(0, 3).map((f) => ({ rel: f.rel, kind: 'render' })));
    files.push(...videoRenders.slice(0, 2).map((f) => ({ rel: f.rel, kind: 'videorender' })));
    files.push(...matchFiles(lanes.creatives, 'creative', 2));
    if (verdict && (lanes.compliance.perFile || []).length) files.push({ rel: lanes.compliance.perFile[0].rel, kind: 'verdict' });

    return {
      ...post, lane, isReel, stage, verdict: copyDone ? verdict : null, channel: channelKey(post.platform), files,
      // 카드 썸네일 — 최신 렌더 이미지 (fs.watch가 생성 즉시 반영)
      thumb: renders[0] ? renders[0].rel : null,
      videoThumb: videoRenders[0] ? videoRenders[0].rel : null,
      chId,
    };
  });
  // 채널-ID 캘린더는 IG-1과 TH-1처럼 번호가 겹친다 — 카드 식별은 uid로
  const seenUid = new Set();
  let publishLog = {};
  try { publishLog = (JSON.parse(read(path.join(dir, 'context', 'publish-log.json'))) || {}).published || {}; } catch { /* none */ }
  let calMtime = 0;
  try { calMtime = fs.statSync(path.join(dir, 'context', 'content-calendar.md')).mtimeMs; } catch { /* none */ }
  for (const c of cards) {
    let uid = `${c.channel}-${c.n}`;
    while (seenUid.has(uid)) uid += 'x';
    seenUid.add(uid);
    c.uid = uid;
    c.published = !!publishLog[uid];
    // stale: 캘린더(상위 계획)가 이 카드의 카피 산출물보다 최신 → 재생성 검토 필요
    const laneNewest = (lanes[c.lane].files[0] || {}).mtime || 0;
    c.stale = c.stage !== 'planned' && calMtime > laneNewest && laneNewest > 0;
  }

  // channel aggregates
  const channels = {};
  for (const c of cards) {
    const k = c.channel;
    channels[k] = channels[k] || {
      key: k, posts: 0, byStage: { planned: 0, copy: 0, visual: 0, review: 0, ready: 0 },
      warn: 0, block: 0, lane: c.lane,
      // 발행 경로: 네이버/인스타그램은 API 제약으로 수동, 나머지는 직접 API(토큰 연결 시) — 렌더러가 pub2 status와 조합
      publishRoute: (k === 'naver' || k === 'instagram') ? 'manual' : 'api',
      files: [],
    };
    channels[k].posts += 1;
    channels[k].byStage[c.stage] += 1;
    if (c.verdict === 'WARN') channels[k].warn += 1;
    if (c.verdict === 'BLOCK') channels[k].block += 1;
  }
  for (const ch of Object.values(channels)) {
    ch.files = (lanes[ch.lane] ? lanes[ch.lane].files : []).slice(0, 5);
  }

  const laneFiles = {};
  for (const [name, l] of Object.entries(lanes)) laneFiles[name] = l.files;

  return {
    hasCalendar: !!calMd || !!indexPosts,
    fromIndex: !!indexPosts,
    calendarHash: calMd
      ? crypto.createHash('sha1').update(calMd).digest('hex').slice(0, 12)
      : (indexPosts ? crypto.createHash('sha1').update(JSON.stringify(indexPosts)).digest('hex').slice(0, 12) : null),
    posts: cards,
    stages: STAGES,
    channels: Object.values(channels).sort((a, b) => b.posts - a.posts),
    lanes: laneFiles,
    foundation: {
      brand: fs.existsSync(path.join(dir, 'context', 'brand-style.md')),
      voice: fs.existsSync(path.join(dir, 'context', 'kr-voice-profile.md')),
      calendar: !!calMd,
    },
    compliance: {
      file: lanes.compliance.files[0] || null,
      pass: cards.filter((c) => c.verdict === 'PASS').length,
      warn: cards.filter((c) => c.verdict === 'WARN').length,
      block: cards.filter((c) => c.verdict === 'BLOCK').length,
    },
  };
}

module.exports = { buildBoard, parseCalendar, STAGES };
