---
version: v16
name: Checkly design system
source: Checkly v16.dc.html (기준 구현)
---

# Checkly 디자인 기준

이 파일은 Checkly UI 작업의 기준입니다. `Checkly v16.dc.html`에 구현된 값을 정본으로 삼고, 화면·컴포넌트를 추가하거나 수정할 때 아래 토큰과 패턴을 우선 적용합니다.

> 폐기된 기준: 크림 캔버스(`#eeefe9`) + IBM Plex Sans + 노랑 CTA(초기), teal 강조 `#17607F` + radius 2px(v15). 두 값 모두 더 이상 사용하지 않습니다.

## 핵심 원칙

- 캔버스는 순백 `#FFFFFF`. 면을 나누는 수단은 배경색이 아니라 **1px 헤어라인**과 옅은 회색 표면(`#FAFBFC`)이다.
- 카드로 감싸지 않는다. 목록·표·단계는 컨테이너 카드 대신 **행 + 하단 구분선 + hover 표면**으로 묶는다. 그림자는 떠 있는 요소(dock, 알림, 모달, drawer)에만 쓴다.
- 기본 radius는 **4px**. 떠 있는 표면(알림, 모달, 화면 전환 바)은 `6px`, dock과 토글은 pill(`999px`).
- 강조는 파랑 한 계열로 통일한다. 면·그래프는 `#3D8CE0`, 인터랙션(버튼·링크·활성)은 `#1F63AE`. 한 화면의 주 CTA는 하나.
- 밀도가 높은 제품이다. 기본 본문 11.5–12.5px, 컨트롤 높이 22/26/28/30/34px, 섹션 헤더 바 26px.
- 데이터·식별자·경로·시간·코드·수치는 모두 `D2Coding` 모노스페이스 + `font-variant-numeric: tabular-nums`.
- 제목과 워드마크만 `Nunito` 800. 본문·라벨·버튼은 Helvetica 계열.
- 상태는 색 점(8px 정사각형)과 짧은 단어로 표현한다. 배지 남발 금지.
- 장식용 일러스트·그라데이션·사진·이모지를 쓰지 않는다. 아이콘은 Material Symbols Rounded(`.msi`), 그 외 화살표·재생 표시는 CSS border 삼각형/사각형으로 만든다.

## 색상 토큰

### 기본

| 역할                 | 값                    | 용도                                            |
| -------------------- | --------------------- | ----------------------------------------------- |
| canvas               | `#FFFFFF`             | 페이지·패널 바닥                                |
| surface subtle       | `#FAFBFC`             | 섹션 헤더 바, 그룹 sticky 헤더, 툴바, 줄번호 열 |
| surface hover        | `#F7F9FA`             | 목록 행 hover                                   |
| surface hover strong | `#F5F7F8` / `#F0F3F5` | 버튼·아이콘 hover                               |
| surface nested       | `#FCFDFE`             | 펼친 하위 단계 영역                             |
| brand plate          | `#F8F8F8`             | 마크 배경(설정 브랜드 블록, dock 마크 원)       |
| hairline strong      | `#D8DDE2`             | 버튼 테두리, 패널 경계, 입력 테두리             |
| hairline             | `#E4E7EA`             | 구획 경계선                                     |
| hairline soft        | `#EDF0F2`             | 행 구분선                                       |
| hairline faint       | `#F3F5F7`             | 하위 단계 행 구분선                             |

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

| 역할              | 값                                                                  | 용도                                         |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| blue (면)         | `#3D8CE0`                                                           | 막대·게이지·진행, 선택 강조 바, 토글 on, 핀  |
| blue action       | `#1F63AE`                                                           | CTA 배경, 링크, 활성 탭/토글 라벨, 숫자 강조 |
| blue action hover | `#17538F`                                                           | primary 버튼 hover                           |
| blue tint         | `#EDF4FC`                                                           | 활성 세그먼트, 선택 배지, 보조 표면          |
| blue tint soft    | `#F5F9FE`                                                           | 선택 행, 콜아웃 배경                         |
| blue line         | `#B9D4F1`                                                           | 강조 테두리, 점선 추가 버튼                  |
| blue on dark      | `#7FB0E8`                                                           | 어두운 배경 위 워드마크·링크                 |
| pass              | `#0E8A5F` (tint `#ECFAF3`, line `#A7E3C6`)                          | 통과·연결됨                                  |
| fail              | `#DE3B45` (tint `#FFF3F3`, line `#FFB3AE`)                          | 실패·오류                                    |
| wait              | `#AD6800` (tint `#FFF8E8`, line `#F3D79B`)                          | 대기·수동 입력·주의                          |
| idle              | `#D3D8DD`                                                           | 아직 실행되지 않은 단계                      |
| dark surface      | `#14181C` (경계 `#262E35`, 활성 `#2B333B`, 비활성 텍스트 `#4A545D`) | dock, 콘솔                                   |

