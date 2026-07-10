# 이미지 프롬프트 팩 (내장 v1)
사진형 생성 모델(gpt-image-1, ima2, diffusion류)용. 원칙: **기획 언어가 아니라 시각 언어로 쓴다.**
프롬프트는 영어가 기본(디퓨전 계열은 한국어 이해가 약함), 브랜드/제품 고유명사만 원문 유지.

## 프롬프트 골격 (이 순서로 조립)
1. SUBJECT — 무엇이 보이는가 (구체적 사물/인물/장면, 수량·재질·상태)
2. SETTING — 어디서 (배경, 시간대, 계절감)
3. COMPOSITION — 구도 (아래 뱅크에서 1개)
4. LIGHTING — 조명 (아래 뱅크에서 1개)
5. STYLE — 스타일 앵커 (아래 뱅크에서 1-2개)
6. COLOR — 브랜드 팔레트 반영 ("muted terracotta and cream tones" 식으로 색 이름화)
7. TEXT RULE — 텍스트 규칙 (필수, 아래 참조)

## COMPOSITION 뱅크
- rule of thirds, subject on right third, generous negative space on the left for headline overlay
- centered symmetrical composition, product hero shot, clean margin around subject
- top-down flat lay, items arranged on a grid, 15% padding at frame edges
- close-up macro with shallow depth of field (f/1.8), background softly blurred
- eye-level candid perspective, environmental context visible, subject occupies 40% of frame
- 4:5 crop safety: keep key elements inside central 80%, nothing important near edges

## LIGHTING 뱅크
- soft window light from the left, gentle shadows, airy morning mood
- golden hour warm backlight, subtle lens flare, cozy atmosphere
- bright even softbox studio lighting, crisp and clean, e-commerce style
- moody low-key lighting, single warm light source, deep shadows
- overcast diffused daylight, true-to-life colors, no harsh shadows

## STYLE 앵커 뱅크
- editorial lifestyle photography, shot on 50mm lens, natural film grain
- premium product photography, minimal styling, high-end brand campaign look
- authentic UGC-style smartphone photo, believable and unpolished
- warm Korean café aesthetic, kinfolk magazine style
- vibrant food photography, appetizing steam and texture detail

## TEXT RULE (필수 — 둘 중 하나)
- 오버레이 예정: "absolutely no text, no letters, no logos in the image; leave clean negative space at {위치}"
- 텍스트 불필요: "no text or watermarks anywhere"
(디퓨전 모델의 한글 렌더링은 항상 깨진다 — 이미지 안에 한글을 넣으라는 지시는 금지.
한글 타이포가 필요하면 claude-svg 레인으로 보낼 것.)

## NEGATIVE 뱅크 (지원 모델에만)
deformed hands, extra fingers, distorted face, watermark, signature, garbled text,
low quality, oversaturated, plastic skin, AI artifacts, duplicated objects

## 포맷별 레시피
- single image(제품): SUBJECT=제품 클로즈업+재질 강조 / COMPOSITION=hero shot / LIGHTING=softbox / STYLE=premium product
- single image(라이프스타일): 사람 손·사용 장면 포함 / candid perspective / window light / editorial lifestyle
- carousel 표지: 강한 단일 피사체 + 좌측 여백 (헤드라인 자리) / rule of thirds
- 인포그래픽·스탯·인용 카드: 사진 레인 금지 → claude-svg 레인 사용
- food: top-down flat lay 또는 45도 / appetizing 강조 / vibrant food photography

## 나쁜 예 → 좋은 예
나쁨: "홈카페 라떼 아트. 앵글: 브랜드 인지 제고. 필러: 시즌 콘텐츠"
좋음: "A ceramic cup of latte with intricate rosetta latte art, on a warm wooden café table
beside a linen napkin, soft window light from the left with gentle shadows, editorial
lifestyle photography shot on 50mm, muted terracotta and cream tones, rule of thirds with
the cup on the right third and clean negative space on the left for headline overlay,
absolutely no text or logos in the image"
