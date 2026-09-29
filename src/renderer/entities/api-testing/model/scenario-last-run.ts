import type { ApiScenarioPreview, ApiScenarioResult } from "../../../../app/api-testing/shared/workspace";

export type ScenarioLastRun = { result: ApiScenarioResult; preview: ApiScenarioPreview; bindings: Record<string, string>; completedAt: string };
const memory = new Map<string, ScenarioLastRun>();
const keyFor = (project: string, environment: string, scenario: string) => `checkly:last-run:${JSON.stringify([project, environment, scenario])}`;

export function readLastRun(project: string, environment: string, scenario: string): ScenarioLastRun | null {
  return memory.get(keyFor(project, environment, scenario)) ?? null;
}

export function writeLastRun(project: string, environment: string, scenario: string, value: ScenarioLastRun): void {
  // Match Swagger's live response: keep the raw trace only in this renderer session.
  memory.set(keyFor(project, environment, scenario), structuredClone(value));
}
