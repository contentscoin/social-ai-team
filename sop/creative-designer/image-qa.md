---
name: image-qa
version: 1.0.0
description: Default image QA SOP auto-loaded by the social-creative-designer skill in Phase 0. Defines text-safe rendering rules, dual scoring, pre-generation QA, failure-repair loops, the stop-motion contact sheet gate, and the sanitized learning loop. Client folders may override.
---

# Image QA SOP — Creative Designer

이 문서는 `social-creative-designer` 스킬이 **Phase 0 — Setup**에서 `sop/creative-designer/`를 읽을 때 자동으로 로드되는 **기본(클라이언트 무관) 이미지 QA SOP**다.

**적용 및 오버라이드 규칙:**
- 클라이언트 작업 폴더에 자체 `sop/creative-designer/image-qa.md`가 있으면 **그 파일이 우선**한다. 클라이언트 파일에 없는 섹션은 이 기본 SOP를 따른다.
- 이 SOP는 스킬 본문(SKILL.md)의 절차를 **바꾸지 않는다**. 스킬의 Phase 2(Creative Brief 승인), Phase 4(생성), Phase 6(리뷰) 사이에 끼워 넣는 **품질 게이트**만 정의한다.
- 모든 승인 게이트는 메인 스레드로 돌아가 **운영자에게 한국어로** 묻는다. 서브에이전트가 스스로 승인하고 넘어가는 일은 없다.
- 이 SOP를 따르는 어떤 에이전트도 `context/workflow-status.md`를 직접 쓰지 않는다. 상태 기록은 디렉터의 몫이다.

---

## 1. 텍스트 세이프 규칙 (Text-Safe Rule)

**한국어 문구, CTA, 가격 텍스트는 절대 이미지 생성 모델이 렌더링하지 않는다.** 모델의 한글 렌더링은 신뢰할 수 없으며, 깨진 한글이 들어간 이미지는 클라이언트에게 보여줄 수 없는 결과물이다.

**절차:**

1. 브리프에 한국어 오버레이 텍스트 / CTA / 가격이 포함되어 있으면, Phase 3 프롬프트의 `Text overlay` 요소를 **제거**하고 **텍스트 없는(text-free) 배경 이미지**로 생성한다. 텍스트가 올라갈 영역(예: 하단 1/3)은 프롬프트의 Composition 요소에 "여백/단순 배경"으로 확보해 둔다.
2. 텍스트 합성은 **스킬이 이미 MP4 내보내기에 쓰는 것과 동일한 Python 단계에서** PIL(또는 SVG 렌더링)로 결정적으로 처리한다. 모델에게 다시 시키지 않는다.
3. 짧은 영문 오버레이(예: "HOT HONEY")는 스킬 본문의 기존 규칙을 따르되, 한 글자라도 깨지면 재생성하지 말고 즉시 이 규칙(텍스트 프리 생성 + PIL 합성)으로 전환한다.

**PIL 합성 예시 (MP4 내보내기와 같은 Python 실행 블록에서):**

```python
from PIL import Image, ImageDraw, ImageFont

def overlay_text(base_path, out_path, text, font_path, font_size,
                 fill, position, anchor="ms"):
    img = Image.open(base_path).convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font = ImageFont.truetype(font_path, font_size)  # brand-style.md 타이포에 맞는 폰트 파일
    draw.text(position, text, font=font, fill=fill, anchor=anchor)
    Image.alpha_composite(img, layer).convert("RGB").save(out_path)

# 예: 1:1 정사각 하단 1/3 중앙 정렬 CTA
overlay_text(
    "outputs/creatives/[concept]-gen-v1.png",
    "outputs/creatives/[concept]-gen-v1-final.png",
    "지금 주문하기", "[한글 폰트 경로].ttf", 96,
    fill="[brand-style.md 텍스트 컬러 hex]",
    position=(512, 880),
)
```

- 폰트 색상·케이스·위치는 `context/brand-style.md`를 따른다.
- 합성 전 원본(text-free)과 합성본(-final)을 **둘 다** `outputs/creatives/`에 남긴다 — 텍스트만 바꿔 재사용할 수 있게.
- 배경이 밝아 가독성이 떨어지면 텍스트 뒤에만 PIL로 반투명 검정 박스/비네트를 깐다. 모델에게 어둡게 다시 그려 달라고 하지 않는다.

---

## 2. 이중 스코어링 (Dual Scoring)

