import type { Json, Scenario } from "../../../../../app/api-testing/shared/scenario";
import type { RequestArea } from "./scenario-builder-model";

// `dynamic`: an input, global or linked value — the only request values worth comparing a response to.
export type RequestValueOption = { pointer: string; type: string; dynamic?: boolean; label?: string };

/** The values one request area holds, as JSON Pointer options (arrays show their first item). */
export function requestValueFields(request: Scenario["steps"][number]["request"], area: RequestArea, inputNames: Set<string> = new Set()): RequestValueOption[] {
  const value = request[area];
  if (value === undefined) return [];
  const result: RequestValueOption[] = [];
  const visit = (current: Json, pointer: string, depth: number) => {
    if (depth > 12 || result.length >= 500) return;
    if (current === null || typeof current !== "object") {
      result.push({ pointer, type: current === null ? "null" : typeof current, label: requestValueText(current, inputNames), dynamic: typeof current === "string" && /\{\{(inputs|globals|vars)\./.test(current) });
      return;
    }
    if (Array.isArray(current)) {
      result.push({ pointer, type: "array" });
      if (current.length) visit(current[0], `${pointer}/0`, depth + 1);
      return;
    }
    const entries = Object.entries(current);
    result.push({ pointer, type: "object" });
    entries.forEach(([key, item]) => visit(item, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value as Json, "", 0);
  return result;
}

/** A request value as the editor shows it: the set value, or what a reference stands for. */
export function requestValueText(value: Json, inputNames: Set<string>): string {
  if (typeof value !== "string") return JSON.stringify(value);
  const reference = /^\{\{(inputs|globals|vars)\.([^}]+)\}\}$/.exec(value);
  if (!reference) return JSON.stringify(value);
  // Runtime inputs are stored as vars too; the step's inputs tell them apart from links.
  return reference[1] === "inputs" || inputNames.has(reference[2]) ? "실행 중 입력" : reference[1] === "globals" ? `전역변수 ${reference[2]}` : "값 연결";
}
