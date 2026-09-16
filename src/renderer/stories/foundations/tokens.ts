/**
 * Checkly 디자인 파운데이션 토큰 데이터.
 * Claude Design "Checkly Foundations.dc.html" (v16)에서 그대로 옮겨온 값이며,
 * CSS 커스텀 프로퍼티는 src/renderer/styles/foundations.css 에 1:1로 정의되어 있다.
 */

export const FONT = {
  display: "'Nunito', Verdana, 'Apple SD Gothic Neo', sans-serif",
  ui: "'Helvetica Neue', Helvetica, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  mono: "'D2Coding', ui-monospace, monospace",
};

export interface FamilyToken {
  role: string;
  token: string;
  css: string;
  weight: number;
  sample: string;
  sampleKo: string;
  stack: string;
  use: string;
}

export const FAMILIES: FamilyToken[] = [
  {
    role: "제목 · 워드마크",
    token: "font/display",
    css: FONT.display,
    weight: 800,
    sample: "Checkly",
    sampleKo: "시나리오 편집",
    stack: "'Nunito', Verdana, 'Apple SD Gothic Neo', sans-serif",
    use: "페이지 제목, 화면 제목, 워드마크에만. 본문에 쓰지 않습니다.",
  },
  {
    role: "UI 본문 · 라벨",
    token: "font/ui",
    css: FONT.ui,
    weight: 400,
    sample: "Run all steps",
    sampleKo: "실행 대기열에 올라갑니다",
    stack: "'Helvetica Neue', Helvetica, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    use: "본문, 버튼, 라벨, 설명문 전부.",
  },
  {
    role: "데이터 · 코드",
    token: "font/mono",
    css: FONT.mono,
    weight: 700,
    sample: "00:12.480",
    sampleKo: "~/checkly/login.md",
    stack: "'D2Coding', ui-monospace, monospace",
    use: "식별자, 경로, 시간, 수치, 로그. tabular-nums 항상 적용.",
  },
];

export interface TextStyleToken {
  token: string;
  role: string;
  family: string;
  size: string;
  lh: string;
  ls: string;
  weight: number;
  sample: string;
  color: string;
  num: "tabular-nums" | "normal";
}

const T = FONT;
export const TEXT_STYLES: TextStyleToken[] = [
  { token: "type/metric-xl", role: "지표 숫자", family: T.mono, size: "52px", lh: "1.05", ls: "-0.035em", weight: 700, sample: "98.2%", color: "#14181C", num: "tabular-nums" },
  { token: "type/metric-lg", role: "보조 지표", family: T.mono, size: "26px", lh: "1.15", ls: "-0.02em", weight: 700, sample: "1,284", color: "#14181C", num: "tabular-nums" },
  { token: "type/metric-md", role: "패널 지표", family: T.mono, size: "20px", lh: "1.2", ls: "0", weight: 700, sample: "00:12.4", color: "#1F63AE", num: "tabular-nums" },
  { token: "type/title-page", role: "페이지 제목", family: T.display, size: "26px", lh: "1.25", ls: "-0.02em", weight: 800, sample: "시나리오 선택", color: "#14181C", num: "normal" },
  { token: "type/title-screen", role: "화면 제목", family: T.display, size: "20px", lh: "1.3", ls: "-0.02em", weight: 800, sample: "시나리오 편집", color: "#14181C", num: "normal" },
  { token: "type/title-modal", role: "모달 제목", family: T.ui, size: "17px", lh: "1.35", ls: "-0.015em", weight: 600, sample: "시나리오를 삭제할까요?", color: "#14181C", num: "normal" },
  { token: "type/row-title", role: "행 제목", family: T.ui, size: "13px", lh: "1.4", ls: "-0.01em", weight: 600, sample: "로그인 후 대시보드 확인", color: "#14181C", num: "normal" },
  { token: "type/body", role: "본문 · 버튼", family: T.ui, size: "12.5px", lh: "1.45", ls: "0", weight: 400, sample: "선택한 시나리오가 실행 대기열에 올라갑니다", color: "#3D4650", num: "normal" },
  { token: "type/body-strong", role: "버튼 라벨", family: T.ui, size: "12.5px", lh: "1.45", ls: "0", weight: 600, sample: "전체 실행", color: "#14181C", num: "normal" },
  { token: "type/body-prose", role: "설명문", family: T.ui, size: "12.5px", lh: "1.7", ls: "0", weight: 400, sample: "실패한 단계는 리포트에서 기대값과 실제값을 나란히 보여줍니다", color: "#5A646E", num: "normal" },
  { token: "type/body-dense", role: "조밀 본문", family: T.ui, size: "11.5px", lh: "1.45", ls: "0", weight: 400, sample: "단계 4 / 12 · 재시도 1회", color: "#3D4650", num: "normal" },
  { token: "type/label", role: "라벨 · 헤더 바", family: T.ui, size: "11px", lh: "1.4", ls: "0.04em", weight: 400, sample: "EXECUTION", color: "#8A939C", num: "normal" },
  { token: "type/mono-row", role: "모노 행", family: T.mono, size: "11.5px", lh: "1.5", ls: "0", weight: 400, sample: "scenarios/login.md", color: "#14181C", num: "tabular-nums" },
  { token: "type/mono-meta", role: "모노 메타 · 번호", family: T.mono, size: "10.5px", lh: "1.5", ls: "0", weight: 400, sample: "2026-09-14 09:41", color: "#8A939C", num: "tabular-nums" },
  { token: "type/micro", role: "마이크로 배지", family: T.mono, size: "9.5px", lh: "1.3", ls: "0.08em", weight: 400, sample: "SELECTED 3", color: "#1F63AE", num: "tabular-nums" },
];