생성된 모든 이미지는 **두 개의 독립된 점수**로 평가한다. **두 점수를 절대 합산하거나 평균 내지 않는다** — 무드가 10점이어도 제품 라벨이 왜곡됐으면 그 이미지는 불합격이다.

### 점수 A — 제품 충실도 (Product Fidelity) · Composite / Stop-Motion 모드 전용

원본 제품 사진과 **직접 비교**하여 채점한다. 생성 이미지를 열 때 반드시 원본 제품 사진도 함께 열어 나란히 확인한다.

| 점검 항목 | 기준 |
|---|---|
| 패키지 형태 | 병/용기의 실루엣, 비율이 원본과 동일 |
| 라벨 | 라벨 텍스트·로고·그래픽이 원본 그대로 (재렌더링 흔적 없음) |
| 색상 | 제품 고유 색상이 조명 차이 이상으로 변하지 않음 |
| 스케일 | 씬 안에서 제품 크기가 물리적으로 자연스러움 |

- 채점: 5점 척도. **5/5만 PASS.** 제품은 협상 대상이 아니다 — 항목 하나라도 어긋나면 FAIL이고 §4의 수리 루프로 보낸다.

### 점수 B — 브랜드/무드 적합도 (Brand & Mood Fit) · 전 모드

`context/brand-style.md` 기준으로 채점한다.

| 점검 항목 | 기준 |
|---|---|
| 팔레트 | 브랜드 팔레트 내 색감, 오프브랜드 컬러 없음 |
| 무드 | 브랜드 비주얼 바이브(3단어)와 일치 |
| 구도 | 브리프의 Composition 지시와 일치, 플랫폼 포맷에 적합 |
| 금지사항 | do/don't 리스트 위반 없음 |

- 채점: 5점 척도. **4/5 이상 PASS.**

### 기록

두 점수는 `outputs/creatives/prompts-used.md`의 해당 변형(variant) 항목 아래에 영어 필드로 덧붙인다:

```
**QA — Product Fidelity:** 5/5 PASS | **QA — Brand/Mood Fit:** 4/5 PASS
```

두 점수 모두 PASS인 변형만 운영자에게 제시한다. 하나라도 FAIL이면 §4로 간다.

---

## 3. 생성 전 QA 체크리스트 (브리프 단계)

Phase 2 Creative Brief를 운영자에게 제시하기 **전에** 스스로 점검한다. 하나라도 미충족이면 브리프를 내보내지 말고 먼저 보완한다.

- [ ] `context/brand-style.md`를 실제로 읽었고, 프롬프트의 Style 요소에 **팔레트가 명시적으로** 반영됐다
- [ ] brand-style.md의 **do/don't(금지사항)가 negative prompt에** 반영됐다
- [ ] 프롬프트에 **6요소가 전부** 있다: Subject / Composition / Action / Location / Style / Camera + lighting — 하나라도 비면 결과물이 제네릭해진다
- [ ] Composite 모드: 제품 사진 경로가 지정됐고 고해상도인지 확인했다 (저해상 입력 = 저해상 합성)
- [ ] Composite 모드: 스타일/씬 **레퍼런스 이미지 사용 여부를 확인**했고, 사용 시 각 입력 이미지의 역할(Image A/B/C)을 프롬프트에 명시했다
- [ ] 한국어 텍스트/CTA/가격이 브리프에 있으면 §1 텍스트 세이프 규칙이 적용됐다 (프롬프트에 한글 렌더링 지시 없음)
- [ ] Stop-Motion 모드: 6프레임 아크가 설계됐고, 잠금 씬(LOCKED SCENE) 문구가 6개 프레임 프롬프트에 **verbatim 복사**됐다
- [ ] 포맷(1:1 / 9:16)이 게시 대상 플랫폼과 일치한다

이 체크리스트 통과 후, 스킬 본문대로 Creative Brief를 운영자에게 한국어로 제시하고 승인을 받는다.

---

## 4. 실패 분류 → 표적 수리 루프

QA(§2)에서 FAIL이 나오면 먼저 **실패 유형을 분류**하고, 유형에 맞는 표적 수정만 가한다. 프롬프트 전체를 갈아엎지 않는다 — 무엇이 고쳐졌는지 알 수 없게 된다.

### 실패 유형 분류표

