# ima2 렌더 경로 SOP — 이미지·영상 로컬 생성 스튜디오 (ima2-gen)

사용자의 [ima2-gen](https://github.com/lidge-jun/ima2-gen) (`npm i -g ima2-gen`)을 팀의 렌더 백엔드로 쓰는 경로입니다. **ChatGPT OAuth(무료, 이미지) / Grok OAuth(이미지+영상)** 로 로그인하므로 API 키가 필요 없습니다. `image-qa.md`의 규칙(이중 스코어링, 재생성 상한 2회, 자산 프라이버시, #AI생성 고지)은 동일 적용됩니다. 상세 CLI 규약은 `/ima2` 스킬(`~/.claude/skills/ima2/SKILL.md` — ima2-gen 번들 스킬 원문)을 따릅니다.

## 렌더 경로 우선순위 (통합판 — codex-render.md의 표를 대체)

| 순위 | 경로 | 조건 · 용도 |
|---|---|---|
| 1 | Nano Banana MCP (`mcp__nanobanana__generate_image`) | MCP 연결됨. Composite(제품 사진 앵커)·Brand·Stop-Motion의 **기본 경로** |
| 2 | **ima2** (`ima2 gen` / `ima2 edit`) | ima2 설치 + OAuth 로그인됨. Generate 모드·키프레임·캐러셀 카드. `--ref`(최대 5장)와 `edit`로 **레퍼런스 기반·편집 워크플로 부분 지원** — 제품 충실도는 image-qa 이중 스코어링으로 반드시 검증 |
| 3 | Codex (`mcp__codex__codex` 위임 → `scripts/codex_render.sh`) | codex 인증 시. Generate 모드·키프레임 전용 |
| 4 | 브리프 온리 | 전부 불가 — 프롬프트 스펙만 텍스트 산출 |

**영상**: `ima2 video` (Grok OAuth 필요)는 video-producer의 실행 레인입니다 — 아래 "영상 실행" 절.

## 이미지 호출 계약

```bash
ima2 ping || ima2 serve          # 서버 상태 확인 → 필요 시 기동 (~/.ima2/server.json에 실제 URL)
ima2 gen "<6요소 프레임워크 최종 프롬프트>" --quality high -o outputs/creatives/<파일명>.png
ima2 gen "<프롬프트>" --ref assets/products/<제품사진>.png --quality high -o ...   # 레퍼런스 (최대 5)
ima2 edit outputs/creatives/<기존>.png --prompt "<수정 지시>" -o ...               # 편집(I2I)
ima2 gen "<후보 4안>" -n 4 -d outputs/creatives/                                   # 배치는 -n (병렬 플래그 없음)
```

- 프롬프트는 스킬의 6요소 프레임워크 산출물을 그대로 사용, `--mode direct`는 재작성 없이 원문 투입이 필요할 때만.
- 생성 후 `outputs/creatives/prompts-used.md`에 `render: ima2` 표기로 로깅 (기존 규약 유지).

## 한국어 텍스트 렌더링 — 예외 규정

기본 규칙(image-qa.md)은 "한국어 문구는 모델이 렌더링하지 않고 후반 합성"입니다. 단, **ima2의 GPT Image 2는 정확한 문구 지정 시 가시 텍스트 렌더링을 지원**하므로 다음 조건을 모두 충족하면 예외 허용:
1. 프롬프트에 **정확한 문구를 따옴표로** 명시 (언어·문자·위치·크기·스타일 + "그 외 읽히는 텍스트 금지")
2. 짧은 문구만 (헤드라인 수준 — 긴 문단·법적 고지·픽셀 정밀 UI는 여전히 후반 합성)
3. 생성 후 **글자 검수**를 image-qa 체크리스트에 추가 — 오탈자·유령 글자 발견 시 실패 분류 → 재생성 또는 후반 합성 폴백

## 영상 실행 (video-producer 레인)

`/reels-script`의 CLIP PLAN + ENGINE PROMPT SPEC은 Grok OAuth가 있으면 실행 가능합니다:

```bash
ima2 video "<클립 프롬프트>" --duration <초> --resolution 720p --ref <키프레임.png>   # T2V/I2V/Ref2V
ima2 video continue "<다음 클립 프롬프트>" --video <직전 생성.mp4>                     # 마지막 프레임 이어붙이기 — 클립 체인
ima2 video frame <생성.mp4>       # 프레임 추출 (루프 검증: 첫/끝 프레임 비교)
ima2 video analyze <생성.mp4>     # 첫/끝 프레임 비전 분석
```

- 클립 분할(≤15초)과 `--duration`이 맞물리고, `video continue`가 클립 체인·루프 설계(마지막≈첫 프레임)를 그대로 구현합니다.
- 산출 mp4는 `outputs/videos/`에 저장, 선적 게이트(훅 타이밍·루프·#AI생성)는 기존과 동일.

## 셋업 (설치 시 적용 — 데스크톱 앱 마법사에 포함)

```bash
npm install -g ima2-gen
ima2 setup        # 대화형: 1 GPT OAuth(이미지) / 2 Grok OAuth(+영상) / 3 둘 다
ima2 doctor       # 문제 시 진단
```
