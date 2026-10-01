import { type Scenario, type Json, type ScenarioInput } from "../../../../../app/api-testing/shared/scenario";
import { type RequestArea } from "./scenario-builder-model";

export type RequestField = { name: string; area: RequestArea; type: string; required: boolean; description?: string; example?: Json };
export type VerificationOperator = "exists" | "equals" | "contains";
export type FieldState = { kind: "user-input" | "global" | "scenario" | "cookie"; label: string; detail?: string };

export function suggestedInputName(field: RequestField, index: number): string {
  const name = field.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  return /^[A-Za-z]/.test(name) ? name : `input${index + 1}`;
}

export function inputTypeForField(type: string): ScenarioInput["type"] {
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

export function isStructuredRequestField(field: RequestField): boolean {
  return field.type === "object" || field.type === "array";
}

export function requestFieldValueMatches(value: Json, type: string): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return true;
}

export function templateVariable(value: unknown, namespace: "vars" | "globals"): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(new RegExp(`\\{\\{${namespace}\\.([A-Za-z][A-Za-z0-9_]*)\\}\\}`));
  return match?.[1];
}

export function variableReferenceInValue(value: unknown, variable: string): boolean {
  if (typeof value === "string") return value.includes(`{{vars.${variable}}}`);
  if (Array.isArray(value)) return value.some(item => variableReferenceInValue(item, variable));
  if (value && typeof value === "object") return Object.values(value).some(item => variableReferenceInValue(item, variable));
  return false;
}

export function sourceStepIndex(scenario: Scenario, id: string): number {
  return scenario.steps.findIndex(step => step.id === id);
}

export function fieldState(scenario: Scenario, index: number, field: RequestField, current: Json | undefined, userInput?: ScenarioInput): FieldState | undefined {
  if (userInput) return { kind: "user-input", label: "실행 중 입력", detail: userInput.name };
  const global = templateVariable(current, "globals");
  if (global) return { kind: "global", label: "전역변수", detail: global };
  const variable = templateVariable(current, "vars");
  if (variable) {
    const binding = scenario.valueBindings.find(value => value.name === variable);
    if (binding) {
      const from = sourceStepIndex(scenario, binding.step);
      const source = binding.source === "response" ? `응답 ${binding.area === "header" ? binding.header ?? "헤더" : binding.pointer || "전체 응답"}` : `요청 ${binding.area} ${binding.pointer || "전체 값"}`;
      return { kind: "scenario", label: "값 연결", detail: `${from >= 0 ? `${from + 1}단계 ` : ""}${source}` };
    }
    return { kind: "scenario", label: "값 연결", detail: "출처 설정 필요" };
  }
  if (field.area === "cookies" && current === undefined) return { kind: "cookie", label: "자동 쿠키", detail: "앞선 응답의 Set-Cookie" };
  return undefined;
}

export function jsonText(value: Json | undefined): string {
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function requestToken(value: Json | undefined, field: RequestField): string {
  if (value !== undefined) return JSON.stringify(value) ?? "null";
  if (field.example !== undefined) return JSON.stringify(field.example) ?? "null";
  if (field.type === "string") return '"string"';
  if (field.type === "boolean") return "false";
  if (field.type === "number" || field.type === "integer") return "0";
  if (field.type === "object") return "{}";
  if (field.type === "array") return "[]";
  return "null";
}

// Check wording lives in the shared scenario module so reports use the same words.
export { verificationOperatorLabels, verificationSourceLabels, parseExpectedValue, expectedValueText } from "../../../../../app/api-testing/shared/scenario";
