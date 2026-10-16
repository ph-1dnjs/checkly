import { actionLabel, type Action } from "./action";

export { actionLabel, type Action } from "./action";

import type { Scenario, Step } from "../../../app/ipc/web-scenario/scenario";
export { parseMarkdown, splitScenarioBlocks } from "../../../app/ipc/web-scenario/scenario";
export type { Scenario, Step } from "../../../app/ipc/web-scenario/scenario";

export type MarkerPosition = Pick<
  Step,
  "databaseId" | "markerViewport" | "markerPageUrl" | "action" | "target" | "value" | "prompt" | "condition" | "waitSeconds" | "occurrence" | "x" | "y" | "color"
>;
export type MarkerPositionStore = Record<string, MarkerPosition[]>;
export type { ScenarioRunResult, RunRecord, RunStepResult } from "../../../app/ipc/web-scenario/scenario";
export type RunSummary = { total: number; passed: number; failed: number };
export type RunProgress = { current: number; total: number; step: string };
export type Route =
  | "dashboard"
  | "editor"
  | "picker"
  | "run"
  | "form-automation"
  | "api-testing"
  | "settings";
/** 시나리오 작업공간 하나로 묶인 화면: 편집 탭(editor)과 실행 탭(picker · run). */
export type ScenarioWorkspaceRoute = Extract<Route, "editor" | "picker" | "run">;
export type ScenarioRunRoute = Extract<Route, "picker" | "run">;
export const isScenarioWorkspaceRoute = (
  route: Route,
): route is ScenarioWorkspaceRoute =>
  route === "editor" || route === "picker" || route === "run";

export const emptyScenario: Scenario = {
  id: "",
  title: "",
  url: "",
  steps: [],
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
export const formatClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, Math.round(seconds)) % 60).padStart(2, "0")}`;
export const markerColor = (index: number): string =>
  `hsl(${Math.round((index * 137.508 + 19) % 360)} 72% 48%)`;
