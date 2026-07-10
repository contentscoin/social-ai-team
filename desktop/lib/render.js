// 인앱 렌더 엔진 — 프롬프트 md에서 멈추지 않고 실제 PNG/MP4를 만든다.
// 이미지: claude-svg(클로드 디자인, 추가 키 불필요) / openai-image(gpt-image-1) / ima2(ChatGPT OAuth)
// 영상:   runway / higgsfield / google-veo(Gemini API) / replicate(오픈모델 게이트웨이)
//         / ffmpeg(로컬 무료 슬라이드쇼·켄번즈) / comfyui(오픈소스 로컬) / custom-http / ima2-video(Grok)
// 산출 파일명은 `${chId}-${n}` 프리픽스 — board.js가 카드에 자동 매칭해 썸네일로 표시한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runCmd, isWin } = require('./proc');
const secrets = require('./secrets');
const config = require('./config');
const { svgToPng, extractSvg } = require('./svg2png');

const SIZES = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], landscape: [1200, 675] };

// ---- 공용 ----------------------------------------------------------------------
function outName(dir, sub, base, ext) {
  const d = path.join(dir, 'outputs', sub);
  fs.mkdirSync(d, { recursive: true });
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? `${base}.${ext}` : `${base}_v${i}.${ext}`;
    if (!fs.existsSync(path.join(d, name))) return { abs: path.join(d, name), rel: path.join('outputs', sub, name) };
  }
  const name = `${base}_${Date.now()}.${ext}`;
  return { abs: path.join(d, name), rel: path.join('outputs', sub, name) };
}

async function fetchJson(url, opts, timeoutMs = 120_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { status: res.status, ok: res.ok, json, text };
  } finally { clearTimeout(t); }
}

async function downloadTo(url, absPath, timeoutMs = 300_000, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buf);
    return buf.length;
  } finally { clearTimeout(t); }
}

function err(provider, message) { return { ok: false, provider, error: String(message).slice(0, 500) }; }

// ---- 이미지 프로바이더 -------------------------------------------------------------
// (1) 클로드 디자인 — claude가 브랜드 스타일 기반 SVG를 설계하고 앱이 PNG로 굽는다.
//     API 키가 하나도 없어도 동작하는 기본 레인. 텍스트 카드·인포그래픽에 강함.
async function genClaudeSvg(dir, job, onLine) {
  const [w, h] = SIZES[job.size] || SIZES.square;
  const model = config.getModels().claude;
  const args = ['-p', '--add-dir', dir];
  if (model) args.push('--model', model);
  // 디자인 팩(레이아웃 아키타입·한글 타이포 규칙) 주입 — 매번 다른 즉흥 디자인이 아니라 검증된 틀 위에서
  let designPack = '';
  try { designPack = require('./promptlab').packContext('svg', 6000); } catch { /* 팩 없이도 동작 */ }
  const prompt =
    `${dir}/context/brand-style.md 를 읽고(없으면 모던·미니멀 기본), 아래 소셜 포스트의 피드 이미지를 SVG로 디자인하라.\n` +
    `규칙:\n- 캔버스 정확히 ${w}x${h} (viewBox="0 0 ${w} ${h}", width/height 명시)\n` +
    `- 아래 디자인 팩의 아키타입 중 포스트 성격에 맞는 것 하나를 고르고, 한글 타이포·색·여백 규칙을 그대로 지켜라\n` +
    `- 브랜드 팔레트와 무드 반영, 사진 대신 도형·그라디언트·패턴 일러스트 구성\n` +
    `- 한글 텍스트 font-family="Pretendard, 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"\n` +
    `- 외부 이미지/폰트/스크립트 참조 절대 금지 (완전 self-contained)\n` +
    `- 출력은 SVG 코드만. 설명·코드펜스 금지. 반드시 <svg 로 시작해 </svg>로 끝낼 것.\n\n` +
    `[포스트]\n${job.prompt}` +
    (designPack ? `\n\n[디자인 팩]\n${designPack}` : '');
  onLine && onLine('[render] 클로드 디자인 — SVG 설계 중…');
  const r = await runCmd('claude', args, null, { cwd: dir, stdinText: prompt, timeoutMs: 5 * 60_000 });
  const svg = extractSvg(r.out);
  if (!svg) return err('claude-svg', 'SVG를 받지 못했습니다: ' + (r.tail || '').slice(-200));
  const { abs, rel } = outName(dir, 'creatives', job.base, 'png');
  onLine && onLine('[render] SVG → PNG 변환 중…');
  await svgToPng(svg, w, h, abs);
  try { fs.writeFileSync(abs.replace(/\.png$/, '.svg'), svg); } catch { /* 소스 보존 실패는 무시 */ }
  return { ok: true, provider: 'claude-svg', rel, files: [rel] };
}