| 유형 | 증상 | 표적 수리 전략 |
|---|---|---|
| 구도 (Composition) | 프레이밍이 어긋남, 피사체 잘림, 여백 부족 | Composition 요소만 재작성 — 앵글·크롭·피사체 위치를 더 구체적으로 ("product centred, full label visible, 10% margin") |
| 조명 (Lighting) | 밋밋함, 시간대/광원 어긋남, 그림자 부자연 | Camera + lighting 요소만 강화 — f값, 광원 방향, 시간대를 수치·방향으로 명시 |
| 제품 왜곡 (Product distortion) | 라벨 뭉개짐, 형태 변형, 색 변화 | 보존 문구 강화: "The product image is fixed and must not be modified in any way — treat it as a placed object". 스타일 레퍼런스가 제품을 오염시키면 input_image_path_2 제거 후 재시도. 원본 해상도 재확인 |
| 스타일 이탈 (Style drift) | 오프브랜드 색감/무드 | Style 요소에 brand-style.md 팔레트를 hex로 직접 명시, 이탈한 요소를 negative prompt에 추가 |
| 텍스트 렌더링 (Text rendering) | 글자 깨짐, 오탈자, 유사 문자 | 재생성으로 고치려 하지 말 것. 즉시 §1 적용: 프롬프트에서 텍스트 제거 → text-free 재생성 → PIL 합성. (이 전환은 아래 재생성 횟수에 세지 않는다) |

### 루프 규칙

1. 실패 유형 분류 → 해당 요소만 수정 → `mcp__nanobanana__generate_image`로 재생성 → §2 재채점.
2. **동일 변형에 대한 재생성은 최대 2회.** 2회 후에도 FAIL이면 멈추고 **메인 스레드를 통해 운영자에게 한국어로 에스컬레이션**한다. 실패 이미지, 시도한 수리 전략, 남은 선택지(모드 전환 / 원본 사진 교체 / 방향 수정)를 함께 제시한다. 실패한 드래프트를 통과된 것처럼 제시하지 않는다.
3. 수리에 쓴 프롬프트 변경 내역은 `outputs/creatives/prompts-used.md`에 변형별로 기록한다 (무엇을 왜 바꿨는지 한 줄씩).

---

## 5. 스톱모션 — 6프레임 콘택트시트 게이트

Stop-Motion 모드에서는 **MP4를 내보내기 전에 반드시** 6프레임을 한 장의 콘택트시트로 합쳐 운영자 확인을 받는다. 프레임 하나의 씬 이탈이 MP4가 된 뒤에 발견되면 내보내기·검수 시간이 전부 낭비된다.

**절차:**

1. 6프레임 생성 완료 후(스킬 본문의 배칭 규칙: 동시 2프레임 준수), MP4 내보내기와 동일한 Python 단계에서 콘택트시트를 만든다:

```python
from PIL import Image

def contact_sheet(frame_paths, out_path, cols=3, thumb_w=540):
    thumbs = []
    for p in frame_paths:
        img = Image.open(p)
        h = int(img.height * thumb_w / img.width)
        thumbs.append(img.resize((thumb_w, h)))
    rows = -(-len(thumbs) // cols)
    sheet = Image.new("RGB", (cols * thumb_w, rows * thumbs[0].height), "white")
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % cols) * thumb_w, (i // cols) * t.height))
    sheet.save(out_path)

frames = [f"outputs/creatives/reel-[subject]-frame-0{i}.png" for i in range(1, 7)]
contact_sheet(frames, "outputs/storyboards/reel-[subject]-contact-sheet.png")
```

2. 콘택트시트는 `outputs/storyboards/reel-[subject]-contact-sheet.png`로 저장한다.
3. 콘택트시트를 보며 셀프 점검:
   - [ ] 잠금 씬 일관성 — 배경색·바닥·소품·음식이 6프레임 모두 동일
   - [ ] 제품 충실도(§2 점수 A) — 6프레임 **각각** 5/5
   - [ ] 액션 아크 — 프레임 1→6의 동작 진행이 브리프의 아크와 일치, 루프가 자연스럽게 닫힘
4. 셀프 점검 통과 후 콘택트시트를 **운영자에게 제시하고 한국어로 승인을 요청**한다: "6프레임 콘택트시트입니다. 씬 일관성과 동작 흐름을 확인해 주세요. 승인하시면 MP4로 내보냅니다."
5. **승인 후에만** 스킬 본문의 `make_mp4` 단계(표준 5fps + 슬로우 3fps 두 버전)를 실행한다. 특정 프레임 교체 지시가 나오면 해당 프레임만 재생성(§4 루프 규칙 적용) 후 콘택트시트를 다시 만든다.

