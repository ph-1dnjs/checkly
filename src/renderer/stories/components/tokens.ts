/**
 * Checkly 컴포넌트 디자인 시스템 데이터.
 * Source: Claude Design "Checkly Components v2.dc.html"
 * CONTROLS · DISPLAY · LAYOUT · FEEDBACK · NAVIGATION 다섯 그룹, 13개 컴포넌트.
 * 시각 데모에 쓰이는 CSS 클래스(cp-*)는 src/renderer/styles/components.css 에 정의되어 있다.
 */

export interface SpecRow {
  token: string;
  value: string;
  use: string;
}

export interface ComponentDef {
  id: string;
  group: "CONTROLS" | "DISPLAY" | "LAYOUT" | "FEEDBACK" | "NAVIGATION";
  name: string;
  tag: string;
  desc: string;
  specs: SpecRow[];
  rules: string[];
}

function specs(rows: [string, string, string][]): SpecRow[] {
  return rows.map(([token, value, use]) => ({ token, value, use }));
}

export const COMPONENTS: ComponentDef[] = [
  {
    id: "comp-button",
    group: "CONTROLS",
    name: "Button",
    tag: "B",
    desc: "Primary / Secondary / Ghost / Danger / Dashed 다섯 종류. 높이는 34·30·28·26px 네 단계로 고정하고 좌우 패딩만 조정합니다. 한 화면의 primary는 하나입니다.",
    specs: specs([
      ["comp/button-primary", "bg #1F63AE · fg #FFFFFF · hover #17538F", "주 CTA"],
      ["comp/button-secondary", "bg #FFFFFF · 1px #D8DDE2 · hover #F5F7F8", "보조 동작"],
      ["comp/button-ghost", "no border · fg #5A646E · hover #F0F3F5", "아이콘 버튼, 목록 내 동작"],
      ["comp/button-danger", "1px #E9C4C0 · fg #B32318 · hover #FDF6F5", "삭제 등 되돌릴 수 없는 동작"],
      ["comp/button-dashed", "1px dashed #B9D4F1 · fg #1F63AE · hover #F5F9FE", "항목 추가"],
      ["comp/button-radius", "4px", "모든 크기 동일"],
      ["comp/button-icon", "msi 16px · gap 8px", "라벨 왼쪽"],
      ["comp/button-shortcut", "mono 10.5px · opacity .65", "라벨 오른쪽"],
    ]),
    rules: [
      "전환은 background 120ms ease만. 크기·그림자 변화를 주지 않습니다.",
      "아이콘 단독 버튼은 30×30px 정사각형, title 또는 aria-label 필수.",
      "danger는 배경을 채우지 않고 테두리·글자색으로만 표시합니다.",
      "비활성은 배경 #FAFBFC, 글자 #A6AEB5, 테두리 #E4E7EA로 통일합니다.",
    ],
  },
  {
    id: "comp-segmented",
    group: "CONTROLS",
    name: "Segmented",
    tag: "S",
    desc: "2–4개의 배타적 선택지를 한 줄로 놓습니다. 활성 항목만 파랑 tint를 받고, 항목 사이는 1px 선으로 나눕니다. 5개 이상이면 세그먼트 대신 목록을 씁니다.",
    specs: specs([
      ["comp/segmented", "1px #D8DDE2 · radius 4px · overflow hidden", "컨테이너"],
      ["comp/segmented-divider", "border-left 1px #E4E7EA", "항목 사이"],
      ["comp/segmented-active", "bg #EDF4FC · fg #1F63AE · 600", "활성 항목"],
      ["comp/segmented-idle", "fg #5A646E · hover #F5F7F8", "비활성 항목"],
      ["comp/segmented-h", "22px / 24px / 28px", "헤더 바 · 툴바 · 단독 배치"],
    ]),
    rules: [
      "활성 표시는 배경 tint + 글자색 + 600 세 가지를 함께 적용합니다.",
      "항목 폭은 내용에 맞추고, 라벨은 명사형 한두 단어로 둡니다.",
      "패널 헤더 바(26px) 안에는 22px 세그먼트만 넣습니다.",
    ],
  },
  {
    id: "comp-form",
    group: "CONTROLS",
    name: "Input · Toggle",
    tag: "I",
    desc: "입력은 높이 26–30px, 테두리 1px #D8DDE2, radius 4px으로 통일합니다. 값이 데이터·경로·시간이면 모노를 씁니다. 토글은 즉시 적용되는 설정, 체크박스는 다중 선택에 씁니다.",
    specs: specs([
      ["comp/input", "h 30px · 1px #D8DDE2 · radius 4px · 12px", "기본 텍스트 입력"],
      ["comp/input-dense", "h 26px · 11.5px", "패널·헤더 바 내부"],
      ["comp/input-mono", "font D2Coding 11.5px", "경로·선택자·시간 값"],
      ["comp/input-disabled", "bg #FAFBFC · fg #A6AEB5 · 1px #E4E7EA", "비활성"],
      ["comp/checkbox", "16px · radius 4px · on #1F63AE + check 13px", "다중 선택"],
      ["comp/toggle", "track 26×15px pill · knob 11px · on #3D8CE0", "즉시 적용 설정"],
      ["comp/toggle-motion", "transform 140ms ease", "노브 이동"],
    ]),
    rules: [
      "라벨은 입력 위가 아니라 행 왼쪽에 둡니다. 설정 화면은 라벨 + 오른쪽 컨트롤 구조입니다.",
      "토글은 저장 버튼 없이 즉시 반영되는 항목에만 씁니다.",
      "입력 오류는 테두리 #FFB3AE + 아래 11px #B32318 문구로 표시합니다.",
    ],
  },
  {
    id: "comp-badge",
    group: "DISPLAY",
    name: "Badge · Tag",
    tag: "T",
    desc: "배지는 최소한으로 씁니다. 수치·선택 개수는 모노 마이크로 배지, 단계의 연산 종류는 고정 폭 86px 태그, 연결 상태는 배지 없이 모노 텍스트로 표현합니다.",
    specs: specs([
      ["comp/badge-micro", "mono 9.5px · padding 1px 5px · radius 4px", "개수·버전·선택 상태"],
      ["comp/badge-info", "bg #EDF4FC · 1px #B9D4F1 · fg #1F63AE", "정보형"],
      ["comp/badge-warn", "bg #FDF7E9 · 1px #E0CFA4 · fg #96690C", "주의형"],
      ["comp/tag-op", "h 19px · w 86px · radius 4px · 10.5px 600", "단계 연산 종류"],
      ["comp/tag-text", "mono 9.5px", "연결 상태 linked / unlinked"],
    ]),
    rules: [
      "한 행에 배지는 하나까지. 두 개 이상 필요하면 하나를 모노 텍스트로 내립니다.",
      "연산 태그는 폭이 고정이므로 라벨이 길면 말줄임하고 title로 전체 값을 줍니다.",
      "색은 연산 종류별 tint에서 꺼내고 새 색을 만들지 않습니다.",
    ],
  },
  {
    id: "comp-status",
    group: "DISPLAY",
    name: "Status",
    tag: "D",
    desc: "상태는 색 점과 짧은 단어로 표현합니다. 점은 radius 없는 정사각형이고, 진행 중이면 ckBlink로 깜빡입니다. tint 배지는 리포트 요약처럼 상태가 결론인 자리에만 씁니다.",
    specs: specs([
      ["comp/status-dot", "8px 정사각형", "요약·기록 행"],
      ["comp/status-dot-group", "7px", "그룹 헤더"],
      ["comp/status-dot-step", "6px", "단계 행"],
      ["comp/status-running", "animation ckBlink 1s infinite", "진행 중"],
      ["comp/status-chip", "h 19px · tint + 1px line + ink", "결론 표시"],
    ]),
    rules: [
      "상태 색은 통과·실패·대기·미실행 네 가지만. 다섯 번째 상태를 만들지 않습니다.",
      "점만으로 뜻이 전달되지 않는 자리에는 항상 단어를 함께 둡니다.",
      "미실행(#D3D8DD)은 회색이므로 텍스트 없이 단독으로 쓰지 않습니다.",
    ],
  },
  {
    id: "comp-progress",
    group: "DISPLAY",
    name: "Progress",
    tag: "P",
    desc: "진행은 세 형태로만 표현합니다. 최근 실행 이력은 막대 스트립, 실행 중 단계 진행은 3px 테이프, 전체 진행률은 38px 도넛. 시간을 알 수 없으면 ckBar 불확정 바를 씁니다.",
    specs: specs([
      ["comp/progress-history", "h 34px · gap 3px · 막대별 title", "대시보드 최근 실행"],
      ["comp/progress-tape", "h 3px · gap 1px · 단계 수 등분", "실행 화면 헤더 아래"],
      ["comp/progress-report", "h 6px · gap 3px", "리포트 단계 요약"],
      ["comp/progress-donut", "38px conic-gradient + 내부 28px 흰 원", "토스트·요약 진행률"],
      ["comp/progress-indeterminate", "h 3px · ckBar 1.4s ease-in-out infinite", "남은 시간 미정"],
    ]),
    rules: [
      "막대 색은 상태색 그대로 쓰고, 진행 중 구간만 파랑 + 깜빡임입니다.",
      "숫자 진행률은 항상 모노 + tabular-nums로 적어 자리가 흔들리지 않게 합니다.",
      "스트립 막대에는 title로 회차·결과를 넣습니다.",
    ],
  },
  {
    id: "comp-row",
    group: "LAYOUT",
    name: "List Row",
    tag: "R",
    desc: "목록은 카드로 감싸지 않습니다. 헤더 행 30px, 데이터 행 최소 46px, 단계 행 30–34px이고 구분선으로 간격을 만듭니다. 선택된 행은 옅은 파랑 배경과 좌측 2px 막대로 표시합니다.",
    specs: specs([
      ["comp/row-header", "h 30px · 11px #8A939C · 하단 1px #E4E7EA", "열 이름"],
      ["comp/row-data", "min-h 46px · padding 9px 12px · 하단 1px #EDF0F2", "시나리오·기록 행"],
      ["comp/row-hover", "bg #F7F9FA", "hover"],
      ["comp/row-selected", "bg #F5F9FE · border-left 2px #3D8CE0", "선택"],
      ["comp/row-step", "h 30px / 34px · 하단 1px #F3F5F7", "단계 행"],
      ["comp/row-nested", "bg #FCFDFE · padding-left 38px", "펼친 하위 단계"],
    ]),
    rules: [
      "행 왼쪽 패딩은 선택 막대 2px을 포함해 12px을 유지합니다(10px + 2px).",
      "한 행의 정보는 제목 + 모노 보조 한 줄까지. 그 이상은 상세 패널로 넘깁니다.",
      "숫자 열은 우측 정렬 + tabular-nums, 문자 열은 좌측 정렬입니다.",
      "행 사이 간격을 gap이나 margin으로 만들지 않습니다.",
    ],
  },
  {
    id: "comp-panel",
    group: "LAYOUT",
    name: "Panel Header",
    tag: "H",
    desc: "패널과 섹션의 경계는 26px 헤더 바가 만듭니다. 왼쪽에 영문 대문자 라벨, 오른쪽에 모노 메타를 두고 스크롤 시 상단에 고정합니다. 지표는 헤어라인으로 칸을 나눈 스트립에 놓습니다.",
    specs: specs([
      ["comp/panel-header", "h 26px · bg #FAFBFC · 11px #8A939C · sticky top 0", "패널·섹션 헤더"],
      ["comp/panel-header-meta", "mono 10.5px 우측 정렬", "개수·시간·상태"],
      ["comp/panel-header-control", "22px 세그먼트 또는 아이콘 버튼", "헤더 내 컨트롤"],
      ["comp/metric-strip", "위아래 1px #E4E7EA · 칸 사이 1px #EDF0F2", "지표 묶음"],
      ["comp/metric-value", "mono 700 · 52 / 26 / 20px · tabular-nums", "지표 숫자"],
    ]),
    rules: [
      "헤더 바 라벨은 영문 대문자(EXECUTION, CONSOLE)만 허용합니다. 그 외 텍스트는 한국어입니다.",
      "헤더 바 안에 버튼을 넣을 때는 높이 22px을 넘기지 않습니다.",
      "지표는 한 스트립에 3개까지. 그 이상은 표로 바꿉니다.",
    ],
  },
  {
    id: "comp-callout",
    group: "FEEDBACK",
    name: "Callout",
    tag: "C",
    desc: "안내·주의·실패는 좌측 3px 의미색 막대와 옅은 tint로 표현합니다. 아이콘을 쓰지 않고 라벨과 문장으로 전달하며, 실패 상세는 기대값·실제값·선택자 2열로 나열합니다.",
    specs: specs([
      ["comp/callout-info", "bg #F5F9FE · bar #3D8CE0 · 1px #E4E7EA", "안내"],
      ["comp/callout-warn", "bg #FDF7E9 · bar #C08A15", "주의·수동 입력 대기"],
      ["comp/callout-fail", "bg #FDF6F5 · bar #B32318", "실패"],
      ["comp/callout-label", "mono 9.5px · letter-spacing .08em", "의미색 라벨"],
      ["comp/callout-diff", "grid 68px / 1fr · mono 11px", "기대값·실제값·선택자"],
    ]),
    rules: [
      "콜아웃 안 버튼은 28px 높이로 낮춰 본문과 위계를 유지합니다.",
      "실패 문구는 원인 한 줄 + 값 비교로 끝냅니다. 해결 방법을 추측해 적지 않습니다.",
      "한 화면에 콜아웃은 하나까지. 두 개가 필요하면 상위 하나로 합칩니다.",
    ],
  },
  {
    id: "comp-toast",
    group: "FEEDBACK",
    name: "Toast",
    tag: "N",
    desc: "실행 진행과 완료는 우하단 340px 토스트로 알립니다. 진행 중에는 38px 도넛과 단계·경과 시간을, 완료 후에는 상태 점과 리포트 링크를 둡니다. dock 위 92px에 놓아 겹치지 않게 합니다.",
    specs: specs([
      ["comp/toast", "w 340px · radius 6px · 1px #D8DDE2", "컨테이너"],
      ["comp/toast-pos", "fixed right 20px · bottom 92px", "dock 위"],
      ["comp/toast-shadow", "0 12px 28px -16px rgba(20,24,28,.4)", "떠 있는 표면"],
      ["comp/toast-progress", "38px conic + 28px 흰 원 · mono 9.5px", "진행률"],
      ["comp/toast-action", "12px 600 #1F63AE 텍스트 링크", "리포트 열기"],
    ]),
    rules: [
      "토스트는 한 번에 하나만. 새 알림은 기존 것을 대체합니다.",
      "진행 중 토스트는 자동으로 사라지지 않고, 완료 토스트만 닫힙니다.",
      'role="status"를 붙여 스크린리더에 전달합니다.',
    ],
  },
  {
    id: "comp-modal",
    group: "FEEDBACK",
    name: "Modal",
    tag: "M",
    desc: "되돌릴 수 없는 동작을 확인받을 때만 씁니다. 폭 460px, 제목 17px, 본문 12.5px, 액션은 우측 정렬. 대상이 무엇인지 모노 한 줄로 반복해 보여줍니다.",
    specs: specs([
      ["comp/modal", "w 460px · radius 6px · 1px #D8DDE2 · padding 22px 24px", "컨테이너"],
      ["comp/modal-overlay", "rgba(20,24,28,.24)", "뒤 배경"],
      ["comp/modal-shadow", "0 14px 30px -14px rgba(20,24,28,.55)", "떠 있는 표면"],
      ["comp/modal-title", "17px 600 · -0.015em", "제목"],
      ["comp/modal-actions", "우측 정렬 · gap 6px · h 30px", "취소 + 실행"],
    ]),
    rules: [
      '제목은 질문형("삭제할까요?"), 버튼은 동작 명사형("삭제")으로 맞춥니다.',
      "확인 모달에는 파괴적 버튼 하나만 둡니다.",
      "입력이 필요한 작업은 모달이 아니라 화면이나 drawer로 처리합니다.",
    ],
  },
  {
    id: "comp-drawer",
    group: "FEEDBACK",
    name: "Drawer",
    tag: "W",
    desc: "실행 리포트처럼 화면을 떠나지 않고 상세를 볼 때 씁니다. 우측 560px, 48px sticky 헤더, 상단 3열 지표, 아래 실패 단계 블록 순서입니다.",
    specs: specs([
      ["comp/drawer", "w 560px · border-left 1px #D8DDE2", "컨테이너"],
      ["comp/drawer-header", "h 48px sticky · Nunito 15px 800 + mono 식별자", "헤더"],
      ["comp/drawer-metrics", "3열 · mono 20px 700 · 칸 사이 1px #EDF0F2", "PASS RATE / DURATION / STEPS"],
      ["comp/drawer-fail", "border-left 3px #B32318 · bg #FDF6F5", "실패 단계 블록"],
      ["comp/drawer-body", "padding 14px 16px · 하단 여백 110px", "본문"],
    ]),
    rules: [
      "drawer는 화면 전환 없이 읽는 내용에만. 편집은 별도 화면으로 보냅니다.",
      "헤더에는 내려받기와 닫기 두 동작까지만 둡니다.",
      "지표 라벨은 영문 대문자, 값은 모노 + tabular-nums입니다.",
    ],
  },
  {
    id: "comp-dock",
    group: "NAVIGATION",
    name: "Dock · Console",
    tag: "K",
    desc: "내비게이션은 하단 고정 dock 하나입니다. 브랜드·아이콘 내비·상황 액션 세 캡슐을 gap 10px으로 놓고, 실행 상태에 따라 우측 캡슐의 라벨과 색이 바뀝니다. 콘솔은 같은 어두운 표면을 공유합니다.",
    specs: specs([
      ["comp/dock", "fixed bottom 22px · center · z-index 70", "위치"],
      ["comp/dock-capsule", "h 46px · radius 999px · bg #14181C · gap 10px", "캡슐"],
      ["comp/dock-brand", "padding 0 18px 0 8px · 마크 28px in 32px 원 · Nunito 15px 800", "브랜드 캡슐 — 대시보드로 이동"],
      ["comp/dock-icon", "40×34px · 활성 bg #2B333B + #FFFFFF · 비활성 #98A4AE", "내비 버튼 5칸"],
      ["comp/dock-disabled", "fg #4A545D · cursor not-allowed", "준비 중 항목"],
      ["comp/dock-action", "캡슐 전체가 버튼 · bg 실행 #1F63AE / 중지 #97180F · padding 0 20px · msi 21px + 13px 600", "상황 액션"],
      ["comp/dock-meta", "mono 10.5px opacity .7 · 980px 이하 숨김", "진행 표시"],
      ["comp/console", "bg #14181C · 1px #262E35 · mono 11px", "로그 영역"],
    ]),
    rules: [
      "dock은 화면마다 같은 자리, 같은 순서를 유지합니다.",
      "스크롤 영역 하단에 110–120px 여백을 두어 dock이 내용을 덮지 않게 합니다.",
      "콘솔 로그 색은 본문 #E7EAED, 성공 #7FD8A6, 대기 #EBC46B, 실패 #F09B92 네 가지입니다.",
    ],
  },
];