export const TYPE_RULES = [
  "제목과 워드마크만 Nunito 800. 본문·버튼·라벨은 Helvetica 계열을 씁니다.",
  "데이터·식별자·경로·시간·수치·로그는 예외 없이 D2Coding + tabular-nums.",
  "행간은 조밀한 UI에서 1.4–1.5, 설명문에서만 1.7을 줍니다.",
  "11px 미만 크기는 모노 배지·번호에만 허용합니다.",
];

export interface ColorToken {
  token: string;
  hex: string;
  use: string;
}
export interface ColorGroup {
  label: string;
  meta: string;
  items: ColorToken[];
}

export const COLOR_GROUPS: ColorGroup[] = [
  {
    label: "SURFACE · HAIRLINE",
    meta: "color/surface · color/line",
    items: [
      { token: "color/canvas", hex: "#FFFFFF", use: "페이지·패널 바닥" },
      { token: "color/surface-subtle", hex: "#FAFBFC", use: "섹션 헤더 바, 툴바, 줄번호 열" },
      { token: "color/surface-hover", hex: "#F7F9FA", use: "목록 행 hover" },
      { token: "color/surface-hover-strong", hex: "#F0F3F5", use: "버튼·아이콘 hover" },
      { token: "color/surface-nested", hex: "#FCFDFE", use: "펼친 하위 단계 영역" },
      { token: "color/brand-plate", hex: "#F8F8F8", use: "마크 배경" },
      { token: "color/line-strong", hex: "#D8DDE2", use: "버튼·입력 테두리, 패널 경계" },
      { token: "color/line", hex: "#E4E7EA", use: "구획 경계선" },
      { token: "color/line-soft", hex: "#EDF0F2", use: "행 구분선" },
      { token: "color/line-faint", hex: "#F3F5F7", use: "하위 단계 구분선" },
    ],
  },
  {
    label: "TEXT",
    meta: "color/text",
    items: [
      { token: "color/text-ink", hex: "#14181C", use: "제목·강조 텍스트" },
      { token: "color/text-body", hex: "#3D4650", use: "본문" },
      { token: "color/text-secondary", hex: "#5A646E", use: "보조 설명" },
      { token: "color/text-mute", hex: "#8A939C", use: "라벨·메타" },
      { token: "color/text-mute-soft", hex: "#98A0A8", use: "캡션" },
      { token: "color/text-disabled", hex: "#A6AEB5", use: "placeholder·비활성" },
      { token: "color/text-number", hex: "#BFC6CC", use: "행 번호" },
    ],
  },
  {
    label: "ACCENT",
    meta: "color/blue — 강조는 파랑 한 계열",
    items: [
      { token: "color/blue", hex: "#3D8CE0", use: "막대·게이지·토글 on·핀" },
      { token: "color/blue-action", hex: "#1F63AE", use: "CTA 배경, 링크, 활성 라벨" },
      { token: "color/blue-action-hover", hex: "#17538F", use: "primary 버튼 hover" },
      { token: "color/blue-tint", hex: "#EDF4FC", use: "활성 세그먼트, 선택 배지" },
      { token: "color/blue-tint-soft", hex: "#F5F9FE", use: "선택 행, 콜아웃 배경" },
      { token: "color/blue-line", hex: "#B9D4F1", use: "강조 테두리, 점선 버튼" },
      { token: "color/blue-on-dark", hex: "#7FB0E8", use: "어두운 배경 위 워드마크" },
    ],
  },
  {
    label: "STATUS",
    meta: "color/pass · fail · wait · idle",
    items: [
      { token: "color/pass", hex: "#0E8A5F", use: "통과·연결됨" },
      { token: "color/pass-tint", hex: "#ECFAF3", use: "통과 배경" },
      { token: "color/pass-line", hex: "#A7E3C6", use: "통과 테두리" },
      { token: "color/fail", hex: "#DE3B45", use: "실패·오류" },
      { token: "color/fail-ink", hex: "#B32318", use: "실패 텍스트·danger 라벨" },
      { token: "color/fail-tint", hex: "#FFF3F3", use: "실패 배경" },
      { token: "color/wait", hex: "#AD6800", use: "대기·수동 입력" },
      { token: "color/wait-ink", hex: "#96690C", use: "주의 텍스트" },
      { token: "color/wait-tint", hex: "#FFF8E8", use: "주의 배경" },
      { token: "color/idle", hex: "#D3D8DD", use: "미실행 단계" },
    ],
  },
  {
    label: "DARK SURFACE",
    meta: "dock · console",
    items: [
      { token: "color/dark", hex: "#14181C", use: "dock, 콘솔 바닥" },
      { token: "color/dark-line", hex: "#262E35", use: "어두운 영역 경계" },
      { token: "color/dark-active", hex: "#2B333B", use: "활성 아이콘 배경" },
      { token: "color/dark-disabled", hex: "#4A545D", use: "준비 중 항목" },
      { token: "color/dark-text", hex: "#E7EAED", use: "콘솔 본문" },
      { token: "color/dark-mute", hex: "#98A4AE", use: "어두운 배경 보조 텍스트" },
      { token: "color/log-pass", hex: "#7FD8A6", use: "성공 로그" },
      { token: "color/log-wait", hex: "#EBC46B", use: "대기 로그" },
      { token: "color/log-fail", hex: "#F09B92", use: "실패 로그" },
    ],
  },
];