// (2) OpenAI 이미지 (gpt-image-1) — "코덱스 이미지" 직결 레인. OPENAI_API_KEY 필요.
async function genOpenAI(dir, job, onLine) {
  const key = secrets.get('openai').apiKey || process.env.OPENAI_API_KEY;
  if (!key) return err('openai-image', 'OpenAI API 키가 없습니다 — 설정 → 렌더에서 입력하세요');
  const [w, h] = SIZES[job.size] || SIZES.square;
  const apiSize = w === h ? '1024x1024' : (h > w ? '1024x1536' : '1536x1024');
  onLine && onLine(`[render] OpenAI gpt-image-1 생성 중… (${apiSize})`);
  const r = await fetchJson('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: job.prompt, size: apiSize, n: 1 }),
  }, 300_000);
  if (!r.ok) return err('openai-image', (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`);
  const b64 = r.json && r.json.data && r.json.data[0] && r.json.data[0].b64_json;
  if (!b64) return err('openai-image', '응답에 이미지가 없습니다');
  const { abs, rel } = outName(dir, 'creatives', job.base, 'png');
  fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  return { ok: true, provider: 'openai-image', rel, files: [rel] };
}

// (3) ima2 — ChatGPT OAuth 이미지 (설치 마법사의 ima2 레인 재사용)
// ima2 gen은 로컬 `ima2 serve` 데몬이 필요하다 — 죽어 있으면 자동 기동 후 1회 재시도.
let ima2ServeLastStart = 0;
async function ensureIma2Serve(onLine) {
  if (Date.now() - ima2ServeLastStart < 5 * 60_000) return false; // 5분 내 재기동 반복 금지
  ima2ServeLastStart = Date.now();
  onLine && onLine('[render] ima2 serve가 꺼져 있음 — 자동 시작합니다…');
  try {
    const { spawn } = require('child_process');
    const { resolveCmd, envWithPath } = require('./proc');
    const cmd = resolveCmd('ima2') || 'ima2';
    const p = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore', env: envWithPath(), shell: isWin, windowsHide: true });
    p.unref();
  } catch { return false; }
  await new Promise((r) => setTimeout(r, 6000)); // 서버 기동 대기
  return true;
}
const IMA2_DOWN = /server unreachable|ima2 serve/i;
async function genIma2(dir, job, onLine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-ima2-'));
  onLine && onLine('[render] ima2 생성 중…');
  const run = () => runCmd('ima2', ['gen', job.prompt, '-d', tmp, '--quality', 'high'], onLine, { cwd: dir, timeoutMs: 10 * 60_000 });
  let r = await run();
  if (!r.ok && IMA2_DOWN.test(r.out) && await ensureIma2Serve(onLine)) r = await run();
  const made = (fs.existsSync(tmp) ? fs.readdirSync(tmp) : []).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!r.ok || !made.length) return err('ima2', r.tail || 'ima2가 이미지를 만들지 못했습니다');
  const { abs, rel } = outName(dir, 'creatives', job.base, path.extname(made[0]).slice(1));
  fs.copyFileSync(path.join(tmp, made[0]), abs);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp */ }
  return { ok: true, provider: 'ima2', rel, files: [rel] };
}

// ---- 영상 프로바이더 --------------------------------------------------------------
// (4) Runway — image_to_video. 키프레임(생성 이미지)을 data URI로 넣는다 (이미지 ≤5MB).
//     출력 URL은 24~48시간 내 만료 — 즉시 다운로드해 저장한다.
async function genRunway(dir, job, onLine) {
  const s = secrets.get('runway');
  if (!s.apiKey) return err('runway', 'Runway API 키가 없습니다 — 설정 → 렌더에서 입력하세요');
  if (!job.refAbs) return err('runway', '키프레임 이미지가 필요합니다 — 먼저 이미지 레인으로 키프레임을 생성하세요');
  const buf = fs.readFileSync(job.refAbs);
  if (buf.length > 4.8 * 1024 * 1024) return err('runway', '키프레임이 5MB를 넘습니다 — 더 작은 이미지를 사용하세요');
  const mime = /\.png$/i.test(job.refAbs) ? 'image/png' : 'image/jpeg';
  const headers = { Authorization: `Bearer ${s.apiKey}`, 'X-Runway-Version': s.version || '2024-11-06', 'Content-Type': 'application/json' };
  const ratio = job.size === 'story' || job.size === 'portrait' ? '720:1280' : (job.size === 'landscape' ? '1280:720' : '960:960');
  onLine && onLine('[render] Runway 태스크 제출 중…');
  const create = await fetchJson('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: s.model || 'gen4_turbo', // 5크레딧/초 — 가장 저렴한 i2v 모델
      promptImage: `data:${mime};base64,${buf.toString('base64')}`,
      promptText: job.prompt.slice(0, 1000),
      ratio, duration: Number(job.duration) || 5,
    }),
  });
  if (!create.ok) return err('runway', (create.json && (JSON.stringify(create.json.error || create.json).slice(0, 200))) || `HTTP ${create.status}`);
  const id = create.json && create.json.id;
  if (!id) return err('runway', '태스크 id를 받지 못했습니다');
  // 폴링 — 5초 간격(공식 권장 최소), 보통 1~3분. THROTTLED/PENDING/RUNNING은 계속 대기.
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetchJson(`https://api.dev.runwayml.com/v1/tasks/${id}`, { headers });
    const status = st.json && st.json.status;
    if (i % 6 === 0) onLine && onLine(`[render] Runway ${status || '…'}${st.json && st.json.progress ? ` ${Math.round(st.json.progress * 100)}%` : ''} (${Math.round(i * 5 / 60)}분)`);
    if (status === 'SUCCEEDED') {
      const url = st.json.output && st.json.output[0];
      if (!url) return err('runway', '출력 URL이 없습니다');
      const { abs, rel } = outName(dir, 'videos', job.base, 'mp4');
      onLine && onLine('[render] 영상 다운로드 중…');
      await downloadTo(url, abs);
      return { ok: true, provider: 'runway', rel, files: [rel] };
    }
    if (status === 'FAILED' || status === 'CANCELLED') return err('runway', st.json.failure || st.json.failureCode || '태스크 실패');
  }
  return err('runway', '10분 내에 완료되지 않았습니다');
}