export function componentById(id: string): ComponentDef {
  const found = COMPONENTS.find((c) => c.id === id);
  if (!found) throw new Error(`unknown component id: ${id}`);
  return found;
}

/* ---------------------------------------------------------------------- */
/* Button                                                                  */
/* ---------------------------------------------------------------------- */

export interface ButtonVariant {
  token: string;
  name: string;
  label: string;
  bg: string;
  fg: string;
  border: string;
  hoverBg: string;
  hoverFg: string;
  hoverBorder: string;
  disabledBg: string;
  disabledBorder: string;
  use: string;
}

export const BUTTON_VARIANTS: ButtonVariant[] = [
  { token: "comp/button-primary", name: "Primary", label: "전체 실행", bg: "#1F63AE", fg: "#FFFFFF", border: "none", hoverBg: "#17538F", hoverFg: "#FFFFFF", hoverBorder: "none", disabledBg: "#E4E7EA", disabledBorder: "1px solid #E4E7EA", use: "화면의 주 동작. 한 화면에 하나." },
  { token: "comp/button-secondary", name: "Secondary", label: "편집", bg: "#FFFFFF", fg: "#3D4650", border: "1px solid #D8DDE2", hoverBg: "#F5F7F8", hoverFg: "#3D4650", hoverBorder: "1px solid #D8DDE2", disabledBg: "#FAFBFC", disabledBorder: "1px solid #E4E7EA", use: "보조 동작. 개수 제한 없음." },
  { token: "comp/button-ghost", name: "Ghost", label: "실행 기록", bg: "transparent", fg: "#5A646E", border: "none", hoverBg: "#F0F3F5", hoverFg: "#3D4650", hoverBorder: "none", disabledBg: "transparent", disabledBorder: "none", use: "목록·헤더 안의 동작, 아이콘 버튼." },
  { token: "comp/button-danger", name: "Danger", label: "삭제", bg: "#FFFFFF", fg: "#B32318", border: "1px solid #E9C4C0", hoverBg: "#FDF6F5", hoverFg: "#B32318", hoverBorder: "1px solid #E9C4C0", disabledBg: "#FAFBFC", disabledBorder: "1px solid #E4E7EA", use: "되돌릴 수 없는 동작. 배경을 채우지 않는다." },
  { token: "comp/button-dashed", name: "Dashed", label: "단계 추가", bg: "#FFFFFF", fg: "#1F63AE", border: "1px dashed #B9D4F1", hoverBg: "#F5F9FE", hoverFg: "#1F63AE", hoverBorder: "1px dashed #B9D4F1", disabledBg: "#FAFBFC", disabledBorder: "1px dashed #E4E7EA", use: "목록 끝의 항목 추가." },
];

