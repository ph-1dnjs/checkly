---
version: v14
name: Checkly design system
source: Checkly v14.dc.html (기준 구현)
---

# Checkly 디자인 기준

이 파일은 Checkly UI 작업의 기준입니다. `Checkly v14.dc.html`에 구현된 값을 정본으로 삼고, 화면·컴포넌트를 추가하거나 수정할 때 아래 토큰과 패턴을 우선 적용합니다.

> 이전 버전(크림 캔버스 `#eeefe9` + IBM Plex Sans + 노랑 CTA)의 기준은 폐기되었습니다. 해당 값은 더 이상 사용하지 않습니다.

## 핵심 원칙

- 캔버스는 순백 `#FFFFFF`. 면을 나누는 수단은 배경색이 아니라 **1px 헤어라인**과 옅은 회색 표면(`#FAFBFC`)이다.
- 카드로 감싸지 않는다. 목록·표·단계는 컨테이너 카드 대신 **행 + 하단 구분선 + hover 표면**으로 묶는다. 그림자는 떠 있는 요소(dock, popover, drawer)에만 쓴다.
- 기본 radius는 **2px**. pill(`999px`)은 dock과 토글에만, `3px`은 popover/떠 있는 컨트롤에만 쓴다.
- 강조는 teal `#17607F` 하나로 통일한다. 한 화면의 주 CTA는 하나.
- 밀도가 높은 제품이다. 기본 본문 11.5–12.5px, 컨트롤 높이 26/28/30/34px, 섹션 헤더 바 26px.
- 데이터·식별자·경로·시간·코드는 모두 `D2Coding` 모노스페이스 + `font-variant-numeric: tabular-nums`.
- 상태는 색 점(8px 정사각형)과 짧은 단어로 표현한다. 배지 남발 금지.
- 장식용 일러스트·그라데이션·사진·이모지를 쓰지 않는다. 아이콘은 Material Symbols Rounded, 그 외 화살표·재생 표시는 CSS border 삼각형/사각형으로 만든다.

## 색상 토큰

### 기본

| 역할                 | 값                    | 용도                                 |
| -------------------- | --------------------- | ------------------------------------ |
| canvas               | `#FFFFFF`             | 페이지·패널 바닥                     |
| surface subtle       | `#FAFBFC`             | 섹션 헤더 바, 그룹 sticky 헤더, 툴바 |
| surface hover        | `#F7F9FA`             | 목록 행 hover                        |
| surface hover strong | `#F5F7F8` / `#F0F3F5` | 버튼·아이콘 hover                    |
| hairline strong      | `#D8DDE2`             | 버튼 테두리, 패널 경계               |
| hairline             | `#E4E7EA`             | 구획 경계선                          |
| hairline soft        | `#EDF0F2`             | 행 구분선                            |
| hairline faint       | `#F3F5F7`             | 하위 단계 행 구분선                  |

### 텍스트

| 역할            | 값                   |
| --------------- | -------------------- |
| ink             | `#14181C`            |
| body            | `#3D4650`            |
| secondary       | `#5A646E`            |
| mute            | `#8A939C`            |
| mute soft       | `#98A0A8`            |
| disabled / 번호 | `#A6AEB5`, `#BFC6CC` |

### 강조·상태

| 역할           | 값                                                         | 용도                |
| -------------- | ---------------------------------------------------------- | ------------------- |
| primary        | `#17607F`                                                  | CTA, 링크, 활성 탭  |
| primary hover  | `#12506A`                                                  |                     |
| primary active | `#0E4257`                                                  |                     |
| primary tint   | `#EBF2F5` / `#EEF4F7` / `#F5F9FB`                          | 선택 행, 보조 표면  |
| primary line   | `#A8C6D3` / `#6FA8C0`                                      | 강조 테두리         |
| success        | `#1E7A4A` (tint `#E7F0EA`, line `#BFDCCB`)                 | 성공/연결됨         |
| fail           | `#B32318` (deep `#97180F`, tint `#FDF6F5`, line `#E9C4C0`) | 실패/오류           |
| warn           | `#96690C` (dot `#C08A15`, tint `#FDF7E9`, line `#E7D5AE`)  | 대기·수동 입력·주의 |
| preview        | `#7A5AF8`                                                  | 미리보기 상태 전용  |
| dark surface   | `#14181C` (hover `#262E35`, scroll thumb `#2B333B`)        | dock, 어두운 영역   |

