# Social AI Team Desktop (PC 설치용 앱)

소셜 콘텐츠 팀(스킬 16종 + 서브에이전트 4종 + Codex 이미지 레인)을 PC에 설치하고 운영하는 데스크톱 컨트롤타워입니다. Electron 기반, Windows(NSIS 설치본)·macOS(DMG)·Linux(AppImage)를 지원합니다.

## 앱이 하는 일 — "온에어 데스크" (v0.8+)

단일 워크스페이스 4존: **좌측 레일**(클라이언트 아바타) / **채널 허브 스트립** / **타임라인⇄칸반 보드** / **게이트 바** + 우측 **디렉터 독**.

1. **출근 준비 마법사 — "설치했을 때 적용"** — Claude/Codex/ima2 CLI 점검·설치, 스킬 17종 → `~/.claude/skills/`, 에이전트 4종 → `~/.claude/agents/`, Codex OAuth(브라우저)·MCP 등록, ima2 셋업.
   - **레퍼런스 사이트 분석 (v0.14)** — 클라이언트를 만들 때(또는 온보딩 카드에서) 홈페이지·블로그·경쟁사 URL을 넣으면 앱이 페이지를 수집(제목/메타/헤딩/본문 + 컬러 시그널 hex)해 `context/references/`에 스냅샷을 남기고, 종합 분석 리포트(site-analysis.md)와 **brand-style.md 자동 초안**(없을 때만, ⚠초안 표기)을 준비합니다. SNS 페이지는 JS 렌더링이라 수집이 제한될 수 있습니다.
   - **질문지 온보딩 (v0.15)** — 한 질문씩 LLM 왕복하던 인터뷰 대신: ① 고정 질문지 폼(17문항, 전부 선택 답변 — 즉시 표시) → ② 답변의 공백·모호한 부분만 겨냥한 **후속 질문을 한 번에 묶어 생성**(LLM 1회, 최대 6개) → ③ 전체 답변 **일괄 합성**으로 brand-style.md + kr-voice-profile.md 초안 완성(LLM 1회). 답변 원본은 `context/onboarding-answers.md`에 기록됩니다. 대화형 인터뷰는 선택지로 유지.
