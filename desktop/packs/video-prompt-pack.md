# 영상 프롬프트 팩 (내장 v1)
image→video(Runway/Higgsfield/i2v류)와 text→video(Veo)용. 원칙: **외형은 키프레임이 정한다 —
i2v 프롬프트는 움직임만 말한다.** 스타일 형용사 반복은 프레임을 망가뜨린다.

## i2v 프롬프트 골격 (Runway·Higgsfield·Replicate i2v) — 1~3문장, 500자 이내
1. CAMERA — 카메라 움직임 1개 (아래 뱅크)
2. SUBJECT MOTION — 피사체에 실제로 일어나는 일 1-2개 (물리적으로 그럴듯하게)
3. ATMOSPHERE — 분위기 요소 1개 (빛 변화, 김, 입자 등)
금지: 새 사물 등장 지시, 장면 전환, 텍스트 표시, 과도한 동작(왜곡 유발)

## CAMERA 뱅크
- slow dolly-in toward the subject
- gentle orbit around the subject, 15 degrees
- slow push-in with subtle parallax
- handheld micro-sway, breathing rhythm
- slow tilt up revealing the scene
- static camera, locked off (피사체 모션만 강조할 때)

## SUBJECT MOTION 뱅크
- steam rising softly / liquid being poured in a thin stream / fabric swaying in a light breeze
- hands enter frame and interact naturally / page turning slowly / light flickering warmly
- condensation drops rolling down / powder dusting down in slow motion / bubbles rising

## ATMOSPHERE 뱅크
- light shifts warmer as if a cloud passes / dust particles drifting in the light beam
- shallow depth of field breathing slightly / soft bokeh shimmer in the background

## Veo(text→video) 골격 — 시네마틱 산문 2~4문장
장면 묘사(피사체+배경) → 카메라 움직임 → 조명/무드 → (선택) 환경음 큐.
예: "A cozy Korean café counter at golden hour. The camera slowly dollies in toward a
ceramic cup as steam curls upward. Warm backlight catches the steam; ambient café
murmur and soft jazz in the background."

## 릴스 설계 규칙
- 첫 프레임 = 후킹 프레임: 키프레임 자체가 궁금증을 만들어야 함 (반쯤 부은 라떼 > 완성된 라떼)
- 루프 설계: 끝 동작이 시작 상태로 자연스럽게 이어지는 모션 선택 (steam, orbit, sway)
- 세로 9:16: 피사체를 세로 중앙 60%에, 상단 20%는 캡션 안전지대
- 5초=한 모션, 8-10초=모션+미세 변화 1개. 길수록 왜곡 위험 증가

## 프로바이더 노트
- Runway gen4_turbo: promptText 간결할수록 좋음. 카메라+모션만. duration 5 권장
- Higgsfield DoP: motion 중심 문장 + enhance_prompt가 보강함. 과묘사 금지
- Veo: 산문형이 잘 먹힘. 오디오 큐 지원. 8초 기본
- ffmpeg 레인: 프롬프트 불필요 (이미지 조립) — 이미지 품질이 전부이므로 키프레임에 투자
- ComfyUI/Replicate: 모델별 상이 — i2v 골격을 기본으로, 모델 문서의 트리거 워드가 있으면 추가

## 나쁜 예 → 좋은 예
나쁨: "홈카페 라떼 아트 릴스. 감성적인 영상. 브랜드 인지 제고"
좋음: "Slow dolly-in toward the latte cup as steam rises softly and curls in the warm
light. A hand enters frame and gently rotates the cup, revealing the rosetta art.
Light shifts warmer as the shot tightens."