export interface ButtonSize {
  h: string;
  fs: string;
  pad: string;
  use: string;
}

export const BUTTON_SIZES: ButtonSize[] = [
  { h: "34px", fs: "12.5px", pad: "0 14px", use: "h-34 · 주 CTA" },
  { h: "30px", fs: "12.5px", pad: "0 12px", use: "h-30 · 보조 버튼" },
  { h: "28px", fs: "12px", pad: "0 12px", use: "h-28 · 패널 내부" },
  { h: "26px", fs: "11.5px", pad: "0 10px", use: "h-26 · 헤더 바" },
];

/* ---------------------------------------------------------------------- */
/* Segmented                                                               */
/* ---------------------------------------------------------------------- */

export interface SegmentedGroup {
  token: string;
  h: string;
  fs: string;
  use: string;
  items: string[];
  activeIndex: number;
}

export const SEGMENTED_GROUPS: SegmentedGroup[] = [
  { token: "comp/segmented-22", h: "22px", fs: "11px", use: "헤더 바 안", items: ["1440", "768", "390"], activeIndex: 0 },
  { token: "comp/segmented-24", h: "24px", fs: "11.5px", use: "툴바·상단 바", items: ["Docs", "Canvas"], activeIndex: 1 },
  { token: "comp/segmented-28", h: "28px", fs: "12px", use: "단독 배치", items: ["전체", "통과", "실패"], activeIndex: 2 },
];

