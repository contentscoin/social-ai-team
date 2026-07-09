---
title: Social AI Team - Korean Team Manual
version: 1.0.0
description: Korean operations manual for the full Social AI Team system. Covers the team roster (1 director skill, 4 subagents, 5 new skills + 1 vendored ima2 skill, render-lane SOPs layered over the 10 untouched original skills), the monthly production loop, format-to-lane routing, human approval gates, the bilingual contract boundary, MCP requirements, known contract-drift notes, installation, and the deferred roadmap.
---

# Social AI Team — 팀 운영 매뉴얼 (한국어판)

이 문서는 Social AI Team 시스템 전체의 **팀 매뉴얼**입니다. 기존 10개 스킬(영어) 위에 한국어 팀 레이어 — 디렉터 스킬 1개, 서브에이전트 4개, 신규 스킬 5개 + 벤더 스킬 1개(`/ima2`), 렌더 레인 SOP — 를 얹은 구조를 설명합니다.

> **팀 모토: "한국어로 말하고, 영어로 계약한다."**
> 운영자와의 모든 대화·요약·승인 요청은 한국어. 파일로 오가는 계약 필드(`VISUAL DIRECTION`, `BLOTATO FLAG`, `PASS`/`WARN`/`BLOCK`, `context/*.md`, `outputs/` 폴더 규약)는 기존 스킬이 정의한 영어 표기를 한 글자도 바꾸지 않습니다.

---

## 1. 한눈에 보는 팀 구성

**핵심 원칙: 기존 10개 스킬은 단 한 글자도 수정하지 않았습니다.** 아래 신규 레이어는 기존 스킬을 그대로("byte-identical") 실행하며, 그 위에서 라우팅·병렬화·한국어 게이트·컴플라이언스만 추가합니다.

