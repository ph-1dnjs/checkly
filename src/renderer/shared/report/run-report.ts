import { actionLabel } from "../model/action";
import {
  actionText,
  estimateDurationSeconds,
  type RunRecord,
  type ScenarioRunResult,
} from "../model/scenario";

// 시나리오 실행 기록(RunRecord)을 run-report.template.md 의 {{키}} 자리에 채워
// Markdown 리포트를 만든다. 템플릿은 인자로 받아 Vite(?raw) 없이도 테스트할 수 있게 한다.

type StepOutcome = "passed" | "failed" | "skipped";

const STEP_OUTCOME_LABEL: Record<StepOutcome, string> = {
  passed: "✅ 통과",
  failed: "❌ 실패",
  skipped: "⏭️ 미실행",
};

const RESULT_LABEL: Record<ScenarioRunResult["status"], string> = {
  passed: "✅ 통과",
  failed: "❌ 실패",
  cancelled: "⏹️ 취소",
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const formatReportDate = (value: Date): string =>
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;

const formatSeconds = (seconds: number): string =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)}분 ${pad2(seconds % 60)}초`
    : `${seconds}초`;

// 표 셀 안에서 줄바꿈과 `|` 가 표를 깨뜨리지 않도록 정리한다.
const cell = (value: string | undefined): string =>
  (value ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim() || "-";

// 실패한 시나리오는 실패 지점 이전 단계까지만 통과로, 이후 단계는 실행되지 않은 것으로 본다.
export const stepOutcomes = (result: ScenarioRunResult): StepOutcome[] => {
  const { steps } = result.scenario;
  if (result.status === "passed") return steps.map(() => "passed");
  if (result.status === "cancelled") return steps.map(() => "skipped");
  const failedAt = Math.min(
    Math.max(result.failedStepIndex ?? 0, 0),
    Math.max(steps.length - 1, 0),
  );
  return steps.map((_, index) =>
    index < failedAt ? "passed" : index === failedAt ? "failed" : "skipped",
  );
};

const resultSeconds = (result: ScenarioRunResult): number =>
  result.elapsedSeconds ?? estimateDurationSeconds(result.scenario);

const resultDuration = (result: ScenarioRunResult): string =>
  result.elapsedSeconds === undefined
    ? `${formatSeconds(estimateDurationSeconds(result.scenario))} (예상)`
    : formatSeconds(result.elapsedSeconds);

const failedStepNumber = (result: ScenarioRunResult): number =>
  stepOutcomes(result).indexOf("failed") + 1;

const scenarioTable = (results: ScenarioRunResult[]): string =>
  results.length
    ? [
        "| # | 시나리오 | 결과 | 단계 | 소요 | 태그 | URL |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...results.map((result, index) => {
          const outcomes = stepOutcomes(result);
          const passed = outcomes.filter((item) => item === "passed").length;
          return `| ${index + 1} | ${cell(result.scenario.title)} | ${RESULT_LABEL[result.status]} | ${passed}/${outcomes.length} | ${resultDuration(result)} | ${cell(result.scenario.tag)} | ${cell(result.scenario.url)} |`;
        }),
      ].join("\n")
    : "_실행된 시나리오가 없습니다._";

const failureSection = (results: ScenarioRunResult[]): string => {
  const failures = results.filter((result) => result.status === "failed");
  if (!failures.length) return "실패한 시나리오가 없습니다. 🎉";
  return failures
    .map((result) => {
      const number = failedStepNumber(result);
      const step = result.scenario.steps[number - 1];
      const previous = result.scenario.steps[number - 2];
      return [
        `### ❌ ${result.scenario.title}`,
        "",
        `- **실패 단계**: ${step ? `STEP ${number} · ${actionLabel[step.action]} — ${actionText(step)}` : "확인할 수 없음"}`,
        `- **직전 단계**: ${previous ? `STEP ${number - 1} · ${actionText(previous)}` : "없음 (첫 단계에서 실패)"}`,
        `- **오류 메시지**: ${result.message ? `\`${result.message.replace(/`/g, "'")}\`` : "기록된 메시지 없음"}`,
        `- **확인할 점**: 대상 요소(\`${step?.target ?? "-"}\`)가 화면에 있는지, 문구·선택자가 바뀌지 않았는지, 이전 단계 이후 로딩이 충분했는지 확인하세요.`,
      ].join("\n");
    })
    .join("\n\n");
};