export const COLOR_RULES = [
  "면을 나누는 수단은 배경색이 아니라 1px 헤어라인입니다. 한 화면의 배경색은 흰색 + #FAFBFC 두 가지까지.",
  "인터랙션은 #1F63AE, 면·그래프는 #3D8CE0. 한 화면의 주 CTA는 하나입니다.",
  "상태는 색 점과 짧은 단어로 표현하고, 배지는 최소한으로 씁니다.",
  "새 색을 만들기 전에 위 토큰에서 대응되는 값을 먼저 찾습니다.",
];

export interface SpaceToken {
  token: string;
  value: string;
  use: string;
}
export const SPACES: SpaceToken[] = [
  { token: "dim/space-2", value: "2px", use: "아이콘과 라벨 사이 미세 보정, 배지 수직 패딩" },
  { token: "dim/space-4", value: "4px", use: "배지 묶음, 세그먼트 내부 간격" },
  { token: "dim/space-6", value: "6px", use: "버튼 그룹 gap, 모달 액션 gap, 상태 점과 라벨" },
  { token: "dim/space-8", value: "8px", use: "버튼 내부 아이콘·라벨 gap, 히스토리 막대 사이" },
  { token: "dim/space-10", value: "10px", use: "dock 캡슐 사이, 행 내부 요소 gap" },
  { token: "dim/space-12", value: "12px", use: "목록 행 좌우 패딩, 패널 내부 기본 gap" },
  { token: "dim/space-14", value: "14px", use: "패널 좌우 패딩(좁은 열), 인라인 컨트롤 묶음" },
  { token: "dim/space-18", value: "18px", use: "섹션 내부 상하 여백" },
  { token: "dim/space-22", value: "22px", use: "모달 패딩, 페이지 헤더 하단" },
  { token: "dim/space-26", value: "26px", use: "작업 화면 좌우 패딩, 섹션 사이" },
  { token: "dim/space-32", value: "32px", use: "문서형 화면 섹션 사이" },
  { token: "dim/space-44", value: "44px", use: "문서형 화면 상단 패딩" },
  { token: "dim/space-120", value: "120px", use: "스크롤 영역 하단(dock 여백)" },
];