- 어두운 영역 위 보조 텍스트 `#98A4AE`, 본문 로그 `#E7EAED`, 성공 로그 `#7FD8A6`, 대기 로그 `#EBC46B`, 실패 로그 `#F09B92`.
- 오버레이는 `rgba(20,24,28,.24)`. 그림자는 `0 14px 30px -14px rgba(20,24,28,.55)`(dock·모달), `0 12px 28px -16px rgba(20,24,28,.4)`(알림·화면 전환 바), `0 6px 14px -8px rgba(20,24,28,.6)`(마커 핀).
- 링크 기본색 `#1F63AE`, hover `#14181C`.

## 타이포그래피

- 제목·워드마크: `'Nunito', Verdana, 'Apple SD Gothic Neo', sans-serif` (700/800)
- UI 서체: `'Helvetica Neue', Helvetica, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`
- 모노: `'D2Coding', ui-monospace, monospace` (400/700, jsdelivr woff)
- 아이콘: `Material Symbols Rounded` — 16px(버튼 내), 18px(행 아이콘), 21px(dock)

| 역할                         | 크기 / 굵기 / 자간            |
| ---------------------------- | ----------------------------- |
| 지표 숫자(모노)              | 52px / 700 / -0.035em         |
| 보조 지표(모노)              | 26px / 700 / -0.02em          |
| 패널 지표(모노)              | 20px / 700                    |
| 페이지 제목(Nunito)          | 26px / 800 / -0.02em          |
| 화면 제목(Nunito, 작업 화면) | 20px / 800 / -0.02em          |
| 워드마크(Nunito)             | 22px(설정) / 15px(dock) / 800 |
| 모달 제목                    | 17px / 600 / -0.015em         |
| 행 제목                      | 13px / 600 / -0.01em          |
| 본문·버튼                    | 12.5px / 400–600              |
| 조밀 본문·모노 행·보조 버튼  | 11.5–12px                     |
| 라벨·헤더 바·메타            | 11px, `#8A939C`               |
| 모노 메타·번호               | 10.5px                        |
| 마이크로 배지·모노 태그      | 9.5px / letter-spacing .08em  |

행간은 조밀한 UI에서 기본값을 쓰고, 설명문에서만 1.55–1.7을 준다.

## 레이아웃

- 문서형 화면(대시보드, 설정): `max-width: 1100px; margin: 0 auto; padding: 44px clamp(24px, 4.5vw, 64px) 128px`.
- 작업 화면(선택, 실행, 편집, 추출): `height: 100vh; overflow: hidden`, 내부 패널이 각자 스크롤. 좌우 패딩 14–26px, 스크롤 영역 하단 `padding-bottom: 110–120px`(dock 여백).
- 대시보드 지표 스트립: `grid-template-columns: minmax(0,1.05fr) minmax(0,1fr) minmax(0,1.4fr)`, 위아래 `1px #E4E7EA`, 칸 사이 `1px #EDF0F2`.
- 시나리오 선택: 3열 `260px / minmax(0,1fr) / 320px` (파일 / 시나리오 / 실행 대상). 우측 열 하단에 요약 + CTA footer.
- 실행 화면: 헤더 52px → 3px 진행 테이프 → (수동 입력 배너) → 본문 `minmax(0,380px) minmax(0,1fr)`. 우측은 VIEWPORT 패널 + 콘솔(`200px`, 뷰포트를 숨기면 `100%`).
- 편집 화면: `grid-template-columns: 1fr 1fr` (MARKDOWN / PREVIEW), 가운데 1px 경계.
- 추출 화면: 상단 44px 브라우저 크롬 + `320px / minmax(0,1fr)`.
- 목록 헤더 행: 높이 30px, 11px 라벨, 하단 `#E4E7EA`. 데이터 행: 최소 46–52px, 하단 `#EDF0F2`. 단계 행: 30px 또는 34px, 하단 `#F3F5F7`.
- 패널 섹션 헤더 바: 높이 26px, 배경 `#FAFBFC`, 11px `#8A939C`, `position: sticky; top: 0`, 오른쪽 끝에 모노 메타.
- 목록 간격은 gap이 아니라 구분선으로 만든다.
- 반응형: `@media (max-width: 980px)`에서 `[data-dockmeta]`를 숨긴다. 그 외 브레이크포인트는 두지 않는다.

## 컴포넌트 규칙

**버튼**

