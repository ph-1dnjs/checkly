import { parseScenario, scenarioStepLabel, type Scenario } from "../../../app/api-testing/shared/scenario";
import type { ApiGlobal, SavedApiScenario } from "../../../app/api-testing/shared/workspace";

export type GlobalOption = { name: string; status: string; sources: string[] };

/** Definitions are metadata, never values and never implicit execution dependencies. */
export function globalOptions(current: Scenario, before: number, globals: ApiGlobal[], saved: SavedApiScenario[], environment: string): GlobalOption[] {
  const entries = new Map<string, { available: boolean; prior: boolean; sources: Set<string> }>();
  const entry = (name: string) => {
    if (!entries.has(name)) entries.set(name, { available: false, prior: false, sources: new Set() });
    return entries.get(name)!;
  };
  globals.forEach(g => { entry(g.name).available = true; });
  const scan = (scenario: Scenario, own: boolean) => {
    if (!own && scenario.environments && !scenario.environments.includes(environment)) return;
    scenario.steps.forEach((step, index) => {
      step.extract.forEach(extract => {
        if (!extract.target.startsWith("globals.")) return;
        const item = entry(extract.target.slice(8));
        item.sources.add(`${own ? "현재 시나리오" : scenario.name} · ${index + 1}. ${scenarioStepLabel(step)}`);
        if (own && index < before) item.prior = true;
      });
    });
  };
  scan(current, true);
  saved.forEach(s => {
    try { const parsed = parseScenario(s.source); if (parsed.id !== current.id) scan(parsed, false); } catch { /* Invalid drafts cannot declare variables. */ }
  });
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{\s*globals\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)) entry(match[1]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  current.steps.forEach(step => { visit(step.request); visit(step.expect); });
  return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({
    name, sources: [...item.sources],
    status: item.available ? "사용 가능" : item.prior ? "이전 단계에서 생성 예정" : item.sources.size ? "값 없음 · 선행 실행 필요" : "미등록",
  }));
}