export const PADDINGS: SpaceToken[] = [
  { token: "dim/pad-row", value: "13px 12px", use: "목록·데이터 행" },
  { token: "dim/pad-panel", value: "18px 12px", use: "패널 섹션" },
  { token: "dim/pad-modal", value: "22px 24px", use: "모달·drawer 본문" },
  { token: "dim/pad-page", value: "44px 26px 128px", use: "문서형 화면 전체" },
];

export const RADII: SpaceToken[] = [
  { token: "dim/radius-none", value: "0px", use: "상태 점(정사각형), 히스토리 막대" },
  { token: "dim/radius-base", value: "4px", use: "기본값 — 버튼, 입력, 배지, 카드" },
  { token: "dim/radius-float", value: "6px", use: "떠 있는 표면 — 모달, 토스트, 전환 바" },
  { token: "dim/radius-pill", value: "999px", use: "dock 캡슐, 토글 트랙" },
];

export interface HeightToken {
  value: string;
  use: string;
}
export const HEIGHTS: HeightToken[] = [
  { value: "22px", use: "dim/h-22 · 인라인 세그먼트" },
  { value: "26px", use: "dim/h-26 · 헤더 바, 좁은 입력" },
  { value: "28px", use: "dim/h-28 · 패널 내부 버튼" },
  { value: "30px", use: "dim/h-30 · 보조 버튼, 목록 헤더" },
  { value: "34px", use: "dim/h-34 · 주 CTA" },
  { value: "46px", use: "dim/h-46 · 데이터 행 최소, dock 캡슐" },
];

export interface ShadowToken {
  token: string;
  value: string;
  use: string;
  radius: string;
  on: string;
}
export const SHADOWS: ShadowToken[] = [
  { token: "fx/shadow-dock", value: "0 14px 30px -14px rgba(20,24,28,.55)", use: "dock, 모달", radius: "999px", on: "dock" },
  { token: "fx/shadow-float", value: "0 12px 28px -16px rgba(20,24,28,.4)", use: "토스트 알림, 화면 전환 바", radius: "6px", on: "toast" },
  { token: "fx/shadow-pin", value: "0 6px 14px -8px rgba(20,24,28,.6)", use: "마커 핀", radius: "4px", on: "pin" },
  { token: "fx/shadow-none", value: "none", use: "그 외 전부 — 카드·행·패널은 헤어라인으로", radius: "4px", on: "row" },
];

export interface FxToken {
  token: string;
  value: string;
  use: string;
}
export const FX: FxToken[] = [
  { token: "fx/overlay", value: "rgba(20, 24, 28, .24)", use: "모달·drawer 뒤 배경" },
  { token: "fx/hairline", value: "1px solid #E4E7EA", use: "기본 구획선" },
  { token: "fx/hairline-row", value: "1px solid #EDF0F2", use: "행 구분선" },
  { token: "fx/select-bar", value: "border-left: 2px solid #3D8CE0", use: "선택된 행 좌측 표시" },
  { token: "fx/callout-bar", value: "border-left: 3px solid 의미색", use: "콜아웃·배너·실패 블록" },
  { token: "fx/motion-enter", value: "ckIn 180ms ease (dock 260ms)", use: "화면 전환·오버레이 진입" },
  { token: "fx/motion-state", value: "background 120ms ease", use: "hover·활성 전환" },
  { token: "fx/motion-knob", value: "transform 140ms ease", use: "토글 노브" },
  { token: "fx/motion-blink", value: "ckBlink 1s infinite", use: "진행 중 상태 점·활성 단계" },
];