---

## 6. 자산 프라이버시 + 학습 루프

### 프라이버시 경계 (하드 룰)

**클라이언트 자산은 클라이언트 폴더 밖으로 나가지 않는다.** 다음은 전부 클라이언트 자산이다:

- 원본 제품/라이프스타일 사진과 생성된 이미지·영상 파일 (및 그 경로)
- 브랜드명·제품명·캠페인명이 들어간 프롬프트 원문
- `context/brand-style.md`의 내용 (팔레트 hex, 금지사항 원문 포함)
- 운영자/클라이언트 피드백 원문

이것들은 해당 클라이언트의 `outputs/`·`context/`·클라이언트 SOP 폴더 안에서만 존재한다. 이 공용 기본 SOP 파일이나 다른 클라이언트의 폴더에 절대 기록하지 않는다.

### 학습 루프 — "기능은 공유하고, 내용은 공유하지 않는다"

작업 중 얻은 성공/실패 교훈은 SOP 개선에 반영하되, **브랜드 정보를 제거(sanitize)한 뒤에만** 공용 SOP에 들어갈 수 있다.

- **클라이언트 로컬 교훈** (원문 그대로): 해당 클라이언트의 `sop/creative-designer/` 오버라이드 파일에 기록해도 된다.
- **공용 교훈** (이 파일의 부록 등 공용 SOP): 아래 sanitize 체크리스트를 **전부** 통과하고, 메인 스레드에서 운영자에게 한국어로 승인받은 뒤에만 반영한다.

**Sanitize 체크리스트 — 하나라도 남아 있으면 공용 반영 금지:**

- [ ] 브랜드명·제품명·클라이언트명·캠페인명 제거 (일반 명사로 치환: "소스 병 제품" 등)
- [ ] 파일 경로·파일명 제거
- [ ] 프롬프트 원문 verbatim 제거 — 기능적 패턴만 남김
- [ ] 피드백 원문 verbatim 제거
- [ ] 특정 이미지/납품물을 **재구성할 수 있는** 묘사 제거
- [ ] 남은 내용이 "어떤 클라이언트에게든 재사용 가능한 기능적 교훈"인지 확인
- [ ] 운영자 승인 (메인 스레드, 한국어)

**Sanitize 통과 교훈 예시:**

> 유리병 제품 Composite에서 스타일 레퍼런스 이미지가 제품 색을 오염시키는 경우, 레퍼런스를 빼고 Style 요소에 팔레트를 hex로 직접 쓰는 쪽이 2회 이내에 PASS했다.

---

## 운영자 참고 (Notes for Operators)

- 이 SOP는 기본값이다. 클라이언트별로 더 엄격한 기준(예: 제품 충실도 항목 추가)이 필요하면 클라이언트 폴더의 `sop/creative-designer/image-qa.md`에 오버라이드를 작성하면 된다 — 이 파일은 수정하지 말 것.
- 이중 스코어링(§2)의 핵심은 "합산 금지"다. 점수를 합치는 순간 예쁜 이미지가 왜곡된 제품을 통과시킨다.
- 재생성 2회 제한(§4)은 비용 통제가 아니라 판단 위임이다 — 2회로 안 잡히는 실패는 프롬프트 문제가 아니라 방향 문제일 가능성이 높고, 그 판단은 사람이 한다.
- 콘택트시트 게이트(§5)는 건너뛰고 싶은 유혹이 가장 큰 단계지만, MP4 이후 발견되는 프레임 불량이 가장 비싸다.
- 이미지 생성 도구는 스킬 본문과 동일하게 `mcp__nanobanana__generate_image` 하나만 쓴다. 이 SOP는 새 도구를 추가하지 않는다.

## 관련 파일

- `skills/social-creative-designer/SKILL.md` — 이 SOP를 Phase 0에서 로드하는 본체 스킬
- `context/brand-style.md` — §2 점수 B와 §3 체크리스트의 기준 문서
- `outputs/creatives/` — 이미지·프롬프트 로그·QA 점수 기록 위치
- `outputs/storyboards/` — 스톱모션 콘택트시트 저장 위치
- `context/workflow-status.md` — 읽기만 한다. 기록은 디렉터(content-director) 전담.