// (4b) Higgsfield — DoP image2video. 업로드 URL 발급 → PUT → public_url로 생성.
//     인증: `Authorization: Key KEY_ID:KEY_SECRET`. 403 = 크레딧 부족(권한 오류 아님).
async function genHiggsfield(dir, job, onLine) {
  const s = secrets.get('higgsfield');
  if (!s.keyId || !s.keySecret) return err('higgsfield', 'Higgsfield Key ID/Secret이 필요합니다 — 설정 → 렌더');
  if (!job.refAbs) return err('higgsfield', '키프레임 이미지가 필요합니다 — 먼저 이미지 레인으로 키프레임을 생성하세요');
  const auth = { Authorization: `Key ${s.keyId}:${s.keySecret}` };
  const base = 'https://platform.higgsfield.ai';
  try {
    // 1) 로컬 키프레임 업로드
    onLine && onLine('[render] Higgsfield 키프레임 업로드 중…');
    const mime = /\.png$/i.test(job.refAbs) ? 'image/png' : 'image/jpeg';
    const up = await fetchJson(`${base}/files/generate-upload-url`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: mime }),
    });
    if (!up.ok || !up.json || !up.json.upload_url) return err('higgsfield', up.status === 403 ? '크레딧이 부족합니다' : (up.text || `HTTP ${up.status}`).slice(0, 200));
    const putRes = await fetch(up.json.upload_url, { method: 'PUT', headers: { 'Content-Type': mime }, body: fs.readFileSync(job.refAbs) });
    if (!putRes.ok) return err('higgsfield', `업로드 실패 HTTP ${putRes.status}`);
    // 2) DoP 생성 제출
    onLine && onLine('[render] Higgsfield DoP 생성 제출 중…');
    const create = await fetchJson(`${base}/v1/image2video/dop`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: s.model || 'dop-turbo',
        prompt: job.prompt.slice(0, 1500),
        input_images: [{ type: 'image_url', image_url: up.json.public_url }],
        enhance_prompt: true,
      }),
    });
    if (!create.ok || !create.json || !create.json.request_id) {
      return err('higgsfield', create.status === 403 ? '크레딧이 부족합니다' : ((create.json && JSON.stringify(create.json.detail || create.json)) || `HTTP ${create.status}`).slice(0, 250));
    }
    const statusUrl = create.json.status_url || `${base}/requests/${create.json.request_id}/status`;
    // 3) 폴링
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const st = await fetchJson(statusUrl, { headers: auth });
      const status = st.json && st.json.status;
      if (i % 8 === 0) onLine && onLine(`[render] Higgsfield ${status || '…'} (${Math.round(i * 4 / 60)}분)`);
      if (status === 'completed') {
        const url = st.json.video && st.json.video.url;
        if (!url) return err('higgsfield', '응답에 video.url이 없습니다');
        const { abs, rel } = outName(dir, 'videos', job.base, 'mp4');
        onLine && onLine('[render] 영상 다운로드 중…');
        await downloadTo(url, abs);
        return { ok: true, provider: 'higgsfield', rel, files: [rel] };
      }
      if (status === 'failed') return err('higgsfield', '생성 실패 (크레딧은 환불됩니다)');
      if (status === 'nsfw') return err('higgsfield', 'NSFW 판정으로 거부됨 (크레딧은 환불됩니다)');
    }
    return err('higgsfield', '10분 내에 완료되지 않았습니다');
  } catch (e) { return err('higgsfield', e.message); }
}

