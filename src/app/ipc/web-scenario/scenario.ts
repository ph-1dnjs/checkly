export type Action = "goto" | "fill" | "fileUpload" | "click" | "select" | "expectText" | "manualFill" | "manualControl" | "manualResult";

export type Step = {
  id: string;
  databaseId?: string;
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
  markerViewport?: "mobile" | "tablet" | "desktop";
  markerPageUrl?: string;
};

export type Scenario = {
  id: string;
  code?: string;
  sortOrder?: number;
  title: string;
  /** 설정(엔드포인트 × 환경)의 웹 엔드포인트 ID. 본문에는 `endpoint:`로 저장한다. */
  endpointId?: string;
  /** 실행 시 해석한 시작 주소. 본문에는 저장하지 않는다(이전 문서의 `url:`만 읽는다). */
  url: string;
  steps: Step[];
  tag?: string;
};
const unquoteMarkdownValue = (value: string) =>
  value.trim().replace(/^`([\s\S]*)`$/, "$1");

export const splitScenarioBlocks = (markdown: string): string[] =>
  markdown
    .split(/(?=^#{1,3}\s*시나리오:|^Scenario:)/im)
    // 편집 중에는 Enter/Delete로 공백 줄만 남는 중간 상태가 생길 수 있다.
    // 이 상태는 시나리오 블록이 아니므로 파싱/교체 대상에서 제외한다.
    .filter((block) => block.trim());

const STEP_LINE = /^(Given|When|Then|And|But|If)\s+/i;

/** 이동 주소는 환경과 무관한 경로만 보관한다. 쿼리와 해시는 유지한다. */
export const routePath = (value: string): string => {
  const route = value.trim();
  if (/^(https?:)?\/\//i.test(route)) {
    const url = new URL(route, "https://route.invalid");
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return route || "/";
};

/** 이전 시작 URL을 이동 단계로 옮기고 절대 이동 주소에서 호스트를 제거한다. */
export const migrateLegacyUrl = (block: string): string => {
  const lines = block.split("\n");
  const index = lines.findIndex((line) => line.trim().startsWith("url:"));
  if (index >= 0) {
    const path = routePath(lines[index].trim().slice(4));
    lines.splice(index, 1);
    if (path !== "/") {
      const first = lines.findIndex((line) => STEP_LINE.test(line.trim()));
      const step = `Given \`${path}\` 페이지로 이동한다`;
      if (first < 0) lines.push(step);
      else lines.splice(first, 0, step);
    }
  }
  return lines.map(line => {
    if (!STEP_LINE.test(line.trim())) return line;
    const step = parseMarkdown(`# 시나리오: 경로\n${line}`)[0]?.steps[0];
    if (step?.action !== "goto") return line;
    const index = line.lastIndexOf(step.target);
    return index < 0 ? line : line.slice(0, index) + routePath(step.target) + line.slice(index + step.target.length);
  }).join("\n");
};

export const resolveScenarioUrl = (scenario: Scenario, baseUrl: string): Scenario => {
  const base = new URL(baseUrl);
  if (!/^https?:$/.test(base.protocol)) throw new Error("웹 주소를 확인하세요.");
  return {
    ...scenario,
    url: scenario.url ? new URL(routePath(scenario.url), base).href : base.href,
    steps: scenario.steps.map(step => step.action === "goto" ? { ...step, target: routePath(step.target) } : step),
  };
};

// 저장된 id: UUID를 우선 사용한다. 이전 문서에는 source + 블록 순서로 임시 ID를 만든다.
export const parseMarkdown = (markdown: string, source?: string): Scenario[] =>
  splitScenarioBlocks(markdown)
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
          .trim() || "";
      const endpointId =
        lines
          .find((line) => line.startsWith("endpoint:"))
          ?.slice(9)
          .trim() || undefined;
      const tag =
        lines
          .find((line) => line.startsWith("tag:"))
          ?.slice(4)
          .trim() || undefined;
      const steps = lines
        .filter((line) => /^(Given|When|Then|And|But|If)\s+/i.test(line))
        .map((line, stepIndex): Step => {
          const databaseId = line.match(/<!-- step:([a-f0-9-]{36}) -->/)?.[1];
          const rawText = line.replace(/\s*<!-- step:[a-f0-9-]{36} -->/, "").replace(/^(Given|When|Then|And|But|If)\s+/i, "");
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
              databaseId,
              action: "manualResult",
              target: unquoteMarkdownValue(manualResult[1]),
              prompt: manualResult[2],
              waitSeconds,
              condition,
              connected: true,
            };
          if (manualControl)
            return {
              id: String(stepIndex + 1),
              databaseId,
              action: "manualControl",
              target: unquoteMarkdownValue(manualControl[1]),
              prompt: manualControl[2],
              waitSeconds,
              condition,
              connected: true,
            };
          if (/보인다|포함된다|확인된다|표시된다|결과\s*확인/.test(text))
            return {
              id: String(stepIndex + 1),
              databaseId,
              action: "expectText",
              target: unquoteMarkdownValue(result),
              condition,
              waitSeconds,
              connected: false,
            };
          if (manual)
            return {
              id: String(stepIndex + 1),
              databaseId,
              action: "manualFill",
              target: unquoteMarkdownValue(manual[1]),
              prompt: manual[2],
              waitSeconds,
              required: true,
              condition,
              connected: true,
            };
          if (fileUpload)
            return {
              id: String(stepIndex + 1),
              databaseId,
              action: "fileUpload",
              target: unquoteMarkdownValue(
                fileUpload[1].replace(/(에서|에)$/, "").trim(),
              ),
              value: fileUpload[2],
              waitSeconds,
              condition,
              connected: true,
            };
          if (fill)
            return {
              id: String(stepIndex + 1),
              databaseId,
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
              databaseId,
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
              databaseId,
              action: "goto",
              waitSeconds,
              target:
                unquoteMarkdownValue(
                  text.replace(/\s*(페이지로?\s*이동|접속|열기).*/, "").trim(),
                ) || "/",
              condition,
              connected: true,
            };
          return {
            id: String(stepIndex + 1),
              databaseId,
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
      const databaseId = lines.find(line => line.startsWith("id:"))?.slice(3).trim();
      const code = lines.find(line => line.startsWith("code:"))?.slice(5).trim();
      const id = databaseId || (source ? `${source}::scenario-${index}` : `scenario-${index}`);
      return { id, code, sortOrder: index, title, endpointId, url, tag, steps };
    });

export type ScenarioRunResult = {
  scenario: Scenario;
  status: "passed" | "failed" | "cancelled";
  failedStepIndex?: number;
  message?: string;
  // 리포트용 부가 정보. 이전 기록이나 예외로 끝난 실행에는 없을 수 있다.
  startedAt?: string;
  elapsedSeconds?: number;
  log?: string[];
  stepResults?: RunStepResult[];
};
export type RunRecord = {
  id: string;
  scenarios: Scenario[];
  status: "passed" | "failed" | "cancelled";
  passed: number;
  failed: number;
  ranAt: string;
  startedAt?: string;
  results: ScenarioRunResult[];
  trigger?: "editor" | "picker" | "rerun" | "single";
  sessionKept?: boolean;
  viewport?: { width: number; height: number };
  browser?: string;
};

export type RunStepResult = { stepNo: number; status: "passed" | "failed" | "skipped" | "not_run"; elapsedMs: number; errorMessage?: string; manualVerdict?: "passed" | "failed"; manualReason?: string };