export interface IconSizeToken {
  token: string;
  value: string;
  use: string;
}
export const ICON_SIZES: IconSizeToken[] = [
  { token: "icon/size-16", value: "16px", use: "버튼 내부 아이콘" },
  { token: "icon/size-18", value: "18px", use: "목록 행 아이콘" },
  { token: "icon/size-21", value: "21px", use: "dock 내비게이션" },
  { token: "icon/size-13", value: "13px", use: "체크박스 내부 체크" },
];

export interface IconGroup {
  label: string;
  meta: string;
  items: [string, string][];
}
export const ICON_GROUPS: IconGroup[] = [
  {
    label: "실행 · 제어",
    meta: "run",
    items: [
      ["play_arrow", "실행"], ["pause", "일시정지"], ["stop_circle", "중지"], ["replay", "재실행"],
      ["skip_next", "단계 건너뛰기"], ["schedule", "예약·소요 시간"], ["bolt", "즉시 실행"], ["pending", "대기 중"],
    ],
  },
  {
    label: "편집 · 작성",
    meta: "edit",
    items: [
      ["edit", "수정"], ["delete", "삭제"], ["add", "추가"], ["content_copy", "복제"],
      ["drag_indicator", "순서 변경"], ["check", "체크박스 on"], ["close", "닫기·취소"], ["my_location", "마커 대상 선택"],
    ],
  },
  {
    label: "내비게이션 · 파일",
    meta: "nav",
    items: [
      ["dashboard", "대시보드"], ["description", "시나리오 파일"], ["folder_open", "폴더"], ["history", "실행 기록"],
      ["settings", "설정"], ["search", "검색"], ["chevron_right", "하위 열기"], ["expand_more", "펼치기"],
      ["arrow_back", "뒤로"], ["open_in_new", "새 창"], ["download", "리포트 내려받기"], ["upload_file", "파일 업로드"],
    ],
  },
  {
    label: "상태 · 데이터",
    meta: "status",
    items: [
      ["check_circle", "통과"], ["error", "실패"], ["warning", "주의·수동 입력"], ["info", "안내"],
      ["link", "연결됨"], ["link_off", "미연결"], ["visibility", "뷰포트 보기"], ["visibility_off", "뷰포트 숨기기"],
      ["terminal", "콘솔"], ["bug_report", "오류 상세"], ["screenshot_monitor", "캡처"], ["tune", "실행 옵션"],
    ],
  },
];

export const ICON_RULES = [
  "Material Symbols Rounded(wght 400, FILL 0) 한 세트만. 다른 아이콘 세트를 섞지 않습니다.",
  "화살표·재생 표시 같은 단순 도형은 아이콘 대신 CSS border 삼각형으로 만듭니다.",
  "아이콘 단독 버튼에는 title 또는 aria-label을 반드시 붙입니다.",
];

/**
 * 실사용 아이콘 — src/renderer 전체(.msi 클래스 사용처)를 스캔해 모은 값.
 * 파운데이션 목록(ICON_GROUPS)에 없는 이름도 포함되며, 새 화면을 만들 때
 * 이미 쓰이고 있는 아이콘을 재사용할 수 있도록 컴포넌트별로 정리했다.
 */
export interface UsedIconEntry {
  name: string;
  use: string;
  where: string;
}
export interface UsedIconGroup {
  label: string;
  meta: string;
  items: UsedIconEntry[];
}

