// Approval gate persistence + current-node computation.
// context/gates.json: { approvals: [{node, approvedAt, signer, note, warnSigned:[]}] }
const fs = require('fs');
const path = require('path');

// 8-node stepper — maps 1:1 to foundation + the 7 pipeline stages (publish node hosts review)
const NODES = [
  { key: 'foundation', label: '파운데이션', stage: null },
  { key: 'calendar', label: '캘린더', stage: 'calendar' },
  { key: 'copy', label: '카피', stage: 'copy' },
  { key: 'shortform', label: '릴스/보드', stage: 'shortform' },
  { key: 'visuals', label: '비주얼 브리프', stage: 'visuals' },
  { key: 'visuals-generate', label: '비주얼 생성', stage: 'visuals-generate' },
  { key: 'compliance', label: '컴플라이언스', stage: 'compliance' },
  { key: 'publish', label: '발행', stage: 'review' },
];

function gatesPath(dir) { return path.join(dir, 'context', 'gates.json'); }
function load(dir) {
  try { return JSON.parse(fs.readFileSync(gatesPath(dir), 'utf8')); } catch { return { approvals: [] }; }
}
function approve(dir, entry) {
  const g = load(dir);
  g.approvals = g.approvals.filter((a) => a.node !== entry.node);
  g.approvals.push({ ...entry, approvedAt: new Date().toISOString() });
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
  fs.writeFileSync(gatesPath(dir), JSON.stringify(g, null, 2));
  return g;
}
function approvedSet(g) { return new Set((g.approvals || []).map((a) => a.node)); }

// evidence per node from board data; approval unlocks regardless (conservative on ambiguity)
function computeGates(board, gatesData) {
  const ok = approvedSet(gatesData);
  const posts = board.posts || [];
  const at = (s) => posts.filter((p) => ['planned', 'copy', 'visual', 'review', 'ready'].indexOf(p.stage) >= ['planned', 'copy', 'visual', 'review', 'ready'].indexOf(s)).length;
  const evidence = {
    foundation: !!(board.foundation && board.foundation.brand),
    calendar: !!board.hasCalendar,
    copy: at('copy') > 0,
    shortform: posts.some((p) => p.isReel && ['visual', 'review', 'ready'].includes(p.stage)) || !posts.some((p) => p.isReel),
    visuals: at('visual') > 0 || posts.every((p) => !p.visual),
    'visuals-generate': (board.lanes && board.lanes.creatives || []).length > 0 || at('visual') > 0,
    compliance: !!(board.compliance && (board.compliance.pass + board.compliance.warn + board.compliance.block) > 0),
    publish: posts.length > 0 && posts.every((p) => p.stage === 'ready'),
  };
  const nodes = NODES.map((n) => ({
    ...n,
    done: !!(evidence[n.key] && (n.key === 'foundation' || n.key === 'calendar' ? true : true)),
    approved: ok.has(n.key),
    blocked: n.key === 'publish' && board.compliance && board.compliance.block > 0,
  }));
  // done = evidence && (auto nodes) — approval gates: calendar/copy/compliance need a stamp to unlock the NEXT node
  let current = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const needsStamp = ['calendar', 'copy', 'compliance'].includes(n.key);
    const cleared = n.done && (!needsStamp || n.approved);
    if (cleared) current = Math.min(i + 1, nodes.length - 1);
    else break;
  }
  return { nodes, current, approvals: gatesData.approvals || [] };
}

module.exports = { NODES, load, approve, computeGates };