// (4c) Google Veo — Gemini API predictLongRunning. text→video / image→video 모두 지원.
//     모델명은 설정으로 교체 가능 (기본 veo-3.0-fast-generate-001; veo-3.1 프리뷰 등 입력 가능).
async function genVeo(dir, job, onLine) {
  const s = secrets.get('google');
  if (!s.apiKey) return err('google-veo', 'Google AI(Gemini) API 키가 없습니다 — 설정 → 렌더');
  const model = s.model || 'veo-3.0-fast-generate-001';
  const headers = { 'x-goog-api-key': s.apiKey, 'Content-Type': 'application/json' };
  const body = {
    instances: [{ prompt: job.prompt }],
    parameters: { aspectRatio: (job.size === 'story' || job.size === 'portrait') ? '9:16' : '16:9' },
  };
  if (job.refAbs) {
    body.instances[0].image = {
      bytesBase64Encoded: fs.readFileSync(job.refAbs).toString('base64'),
      mimeType: /\.png$/i.test(job.refAbs) ? 'image/png' : 'image/jpeg',
    };
  }
  onLine && onLine(`[render] Veo(${model}) 제출 중…`);
  const create = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, 120_000);
  if (!create.ok || !create.json || !create.json.name) {
    return err('google-veo', ((create.json && create.json.error && create.json.error.message) || `HTTP ${create.status}`) + ' — 모델명이 계정에서 지원되는지 확인하세요 (설정 → 렌더)');
  }
  const opName = create.json.name;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const st = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/${opName}`, { headers });
    if (i % 5 === 0) onLine && onLine(`[render] Veo 생성 중… (${Math.round(i * 6 / 60)}분)`);
    if (st.json && st.json.done) {
      if (st.json.error) return err('google-veo', st.json.error.message || JSON.stringify(st.json.error).slice(0, 200));
      // 응답 형태가 버전에 따라 다르다 — 두 스키마 모두 수용
      const resp = st.json.response || {};
      const sample = (resp.generateVideoResponse && resp.generateVideoResponse.generatedSamples && resp.generateVideoResponse.generatedSamples[0])
        || (resp.generatedVideos && resp.generatedVideos[0]) || null;
      const uri = sample && sample.video && (sample.video.uri || sample.video.url);
      if (!uri) return err('google-veo', '응답에서 영상 URI를 찾지 못했습니다');
      const { abs, rel } = outName(dir, 'videos', job.base, 'mp4');
      onLine && onLine('[render] 영상 다운로드 중…');
      const dl = uri.includes('?') ? `${uri}&key=${encodeURIComponent(s.apiKey)}` : `${uri}?key=${encodeURIComponent(s.apiKey)}`;
      await downloadTo(dl, abs, 300_000, { 'x-goog-api-key': s.apiKey });
      return { ok: true, provider: 'google-veo', rel, files: [rel] };
    }
  }
  return err('google-veo', '12분 내에 완료되지 않았습니다');
}

// (4d) Replicate — 오픈모델 게이트웨이. 토큰 하나로 Wan/Kling/Hunyuan/LTX 등 어떤 호스팅 모델이든.
//     설정: token, model("owner/name"), imageKey(모델별 이미지 입력 필드명, 기본 image).
async function genReplicate(dir, job, onLine) {
  const s = secrets.get('replicate');
  if (!s.token) return err('replicate', 'Replicate API 토큰이 없습니다 — 설정 → 렌더');
  if (!s.model || !s.model.includes('/')) return err('replicate', '모델을 "owner/name" 형식으로 설정하세요 (예: wan-video/wan-2.2-i2v-a14b) — replicate.com/collections/text-to-video 참고');
  const headers = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Prefer: 'wait=10' };
  const input = { prompt: job.prompt };
  if (job.negative) input.negative_prompt = job.negative;
  if (job.refAbs) {
    const mime = /\.png$/i.test(job.refAbs) ? 'image/png' : 'image/jpeg';
    input[s.imageKey || 'image'] = `data:${mime};base64,${fs.readFileSync(job.refAbs).toString('base64')}`;
  }
  onLine && onLine(`[render] Replicate ${s.model} 제출 중…`);
  const create = await fetchJson(`https://api.replicate.com/v1/models/${s.model}/predictions`, {
    method: 'POST', headers, body: JSON.stringify({ input }),
  }, 120_000);
  if (!create.ok || !create.json || !create.json.id) {
    return err('replicate', ((create.json && (create.json.detail || create.json.title)) || `HTTP ${create.status}`).toString().slice(0, 250));
  }
  const getUrl = create.json.urls && create.json.urls.get;
  let pred = create.json;
  for (let i = 0; i < 240 && !['succeeded', 'failed', 'canceled'].includes(pred.status); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetchJson(getUrl, { headers: { Authorization: `Bearer ${s.token}` } });
    if (st.json) pred = st.json;
    if (i % 6 === 0) onLine && onLine(`[render] Replicate ${pred.status || '…'} (${Math.round(i * 5 / 60)}분)`);
  }
  if (pred.status !== 'succeeded') return err('replicate', (pred.error || pred.status || '실패').toString().slice(0, 250));
  // output은 모델마다 문자열/배열/객체 — URL을 재귀 탐색
  const findUrl = (v) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
    if (Array.isArray(v)) { for (const x of v) { const u = findUrl(x); if (u) return u; } }
    else if (v && typeof v === 'object') { for (const x of Object.values(v)) { const u = findUrl(x); if (u) return u; } }
    return null;
  };
  const url = findUrl(pred.output);
  if (!url) return err('replicate', '출력에서 URL을 찾지 못했습니다');
  const isImg = /\.(png|jpe?g|webp)(\?|$)/i.test(url);
  const { abs, rel } = outName(dir, isImg ? 'creatives' : 'videos', job.base, isImg ? 'png' : 'mp4');
  onLine && onLine('[render] 결과 다운로드 중…');
  await downloadTo(url, abs);
  return { ok: true, provider: 'replicate', rel, files: [rel] };
}

