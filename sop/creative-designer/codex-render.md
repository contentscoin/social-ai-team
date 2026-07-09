# Codex 렌더 경로 SOP — /social-creative-designer 보조 렌더 레인

Nano Banana MCP가 없거나 운영자가 지시한 경우, 이미지 생성을 **OpenAI Codex CLI**(+ OpenAI Images API `gpt-image-1`)로 수행하는 경로입니다. `image-qa.md`의 모든 규칙(텍스트 세이프, 이중 스코어링, 재생성 상한 2회, 자산 프라이버시)은 이 경로에도 **동일하게** 적용됩니다.

## 렌더 경로 우선순위

> **통합 우선순위는 `ima2-render.md`의 표가 기준입니다**: ① Nano Banana MCP → ② ima2 (`ima2 gen`/`edit`) → ③ Codex (이 문서) → ④ 브리프 온리. 이 문서는 ③ Codex 경로의 상세 규약입니다.

| 경로 | 조건 |
|---|---|
| **Codex MCP 위임 — pumasi 방식** (`mcp__codex__codex`) | codex가 MCP 서버로 등록돼 있고 (아래 등록 방법) codex 인증 완료. 조립된 프롬프트 + 출력 경로 규칙을 codex 서브에이전트에 위임하고 결과 파일 경로만 회수 (사용자 video-production 리포의 pumasi/image-generator 패턴) |
| **Codex 렌더 스크립트** (`sop/creative-designer/scripts/codex_render.sh`) | MCP 위임 불가 시 동일 백엔드의 스크립트 경로. **Generate 모드(신규 생성)와 스토리보드 키프레임 전용** (위임 방식도 동일 제약) |

**pumasi 방식 위임 계약 (2a):** 호출당 하나의 명확한 태스크만 전달합니다 — ① 최종 프롬프트 전문(재작성 금지 명시), ② 정확한 출력 파일 경로, ③ 크기/비율, ④ "파일 생성 후 경로만 보고" 지시. codex가 프롬프트를 손대지 않게 하는 것이 pumasi 원칙입니다 (프롬프트 작성 책임은 이쪽, 실행 책임은 codex).

## codex MCP 서버 등록 (2a 경로 — 운영자가 직접 추가)

MCP 서버 등록은 실행 권한을 넓히는 설정이므로 **운영자가 직접** 추가합니다. 프로젝트 루트의 `.mcp.json`에:

```json
{
  "mcpServers": {
    "codex": { "command": "codex", "args": ["mcp-server"] }
  }
}
```

또는 `claude mcp add codex -- codex mcp-server`. 등록하면 `mcp__codex__codex` 도구가 생기고, pumasi 방식 위임이 활성화됩니다.

## 인증 요구사항

- `OPENAI_API_KEY` 환경 변수 (헤드리스 환경 권장 — Claude Code 환경 설정의 secret으로 등록), 또는
- 로컬에서 `codex login` 완료된 세션 (`~/.codex/auth.json`)

키가 없으면 스크립트는 exit 2 + `AUTH MISSING` 메시지로 즉시 멈춥니다 — 조용히 건너뛰지 않습니다.

## 호출 계약

```bash
bash sop/creative-designer/scripts/codex_render.sh \
  --prompt-file outputs/creatives/tmp-prompt-post1.txt \
  --out outputs/creatives/ondo-post1-roasting-v1.png \
  --size 1024x1536        # 4:5 피드는 1024x1536(세로), 정방형 1024x1024, 가로 1536x1024
```

- 프롬프트는 **파일로** 전달합니다 (따옴표 이스케이프 사고 방지). 스킬의 6요소 프레임워크로 작성한 최종 프롬프트를 그대로 담습니다.
- 스크립트는 ① codex exec가 API를 호출해 PNG 저장 → 실패 시 ② 동일 키로 Images API 직접 호출 폴백. 어느 쪽이든 산출 파일 검증(`file` 매직 체크) 후 성공을 보고합니다.
- 생성 후에도 `outputs/creatives/prompts-used.md` 로깅은 기존 규약대로 필수입니다 (경로에 `render: codex` 표기 추가).

## 이 경로의 제약 (정직하게)

- **Composite/Brand/Stop-Motion 모드는 지원하지 않습니다.** 실제 제품 사진 앵커링·이미지 편집은 Nano Banana 경로 전용입니다. Codex 경로에서 제품 포스트를 만들 때는 제품 왜곡 리스크를 브리프에 명시하고 실사 대체를 우선 검토하세요.
- 한국어 텍스트 렌더링 금지 규칙은 그대로: 프롬프트에 `no text, no lettering`을 포함하고 문구는 후반 합성.
- 생성물은 AI 생성물입니다 — `#AI생성` 고지 의무가 Nano Banana 경로와 동일하게 적용됩니다 (`/kr-guardrail-check` Part 3).
- 비용: gpt-image-1 호출당 과금. 재생성 상한(2회)을 넘기지 마세요.

## QA 루프 (image-qa.md 준수)

1. 생성 전: 브리프 게이트 (메인 스레드 인간 승인) — 기존 2회 호출 프로토콜 유지
2. 생성 후: 이중 스코어링 (제품 충실도 / 브랜드·무드 적합도) — 4:5 크롭 세이프존 확인
3. 실패 분류 → 프롬프트 표적 수정 → 재생성 (최대 2회) → 이후 인간 에스컬레이션