- Primary: 배경 `#1F63AE`, 흰 글자, 600, radius 4px. 높이 34px(페이지 헤더·주 CTA) / 30px / 28px(패널 내부).
- Secondary: 흰 배경 + `1px #D8DDE2`, hover `#F5F7F8`.
- Ghost: 테두리 없음, `#5A646E`, hover `#F0F3F5`.
- Danger: 테두리 `#E9C4C0` + 글자 `#B32318`, hover `#FDF6F5`.
- 점선 추가 버튼: `1px dashed #B9D4F1`, 글자 `#1F63AE`, hover `#F5F9FE`, 높이 30px.
- 단축키는 버튼 안 우측에 모노 10.5px, `opacity: .65`.
- 전환은 `background 120ms ease`.

**세그먼트 컨트롤**

- `1px #D8DDE2` + radius 4px + `overflow: hidden`, 항목 사이 `border-left: 1px #E4E7EA`. 높이 22/24/28px.
- 활성 항목만 배경 `#EDF4FC` + 글자 `#1F63AE` + 600, 비활성은 `#5A646E` + hover `#F5F7F8`.

**배지 / 태그**

- 마이크로 배지: 모노 9.5px, `padding: 1px 5px`, radius 4px. 정보형 `#EDF4FC`/`#B9D4F1`/`#1F63AE`, 주의형 `#FDF7E9`/`#E0CFA4`/`#96690C`.
- 연산 태그(단계 행): 높이 19px, 고정 폭 86px, radius 4px, 10.5px 600, 배경·글자는 연산 종류별 tint(이동·입력 `#EDF4FC`/`#1F63AE`, 클릭·선택·업로드 `#F0F3F5`/`#3D4650`, 수동 `#FDF7E9`/`#96690C`, 결과 확인 `#E7F0EA`/`#1E7A4A`), 말줄임 처리.
- 연결 상태는 배지 대신 모노 9.5px 텍스트: `linked`(`#8A939C`) / `unlinked`(`#96690C`).

**상태 점**

- 8px 정사각형(요약·기록), 7px(그룹 헤더), 6px(단계). radius 없음. 진행 중이면 `animation: ckBlink 1s infinite`.

**히스토리·진행 테이프**

- 대시보드: `display: flex; gap: 3px`, 높이 34px, 막대별 `title`(통과/실패).
- 실행 진행바: 높이 3px, `gap: 1px`, 단계 수만큼 등분.
- 리포트: 높이 6px, `gap: 3px`.

**선택 행 / 체크박스**

- 선택된 행은 배경 `#F5F9FE` + `border-left: 2px solid #3D8CE0`.
- 체크박스는 16px, radius 4px. on `#1F63AE` 배경 + 흰 `check` 아이콘, off 흰 배경 + `1px #D8DDE2`(아이콘 `opacity: 0`).

**토글**

- 트랙 26×15px pill, 노브 11px 흰 원, on 배경 `#3D8CE0` / off `#D8DDE2`, `transition: transform 140ms ease`.

**입력**

- 높이 26–30px, `1px #D8DDE2`, radius 4px, 모노 또는 12px 본문. placeholder `#A6AEB5`.

**콜아웃 / 배너**

- 좌측 3px 의미색 막대 + 옅은 tint. 정보형 `#F5F9FE` + `#3D8CE0` + `1px #E4E7EA`, 주의형 `#FDF7E9` + `#C08A15`, 실패형 `#FDF6F5` + `#B32318`.
- 라벨은 모노 9.5px `letter-spacing: .08em` 의미색 또는 11px 600.

**알림(우하단 토스트)**

- `position: fixed; right: 20px; bottom: 92px`, 폭 340px, radius 6px, `1px #D8DDE2`, 그림자.
- 진행률은 38px `conic-gradient(#3D8CE0 0 N%, #EDF0F2 N% 100%)` 도넛 + 내부 28px 흰 원에 모노 9.5px 수치.

**모달**

- 폭 460px, radius 6px, `1px #D8DDE2`, 그림자, 오버레이 `rgba(20,24,28,.24)`. 패딩 22–24px, 액션은 우측 정렬 gap 6px.

**Drawer(실행 리포트)**

- 우측 560px, `border-left: 1px #D8DDE2`, sticky 헤더 48px, 상단에 3열 지표(`PASS RATE / DURATION / STEPS`).
- 실패 블록은 `border-left: 3px solid #B32318` + `#FDF6F5`, 기대값/실제값/선택자를 `68px / 1fr` 모노 2열로 나열.

**Dock (하단 고정 내비게이션)**