// (4e) ffmpeg — 로컬 무료 조립 레인. 렌더된 이미지 1장이면 켄번즈, 여러 장이면 크로스페이드 슬라이드쇼.
let ffmpegCached = null;
function hasFfmpeg() {
  if (ffmpegCached !== null) return ffmpegCached;
  try { ffmpegCached = spawnSync(isWin ? 'where' : 'which', ['ffmpeg'], { windowsHide: true }).status === 0; }
  catch { ffmpegCached = false; }
  return ffmpegCached;
}
async function genFfmpeg(dir, job, onLine) {
  if (!hasFfmpeg()) return err('ffmpeg', 'ffmpeg가 설치돼 있지 않습니다 — Windows: winget install ffmpeg / macOS: brew install ffmpeg');
  // 이 포스트의 렌더 이미지 수집 (refAbs 우선 + base 프리픽스 렌더들)
  const imgs = [];
  if (job.refAbs) imgs.push(job.refAbs);
  try {
    const cdir = path.join(dir, 'outputs', 'creatives');
    const prefix = new RegExp(`^${job.base}(?![0-9])`, 'i');
    for (const f of fs.readdirSync(cdir).sort()) {
      if (prefix.test(f) && /\.(png|jpe?g|webp)$/i.test(f)) {
        const p2 = path.join(cdir, f);
        if (!imgs.includes(p2)) imgs.push(p2);
      }
    }
  } catch { /* 레인 없음 */ }
  if (!imgs.length) return err('ffmpeg', '이 카드의 렌더 이미지가 없습니다 — 먼저 이미지 레인으로 생성하세요');
  imgs.splice(4); // 최대 4장
  const [w, h] = job.size === 'story' || job.size === 'portrait' ? [1080, 1920] : (job.size === 'landscape' ? [1920, 1080] : [1080, 1080]);
  const dur = Math.min(30, Math.max(3, Number(job.duration) || 6));
  const { abs, rel } = outName(dir, 'videos', job.base, 'mp4');
  let args;
  if (imgs.length === 1) {
    // 켄번즈 — 천천히 줌인
    const frames = dur * 30;
    args = ['-y', '-loop', '1', '-i', imgs[0], '-vf',
      `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
      `zoompan=z='min(zoom+0.0008,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30,format=yuv420p`,
      '-t', String(dur), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', abs];
  } else {
    // 슬라이드쇼 + 크로스페이드
    const fade = 0.5;
    const per = dur / imgs.length;
    const inputs = imgs.flatMap((i) => ['-loop', '1', '-t', String((per + fade).toFixed(2)), '-i', i]);
    let fc = imgs.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[v${i}]`).join(';');
    let last = 'v0';
    for (let i = 1; i < imgs.length; i++) {
      const out = `x${i}`;
      fc += `;[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${Math.max(0.1, per * i - fade / 2).toFixed(2)}[${out}]`;
      last = out;
    }
    fc += `;[${last}]format=yuv420p[final]`;
    args = ['-y', ...inputs, '-filter_complex', fc, '-map', '[final]',
      '-t', String(dur), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', abs];
  }
  onLine && onLine(`[render] ffmpeg ${imgs.length === 1 ? '켄번즈' : imgs.length + '장 슬라이드쇼'} 조립 중… (${dur}s ${w}x${h})`);
  const r = await runCmd('ffmpeg', args, null, { timeoutMs: 5 * 60_000 });
  if (!r.ok || !fs.existsSync(abs)) return err('ffmpeg', (r.tail || 'ffmpeg 실패').slice(-300));
  return { ok: true, provider: 'ffmpeg', rel, files: [rel] };
}

// (5) ComfyUI — 오픈소스 로컬 엔진 브릿지 (Wan/HunyuanVideo 등 사용자가 띄운 워크플로)
//     설정: url(예 http://127.0.0.1:8188), workflowPath(API 포맷 JSON, "__PROMPT__" 플레이스홀더)
async function genComfy(dir, job, onLine) {
  const s = secrets.get('comfyui');
  if (!s.url || !s.workflowPath) return err('comfyui', 'ComfyUI URL과 워크플로 JSON 경로가 필요합니다 — 설정 → 렌더');
  let wf;
  try { wf = fs.readFileSync(s.workflowPath, 'utf8'); } catch (e) { return err('comfyui', '워크플로 파일을 읽지 못했습니다: ' + e.message); }
  wf = wf.split('__PROMPT__').join(job.prompt.replace(/"/g, '\\"'));
  wf = wf.split('__NEGATIVE__').join(String(job.negative || '').replace(/"/g, '\\"'));
  let wfJson;
  try { wfJson = JSON.parse(wf); } catch { return err('comfyui', '워크플로 JSON 파싱 실패 — API 포맷(Save (API Format))으로 내보냈는지 확인'); }
  onLine && onLine('[render] ComfyUI 큐 제출 중…');
  const q = await fetchJson(`${s.url.replace(/\/$/, '')}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wfJson }),
  });
  if (!q.ok || !q.json || !q.json.prompt_id) return err('comfyui', q.text || `HTTP ${q.status}`);
  const pid = q.json.prompt_id;
  for (let i = 0; i < 360; i++) { // 로컬 생성은 오래 걸릴 수 있다 — 30분
    await new Promise((r) => setTimeout(r, 5000));
    const h = await fetchJson(`${s.url.replace(/\/$/, '')}/history/${pid}`, {});
    const entry = h.json && h.json[pid];
    if (i % 12 === 0) onLine && onLine(`[render] ComfyUI 진행 중… (${Math.round(i * 5 / 60)}분)`);
    if (entry && entry.outputs) {
      for (const node of Object.values(entry.outputs)) {
        const media = (node.videos || node.gifs || node.images || [])[0];
        if (media) {
          const ext = (media.filename.match(/\.(\w+)$/) || [])[1] || 'mp4';
          const { abs, rel } = outName(dir, /png|jpe?g|webp/i.test(ext) ? 'creatives' : 'videos', job.base, ext);
          const vu = `${s.url.replace(/\/$/, '')}/view?filename=${encodeURIComponent(media.filename)}&subfolder=${encodeURIComponent(media.subfolder || '')}&type=${media.type || 'output'}`;
          await downloadTo(vu, abs);
          return { ok: true, provider: 'comfyui', rel, files: [rel] };
        }
      }
      if (entry.status && entry.status.status_str === 'error') return err('comfyui', '워크플로 실행 오류 — ComfyUI 콘솔 확인');
    }
  }
  return err('comfyui', '30분 내에 완료되지 않았습니다');
}