/* ---------------------------------------------------------------------- */
/* Input · Toggle                                                         */
/* ---------------------------------------------------------------------- */

export interface InputDef {
  token: string;
  h: string;
  value: string;
  family: "ui" | "mono";
  fs: string;
  fg: string;
  border: string;
  bg: string;
  icon?: string;
  suffix?: string;
  use: string;
}

export const INPUTS: InputDef[] = [
  { token: "comp/input", h: "30px", value: "시나리오 이름을 입력하세요", family: "ui", fs: "12px", fg: "#A6AEB5", border: "#D8DDE2", bg: "#FFFFFF", use: "기본 텍스트 입력 · placeholder 상태" },
  { token: "comp/input (filled)", h: "30px", value: "로그인 후 대시보드 확인", family: "ui", fs: "12px", fg: "#14181C", border: "#D8DDE2", bg: "#FFFFFF", use: "값이 있는 상태" },
  { token: "comp/input-mono", h: "30px", value: "scenarios/login-dashboard.md", family: "mono", fs: "11.5px", fg: "#14181C", border: "#D8DDE2", bg: "#FFFFFF", use: "경로·선택자·식별자" },
  { token: "comp/input-dense", h: "26px", value: "단계 검색", family: "ui", fs: "11.5px", fg: "#A6AEB5", border: "#D8DDE2", bg: "#FFFFFF", icon: "search", suffix: "/", use: "패널·헤더 바 내부" },
  { token: "comp/input-unit", h: "30px", value: "3", family: "mono", fs: "11.5px", fg: "#14181C", border: "#D8DDE2", bg: "#FFFFFF", suffix: "회 재시도", use: "단위가 붙는 수치" },
  { token: "comp/input-disabled", h: "30px", value: "연결된 시나리오 없음", family: "ui", fs: "12px", fg: "#A6AEB5", border: "#E4E7EA", bg: "#FAFBFC", use: "비활성" },
];

