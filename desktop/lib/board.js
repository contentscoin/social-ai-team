// Live production board data — parses context/content-calendar.md into post cards
// and infers each post's pipeline stage from file evidence in outputs/.
// Stages: planned → copy → visual → review → ready   (cards move themselves; no manual drag)
const fs = require('fs');
const path = require('path');

const STAGES = ['planned', 'copy', 'visual', 'review', 'ready'];

// ---- helpers -----------------------------------------------------------------
function read(p, cap = 512 * 1024) {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile() || stat.size > cap) return '';
    return fs.readFileSync(p, 'utf8');
  } catch { return ''; }
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
      files.push({ name: f, rel: path.join('outputs', lane, f), mtime: st.mtimeMs, size: st.size });
      if (/\.(md|txt|json|srt)$/i.test(f)) text += '\n' + read(fp);
    }
  } catch { /* lane absent */ }
  files.sort((a, b) => b.mtime - a.mtime);
  return { text, files };
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
const FIELD_RE = {
  platform: /^Platform:\s*(.+)$/im,
  pillar: /^Pillar:\s*(.+)$/im,
  format: /^Format:\s*(.+)$/im,
  objective: /^Objective:\s*(.+)$/im,
  topic: /^Topic:\s*(.+)$/im,
  angle: /^Angle:\s*(.+)$/im,
  visual: /^Visual direction:\s*(.+)$/im,
  notes: /^Notes:\s*(.+)$/im,
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
    const tm = header.match(/^POST\s*\d+\s*[—-]\s*(.+)$/i);
    if (tm) post.topic = tm[1].split(/\s+—\s+/)[0].trim();
  }
  post.headerRaw = header;
  return post;
}

function parseCalendar(md) {
  const posts = [];
  const anchors = [...md.matchAll(/^(POST\s*(\d+)\b.*)$/gim)];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index + anchors[i][0].length;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : Math.min(md.length, start + 2500);
    posts.push(parsePostBlock(Number(anchors[i][2]), anchors[i][1], md.slice(start, end)));
  }
  if (posts.length) return dedupe(posts);
  // fallback: summary table | # | Week | Day | Platform | Pillar | Format | Topic |
  for (const row of md.matchAll(/^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)) {
    posts.push({
      n: Number(row[1]), week: row[2].trim().replace(/^W/i, ''), day: row[3].trim(),
      platform: row[4].trim(), pillar: row[5].trim(), format: row[6].trim(),
      objective: '', topic: row[7].trim(), angle: '', visual: '', notes: '',
    });
  }
  return dedupe(posts);
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
function verdictFor(complianceRaw, post) {
  if (!complianceRaw) return null;
  const lines = complianceRaw.split(/\r?\n/).filter((l) => /PASS|WARN|BLOCK/.test(l));
  const postTag = 'post' + post.n;
  let worst = null;
  for (const line of lines) {
    const ln = norm(line);
    const byTopic = topicIn(ln, post.topic);
    // fallback: verdict rows that cite "POST n" + the post's lane/platform (real guardrail table shape)
    const byNumber = ln.includes(postTag) && (ln.includes(post.lane) || ln.includes(norm(post.platform)));
    if (byTopic || byNumber) {
      const m = line.match(/BLOCK|WARN|PASS/);
      if (m && (!worst || VERDICT_RANK[m[0]] > VERDICT_RANK[worst])) worst = m[0];
    }
  }
  return worst;
}

// ---- main entry ----------------------------------------------------------------------
function buildBoard(dir) {
  const calMd = read(path.join(dir, 'context', 'content-calendar.md'));
  const posts = calMd ? parseCalendar(calMd) : [];

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
    const visualDone = isReel
      ? topicIn(lanes.videos.norm, post.topic) || topicIn(lanes.storyboards.norm, post.topic)
      : lanes.creatives.files.length > 0 && topicIn(norm(lanes.creatives.text), post.topic);
    const verdict = verdictFor(lanes.compliance.text, { ...post, lane });

    let stage = 'planned';
    if (copyDone) stage = 'copy';
    if (copyDone && visualDone) stage = 'visual';
    if (verdict === 'WARN' || verdict === 'BLOCK') stage = 'review';
    if (verdict === 'PASS') stage = 'ready';

    return { ...post, lane, isReel, stage, verdict, channel: channelKey(post.platform) };
  });

  // channel aggregates
  const channels = {};
  for (const c of cards) {
    const k = c.channel;
    channels[k] = channels[k] || {
      key: k, posts: 0, byStage: { planned: 0, copy: 0, visual: 0, review: 0, ready: 0 },
      warn: 0, block: 0, lane: c.lane,
      publishRoute: k === 'naver' ? 'manual' : 'blotato',
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

  return {
    hasCalendar: !!calMd,
    posts: cards,
    stages: STAGES,
    channels: Object.values(channels).sort((a, b) => b.posts - a.posts),
    compliance: {
      file: lanes.compliance.files[0] || null,
      pass: cards.filter((c) => c.verdict === 'PASS').length,
      warn: cards.filter((c) => c.verdict === 'WARN').length,
      block: cards.filter((c) => c.verdict === 'BLOCK').length,
    },
  };
}

module.exports = { buildBoard, parseCalendar, STAGES };