// (6) 커스텀 HTTP — Higgsfield 등 아직 내장하지 않은 API를 사용자가 브릿지.
//     POST {prompt, image_b64?, duration} → {video_url|image_url|video_b64|image_b64} 규약.
async function genCustom(dir, job, onLine) {
  const s = secrets.get('custom-video');
  if (!s.url) return err('custom', '커스텀 엔드포인트 URL이 없습니다 — 설정 → 렌더');
  let headers = { 'Content-Type': 'application/json' };
  if (s.headers) { try { headers = { ...headers, ...JSON.parse(s.headers) }; } catch { return err('custom', '헤더 JSON 파싱 실패'); } }
  const body = { prompt: job.prompt, duration: Number(job.duration) || 5 };
  if (job.refAbs) body.image_b64 = fs.readFileSync(job.refAbs).toString('base64');
  onLine && onLine('[render] 커스텀 엔드포인트 호출 중…');
  const r = await fetchJson(s.url, { method: 'POST', headers, body: JSON.stringify(body) }, 30 * 60_000);
  if (!r.ok || !r.json) return err('custom', r.text ? r.text.slice(0, 300) : `HTTP ${r.status}`);
  const isImg = !!(r.json.image_url || r.json.image_b64);
  const { abs, rel } = outName(dir, isImg ? 'creatives' : 'videos', job.base, isImg ? 'png' : 'mp4');
  if (r.json.video_url || r.json.image_url) await downloadTo(r.json.video_url || r.json.image_url, abs);
  else if (r.json.video_b64 || r.json.image_b64) fs.writeFileSync(abs, Buffer.from(r.json.video_b64 || r.json.image_b64, 'base64'));
  else return err('custom', '응답에 video_url/image_url/…_b64가 없습니다');
  return { ok: true, provider: 'custom', rel, files: [rel] };
}

