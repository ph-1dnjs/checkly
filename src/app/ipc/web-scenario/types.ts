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
export type WebScenarioBridge = {
  listRuns(): Promise<RunRecord[]>;
  saveRun(record: RunRecord): Promise<void>;
  list(): Promise<WebScenarioRecord[]>;
  save(input: WebScenarioInput): Promise<WebScenarioRecord>;
  remove(id: string, expectedUpdatedAt: string): Promise<void>;
};