- 어두운 영역 위 보조 텍스트는 `#98A4AE`, 본문은 `#FFFFFF`.
- 오버레이는 `rgba(20,24,28,.24)`(drawer), 그림자는 `0 14px 30px -14px rgba(20,24,28,.55)`(dock) / `0 12px 28px -16px rgba(20,24,28,.4)`(popover).

## 타이포그래피

- UI 서체: `'Helvetica Neue', Helvetica, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`
- 모노: `'D2Coding', ui-monospace, monospace`
- 아이콘: `Material Symbols Rounded` (18px 카드 아이콘, 21px dock)

| 역할                 | 크기 / 굵기 / 자간           |
| -------------------- | ---------------------------- |
| 지표 숫자            | 52px / 600 / -0.035em        |
| 보조 지표            | 26px / 600 / -0.02em         |
| 페이지 제목          | 22px / 600 / -0.02em         |
| 화면 제목(작업 화면) | 20px / 600 / -0.02em         |
| 섹션 제목            | 17px / 600 / -0.015em        |
| 강조 본문            | 15px / 600 / -0.015em        |
| 행 제목              | 13px / 600 / -0.01em         |
| 본문                 | 12.5px / 400                 |
| 조밀 본문·모노 행    | 11.5px                       |
| 라벨·헤더 바·메타    | 11px, `#8A939C`              |
| 모노 메타·번호       | 10.5px                       |
| 마이크로 배지        | 9.5px / letter-spacing .08em |

행간은 조밀한 UI에서 기본값을 쓰고, 설명문에서만 1.55–1.7을 준다.

## 레이아웃

- 문서형 화면(대시보드, 시나리오 목록): `max-width: 1100px; margin: 0 auto; padding: 0 clamp(24px, 4.5vw, 64px)`. 제목 영역 상단 여백 44px.
- 작업 화면(편집, 실행, 추출): `height: 100vh; overflow: hidden`, 내부 패널이 각자 스크롤. 좌우 패딩 20–26px.
- 모든 화면은 dock을 위해 `padding-bottom: 92–128px`.
- 2열 편집: `grid-template-columns: 1fr 1fr`, 가운데 1px 경계.
- 실행 화면: `grid-template-columns: 340–380px 1fr`(큐 / 상세). `data-runcols="zen"`이면 1열로 큐를 감춘다.
- 목록 헤더 행: 높이 30px, 11px 라벨, 하단 `#E4E7EA`. 데이터 행: 최소 46–52px, 하단 `#EDF0F2`.
- 패널 섹션 헤더 바: 높이 26px, 배경 `#FAFBFC`, 11px `#8A939C`, 오른쪽 끝에 메타.
- 목록 간격은 gap이 아니라 구분선으로 만든다. 카드 그리드가 필요할 때만 `gap: 10px`.

### 반응형 브레이크포인트

- `1240px`: 실행 화면 큐 340px로 축소, 부가 열(`[data-tcol]`) 숨김.
- `980px`: dock 메타(`[data-dockmeta]`) 숨김.
- `900px`: 실행·편집 2열 → 1열, drawer 폭 `100vw`.

## 컴포넌트 규칙

**버튼**

- Primary: 배경 `#17607F`, 흰 글자, 600, radius 2px. 높이 34px(페이지 헤더) / 30px / 28px(패널 내부).
- Secondary: 흰 배경 + `1px #D8DDE2`, hover `#F5F7F8`.
- Ghost: 테두리 없음, `#5A646E`, hover `#F0F3F5`.
- Danger: 테두리·글자 `#B32318`, 확인 단계에서만 채운 배경.
- 단축키는 버튼 안 우측에 모노 10–10.5px, `opacity .65` 또는 `#98A0A8`.
- 전환: `background 120ms ease`.

**배지 / 태그**

- 마이크로 배지: 모노 9.5px, `padding: 1px 5px`, radius 2px, 테두리 색 = 의미 색(신규 `#A8C6D3`/`#17607F`, 불안정 `#E0CFA4`/`#8A6408`).
- 연산 태그(실행 단계): 높이 19px, 고정 폭 86px, 배경 tint, 10.5px 600, 말줄임 처리.