// (7) ima2 영상 (Grok) — 기존 설치 레인 재사용
async function genIma2Video(dir, job, onLine) {
  const args = ['video', job.prompt];
  if (job.refAbs) args.push('--ref', job.refAbs);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-ima2v-'));
  args.push('-d', tmp);
  onLine && onLine('[render] ima2(Grok) 영상 생성 중…');
  const runV = () => runCmd('ima2', args, onLine, { cwd: dir, timeoutMs: 20 * 60_000 });
  let r = await runV();
  if (!r.ok && IMA2_DOWN.test(r.out) && await ensureIma2Serve(onLine)) r = await runV();
  const made = (fs.existsSync(tmp) ? fs.readdirSync(tmp) : []).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
  if (!r.ok || !made.length) return err('ima2-video', r.tail || 'ima2가 영상을 만들지 못했습니다');
  const { abs, rel } = outName(dir, 'videos', job.base, path.extname(made[0]).slice(1));
  fs.copyFileSync(path.join(tmp, made[0]), abs);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp */ }
  return { ok: true, provider: 'ima2-video', rel, files: [rel] };
}

// ---- 디스패치 ----------------------------------------------------------------------
const IMAGE_PROVIDERS = { 'claude-svg': genClaudeSvg, 'openai-image': genOpenAI, ima2: genIma2, comfyui: genComfy, custom: genCustom };
const VIDEO_PROVIDERS = {
  ffmpeg: genFfmpeg, runway: genRunway, higgsfield: genHiggsfield, 'google-veo': genVeo,
  replicate: genReplicate, comfyui: genComfy, custom: genCustom, 'ima2-video': genIma2Video,
};