/* ---------------------------------------------------------------------- */
/* Badge · Tag                                                            */
/* ---------------------------------------------------------------------- */

export interface BadgeDef {
  label: string;
  bg: string;
  border: string;
  fg: string;
  use: string;
}

export const BADGES: BadgeDef[] = [
  { label: "v16", bg: "#EDF4FC", border: "#B9D4F1", fg: "#1F63AE", use: "버전·식별 배지" },
  { label: "SELECTED 3", bg: "#EDF4FC", border: "#B9D4F1", fg: "#1F63AE", use: "선택 개수" },
  { label: "12 STEPS", bg: "#EDF4FC", border: "#B9D4F1", fg: "#1F63AE", use: "단계 수" },
  { label: "MANUAL", bg: "#FDF7E9", border: "#E0CFA4", fg: "#96690C", use: "수동 입력 필요" },
  { label: "DRAFT", bg: "#FDF7E9", border: "#E0CFA4", fg: "#96690C", use: "작성 중" },
];

export interface OpTagDef {
  label: string;
  token: string;
  bg: string;
  fg: string;
  use: string;
}

export const OP_TAGS: OpTagDef[] = [
  { label: "이동", token: "comp/tag-op-move", bg: "#EDF4FC", fg: "#1F63AE", use: "URL로 이동" },
  { label: "입력", token: "comp/tag-op-type", bg: "#EDF4FC", fg: "#1F63AE", use: "필드에 값 입력" },
  { label: "클릭", token: "comp/tag-op-click", bg: "#F0F3F5", fg: "#3D4650", use: "요소 클릭" },
  { label: "선택", token: "comp/tag-op-select", bg: "#F0F3F5", fg: "#3D4650", use: "옵션 선택" },
  { label: "업로드", token: "comp/tag-op-upload", bg: "#F0F3F5", fg: "#3D4650", use: "파일 업로드" },
  { label: "수동", token: "comp/tag-op-manual", bg: "#FDF7E9", fg: "#96690C", use: "사람이 직접 처리" },
  { label: "결과 확인", token: "comp/tag-op-assert", bg: "#E7F0EA", fg: "#1E7A4A", use: "기대값과 비교" },
];

