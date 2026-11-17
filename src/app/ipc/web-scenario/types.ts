import type { RunRecord } from "./scenario";
export type WebScenarioRecord = {
  id: string;
  title: string;
  markdown: string;
  positions: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};
export type WebScenarioInput = {
  id?: string;
  expectedUpdatedAt?: string;
  title: string;
  markdown: string;
  positions: string;
};
export type DashboardRun = {
  id: string; type: "web" | "api"; name: string; status: "passed" | "failed" | "blocked" | "cancelled";
  startedAt: string; endedAt: string; environmentId: string | null; passed?: number; failed?: number; total?: number;
};
export type WebScenarioBridge = {
  listRuns(): Promise<RunRecord[]>;
  listDashboardRuns(since: string, until: string): Promise<DashboardRun[]>;
  getRun(id: string): Promise<RunRecord | null>;
  saveRun(record: RunRecord): Promise<void>;
  list(): Promise<WebScenarioRecord[]>;
  save(input: WebScenarioInput): Promise<WebScenarioRecord>;
  remove(id: string, expectedUpdatedAt: string): Promise<void>;
};
