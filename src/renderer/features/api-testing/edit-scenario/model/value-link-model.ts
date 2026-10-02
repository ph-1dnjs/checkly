import type { Json, Scenario } from "../../../../../app/api-testing/shared/scenario";
import type { RequestArea } from "./scenario-builder-model";

// `dynamic`: an input, global or linked value — the only request values worth comparing a response to.
export type RequestValueOption = { pointer: string; type: string; dynamic?: boolean; label?: string };

/** JSON Pointer options for every node of a value (arrays show their first item); leaves get `leaf` fields. */
function jsonValueOptions(value: Json, leaf: (current: Json) => Partial<RequestValueOption> = () => ({})): RequestValueOption[] {
  const result: RequestValueOption[] = [];
  const visit = (current: Json, pointer: string, depth: number) => {
    if (depth > 12 || result.length >= 500) return;
    if (current === null || typeof current !== "object") {
      result.push({ pointer, type: current === null ? "null" : typeof current, ...leaf(current) });
      return;
    }
    if (Array.isArray(current)) {
      result.push({ pointer, type: "array" });
      if (current.length) visit(current[0], `${pointer}/0`, depth + 1);
      return;
    }
    result.push({ pointer, type: "object" });
    Object.entries(current).forEach(([key, item]) => visit(item, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value, "", 0);
  return result;
}

/** The values one request area holds, as JSON Pointer options (arrays show their first item). */
export function requestValueFields(request: Scenario["steps"][number]["request"], area: RequestArea, inputNames: Set<string> = new Set()): RequestValueOption[] {
  const value = request[area];
  if (value === undefined) return [];
  return jsonValueOptions(value as Json, current => ({ label: requestValueText(current, inputNames), dynamic: typeof current === "string" && /\{\{(inputs|globals|vars)\./.test(current) }));
}

/** The value at a JSON Pointer, or undefined when the path is not there. */
export function valueAtPointer(value: Json | undefined, pointer: string): Json | undefined {
  let current: Json | undefined = value;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current) ? current[Number(key)] : current[key];
  }
  return current;
}

/** A value from the last run, short enough for one line of the picker. */
export function runValueText(value: Json): string {
  const text = JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/**
 * Response fields to pick from, with the last run's values on the leaves of the status it returned.
 * Without a response schema the last run's body itself gives the fields.
 */
export function responseValueOptions<T extends { pointer: string; type: string; status?: string }>(specFields: T[], run?: { httpStatus?: number; body?: Json }): Array<T | (RequestValueOption & { status?: string })> {
  const status = run?.httpStatus === undefined ? undefined : String(run.httpStatus);
  if (!run || run.body === undefined || !status) return specFields;
  if (!specFields.length) return jsonValueOptions(run.body, current => ({ label: runValueText(current) })).map(option => ({ ...option, status }));
  return specFields.map(field => {
    if (field.status !== status || field.type === "object" || field.type === "array") return field;
    const value = valueAtPointer(run.body, field.pointer);
    return value === undefined || (value !== null && typeof value === "object") ? field : { ...field, label: runValueText(value) };
  });
}

/** A request value as the editor shows it: the set value, or what a reference stands for. */
export function requestValueText(value: Json, inputNames: Set<string>): string {
  if (typeof value !== "string") return JSON.stringify(value);
  const reference = /^\{\{(inputs|globals|vars)\.([^}]+)\}\}$/.exec(value);
  if (!reference) return JSON.stringify(value);
  // Runtime inputs are stored as vars too; the step's inputs tell them apart from links.
  return reference[1] === "inputs" || inputNames.has(reference[2]) ? "실행 중 입력" : reference[1] === "globals" ? `전역변수 ${reference[2]}` : "값 연결";
}