/* ---------------------------------------------------------------------- */
/* Status                                                                  */
/* ---------------------------------------------------------------------- */

export interface StatusDef {
  token: string;
  color: string;
  word: string;
  tint: string;
  line: string;
  ink: string;
  running?: boolean;
  use: string;
}

export const STATUSES: StatusDef[] = [
  { token: "comp/status-pass", color: "#0E8A5F", word: "통과", tint: "#ECFAF3", line: "#A7E3C6", ink: "#0E6B4A", use: "단계·실행이 기대값과 일치" },
  { token: "comp/status-fail", color: "#DE3B45", word: "실패", tint: "#FFF3F3", line: "#FFB3AE", ink: "#B32318", use: "기대값 불일치 또는 오류" },
  { token: "comp/status-wait", color: "#AD6800", word: "대기", tint: "#FFF8E8", line: "#F3D79B", ink: "#96690C", use: "수동 입력·승인 대기" },
  { token: "comp/status-running", color: "#3D8CE0", word: "진행 중", tint: "#EDF4FC", line: "#B9D4F1", ink: "#1F63AE", running: true, use: "실행 중인 단계" },
  { token: "comp/status-idle", color: "#D3D8DD", word: "미실행", tint: "#FAFBFC", line: "#E4E7EA", ink: "#8A939C", use: "아직 실행되지 않음" },
];