| 구분 | 이름 | 위치 | 역할 |
|---|---|---|---|
| **디렉터 스킬 (1)** | `/content-director` | `skills/content-director/` | **메인 스레드**에서 실행되는 팀 지휘자. 라우팅, 카피라이터 최대 5병렬 팬아웃, 승인 게이트 회수, 컴플라이언스 게이트 강제. `context/workflow-status.md`의 **유일한 작성자** |
| **서브에이전트 (4)** | `copywriter` | `.claude/agents/copywriter.md` | 플랫폼 파라미터형 카피라이터 — caption/linkedin/threads/x/naver 라이터 스킬을 그대로 실행. 최대 5개 병렬 |
| | `creative-designer` | `.claude/agents/creative-designer.md` | `/social-creative-designer` 실행 + `sop/creative-designer/image-qa.md` 준수. 스토리보드 키프레임도 렌더링 |
| | `video-producer` | `.claude/agents/video-producer.md` | 숏폼 포드 — `/reels-script`, `/ad-storyboard` 실행 + 스토리보드 계약 스크립트 검증 |
| | `compliance-reviewer` | `.claude/agents/compliance-reviewer.md` | `/kr-guardrail-check`를 격리 컨텍스트에서 실행, `PASS`/`WARN`/`BLOCK` 판정표 반환 |
| **신규 스킬 (5)** | `/reels-script` | `skills/reels-script/` | Reels/Shorts/TikTok 타임코드 대본 + 자막 트랙 + 클립 분할 → `outputs/videos/` (시리즈물은 `references/series-variation-matrix.md`로 변주 관리) |
| | `/ad-storyboard` | `skills/ad-storyboard/` | 광고 스토리보드 (6비트, strict-JSON 계약 + 검증 스크립트) → `outputs/storyboards/` |
| | `/kr-guardrail-check` | `skills/kr-guardrail-check/` | 표시광고법·AI권리·고지 의무 + 기계적 계약 검증 → `outputs/compliance/` |
| | `/kr-voice-localizer` | `skills/kr-voice-localizer/` | 보이스 프로파일 인테이크(`context/kr-voice-profile.md`) + 톤 QA |
| | `/naver-blog-writer` | `skills/naver-blog-writer/` | 네이버 블로그 검색 유입형 장문 글 — 키워드 제목, 소제목·이미지 슬롯 구조, 대가성 고지 → `outputs/naver/` (**수동 발행** — Blotato 미지원) |
| **벤더 스킬 (1)** | `/ima2` | `skills/ima2/` | [ima2-gen](https://github.com/lidge-jun/ima2-gen) 번들 스킬 원문(무수정 벤더링) — 로컬 이미지·영상 생성 스튜디오의 CLI 규약. ChatGPT/Grok OAuth, API 키 불요. 렌더 레인 사용법은 `sop/creative-designer/ima2-render.md` |
| **SOP (1)** | 이미지 QA | `sop/creative-designer/image-qa.md` | 텍스트 세이프 규칙, 이중 채점, 재생성 루프 상한 — 기존 `/social-creative-designer` Phase 0의 `sop/creative-designer/` 훅으로 자동 로드 |
| **기존 스킬 (10)** | `/social-media-manager`, `/brand-onboarding`, `/content-calendar`, `/caption-writer`, `/social-creative-designer`, `/linkedin-writer`, `/threads-writer`, `/x-writer`, `/publisher`, `/social-performance-review` | `skills/` | **무수정.** 디렉터가 인라인 실행하거나 에이전트가 그대로 따름 |

왜 디렉터는 에이전트가 아니라 스킬인가? **서브에이전트는 서브에이전트를 생성할 수 없기 때문입니다.** 팀을 지휘하려면 메인 스레드여야 하고, 메인 스레드여야만 모든 승인 게이트가 사람에게 닿습니다.

---

## 2. 월간 루프 다이어그램

```
        ┌─────────────────────────────────────────────────────────────────┐
        │                    월간 콘텐츠 루프 (/content-director)           │
        └─────────────────────────────────────────────────────────────────┘

  [신규 클라이언트만]
  온보딩 ──────────────────────→ context/brand-style.md
  /brand-onboarding (인라인)
        │
        ▼
  보이스 프로파일 ──────────────→ context/kr-voice-profile.md
  /kr-voice-localizer 모드 A (인라인, 클라이언트당 1회)
        │
        ▼
  캘린더 + KR 시즌 브리핑 ──────→ context/content-calendar.md
  /content-calendar (인라인)      (설날/추석/빼빼로데이/수능/코세페/김장철 등
        │                          kr-voice-localizer의 시즌 캘린더 인용)
        ▼
  ◆ 승인 게이트 1 — "이 캘린더로 진행할까요?" (한국어, 메인 스레드)
        │
        ▼
  카피라이터 병렬 팬아웃 ───────→ outputs/captions|linkedin|threads|x|naver/
  copywriter × 최대 5 (Task, 한 메시지) (context/는 읽기 전용, 산출 폴더 서로 겹치지 않음)
        │
        ▼
  ◆ 승인 게이트 2 — 핸드오프 검증 + "수정할 카피 있나요?" (한국어)
        │
        ├──────────────────────┬─────────────────────────┐
        ▼                      ▼                         ▼
  비주얼 레인              릴스 레인                광고 스팟 레인
  creative-designer        video-producer            video-producer
  (브리프 게이트 → 생성,   /reels-script             /ad-storyboard (+검증 스크립트)
   image-qa.md SOP 준수)   → outputs/videos/         → outputs/storyboards/
  → outputs/creatives/                               키프레임은 creative-designer가 렌더
        │                      │                         │
        └──────────────────────┴─────────────────────────┘
        │
        ▼
  ◆ 컴플라이언스 게이트 — compliance-reviewer가 /kr-guardrail-check 실행
  → outputs/compliance/ 판정표. BLOCK → 담당 에이전트 재작업,
    WARN → 운영자 한국어 사인오프, PASS만 발행 진행
        │
        ▼
  퍼블리시 ─────────────────────→ Blotato 스케줄링
  /publisher (인라인, Blotato 미연결 시 하드스톱)
        │
        ▼
  월말 리뷰 ────────────────────→ outputs/reviews/ + context/best-performers.md
  /social-performance-review (인라인)
        │
        └──────────── best-performers.md + review-history.md ────→ 다음 달 캘린더로 피드백
```

모든 단계 후 디렉터가 `context/workflow-status.md`를 갱신합니다 — 디렉터만 씁니다.

---

## 3. Format → 레인 라우팅 표

캘린더(`context/content-calendar.md`)의 **기존 Format 컬럼 값**을 그대로 읽어 배정합니다. 새 계약 파일이나 새 컬럼은 없습니다.

| 캘린더 Format 값 | 담당 에이전트 | 실행 스킬 | 산출 폴더 |
|---|---|---|---|
| `single image` (정적 이미지) | `creative-designer` | `/social-creative-designer` + `sop/creative-designer/image-qa.md` QA 필수 | `outputs/creatives/` |
| `carousel` | `creative-designer` | `/social-creative-designer` + image-qa SOP | `outputs/creatives/` |
| `reel` (Reel / Short video) | `video-producer` | `/reels-script` | `outputs/videos/` |
| 캠페인/광고 스팟 (Format `reel` + Notes에 campaign context 또는 Objective가 sales인 프로모션 슬롯) | `video-producer` | `/ad-storyboard` (+ `normalize_storyboard_contract.py` 검증) | `outputs/storyboards/` |

- 이미지 작업은 포스트 단위 **순차** 진행(기존 `/social-creative-designer` 설계 유지). 비디오 레인은 이미지 레인과 **병렬 가능** — 산출 폴더가 겹치지 않기 때문입니다.
- 스토리보드의 `image_prompt_blocks`는 video-producer가 만들고, 키프레임/캐러셀 카드 렌더링은 creative-designer에게 넘깁니다.

---

## 4. 인간 승인 게이트

**서브에이전트는 절대 스스로 승인하지 않습니다.** 모든 게이트는 메인 스레드로 돌아오고, 디렉터가 운영자에게 **한국어로** 묻습니다.

| # | 게이트 | 시점 | 질문 예시 (한국어) |
|---|---|---|---|
| 1 | 캘린더 승인 | `/content-calendar` 완료 후 | "이 캘린더로 카피 작성을 시작할까요?" |
| 2 | 카피 승인 | 카피라이터 팬아웃 + 핸드오프 검증 후 | "수정하고 싶은 카피가 있나요? 없으면 비주얼로 넘어갑니다." |
| 3 | 제작 배정 승인 | Route G 레인 배정 직후 | "이미지 [n]건, 릴스 [n]건, 스토리보드 [n]건 — 이대로 진행할까요?" |
| 4 | 크리에이티브 브리프 승인 | creative-designer가 브리프 반환 후, 생성 **전** | "이 브리프로 이미지를 생성할까요?" (승인 후 2차 호출로 생성) |
| 5 | 비주얼/영상 결과 승인 | 각 에이전트 결과 반환 후 | "이 이미지/대본/스토리보드를 확정할까요?" |
| 6 | 컴플라이언스 사인오프 | `/kr-guardrail-check` 판정표 반환 후 | "WARN [n]건이 있습니다. 사유는 다음과 같습니다 — 그대로 진행할까요?" (BLOCK은 사인오프 불가, 재작업 필수) |
| 7 | 발행 스케줄 확정 | `/publisher` 제출 직전 | "이 스케줄로 Blotato에 제출할까요?" |
| 8 | 리뷰 → 다음 달 | `/social-performance-review` 후 | "이 권고를 반영해 다음 달 캘린더를 지금 만들까요?" |

### Blotato 미연결 하드스톱

`/publisher`의 Phase 0은 `mcp__claude_ai_Blotato__blotato_list_accounts`를 호출해 연결을 확인합니다. 실패하면 **아래 영어 메시지를 원문 그대로** 표시하고 세션을 중단합니다 (기존 스킬의 계약이므로 번역하지 않습니다):

```
Blotato is not set up.

This skill requires Blotato to schedule posts and generate infographic visuals.
Without it, no scheduling can happen from this skill.

To set up Blotato:
1. Create an account at blotato.com
2. Connect your social accounts (LinkedIn, Threads, X, Instagram, etc.)
3. Add the Blotato MCP server to your Claude Code configuration

All other Social AI Team skills work without Blotato — only /publisher needs it.
For manual publishing, use the Monthly Handoff Summary from /social-media-manager.
```

**한국어 설명:** Blotato가 연결되어 있지 않으면 발행 스킬은 어떤 질문도 하지 않고 즉시 멈춥니다. 디렉터는 이 메시지를 그대로 보여준 뒤, 한국어로 "Blotato 없이 수동 발행하시겠어요? Monthly Handoff Summary로 파일을 넘겨드릴 수 있습니다"라고 대안을 제시합니다. 우회 시도는 금지 — 하드스톱은 설계입니다.

---

## 5. 이중 언어 경계 규칙 + 영어 계약 필드 용어집

### 규칙: "한국어로 말하고, 영어로 계약한다"

- **한국어 영역:** 운영자 대화, 상태 요약, 승인 질문, 콘텐츠 본문(카피·자막·대본), Notes for Operators의 조언.
- **영어 영역:** 기계가 읽는 모든 것 — 필드명, 상태값, 파일명 패턴, 폴더 경로, YAML frontmatter. 번역·변형·재발명 금지.

### 영어 계약 필드 용어집

| 계약 요소 | 형식 | 쓰는 쪽 → 읽는 쪽 |
|---|---|---|
| `VISUAL DIRECTION:` | 캡션 파일 내 필드 | `/caption-writer` → `/social-creative-designer` (비주얼 브리핑 노트) |
| `BLOTATO FLAG:` | `BLOTATO FLAG: Yes — [type]` 또는 `BLOTATO FLAG: No` | `/linkedin-writer`, `/threads-writer`, `/x-writer` → `/publisher` (인포그래픽 필요 여부) |
| `PASS` / `WARN` / `BLOCK` | 포스트별 판정값 | `/kr-guardrail-check` → `/content-director` (BLOCK=재작업, WARN=인간 사인오프, PASS=발행 가능) |
| `Char count: [n]/280`, `[n]/500` | 글자 수 필드 | 플랫폼 라이터 (X는 CJK 2배 가중 → 실효 140자) |
| `context/*.md` | `brand-style.md`, `content-calendar.md`, `best-performers.md`, `kr-voice-profile.md`, `workflow-status.md`, `upcoming-events.md`, `review-history.md` | 모든 스킬이 읽음. `workflow-status.md`는 **디렉터만 씀**. 에이전트에게 `context/`는 읽기 전용 |
| `outputs/*` 폴더 규약 | `captions/`, `linkedin/`, `threads/`, `x/`, `creatives/`, `reviews/` (기존) + `videos/`, `storyboards/`, `compliance/`, `naver/` (신규) | 레인별 산출 폴더 — 서로 겹치지 않아 병렬 안전 |
| `Sponsored:` / `Main keyword:` / `TAGS:` | 네이버 글 헤더 필드 | `/naver-blog-writer` → `/kr-guardrail-check` (대가성 판별·고지 검증). naver 출력에 `BLOTATO FLAG`는 **없음** — 발행은 수동 |
| 파일명 패턴 | `[client-name]-[type]-[month]-[year].md` | 모든 산출물. `/kr-guardrail-check`가 기계적으로 검증 |

---

## 6. MCP 요구사항 표

**MCP를 새로 발명하지 않습니다.** 이 시스템이 아는 MCP는 아래 6개가 전부이며, 도구명은 기존 스킬 파일에 적힌 `mcp__` 표기를 그대로 씁니다.

| MCP | 필수 여부 | 사용처 | 없을 때 (베이스라인 모드) |
|---|---|---|---|
| **Nano Banana** | 비주얼 제작 1순위 | `creative-designer` (`/social-creative-designer`), 스토리보드 키프레임, 스톱모션 — Composite/Brand/Stop-Motion은 이 경로 전용 | 2순위 ima2 → 3순위 Codex로 폴백 (아래) |
| **ima2 렌더 레인** (MCP 아님 — CLI) | 선택 (이미지 2순위 + **영상 실행**) | `creative-designer` — `ima2 gen`/`edit` (레퍼런스 ≤5, I2I 편집); `video-producer` — `ima2 video`/`video continue`로 릴스 CLIP PLAN 실제 실행. ChatGPT OAuth(이미지, 무료)/Grok OAuth(+영상), **API 키 불요**. `sop/creative-designer/ima2-render.md` | 다음 순위로 폴백 |
| **Codex 렌더 레인** (MCP 아님 — CLI) | 선택 (이미지 3순위) | `creative-designer` — `sop/creative-designer/scripts/codex_render.sh` (Codex CLI + OpenAI Images API `gpt-image-1`). **Generate 모드·키프레임 전용.** `OPENAI_API_KEY` 환경 secret 또는 `codex login` 필요 | 브리프 온리 (텍스트 프롬프트 스펙만 산출) |
| **Blotato** | 퍼블리싱 시 **필수** | `/publisher` (`mcp__claude_ai_Blotato__blotato_*`) | 하드스톱 (섹션 4) → 수동 발행 핸드오프 |
| **Playwright** | 선택 | `/brand-onboarding` (웹사이트·인스타그램 증거 수집) | 운영자 인터뷰로 대체 |
| **Firecrawl** | 선택 | `/content-calendar`, `/caption-writer`, `/linkedin-writer`, `/x-writer`, `/social-performance-review`, copywriter (경쟁사 리서치) | 리서치 생략, 브랜드 컨텍스트만으로 진행 |
| **SerpApi** | 선택 | `/content-calendar`, `/caption-writer` (트렌드 리서치) | 리서치 생략 |
| **Tasty Content** | 선택 | `/x-writer` (X 트렌드 리서치) | 리서치 생략 |

---

## 7. 알려진 계약 편차 노트

기존 10개 스킬을 무수정으로 유지하는 대가로, 스킬 간 문서상 어긋남이 몇 개 존재합니다. 신규 레이어는 이를 **고치지 않고 흡수**합니다:

1. **리뷰 파일명 두 변형.** `/social-performance-review`는 실제로 `outputs/reviews/[client-name]-social-review-[month]-[year].md`로 저장하지만, `/social-media-manager`와 리뷰 스킬 자신의 입력 참조는 `[client]-review-[month]-[year].md`를 가리킵니다. → 디렉터와 `/kr-guardrail-check`는 **`-review-`와 `-social-review-` 두 표기를 모두 검색**합니다. 한쪽만 찾고 "리뷰 없음"으로 판단하지 마세요.
2. **caption-writer에는 BLOTATO FLAG가 없습니다.** `/publisher`의 Notes는 "caption-writer도 BLOTATO FLAG를 쓴다"고 서술하지만, 실제 `/caption-writer` 스킬에는 이 필드가 존재하지 않습니다 (있는 것은 `VISUAL DIRECTION`뿐). `/publisher` 본문 자체도 "플래그 없는 포스트(예: caption-writer 산출물)는 인포그래픽 생성을 건너뛴다"고 처리합니다. → **BLOTATO FLAG는 플랫폼 전문 스킬(linkedin/threads/x)에만 있는 계약**으로 취급하고, 캡션 파일에서 이 필드를 찾거나 요구하지 마세요.

---

## 8. 설치

```bash
bash install.sh
```

- **스킬 17종** → `~/.claude/skills/` (기존 10 + content-director, reels-script, ad-storyboard, kr-guardrail-check, kr-voice-localizer, naver-blog-writer, ima2)
- **에이전트 4종** → `~/.claude/agents/` (copywriter, creative-designer, video-producer, compliance-reviewer)
- Windows는 `install.bat`.

**사용자 레벨(`~/.claude/`) 설치가 필수인 이유:** SETUP.md 방식대로 클라이언트마다 별도 작업 폴더를 만들어 그 안에서 스킬을 실행하는데, 클라이언트 폴더는 이 저장소의 `.claude/`를 볼 수 없습니다. 사용자 레벨에 설치해야 어느 폴더에서든 팀이 동작합니다. 클라이언트 폴더(`context/`, `assets/`, `outputs/`)는 SETUP.md 방식 그대로 저장소와 **별도로** 유지합니다.

`sop/creative-designer/` 폴더(image-qa.md, codex-render.md, scripts/codex_render.sh)는 클라이언트 폴더의 `sop/` 경로에 복사해 두면 기존 `/social-creative-designer` Phase 0의 SOP 훅이 자동으로 읽습니다 — 스킬 수정 없이 동작하는 검증된 훅입니다. Codex 렌더 레인을 쓰려면 환경에 `OPENAI_API_KEY` secret을 등록하세요 (Claude Code 웹 환경: 환경 설정 → 환경 변수).

---

## 9. 시작하기

```bash
mkdir my-client && cd my-client
# 이 폴더에서 Claude Code를 열고:
/content-director
```

디렉터가 Phase 0 컨텍스트 체크(`context/*.md`, `workflow-status.md`, 최신 산출물)를 수행하고, 현재 상태를 한국어로 요약한 뒤 다음 루트를 제안합니다. 신규 클라이언트라면 온보딩부터, 진행 중이었다면 `workflow-status.md`가 가리키는 지점부터 이어갑니다. 영어 원본 워크플로우를 쓰고 싶다면 기존 `/social-media-manager`도 그대로 사용 가능합니다.

---

## 10. 로드맵 (미구현)

| 항목 | 내용 | 전제 |
|---|---|---|
| **네이버 블로그 자동 발행** | `/naver-blog-writer`의 산출물은 현재 수동 발행. 네이버 API/MCP가 쓸 만해지면 발행 연동 | 공식 연동 수단 확보 시 |

구현 완료되어 로드맵에서 졸업한 항목: **naver-blog-writer** (`skills/naver-blog-writer/`), **series-variation 풀 매트릭스** (`skills/reels-script/references/series-variation-matrix.md`), **영상 엔진 실행 연동** (Runway/Seedance MCP 대기 대신 **ima2 + Grok video**로 확보 — `/reels-script`의 CLIP PLAN을 `ima2 video`/`video continue`로 실제 실행).

---

## 관련 문서

- `README.md` — 기존 10개 스킬의 영어 원본 문서
- `SETUP.md` — 초심자용 설치·클라이언트 폴더 안내
- `skills/content-director/SKILL.md` — 디렉터의 전체 라우팅·게이트 규칙 (이 매뉴얼의 실행 명세)
