import type { ApiScenarioResult } from "../../../../app/api-testing/shared/workspace";
import type { SuiteReport } from "../../../../app/api-testing/shared/suite-report";

export type SuiteLastRun = {
  suiteUpdatedAt: string;
  report: SuiteReport;
  blocked: Record<number, string[]>;
  /** Raw checks stay in renderer memory only; reports do not include actual response values. */
  results: Record<number, ApiScenarioResult>;
};

const memory = new Map<string, SuiteLastRun>();
const keyFor = (project: string, environment: string, suite: string) => JSON.stringify([project, environment, suite]);

export function readLastSuiteRun(project: string, environment: string, suite: string, suiteUpdatedAt: string): SuiteLastRun | null {
  const key = keyFor(project, environment, suite);
  const value = memory.get(key);
  if (!value || value.suiteUpdatedAt !== suiteUpdatedAt) return null;
  return structuredClone(value);
}

export function writeLastSuiteRun(project: string, environment: string, suite: string, value: SuiteLastRun): void {
  memory.set(keyFor(project, environment, suite), structuredClone(value));
}