2. **채널 허브** — 채널별 카드: 이번 달 큐, 5단계 진행 미터, 주차 스파크바, WARN/BLOCK 닷, 발행 경로(Blotato 자동/연결 필요/수동). 카드 클릭 = 보드 필터 + 발행 와이어.
3. **라이브 보드** — 캘린더의 포스트가 기획→카피→비주얼→검수→발행준비를 흐르는 칸반/타임라인. **카드는 드래그로 옮기지 않습니다** — 팀이 파일을 만들면 fs 감시가 잡아 카드가 FLIP으로 스스로 이동합니다. 카드의 진실은 `context/calendar-index.json`(캘린더 생성 시 자동 산출, 마크다운 형식 무관) → 없으면 md 파서 폴백.
4. **게이트 바 + 오토파일럿** — 8노드 스테퍼 + 상황별 CTA 1개. 승인 게이트는 **도장 버튼을 길게 눌러**(마우스/키보드 모두) 찍고(`context/gates.json` 영속, 캘린더 재생성 시 자동 무효화), 컴플라이언스 게이트는 WARN 서명·BLOCK 잠금. **오토파일럿**은 캘린더→카피→릴스→비주얼 브리프→컴플라이언스까지 증거 없는 단계를 자동으로 이어 달리다가, 승인 도장이 필요한 지점에서 멈추고 OS 알림을 보냅니다 (이미지 생성은 비주얼 브리프 승인 후에만).
5. **디렉터 독** — 앱 내 채팅(**실시간 스트리밍** — 텍스트·도구 실행이 타이핑되듯 표시, 세션 유지 + 클라이언트별 대화 기록 복원, 카드/파일 드래그로 컨텍스트 첨부, **마크다운 렌더링**, 응답당 비용·소요 표시, 중지 버튼), 실행 로그, **실행 기록 탭**(단계별 시간·소요·비용 + 이번 달 누적 비용), 포스트 인스펙터(포스트별 실제 증거 파일 + 미리보기, 이미지 클릭 확대).
6. **직접 발행 — Blotato 불필요 (v0.9)** — 설정 → 채널에 각 플랫폼 개발자 토큰을 넣으면 앱이 공식 API로 바로 발행합니다: **X**(텍스트+이미지, OAuth 1.0a 자체 서명·v2 미디어 업로드), **Facebook 페이지**(텍스트+이미지), **Threads**(텍스트 + **댓글형 체인 v0.16** — "---"·빈 줄·"Post 1/n" 마커로 나눈 조각이 reply_to_id로 이어지는 스토리라인 발행), **LinkedIn**(텍스트+이미지, /rest/posts). 발행 전 컴포저에서 본문을 최종 확인·수정하고, **지금 발행** 또는 **예약**(`context/publish-queue.json` + 60초 스케줄러, 앱 재시작에도 유지). Instagram·네이버는 API 제약(공개 이미지 URL 필수/미제공)으로 수동 체크리스트를 유지합니다 — [복사] → 에디터 붙여넣기 → 발행함 체크. 토큰은 `~/.social-ai-team/secrets.json`(0600)에만 저장.
7. **인앱 렌더 엔진 — 프롬프트 md가 아니라 실물 (v0.9)** — 카드 인스펙터의 [🎨 비주얼 생성]으로 실제 PNG/MP4를 만듭니다.
   - 이미지: **Codex 이미지가 기본** — gpt-image-1(OpenAI 키) 또는 ima2(ChatGPT OAuth) 중 사용 가능한 것이 자동 선택 / **클로드 디자인**(한글 타이포 카드·카드뉴스 전용, SVG→PNG, 키 불필요 폴백) / ComfyUI / 커스텀
   - 영상: **ffmpeg**(로컬 무료 — 렌더 이미지로 켄번즈/슬라이드쇼 조립) / **Runway**(키프레임→영상, veo3.1 모델 선택 가능) / **Higgsfield DoP** / **Google Veo**(Gemini API) / **Replicate**(Wan·Kling·Hunyuan 등 오픈모델 게이트웨이) / ima2·Grok / **ComfyUI**(오픈소스 로컬) / 커스텀 HTTP 브릿지
   - 산출 파일은 `ig-1.png`처럼 카드 ID로 저장돼 **카드 썸네일·인스펙터 미리보기(영상 재생 포함)로 즉시 표시**되고 비주얼 단계가 자동 승격됩니다.
   - **멀티이미지·오토파일럿 렌더 (v0.16)** — 대부분의 SNS는 여러 장(캐러셀)을 씁니다. 이미지 탭의 **장수** 선택으로 한 포스트에 응집된 세트를 `ig-1_1.png…ig-1_N.png`로 생성(카드에 썸네일 스트립 표시). **오토파일럿의 비주얼 생성이 앱 렌더 엔진으로 라우팅**되어 설정한 프로바이더 키를 실제로 사용합니다 — 이전엔 파이프라인 에이전트가 앱 설정 키를 못 봐 "generation blocked"였습니다. 포맷(carousel/single/story)에 따라 장수·비율을 자동 추정합니다.
   - **전략 추출 & OpenCrab 인제스트 (v0.16)** — 설정 → 렌더 → "전략 추출 & OpenCrab 인제스트": 클라이언트의 브랜드·캘린더·분석 자료에서 **채널별·주제별 재사용 전략**을 뽑아 `context/strategy/`에 저장하고, OpenCrab MCP 프로젝트로 인제스트합니다(쓰기 도구를 tools/list로 발견, 읽기 전용 엔드포인트면 로컬 저장으로 폴백 안내).
   - **카드뉴스 (v0.13)** — 🎨 비주얼 생성 → 카드뉴스 탭: 표지(후킹)+본문(카드당 1메시지·진행표시)+엔딩(CTA)을 한 번에 5~8장 생성 (`ig-1_c1.png`…), 전 카드 동일 그리드·팔레트(시리즈 일관성 규칙). ffmpeg 레인으로 카드들을 슬라이드쇼 영상으로 바로 조립할 수 있습니다.
   - **프롬프트 컴파일러 (v0.11)** — 기획 언어(주제/앵글/필러)를 그대로 모델에 넣지 않습니다. [✨ 컴파일]이 브랜드 팔레트(brand-style.md) + 카피라이터의 영문 VISUAL DIRECTION + **프롬프트 팩**(내장 3종: 이미지/영상/SVG디자인)을 재료로 구도·조명·카메라 문법이 담긴 시각 언어 프롬프트(+네거티브)로 변환합니다. Claude 컴파일 실패 시 규칙 기반 템플릿 폴백. 생성 전 자동 컴파일이 기본값.
   - **OpenCrab 팩 로더 (v0.11)** — 설정 → 렌더에 opencrab.sh MCP 엔드포인트를 넣으면 프롬프트·이미지·영상 팩을 검색해 `~/.social-ai-team/packs/`로 가져오고, 컴파일러가 즉시 참조합니다.
   - **OpenCrab 프로젝트·워크플로우 가져오기 (v0.17)** — 팩뿐 아니라 **프로젝트(지식팩)와 워크플로우 단위**로도 가져옵니다: 설정 → 렌더 → "OpenCrab 프로젝트·워크플로우 가져오기" → 목록에서 [가져오기] → 현재 클라이언트의 `context/knowledge/opencrab-*.md`로 저장. 저장된 지식은 **모든 작업에서 자동 참조**됩니다 — 파이프라인 전 스테이지(캘린더·카피·릴스·비주얼·컴플라이언스·리뷰), 디렉터 채팅(Claude/Codex), 프롬프트 컴파일러, 전략 추출, 온보딩 합성. 도구 이름은 tools/list로 발견해 매칭하므로 서버 구현이 달라도 동작하고, 본문 도구가 없는 서버는 메타데이터 폴백으로 안내합니다.
