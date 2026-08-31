export type Action =
  | "goto"
  | "fill"
  | "fileUpload"
  | "manualFill"
  | "manualControl"
  | "manualResult"
  | "click"
  | "select"
  | "expectText";

export type Step = {
  id: string;
  action: Action;
  target: string;
  value?: string;
  required?: boolean;
  prompt?: string;
  condition?: string;
  waitSeconds?: number;
  occurrence?: number;
  connected?: boolean;
  x?: number;
  y?: number;
  color?: string;
};

export type Scenario = {
  id: string;
  title: string;
  url: string;
  steps: Step[];
};
export type MarkerPosition = Pick<
  Step,
  "action" | "target" | "value" | "prompt" | "condition" | "waitSeconds" | "occurrence" | "x" | "y" | "color"
>;
export type MarkerPositionStore = Record<string, MarkerPosition[]>;
export type RunRecord = {
  id: string;
  scenarios: Scenario[];
  status: "passed" | "failed";
  passed: number;
  failed: number;
  ranAt: string;
};
export type RunSummary = { total: number; passed: number; failed: number };
export type RunProgress = { current: number; total: number; step: string };
export type Route = "scenarios" | "editor" | "run";

export const seedScenario: Scenario = {
  id: "login-qa",
  title: "로그인",
  url: "https://example.com/login",
  steps: [
    { id: "1", action: "goto", target: "/login", connected: true },
    {
      id: "2",
      action: "fill",
      target: "이메일",
      value: "qa@example.com",
      connected: true,
    },
    {
      id: "3",
      action: "manualFill",
      target: "인증번호",
      prompt: "인증번호를 입력해 주세요.",
      required: true,
      connected: true,
    },
    { id: "4", action: "click", target: "로그인 버튼", connected: true },
    { id: "5", action: "expectText", target: "대시보드", connected: false },
  ],
};

export const actionLabel: Record<Action, string> = {
  goto: "페이지 이동",
  fill: "일반 입력 (자동)",
  fileUpload: "파일 업로드",
  manualFill: "수동 입력",
  manualControl: "브라우저 직접 제어",
  manualResult: "수동 결과 확인",
  click: "클릭",
  select: "선택",
  expectText: "결과 확인",
};

export const actionText = (step: Step): string =>
  step.action === "manualFill"
    ? `${step.target} 수동 입력${step.prompt ? ` [${step.prompt}]` : ""}`
    : step.action === "manualControl"
      ? `${step.target} 브라우저 직접 제어 (최대 5분)${step.prompt ? ` [${step.prompt}]` : ""}`
    : step.action === "manualResult"
      ? `${step.target} 수동 결과 확인 (최대 5분)${step.prompt ? ` [${step.prompt}]` : ""}`
    : step.action === "goto"
      ? `${step.target} 페이지로 이동`
      : step.action === "fill"
        ? `${step.target}에 '${step.value || ""}' 입력`
        : step.action === "fileUpload"
          ? `${step.target}에 '${step.value || ""}' 파일 업로드`
        : step.action === "select"
          ? `${step.target}에서 '${step.value || ""}' 선택`
          : step.action === "click"
            ? `${step.target}${step.occurrence && step.occurrence > 1 ? ` [${step.occurrence}번째]` : ""} 클릭${step.waitSeconds ? ` [대기 ${step.waitSeconds}초]` : ""}`
            : `${step.target} ${actionLabel[step.action]}`;

export const estimateDurationSeconds = (scenario: Scenario): number =>
  scenario.steps.reduce(
    (seconds, step) =>
      seconds +
      (step.action === "goto"
        ? 3
        : step.action === "manualFill"
          ? 15
          : step.action === "manualControl"
            ? 300
          : step.action === "manualResult"
            ? 300
          : step.action === "expectText"
            ? step.waitSeconds ?? 1
            : 1),
    0,
  );
export const formatDuration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, "0")}초`;
export const markerColor = (index: number): string =>
  `hsl(${Math.round((index * 137.508 + 19) % 360)} 72% 48%)`;
export const defaultMarkerPosition = (index: number) => ({
  x: [78, 50, 50, 85, 87][index] ?? 50,
  y: [20, 43, 58, 58, 84][index] ?? 50,
});
