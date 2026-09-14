import { scenarioStepLabel, type Scenario } from "../../../app/api-testing/shared/scenario";

// Mermaid syntax must never be taken from API descriptions or user labels.
const label = (value: string) => value.slice(0, 160).replace(/[^\p{L}\p{N} _./-]/gu, char => `#${char.codePointAt(0)};`).replace(/[\r\n]/g, " ");
export function scenarioFlow(scenario: Scenario) {
  const lines = ["flowchart TD"];
  const writers = new Map<string, { index: number; pointer: string }>();
  const indexes = new Map(scenario.steps.map((step, index) => [step.id, index]));
  const valueBindings = new Map(scenario.valueBindings.map(binding => [binding.name, binding]));
  scenario.steps.forEach((step, index) => {
    const api = "operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}`;
    lines.push(`s${index}["${label(`${index + 1}. ${api}${step.name ? ` · ${scenarioStepLabel(step)}` : ""}`)}"]`);
    if (index) lines.push(`s${index - 1} --> s${index}`);
    const used = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === "string") for (const match of value.matchAll(/\{\{(vars\.[A-Za-z][A-Za-z0-9_]*)\}\}/g)) used.add(match[1]);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(step.request);
    for (const target of used) {
      const binding = valueBindings.get(target.slice(5));
      if (binding) {
        const sourceIndex = indexes.get(binding.step);
        if (sourceIndex !== undefined) lines.push(`s${sourceIndex} -. "${label(`${binding.source} · ${binding.area === "header" ? binding.header : binding.pointer || "전체 값"}`)}" .-> s${index}`);
      } else {
        const source = writers.get(target);
        if (source) lines.push(`s${source.index} -. "${label(source.pointer || "전체 응답")}" .-> s${index}`);
      }
    }
    for (const extract of step.extract) if (extract.target.startsWith("vars.")) writers.set(extract.target, { index, pointer: extract.pointer ?? extract.header ?? "응답" });
  });
  return lines.join("\n");
}