**상태 점**

- 8px 정사각형(요약), 7px(그룹), 6px(단계). radius 없음. 진행 중이면 `animation: ckBlink 1s infinite`.

**히스토리 막대(tape)**

- `display: flex; gap: 3px`, 높이 34px(대시보드) / 3px(실행 진행바, gap 1px). 막대마다 `title` 제공.

**탭**

- 높이 34px, 아래 `1px #E4E7EA` 위에 활성 항목만 `box-shadow`로 밑줄. 활성 600 `#14181C`, 비활성 `#5A646E`.

**Popover**

- `position: absolute; top: 34px`, 폭 268px, `1px #D8DDE2`, radius 3px, 흰 배경, 그림자. 내부는 12px 패딩 그룹 + `1px #EDF0F2` 구분.

**토글**

- 트랙 26×15px pill, 노브 11px 흰 원, `transition: transform 140ms ease`.

**Drawer(실행 상세)**

- 우측 560px, `border-left: 1px #D8DDE2`, 배경 오버레이 `rgba(20,24,28,.24)`, sticky 헤더 48px.
- 실패 블록은 `border-left: 3px solid #B32318`, 기대값/실제값/선택자를 모노 2열로 나열.

**콜아웃**

- 좌측 3px 의미색 막대 + 옅은 tint 배경(`#FDFBF6`, `#FDF6F5`, `#EDF6F1`). 라벨 11px 600, 의미색.

**Dock (하단 고정 내비게이션)**

- `position: fixed; bottom: 22px; left: 50%; translateX(-50%)`, `z-index: 70`, 3개 pill 캡슐을 gap 10px으로 배치: 브랜드 / 아이콘 내비 / 상황 액션.
- 캡슐 높이 46px, 배경 `#14181C`, radius 999px, 그림자 `0 14px 30px -14px rgba(20,24,28,.55)`.
- 아이콘 버튼 40×34px, 활성만 밝은 배경, hover `#262E35`.
- 우측 액션 버튼은 현재 실행 상태에 따라 라벨·아이콘·색이 바뀌며 진행률을 모노로 덧붙인다.

**브라우저 캔버스(추출·실행 화면)**

- 상단 44px 크롬: 뒤/앞 화살표, 모노 URL 바, 디바이스 폭 토글, 나가기 버튼.
- 캔버스 바깥 여백은 `repeating-linear-gradient(135deg, #FAFBFC 0 8px, #F4F6F8 8px 16px)`.
- 마커 핀은 22px 정사각형, 모노 11px 700, radius 2px.

## 모션

정의된 keyframes만 사용한다: `ckIn`(180ms 페이드 진입, 화면 전환), `ckBlink`(진행 중 점), `ckSpin`, `ckSkel`(스켈레톤), `ckBar`(불확정 진행), `ckDock`(dock 등장 260ms).
상태 전환은 110–140ms ease. 그 이상 긴 애니메이션은 쓰지 않는다.

## 스크롤 영역

스크롤되는 컨테이너에는 `data-scroll="light"`(어두운 영역은 `"dark"`)를 붙인다. 폭 11px, thumb `#CDD4DA` / `#2B333B`, `border: 4px solid transparent; background-clip: content-box`.

## 작성 규칙

- 인라인 스타일만 사용한다. 클래스 기반 CSS는 쓰지 않는다. `@font-face`, `@keyframes`, 리셋, 미디어쿼리만 `<helmet><style>`에 둔다.
- 반복 목록은 `<sc-for>`, 조건부는 `<sc-if>`를 쓰고 항상 `hint-*`를 채운다.
- 클릭 가능한 div에는 `role="button" tabindex="0"`을 붙인다.
- 말줄임이 필요한 텍스트에는 `title` 속성으로 전체 값을 준다.
- 한국어 UI. 라벨은 명사형("전체 실행", "새 시나리오"), 문장형 안내는 종결형("…실행 대기열에 올라갑니다").

## 새 UI를 만들 때

기존 어휘로 먼저 해결한다: 흰 캔버스, 2px radius, 헤어라인 구분선, teal 강조, 26px 헤더 바, 모노 메타. 새 색·새 radius·새 그림자를 도입하기 전에 위 토큰에서 대응되는 값을 찾는다.
