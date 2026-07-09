# Social AI Team Desktop (PC 설치용 앱)

소셜 콘텐츠 팀(스킬 16종 + 서브에이전트 4종 + Codex 이미지 레인)을 PC에 설치하고 운영하는 데스크톱 컨트롤타워입니다. Electron 기반, Windows(NSIS 설치본)·macOS(DMG)·Linux(AppImage)를 지원합니다.

## 앱이 하는 일

1. **설치 마법사 — "설치했을 때 적용"**
   - Claude Code CLI / Codex CLI 설치 여부 점검 (Codex는 버튼 한 번으로 npm 설치)
   - 번들된 스킬 16종 → `~/.claude/skills/`, 에이전트 4종 → `~/.claude/agents/` 적용
   - **Codex OAuth 로그인**: PC의 기본 브라우저로 표준 OAuth 진행 (실패 시 디바이스 코드 폴백)
   - **Codex MCP 등록**: `claude mcp add -s user codex -- codex mcp-server` — pumasi 방식 위임(`mcp__codex__codex`) 활성화
2. **클라이언트 관리** — `~/SocialAITeam/<이름>` 폴더 생성(context/assets/outputs 시드 + sop 렌더 레인 자동 배치), 기존 폴더 추가
3. **파이프라인 대시보드** — `context/workflow-status.md` 파싱, 파운데이션 파일 상태 표시
4. **단계 실행** — 각 버튼이 클라이언트 폴더에서 `claude -p`를 헤드리스로 실행하고 로그를 스트리밍:
   캘린더 → 카피 팬아웃 → 릴스/스토리보드 → 비주얼 브리프/생성(2회 호출 프로토콜) → 컴플라이언스 → 월말 리뷰.
   **단계 사이의 승인 게이트는 이 앱이 담당합니다** — 산출물 탭에서 검토 후 다음 버튼을 누르는 행위가 곧 승인입니다.
5. **대화형 모드** — 온보딩 인터뷰 등 질문이 많은 단계는 "디렉터와 대화" 버튼으로 시스템 터미널에서 `/content-director` 실행
6. **산출물 뷰어** — outputs/ 전 레인의 마크다운·이미지 미리보기 (컴플라이언스 판정표 포함)

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

권장: 태그(`v*`)를 푸시하면 GitHub Actions(`.github/workflows/desktop-build.yml`)가 Windows/macOS/Linux 설치본을 빌드해 아티팩트로 올립니다.

## 요구사항

- [Claude Code CLI](https://code.claude.com/docs/en/quickstart) — 파이프라인 실행 엔진 (구독/로그인 필요)
- Node.js 20+ (Codex CLI npm 설치용)
- 이미지 생성: Nano Banana MCP 또는 Codex(OAuth) — 앱 설치 마법사가 Codex 경로를 셋업합니다

## 구조

```
desktop/
├── main.js            Electron 메인 (IPC 라우팅)
├── preload.js         contextBridge (renderer는 Node 접근 불가)
├── lib/
│   ├── setup.js       환경 점검·스킬 설치·Codex OAuth·MCP 등록
│   ├── workspace.js   클라이언트 폴더 CRUD + workflow-status 파싱 + 산출물 리더
│   └── pipeline.js    단계별 claude -p 러너 + 대화형 터미널 런처
└── src/               UI (탭: 대시보드 / 산출물 / 로그)
```

패키징 시 리포의 `skills/`, `.claude/agents/`, `sop/`가 `resources/payload/`로 번들되어 설치 마법사가 이를 `~/.claude`와 클라이언트 폴더에 적용합니다.
