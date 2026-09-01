---
version: alpha
name: Checkly design system
source: PostHog-design-analysis (user-provided)
---

# Checkly 디자인 기준

이 파일은 Checkly UI 작업의 기준입니다. 화면과 컴포넌트를 추가하거나 수정할 때 아래 토큰과 원칙을 우선 적용합니다.

## 핵심 원칙

- 페이지 캔버스는 따뜻한 크림색 `#eeefe9`를 사용한다. 흰색은 카드 표면에만 사용한다.
- 기본 서체는 `IBM Plex Sans`이며, 본문은 olive-gray `#4d4f46`, 제목은 deep olive `#23251d`를 사용한다.
- 강조 CTA는 한 화면에 하나를 원칙으로 하며, 노랑-오렌지 `#f7a501`을 쓴다.
- 카드는 그림자 없이 1px olive hairline 테두리와 6px 반경을 사용한다.
- 주요 섹션의 세로 간격은 80px, 카드 내부 여백은 24px, 그리드 간격은 16px을 기준으로 한다.
- 브랜드 장식은 평면의 손그림 고슴도치 마스코트와 기능적 아이콘만 사용한다. 그라데이션과 사진은 사용하지 않는다.
- 문서성 안내에는 파랑/초록/빨강/보라의 옅은 callout을 사용하되, 일반 마케팅 카드 배경에는 사용하지 않는다.
- 화면 구조는 넓은 여백의 단일 캔버스와 얇은 구분선을 우선한다. 목록은 큰 컨테이너 카드보다 행 단위 구분선과 hover 표면으로 묶는다.
- 페이지 제목은 좌측에 두고, 화면의 대표 작업은 우측 단일 CTA로 둔다. 주요 상태 수치는 카드 묶음보다 큰 요약 수치와 짧은 히스토리 막대로 보여 준다.
- 하단 내비게이션은 반투명한 플로팅 dock 형태로 유지한다. 목업의 차콜·블루 계열은 참조하지 않고 이 문서의 토큰만 쓴다.
- 실행 화면은 상단의 설정 popover, 접을 수 있는 실행 큐, 실행 상세 패널 순으로 구성한다. 작성 화면은 Markdown 원문과 파싱된 단계가 같은 높이의 2열 편집 공간을 이룬다.
- 화면 추출 모드는 브라우저 캔버스를 화면 전체로 쓰고, 단계 패널과 도구 모음을 떠 있는 컨트롤로 배치한다.

## 토큰

| 역할 | 값 |
| --- | --- |
| canvas | `#eeefe9` |
| surface card | `#ffffff` |
| surface soft | `#e5e7e0` |
| ink | `#23251d` |
| body | `#4d4f46` |
| mute | `#6c6e63` |
| hairline | `#bfc1b7` |
| primary | `#f7a501` |
| primary pressed | `#dd9001` |
| link teal | `#1078a3` |
| accent blue soft | `#dceaf6` |
| accent green soft | `#d9eddf` |
| accent red soft | `#f7d6d3` |
| accent purple soft | `#e7d8ee` |

## 타이포그래피와 형태

- Display: 36px / 700 / 1.5
- Section title: 24px / 800 / 1.33 / -0.6px
- Card title: 18px / 600 / 1.56
- Body: 16px / 400 / 1.5
- Small body: 15px / 400 / 1.71
- Button: 14px / 700 / 1.5
- 기본 radius: 6px, 버튼 높이: 40px, pill은 `9999px`

## 반응형

- 데스크톱 카드 그리드 4열 → 1024px에서 3열 → 768px에서 2열 → 480px에서 1열.
- 섹션 여백은 데스크톱 80px, 태블릿 64px, 모바일 48px.
- 작은 화면에서도 기본 CTA는 유지한다.

원문 분석 문서의 세부 컴포넌트 명세와 do/don't 규칙은 이 기준을 보완한다. 새 UI가 필요하면 기존 카드, 6px 반경, 크림 캔버스 어휘로 먼저 해결한다.
