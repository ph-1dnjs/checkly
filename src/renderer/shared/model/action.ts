export const ACTIONS = [
  "goto",
  "fill",
  "fileUpload",
  "manualFill",
  "manualControl",
  "manualResult",
  "click",
  "select",
  "expectText",
] as const;

export type Action = (typeof ACTIONS)[number];

// 화면에 노출하는 액션 라벨은 여기서 관리합니다.
export const actionLabel: Record<Action, string> = {
  goto: "페이지 이동",
  fill: "입력",
  fileUpload: "파일 업로드",
  manualFill: "수동 입력",
  manualControl: "직접 제어",
  manualResult: "수동 결과 확인",
  click: "클릭",
  select: "선택",
  expectText: "결과 확인",
};