// 사용 가능 여부 — 설정 UI와 생성 패널의 프로바이더 선택지에 쓴다
function availability(env) {
  return {
    image: {
      'claude-svg': { ok: true, label: '클로드 디자인 (SVG→PNG · 추가 키 불필요)' },
      'openai-image': { ok: secrets.has('openai', ['apiKey']) || !!process.env.OPENAI_API_KEY, label: 'OpenAI gpt-image-1 (코덱스 이미지)' },
      ima2: { ok: !!(env && env.ima2), label: 'ima2 (ChatGPT OAuth)' },
      comfyui: { ok: secrets.has('comfyui', ['url', 'workflowPath']), label: 'ComfyUI (오픈소스 로컬)' },
      custom: { ok: secrets.has('custom-video', ['url']), label: '커스텀 HTTP' },
    },
    video: {
      ffmpeg: { ok: hasFfmpeg(), label: 'ffmpeg 슬라이드쇼·켄번즈 (로컬 무료 — 렌더 이미지 조립)' },
      runway: { ok: secrets.has('runway', ['apiKey']), label: 'Runway (image→video · veo3.1 모델 선택 가능)' },
      higgsfield: { ok: secrets.has('higgsfield', ['keyId', 'keySecret']), label: 'Higgsfield DoP (image→video)' },
      'google-veo': { ok: secrets.has('google', ['apiKey']), label: 'Google Veo (Gemini API · text/image→video)' },
      replicate: { ok: secrets.has('replicate', ['token', 'model']), label: 'Replicate (Wan/Kling/Hunyuan 등 오픈모델 게이트웨이)' },
      'ima2-video': { ok: !!(env && env.ima2), label: 'ima2 · Grok (text/image→video)' },
      comfyui: { ok: secrets.has('comfyui', ['url', 'workflowPath']), label: 'ComfyUI (오픈소스 로컬 — Wan/Hunyuan 등)' },
      custom: { ok: secrets.has('custom-video', ['url']), label: '커스텀 HTTP 브릿지 (신생 서비스 연결용)' },
    },
  };
}

// job: {kind:'image'|'video', provider, base, prompt, size, duration?, refAbs?}
async function generate(dir, job, onLine) {
  const table = job.kind === 'video' ? VIDEO_PROVIDERS : IMAGE_PROVIDERS;
  const fn = table[job.provider];
  if (!fn) return err(job.provider, '알 수 없는 프로바이더');
  try { return await fn(dir, job, onLine); }
  catch (e) { return err(job.provider, e && e.message || e); }
}

module.exports = { generate, availability, SIZES };