export const DOT_SIZES = [
  { value: "8px", use: "요약·기록 행" },
  { value: "7px", use: "그룹 헤더" },
  { value: "6px", use: "단계 행" },
];

/* ---------------------------------------------------------------------- */
/* Progress                                                                */
/* ---------------------------------------------------------------------- */

const PASS = "#0E8A5F", FAIL = "#DE3B45", BLUE = "#3D8CE0", IDLE = "#D3D8DD";

function historyColor(k: string): string {
  return k === "p" ? PASS : k === "f" ? FAIL : k === "r" ? BLUE : IDLE;
}

const HISTORY_RESULTS = ["p", "p", "p", "f", "p", "p", "p", "p", "p", "f", "p", "p", "p", "p", "p", "p", "f", "p", "p", "p", "p", "p", "p", "r"];

export interface HistoryBar {
  color: string;
  h: string;
  title: string;
}

export const HISTORY: HistoryBar[] = HISTORY_RESULTS.map((k, i) => ({
  color: historyColor(k),
  h: k === "i" ? "12px" : k === "f" ? "34px" : "24px",
  title: `${i + 1}회 · ${k === "p" ? "통과" : k === "f" ? "실패" : "진행 중"}`,
}));

const TAPE_RESULTS = ["p", "p", "p", "p", "p", "p", "r", "i", "i", "i", "i", "i"];

export interface TapeSeg {
  color: string;
  running: boolean;
}

export const TAPE: TapeSeg[] = TAPE_RESULTS.map((k) => ({ color: historyColor(k), running: k === "r" }));

/* ---------------------------------------------------------------------- */
/* List Row · Step Row                                                    */
/* ---------------------------------------------------------------------- */

export interface RowDef {
  name: string;
  path: string;
  linkState: string;
  dot: string;
  running?: boolean;
  at: string;
  steps: string;
  dur: string;
  bg: string;
  bar: string;
}

export const ROWS: RowDef[] = [
  { name: "로그인 후 대시보드 확인", path: "scenarios/login-dashboard.md", linkState: "linked", dot: PASS, at: "09-14 09:41", steps: "12", dur: "14.2s", bg: "#FFFFFF", bar: "transparent" },
  { name: "결제 취소 플로우", path: "scenarios/refund.md", linkState: "linked", dot: FAIL, at: "09-14 08:02", steps: "18", dur: "22.8s", bg: "#F7F9FA", bar: "transparent" },
  { name: "회원가입 이메일 인증", path: "scenarios/signup-email.md", linkState: "unlinked", dot: "#AD6800", at: "09-13 17:20", steps: "9", dur: "—", bg: "#F5F9FE", bar: BLUE },
  { name: "상품 검색 정렬", path: "scenarios/search-sort.md", linkState: "linked", dot: BLUE, running: true, at: "실행 중", steps: "7", dur: "03.1s", bg: "#FFFFFF", bar: "transparent" },
];

export interface StepDef {
  no: string;
  dot: string;
  running?: boolean;
  op: string;
  opBg: string;
  opFg: string;
  text: string;
  dur: string;
  bg: string;
}

export const STEPS: StepDef[] = [
  { no: "01", dot: PASS, op: "이동", opBg: "#EDF4FC", opFg: "#1F63AE", text: "https://app.example.com/login", dur: "0.8s", bg: "#FFFFFF" },
  { no: "02", dot: PASS, op: "입력", opBg: "#EDF4FC", opFg: "#1F63AE", text: "이메일 · qa@example.com", dur: "0.6s", bg: "#FFFFFF" },
  { no: "03", dot: PASS, op: "클릭", opBg: "#F0F3F5", opFg: "#3D4650", text: "로그인 버튼", dur: "1.2s", bg: "#FFFFFF" },
  { no: "04", dot: BLUE, running: true, op: "결과 확인", opBg: "#E7F0EA", opFg: "#1E7A4A", text: "대시보드 제목 노출", dur: "—", bg: "#F5F9FE" },
  { no: "05", dot: IDLE, op: "수동", opBg: "#FDF7E9", opFg: "#96690C", text: "OTP 입력 대기", dur: "—", bg: "#FFFFFF" },
];

/* ---------------------------------------------------------------------- */
/* Panel Header · Metric Strip                                            */
/* ---------------------------------------------------------------------- */

export interface PanelHeaderDef {
  token: string;
  label: string;
  meta: string;
  metaFg: string;
  icon?: string;
  body: string;
  use: string;
}