- `position: fixed; bottom: 22px; left: 50%; translateX(-50%)`, `z-index: 70`, 3개 pill 캡슐을 gap 10px으로 배치: 브랜드 / 아이콘 내비 / 상황 액션.
- 캡슐 높이 46px, 배경 `#14181C`, radius 999px, 그림자 `0 14px 30px -14px rgba(20,24,28,.55)`.
- 브랜드 캡슐: 32px `#F8F8F8` 원 안에 `./brand/checkly-mark-512.png`(28px) + Nunito 15px 워드마크, `ly`는 `#7FB0E8`.
- 아이콘 버튼 40×34px, 활성 배경 `#2B333B` + 흰 아이콘, 비활성 `#98A4AE`, 준비 중 항목은 `#4A545D` + `cursor: not-allowed`.
- 우측 액션 캡슐은 실행 상태에 따라 라벨·아이콘·색이 바뀌고(`#97180F` 중지 / `#1F63AE` 실행) 진행률을 모노 10.5px `[data-dockmeta]`로 덧붙인다.

**화면 전환 바(프로토타입 전용)**

- `position: fixed; left: 16px; bottom: 22px; z-index: 90`, 흰 배경 + `1px #D8DDE2` + radius 6px. 22px 칩(활성 `#EDF4FC`/`#1F63AE` 600), 화면/오버레이 사이를 1px 구분선으로 나눈다. 실제 제품 UI가 아니라 데모 내비게이션이다.

**브라우저 캔버스(추출·실행 화면)**

- 추출: 상단 44px 크롬 — 뒤/앞 CSS 삼각형, 모노 URL 바(연결 상태 6px 점), 디바이스 세그먼트, 마커 대상 선택, 실행 CTA.
- 실행 뷰포트: 22px 미니 크롬(5px 점 3개 + 모노 URL + 해상도) + `aspect-ratio: 16/9` 캡처 영역.
- 캔버스 바깥 여백 `repeating-linear-gradient(135deg, #FAFBFC 0 8px, #F4F6F8 8px 16px)`, 캡처 자리 표시자는 `repeating-linear-gradient(90deg, #F7F9FA 0 6px, #FFFFFF 6px 12px)` + 모노 설명문.
- 마커 핀은 22px 정사각형, radius 4px, 모노 11px 700 흰 글자, 배경은 연결됨 `#3D8CE0` / 미연결 `#C08A15`.

## 브랜드

- 마크: `./brand/checkly-mark-512.png` (dock 28px, 설정 64px). SVG로 다시 그리지 않는다.
- 워드마크: Nunito 800 `Check` + 강조색 `ly`(밝은 배경 `#3D8CE0`, 어두운 배경 `#7FB0E8`).
- 태그라인: "반복되는 확인을 대신 맡습니다".

## 모션

정의된 keyframes만 사용한다: `ckIn`(180ms 페이드 진입 — 화면 전환, 오버레이, dock은 260ms), `ckBlink`(진행 중 점·활성 단계), `ckBar`(불확정 진행).
상태 전환은 `background 120ms ease`, 토글은 `transform 140ms ease`. 그 이상 긴 애니메이션은 쓰지 않는다.

## 스크롤 영역

스크롤되는 컨테이너에는 `data-ck-scroll="light"`(어두운 영역은 `"dark"`)를 붙인다. 폭 11px, thumb `#CDD4DA` / `#2B333B`, `border: 4px solid transparent; background-clip: content-box`.

## 작성 규칙

- 인라인 스타일만 사용한다. 클래스 기반 CSS는 쓰지 않는다. `@font-face`, `@keyframes`, 리셋, 아이콘 클래스(`.msi`), 스크롤바, 미디어쿼리만 `<helmet><style>`에 둔다.
- 반복 목록은 `<sc-for>`, 조건부는 `<sc-if>`를 쓰고 항상 `hint-*`를 채운다.
- 화면 단위 섹션에는 `data-screen-label`을 붙인다.
- 클릭 가능한 div에는 `role="button" tabindex="0"`을, 모달에는 `role="dialog"`, 토스트에는 `role="status"`를 붙인다.
- 말줄임이 필요한 텍스트에는 `title` 속성으로 전체 값을 준다.
- 연산 종류·상태 색은 로직 쪽 상수(`OP`, `BLUE`/`ACT`/`PASS`/`FAIL`/`WAIT`/`IDLE`)에서 꺼내고, 템플릿에 하드코딩하지 않는다.
- 한국어 UI. 라벨은 명사형("전체 실행", "새 시나리오"), 문장형 안내는 종결형("…실행 대기열에 올라갑니다"). 패널 헤더 바와 지표 라벨만 영문 대문자(`EXECUTION`, `CONSOLE`, `PASS RATE`).

## 새 UI를 만들 때

기존 어휘로 먼저 해결한다: 흰 캔버스, 4px radius, 헤어라인 구분선, 파랑 강조 2단(`#3D8CE0` 면 / `#1F63AE` 액션), 26px 헤더 바, 모노 메타, Nunito 제목. 새 색·새 radius·새 그림자를 도입하기 전에 위 토큰에서 대응되는 값을 찾는다.
