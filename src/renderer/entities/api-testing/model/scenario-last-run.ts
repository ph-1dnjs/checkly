import type { ApiScenarioPreview, ApiScenarioResult } from "../../../../app/api-testing/shared/workspace";

/** `source: "mcp"`: an external AI ran it over MCP; the trace is shown here because the AI never receives it. */
export type ScenarioLastRun = { result: ApiScenarioResult; preview: ApiScenarioPreview; bindings: Record<string, string>; /** Absent for runs remembered before it was recorded. */ startedAt?: string; completedAt: string; source?: "mcp" };
const memory = new Map<string, ScenarioLastRun>();
const listeners = new Set<(key: string) => void>();
const keyFor = (project: string, environment: string, scenario: string) => `checkly:last-run:${JSON.stringify([project, environment, scenario])}`;

export function readLastRun(project: string, environment: string, scenario: string): ScenarioLastRun | null {
  return memory.get(keyFor(project, environment, scenario)) ?? null;
}

export function writeLastRun(project: string, environment: string, scenario: string, value: ScenarioLastRun): void {
  // Match Swagger's live response: keep the raw trace only in this renderer session.
  const key = keyFor(project, environment, scenario);
  memory.set(key, structuredClone(value));
  for (const listener of listeners) listener(key);
}

/** Called when another source (an MCP run) records a run for this scenario while it is open. */
export function onLastRunWritten(project: string, environment: string, scenario: string, listener: () => void): () => void {
  const wanted = keyFor(project, environment, scenario);
  const handler = (key: string) => { if (key === wanted) listener(); };
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

// MCP runs happen in the main process whichever screen is open, so record them from module load.
if (typeof window !== "undefined") window.electronAPI?.apiTesting?.onMcpRun?.(({ projectId, environmentId, scenarioId, result, preview, bindings, startedAt, completedAt }) =>
  writeLastRun(projectId, environmentId, scenarioId, { result, preview, bindings, startedAt, completedAt, source: "mcp" }));