8. **엔진·모델 선택** — 설정 → 엔진: Claude(대화+파이프라인)와 Codex(대화)의 모델을 각각 지정 (`sonnet`/`opus`/`haiku`, `gpt-5.6-sol` 등 자유 입력). Codex 계정이 지원하지 않는 모델은 자동으로 기본 모델로 폴백하고 안내합니다.

### 안정성 (v0.7~0.8)
- **워크스페이스별 CLI 뮤텍스** — 채팅·단계·오토파일럿이 같은 폴더에서 동시에 CLI를 돌려 파일을 밟는 사고 방지.
- **고아 프로세스 차단** — 앱 종료·타임아웃 시 자식 CLI를 트리째 종료(Windows `taskkill /T`), 단일 인스턴스 잠금.
- **원자적 쓰기** — `settings.json`·`gates.json`·`publish-log.json` 모두 tmp+rename, 깨진 파일은 백업 후 복구.
- **오류 가시성** — 모든 오류가 `~/.social-ai-team/logs`에 날짜별 기록(7일 보관), 로그 탭에서 폴더 열기·복사(신고용). 렌더러 부분 실패가 화면을 백지로 만들지 않게 부팅 구간 격리, 파일 감시 실패 시 폴링 폴백.
- **키보드 접근성** — 카드·게이트·채널·아바타·도장을 Tab/Enter/Space로 조작.

## 개발 실행

```bash
cd desktop
npm install
npm start
```

## 설치본 빌드

```bash
npm run dist          # 현재 OS 타깃
npm run dist:win      # Windows NSIS (Windows에서, 또는 CI)
npm run dist:mac      # macOS DMG (macOS에서)
```