const detailSection = (results: ScenarioRunResult[]): string =>
  results.length
    ? results
        .map((result, index) => {
          const outcomes = stepOutcomes(result);
          const steps = result.scenario.steps.length
            ? [
                "| STEP | 동작 | 내용 | 결과 |",
                "| --- | --- | --- | --- |",
                ...result.scenario.steps.map(
                  (step, stepIndex) =>
                    `| ${stepIndex + 1} | ${actionLabel[step.action]} | ${cell(actionText(step))} | ${STEP_OUTCOME_LABEL[outcomes[stepIndex]]} |`,
                ),
              ].join("\n")
            : "_단계가 없습니다._";
          const log = result.log?.length
            ? ["```text", ...result.log.map((line) => line.replace(/```/g, "'''")), "```"].join("\n")
            : "_기록된 로그가 없습니다._";
          return [
            `### 4.${index + 1} ${result.scenario.title}`,
            "",
            `- **결과**: ${RESULT_LABEL[result.status]}`,
            `- **URL**: ${result.scenario.url || "-"}`,
            ...(result.scenario.tag ? [`- **태그**: ${result.scenario.tag}`] : []),
            ...(result.startedAt
              ? [`- **시작**: ${formatReportDate(new Date(result.startedAt))}`]
              : []),
            `- **소요**: ${resultDuration(result)}`,
            "",
            steps,
            "",
            "**실행 로그**",
            "",
            log,
          ].join("\n");
        })
        .join("\n\n")
    : "_실행된 시나리오가 없습니다._";

const actionItems = (results: ScenarioRunResult[]): string => {
  const failures = results.filter((result) => result.status === "failed");
  if (!failures.length)
    return [
      "- [ ] 결과를 팀에 공유",
      "- [ ] 다음 회귀 테스트 일정 확인",
    ].join("\n");
  return [
    ...failures.map(
      (result) =>
        `- [ ] **${result.scenario.title}** STEP ${failedStepNumber(result)} 실패 원인 확인 및 이슈 등록`,
    ),
    "- [ ] 실패 시나리오 재실행으로 재현 여부 확인",
    "- [ ] 수정 후 전체 회귀 테스트 다시 실행",
  ].join("\n");
};

export const fillTemplate = (
  template: string,
  values: Record<string, string>,
): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );

export const buildRunReportMarkdown = (
  record: RunRecord,
  template: string,
  generatedAt: Date = new Date(),
): string => {
  const { results } = record;
  const outcomes = results.flatMap(stepOutcomes);
  const total = record.passed + record.failed;
  const finishedAt = new Date(record.ranAt);
  const startedAt = record.startedAt ? new Date(record.startedAt) : null;
  const durationSeconds = startedAt
    ? Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
    : results.reduce((sum, result) => sum + resultSeconds(result), 0);
  const title =
    record.scenarios.length > 1
      ? `전체 회귀 · ${record.scenarios.length}개 시나리오`
      : (record.scenarios[0]?.title ?? "시나리오 실행");

  return fillTemplate(template, {
    title,
    statusIcon: record.status === "passed" ? "✅" : "❌",
    statusLabel: record.status === "passed" ? "통과" : "실패",
    scenarioCount: String(results.length),
    passedCount: String(record.passed),
    failedCount: String(record.failed),
    stepTotal: String(outcomes.length),
    stepPassed: String(outcomes.filter((item) => item === "passed").length),
    stepFailed: String(outcomes.filter((item) => item === "failed").length),
    stepSkipped: String(outcomes.filter((item) => item === "skipped").length),
    passRate: `${total ? Math.round((record.passed / total) * 1000) / 10 : 0}%`,
    startedAt: startedAt ? formatReportDate(startedAt) : "-",
    finishedAt: formatReportDate(finishedAt),
    duration: formatSeconds(durationSeconds),
    generatedAt: formatReportDate(generatedAt),
    reportId: record.id,
    scenarioTable: scenarioTable(results),
    failureSection: failureSection(results),
    detailSection: detailSection(results),
    actionItems: actionItems(results),
  });
};

export const runReportFileName = (record: RunRecord): string => {
  const date = new Date(record.ranAt);
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  const name =
    record.scenarios.length > 1
      ? "전체_회귀"
      : (record.scenarios[0]?.title ?? "시나리오");
  return `checkly-report_${name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "시나리오"}_${stamp}.md`;
};