export const PANELS: PanelHeaderDef[] = [
  { token: "comp/panel-header", label: "EXECUTION", meta: "12 steps", metaFg: "#8A939C", body: "단계 목록", use: "기본형 — 라벨 + 모노 메타" },
  { token: "comp/panel-header (icon)", label: "CONSOLE", meta: "12 lines", metaFg: "#8A939C", icon: "terminal", body: "로그", use: "아이콘을 붙인 형태" },
  { token: "comp/panel-header (state)", label: "VIEWPORT", meta: "connected", metaFg: PASS, body: "캡처 영역", use: "메타에 상태색을 준 형태" },
  { token: "comp/panel-header (group)", label: "FAILED STEP", meta: "1건", metaFg: "#B32318", body: "실패 단계", use: "결과 그룹 헤더" },
];

export interface MetricDef {
  label: string;
  value: string;
  size: string;
  color: string;
  meta: string;
  line: string;
}

export const METRICS: MetricDef[] = [
  { label: "PASS RATE", value: "98.2%", size: "52px", color: "#14181C", meta: "최근 24회", line: "none" },
  { label: "DURATION", value: "14.2s", size: "26px", color: "#14181C", meta: "평균 16.4s", line: "1px solid #EDF0F2" },
  { label: "SCENARIOS", value: "18", size: "26px", color: "#1F63AE", meta: "실행 대기 3", line: "1px solid #EDF0F2" },
];

/* ---------------------------------------------------------------------- */
/* Callout · Failure block                                                */
/* ---------------------------------------------------------------------- */

export interface CalloutDef {
  bg: string;
  bar: string;
  ink: string;
  label: string;
  text: string;
  action?: string;
}

export const CALLOUTS: CalloutDef[] = [
  { bg: "#F5F9FE", bar: BLUE, ink: "#1F63AE", label: "INFO", text: "선택한 3개 시나리오가 실행 대기열에 올라갑니다. 실행 중에는 편집할 수 없습니다." },
  { bg: "#FDF7E9", bar: "#C08A15", ink: "#96690C", label: "MANUAL INPUT", text: "단계 5에서 OTP 입력이 필요합니다. 값을 넣으면 나머지 단계가 이어서 실행됩니다.", action: "입력하고 계속" },
  { bg: "#FDF6F5", bar: "#B32318", ink: "#B32318", label: "FAILED", text: "단계 7에서 기대한 텍스트를 찾지 못했습니다. 선택자가 바뀌었을 수 있습니다." },
];

export interface DiffDef {
  k: string;
  v: string;
  fg: string;
}

export const DIFFS: DiffDef[] = [
  { k: "expected", v: "주문이 취소되었습니다", fg: "#0E6B4A" },
  { k: "actual", v: "요청을 처리할 수 없습니다", fg: "#B32318" },
  { k: "selector", v: '[data-testid="order-status"]', fg: "#3D4650" },
];

/* ---------------------------------------------------------------------- */
/* Drawer                                                                  */
/* ---------------------------------------------------------------------- */

export const DRAWER_METRICS: MetricDef[] = [
  { label: "PASS RATE", value: "94.4%", size: "20px", color: "#14181C", meta: "", line: "none" },
  { label: "DURATION", value: "22.8s", size: "20px", color: "#14181C", meta: "", line: "1px solid #EDF0F2" },
  { label: "STEPS", value: "17 / 18", size: "20px", color: "#1F63AE", meta: "", line: "1px solid #EDF0F2" },
];

/* ---------------------------------------------------------------------- */
/* Dock · Console                                                          */
/* ---------------------------------------------------------------------- */

export interface DockIconDef {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

export const DOCK_ICONS: DockIconDef[] = [
  { icon: "edit", label: "편집기" },
  { icon: "play_circle", label: "시나리오 선택 · 실행", active: true },
  { icon: "dynamic_form", label: "준비 중", disabled: true },
  { icon: "data_object", label: "API 테스트 (준비 중)", disabled: true },
  { icon: "settings", label: "설정" },
];

export interface DockActionDef {
  icon: string;
  label: string;
  meta: string;
  bg: string;
}

export const DOCK_ACTIONS: DockActionDef[] = [
  { icon: "play_arrow", label: "실행", meta: "3개", bg: "#1F63AE" },
  { icon: "stop_circle", label: "중지", meta: "62%", bg: "#97180F" },
];

export interface LogLine {
  text: string;
  fg: string;
}

export const LOGS: LogLine[] = [
  { text: "[00:00.120] run start · scenarios/login-dashboard.md", fg: "#E7EAED" },
  { text: "[00:00.940] step 01 이동 → https://app.example.com/login", fg: "#E7EAED" },
  { text: "[00:02.180] step 03 클릭 · 로그인 버튼 → ok", fg: "#7FD8A6" },
  { text: "[00:06.400] step 05 수동 입력 대기 · OTP", fg: "#EBC46B" },
  { text: "[00:08.120] step 07 결과 확인 실패 · text mismatch", fg: "#F09B92" },
];