권장: `desktop/**`가 바뀐 커밋이 `main`에 푸시되면 GitHub Actions(`.github/workflows/desktop-build.yml`)가 Windows/macOS/Linux 설치본을 빌드해 **GitHub Release로 자동 발행**합니다 — [Releases](https://github.com/contentscoin/social-ai-team/releases)가 공식 다운로드 위치입니다 (Actions 아티팩트에도 사본 업로드).

## 자동 업데이트

앱은 `electron-updater`로 GitHub Releases를 업데이트 피드로 사용합니다:
- 실행 시 자동으로 최신 릴리스를 확인하고 백그라운드에서 다운로드 → 사이드바 "업데이트" 패널에 "재시작하고 설치" 버튼이 나타납니다. 앱 종료 시에도 자동 적용됩니다.
- 수동 확인: 사이드바 → 업데이트 확인.
- **macOS 주의**: 코드사이닝 없는 빌드는 macOS가 업데이트 적용을 막습니다(Squirrel 서명 요구) — 업데이트 패널에 오류로 표시되며, 새 dmg를 받아 수동 설치하세요. Apple 개발자 인증서를 CI secret으로 넣으면 자동 업데이트가 활성화됩니다. Windows/Linux는 서명 없이도 동작합니다.

## 요구사항

- [Claude Code CLI](https://code.claude.com/docs/en/quickstart) — 파이프라인 실행 엔진 (구독/로그인 필요)
- Node.js 20+ (Codex CLI npm 설치용)
- 이미지 생성: Nano Banana MCP 또는 Codex(OAuth) — 앱 설치 마법사가 Codex 경로를 셋업합니다

## 구조

```
desktop/
├── main.js            Electron 메인 (IPC 라우팅, fs 감시 → board:update 푸시, 클립보드)
├── preload.js         contextBridge (renderer는 Node 접근 불가)
├── lib/
│   ├── proc.js        공용 실행기 (PATH 보강, 플랫폼별 인용, 라인 버퍼링, 트리 종료, IPC-safe 결과)
│   ├── stream.js      claude stream-json(NDJSON) 파서 — 텍스트·도구·비용 이벤트
│   ├── setup.js       환경 점검·스킬 설치·Codex OAuth·MCP 등록·ima2
│   ├── workspace.js   클라이언트 폴더 CRUD + workflow-status 파싱 + 산출물 리더
│   ├── board.js       캘린더 파서(index-json 우선) + 포스트별 단계 추론·증거 파일 + 채널 집계
│   ├── gates.js       승인 도장 영속(원자적) + 8노드 게이트 계산 (캘린더 해시 무효화)
│   ├── autopilot.js   승인 게이트 앞까지 자동 진행 (증거 건너뜀·도장 대기·이미지 게이팅)
│   ├── lock.js        워크스페이스별 CLI 뮤텍스 (채팅·단계·오토파일럿 상호 배제)
│   ├── history.js     실행 기록·비용 (~/.social-ai-team/history.json)
│   ├── chatlog.js     클라이언트별 대화 기록 (~/.social-ai-team/chatlogs/)
│   ├── publishlog.js  수동 발행 기록 (publish-log.json, 원자적)
│   ├── pipeline.js    단계별 claude stream-json 러너 + 엔진별 터미널 런처
│   ├── chat.js        앱 내 디렉터 대화 (스트리밍, claude --resume / codex 세션-id resume)
│   ├── applog.js      영속 오류·실행 로그 (7일 보관, 신고용 복사)
│   └── config.js      엔진·모델·세션 설정 (원자적, 엔진별 세션 슬롯)
└── src/               온에어 데스크 UI (4존 + 오버레이, vanilla JS)
```

패키징 시 리포의 `skills/`, `.claude/agents/`, `sop/`가 `resources/payload/`로 번들되어 설치 마법사가 이를 `~/.claude`와 클라이언트 폴더에 적용합니다.
