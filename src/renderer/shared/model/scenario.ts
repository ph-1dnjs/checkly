import { actionLabel, type Action } from "./action";

export { actionLabel, type Action } from "./action";

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
  tag?: string;
};
export type MarkerPosition = Pick<
  Step,
  "action" | "target" | "value" | "prompt" | "condition" | "waitSeconds" | "occurrence" | "x" | "y" | "color"
>;
export type MarkerPositionStore = Record<string, MarkerPosition[]>;
export type ScenarioRunResult = {
  scenario: Scenario;
  status: "passed" | "failed" | "cancelled";
  failedStepIndex?: number;
  message?: string;
};
export type RunRecord = {
  id: string;
  scenarios: Scenario[];
  status: "passed" | "failed";
  passed: number;
  failed: number;
  ranAt: string;
  results: ScenarioRunResult[];
};
export type RunSummary = { total: number; passed: number; failed: number };
export type RunProgress = { current: number; total: number; step: string };
export type Route = "dashboard" | "editor" | "picker" | "run" | "settings";

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
export const defaultMarkerPosition = (index: number) => ({
  x: [78, 50, 50, 85, 87][index] ?? 50,
  y: [20, 43, 58, 58, 84][index] ?? 50,
});

const unquoteMarkdownValue = (value: string) =>
  value.trim().replace(/^`([\s\S]*)`$/, "$1");

export const parseMarkdown = (markdown: string): Scenario[] =>
  markdown
    .split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im)
    .filter(Boolean)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title =
        lines[0].match(/^#{1,3}\s*시나리오:\s*(.+)$/i)?.[1] ||
        `시나리오 ${index + 1}`;
      const url =
        lines
          .find((line) => line.startsWith("url:"))
          ?.slice(4)
          .trim() || seedScenario.url;
      const tag =
        lines
          .find((line) => line.startsWith("tag:"))
          ?.slice(4)
          .trim() || undefined;
      const steps = lines
        .filter((line) => /^(Given|When|Then|And|But|If)\s+/i.test(line))
        .map((line, stepIndex): Step => {
          const rawText = line.replace(/^(Given|When|Then|And|But|If)\s+/i, "");
          const conditional = rawText.match(
            /^화면에\s*`(.+?)`\s*가\s*있는\s*경우\s+(.+)$/,
          );
          const condition = conditional?.[1];
          const conditionalText = conditional?.[2] ?? rawText;
          const waitMatch = conditionalText.match(/\[대기\s*(\d+)초\]\s*$/);
          const waitSeconds = waitMatch ? Number(waitMatch[1]) : undefined;
          const text = conditionalText.replace(/\s*\[대기\s*\d+초\]\s*$/, "");
          const occurrenceMatch = text.match(/\[(\d+)번째\]\s*(?:버튼을?|버튼)?\s*클릭/);
          const occurrence = occurrenceMatch ? Number(occurrenceMatch[1]) : undefined;
          const result = text
            .replace(
              /\s*(텍스트가\s*)?(보인다|포함된다|확인된다|표시된다).*/,
              "",
            )
            .trim();
          const manual = text.match(/^(.+?)\s+수동 입력(?:\s*\[(.+)\])?$/);
          const manualControl = text.match(/^(.+?)\s+브라우저 직접 제어(?:\s*\[(.+)\])?$/);
          const manualResult = text.match(/^(.+?)\s+수동 결과 확인(?:\s*\[(.+)\])?$/);
          const fileUpload =
            text.match(/^`(.+?)`(?:에|에서)?\s*`(.*?)`\s*파일\s*업로드/) ??
            text.match(/^(.+?)(?:에|에서)?\s*['"](.*)['"]\s*파일\s*업로드/);
          const fill =
            text.match(
              /^`(.+?)`(?:에|에서|을|를)?\s*`(.*?)`\s*(?:자동\s*)?(?:입력|작성)/,
            ) ??
            text.match(/^(.+?)\s*`(.*?)`\s*(?:자동\s*)?(?:입력|작성)/) ??
            text.match(
              /^(.+?)(?:에|을|를)?\s*['"](.*)['"]\s*(?:자동\s*)?(?:입력|작성)/,
            );
          const select =
            text.match(/^`(.+?)`(?:에서|에)?\s*`(.*?)`\s*선택/) ??
            text.match(/^(.+?)\s*`(.*?)`\s*선택/) ??
            text.match(/^(.+?)(?:에서|에)\s*['"](.*)['"]\s*선택/);
          if (manualResult)
            return {
              id: String(stepIndex + 1),
              action: "manualResult",
              target: unquoteMarkdownValue(manualResult[1]),
              prompt: manualResult[2],
              condition,
              connected: true,
            };
          if (manualControl)
            return {
              id: String(stepIndex + 1),
              action: "manualControl",
              target: unquoteMarkdownValue(manualControl[1]),
              prompt: manualControl[2],
              condition,
              connected: true,
            };
          if (/보인다|포함된다|확인된다|표시된다|결과\s*확인/.test(text))
            return {
              id: String(stepIndex + 1),
              action: "expectText",
              target: unquoteMarkdownValue(result),
              condition,
              waitSeconds,
              connected: false,
            };
          if (manual)
            return {
              id: String(stepIndex + 1),
              action: "manualFill",
              target: unquoteMarkdownValue(manual[1]),
              prompt: manual[2],
              required: true,
              condition,
              connected: true,
            };
          if (fileUpload)
            return {
              id: String(stepIndex + 1),
              action: "fileUpload",
              target: unquoteMarkdownValue(
                fileUpload[1].replace(/(에서|에)$/, "").trim(),
              ),
              value: fileUpload[2],
              condition,
              connected: true,
            };
          if (fill)
            return {
              id: String(stepIndex + 1),
              action: "fill",
              target: unquoteMarkdownValue(
                fill[1].replace(/(에서|에|을|를)$/, "").trim(),
              ),
              value: fill[2],
              condition,
              waitSeconds,
              connected: true,
            };
          if (select)
            return {
              id: String(stepIndex + 1),
              action: "select",
              target: unquoteMarkdownValue(
                select[1].replace(/(에서|에|을|를)$/, "").trim(),
              ),
              value: select[2],
              condition,
              waitSeconds,
              connected: true,
            };
          if (/(페이지로?\s*이동|접속|열기)/.test(text))
            return {
              id: String(stepIndex + 1),
              action: "goto",
              target:
                unquoteMarkdownValue(
                  text.replace(/\s*(페이지로?\s*이동|접속|열기).*/, "").trim(),
                ) || "/",
              condition,
              connected: true,
            };
          return {
            id: String(stepIndex + 1),
            action: "click",
            target: unquoteMarkdownValue(
              text
                .replace(/\s*\[\d+번째\]\s*(?:버튼을?|버튼)?\s*클릭.*/, "")
                .replace(/\s+(버튼을?|버튼)?\s*클릭.*/, "")
                .trim(),
            ),
            occurrence: occurrence && occurrence > 1 ? occurrence : undefined,
            condition,
            waitSeconds,
            connected: true,
          };
        });
      return { id: `scenario-${index}`, title, url, tag, steps };
    });
