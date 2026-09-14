import type { Action, Step } from "./scenario";

// 복제할 때 변경할 수 있는 값이다. 입력 계열은 value를, 확인 계열은 target을 사용한다.
export type EditableValueKind = "in" | "out";
export const EDITABLE_VALUE_KIND: Partial<Record<Action, EditableValueKind>> = {
  fill: "in",
  select: "in",
  fileUpload: "in",
  manualFill: "in",
  expectText: "out",
  manualResult: "out",
};

export const editableValueDefault = (step: Step, kind: EditableValueKind): string =>
  kind === "out" ? step.target : step.value ?? "";

export const applyEditableValue = (step: Step, kind: EditableValueKind, value: string): Step =>
  kind === "out" ? { ...step, target: value } : { ...step, value };

const uniqueLabel = (base: string, used: string[], separator = ""): string => {
  if (!used.includes(base)) return base;
  let n = 2;
  while (used.includes(`${base}${separator}${n}`)) n += 1;
  return `${base}${separator}${n}`;
};

export const uniqueScenarioTitle = (base: string, used: string[]): string =>
  uniqueLabel(base, used, " ");