export const USED_ICON_GROUPS: UsedIconGroup[] = [
  {
    label: "하단 내비게이션",
    meta: "BottomNavigation",
    items: [
      { name: "edit", use: "편집기", where: "BottomNavigation" },
      { name: "play_circle", use: "시나리오 선택 · 실행", where: "BottomNavigation" },
      { name: "auto_fix_high", use: "폼 자동 완성", where: "BottomNavigation" },
      { name: "data_object", use: "API 테스트", where: "BottomNavigation" },
      { name: "settings", use: "설정", where: "BottomNavigation" },
      { name: "play_arrow", use: "API 실행 · 시나리오 실행 대기", where: "BottomNavigation" },
      { name: "stop_circle", use: "시나리오 실행 중지", where: "BottomNavigation" },
    ],
  },
  {
    label: "시나리오 선택 · 실행",
    meta: "ScenarioPickerPage · RunPage",
    items: [
      { name: "description", use: "시나리오 파일", where: "ScenarioPickerPage" },
      { name: "check", use: "시나리오 선택됨", where: "ScenarioPickerPage" },
      { name: "play_arrow", use: "개별 실행 · 전체 실행", where: "ScenarioPickerPage" },
      { name: "stop", use: "실행 중지", where: "RunPage" },
    ],
  },
  {
    label: "API 테스트",
    meta: "ApiDocumentation · SelectedApiList",
    items: [
      { name: "add_link", use: "Swagger 문서에 단계 추가", where: "ApiDocumentation" },
      { name: "expand_more", use: "operation 상세 열기", where: "ApiDocumentation" },
      { name: "drag_indicator", use: "선택된 단계 순서 변경", where: "SelectedApiList" },
      { name: "link", use: "Swagger에서 위치 보기", where: "SelectedApiList" },
      { name: "close", use: "선택 취소", where: "SelectedApiList" },
    ],
  },
  {
    label: "폼 자동 완성 · 브라우저 툴바",
    meta: "FormAutomationPage",
    items: [
      { name: "photo_camera", use: "화면 캡처 시작", where: "FormAutomationPage" },
      { name: "data_object", use: "Swagger 연결 상태", where: "FormAutomationPage" },
      { name: "auto_fix_high", use: "선택 케이스 자동 입력", where: "FormAutomationPage" },
      { name: "drag_indicator", use: "탭 순서 변경", where: "FormAutomationPage" },
      { name: "edit", use: "탭 이름 수정", where: "FormAutomationPage" },
      { name: "close", use: "탭 닫기", where: "FormAutomationPage" },
      { name: "add", use: "새 세션 · 화면 확대", where: "FormAutomationPage" },
      { name: "arrow_back", use: "브라우저 뒤로가기", where: "FormAutomationPage" },
      { name: "arrow_forward", use: "브라우저 앞으로가기", where: "FormAutomationPage" },
      { name: "progress_activity", use: "페이지 로딩 중", where: "FormAutomationPage" },
      { name: "refresh", use: "새로고침", where: "FormAutomationPage" },
      { name: "lock", use: "주소창 보안 표시", where: "FormAutomationPage" },
      { name: "remove", use: "화면 축소", where: "FormAutomationPage" },
      { name: "close_fullscreen", use: "포커스 모드 종료", where: "FormAutomationPage" },
      { name: "open_in_full", use: "포커스 모드 진입", where: "FormAutomationPage" },
      { name: "lan", use: "네트워크 탭", where: "FormAutomationPage" },
      { name: "auto_awesome", use: "자동 입력 탭 · 진행 알림", where: "FormAutomationPage" },
      { name: "database", use: "저장소 탭", where: "FormAutomationPage" },
      { name: "tune", use: "오버라이드 탭 · 실행 옵션", where: "FormAutomationPage" },
      { name: "check_circle", use: "자동 입력 성공", where: "FormAutomationPage" },
      { name: "error", use: "자동 입력 실패", where: "FormAutomationPage" },
      { name: "delete", use: "저장 케이스 삭제", where: "FormAutomationPage" },
      { name: "restore", use: "케이스 원본 복구", where: "FormAutomationPage" },
      { name: "save", use: "케이스 저장", where: "FormAutomationPage" },
      { name: "restart_alt", use: "입력값 초기화", where: "FormAutomationPage" },
      { name: "language", use: "자동 입력 대상 사이트", where: "FormAutomationPage" },
    ],
  },
  {
    label: "인스펙터 패널",
    meta: "InspectorPanels — 네트워크 · 저장소 · 오버라이드",
    items: [
      { name: "verified_user", use: "오류 없음", where: "InspectorPanels" },
      { name: "cancel", use: "요청 실패", where: "InspectorPanels" },
      { name: "check_circle", use: "요청 성공 · 오버라이드 적용됨", where: "InspectorPanels" },
      { name: "download", use: "네트워크 로그 다운로드", where: "InspectorPanels" },
      { name: "delete", use: "전체 삭제 · 오버라이드 삭제", where: "InspectorPanels" },
      { name: "error", use: "오류만 필터 · JSON 오류", where: "InspectorPanels" },
      { name: "drag_handle", use: "패널 리사이즈 핸들", where: "InspectorPanels" },
      { name: "content_copy", use: "API 스펙 · 저장소 값 복사", where: "InspectorPanels" },
      { name: "tune", use: "오버라이드 만들기 · 필드 편집 탭", where: "InspectorPanels" },
      { name: "progress_activity", use: "저장소 읽는 중", where: "InspectorPanels" },
      { name: "refresh", use: "저장소 새로고침", where: "InspectorPanels" },
      { name: "database", use: "현재 세션 저장소", where: "InspectorPanels" },
      { name: "search", use: "저장소 key·value 검색", where: "InspectorPanels" },
      { name: "info", use: "안내 문구", where: "InspectorPanels" },
      { name: "add", use: "선택 응답 복제", where: "InspectorPanels" },
      { name: "pending", use: "오버라이드 대기", where: "InspectorPanels" },
      { name: "circle", use: "오버라이드 원본 상태", where: "InspectorPanels" },
      { name: "code", use: "JSON 편집 탭", where: "InspectorPanels" },
      { name: "restart_alt", use: "오버라이드 초기화", where: "InspectorPanels" },
      { name: "save", use: "오버라이드 저장", where: "InspectorPanels" },
    ],
  },
  {
    label: "OpenAPI 연결",
    meta: "OpenApiDialog",
    items: [
      { name: "data_object", use: "Swagger / OpenAPI 헤더", where: "OpenApiDialog" },
      { name: "close", use: "다이얼로그 닫기", where: "OpenApiDialog" },
      { name: "check_circle", use: "연결된 문서 표시", where: "OpenApiDialog" },
      { name: "progress_activity", use: "문서 연결 중", where: "OpenApiDialog" },
      { name: "link", use: "URL 연결", where: "OpenApiDialog" },
      { name: "upload_file", use: "로컬 JSON 파일 선택", where: "OpenApiDialog" },
    ],
  },
  {
    label: "화면 캡처 편집기",
    meta: "ScreenshotEditor",
    items: [
      { name: "check", use: "텍스트 적용 · 체크 도구", where: "ScreenshotEditor" },
      { name: "close", use: "텍스트 입력 취소", where: "ScreenshotEditor" },
      { name: "photo_camera", use: "캡처 모드 표시", where: "ScreenshotEditor" },
      { name: "draw", use: "펜 도구", where: "ScreenshotEditor" },
      { name: "crop_square", use: "네모 도구", where: "ScreenshotEditor" },
      { name: "title", use: "텍스트 도구", where: "ScreenshotEditor" },
      { name: "ink_eraser", use: "지우개 도구", where: "ScreenshotEditor" },
      { name: "undo", use: "실행 취소", where: "ScreenshotEditor" },
    ],
  },
];

const usedIconNames = new Set(USED_ICON_GROUPS.flatMap((g) => g.items.map((i) => i.name)));
const foundationIconNames = new Set(ICON_GROUPS.flatMap((g) => g.items.map(([n]) => n)));
export const USED_ICON_COUNT = usedIconNames.size;
export const USED_ICON_NOT_IN_FOUNDATION = [...usedIconNames].filter((n) => !foundationIconNames.has(n)).sort();
