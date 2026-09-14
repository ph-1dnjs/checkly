import { parseDocument } from "yaml";
import { z } from "zod";

const value = z.json();
const pointer = z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/);
export const scenarioInputSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  label: z.string().min(1).max(200).optional(),
  type: z.enum(["string", "number", "boolean", "object", "array"]).default("string"),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(true),
}).strict();
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;
export type ScenarioInputRequest = ScenarioInput & {
  runId: string;
  index: number;
  totalSteps: number;
  stepId: string;
};

export function isProvidedScenarioInput(value: Json | undefined): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");
}

export function scenarioInputType(value: Json | undefined): string {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

export function matchesScenarioInputType(value: Json | undefined, type: ScenarioInput["type"]): boolean {
  return scenarioInputType(value) === type;
}

const expectation = z.object({
  source: z.enum(["status", "body", "header"]),
  pointer: pointer.optional(),
  header: z.string().optional(),
  operator: z.enum(["equals", "exists", "contains"]),
  value: value.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.source === "body" && v.pointer === undefined)
    ctx.addIssue({ code: "custom", message: "body 검증에는 pointer가 필요합니다" });
  if (v.source === "header" && !v.header)
    ctx.addIssue({ code: "custom", message: "header 검증에는 header가 필요합니다" });
  if (v.operator !== "exists" && v.value === undefined)
    ctx.addIssue({ code: "custom", message: "검증할 value가 필요합니다" });
});
const extraction = z.object({
  source: z.enum(["body", "header"]),
  pointer: pointer.optional(), header: z.string().optional(),
  target: z.string().regex(/^(vars|globals)\.[A-Za-z][A-Za-z0-9_]*$/),
  sensitive: z.boolean().default(false),
}).strict().superRefine((v, ctx) => {
  if (v.source === "body" ? v.pointer === undefined : !v.header)
    ctx.addIssue({ code: "custom", message: "추출할 pointer 또는 header가 필요합니다" });
});
const valueBinding = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  step: z.string().min(1),
  source: z.enum(["request", "response"]),
  area: z.enum(["pathParams", "query", "headers", "cookies", "body", "header"]),
  pointer: pointer.optional(),
  header: z.string().min(1).optional(),
  sensitive: z.boolean().default(false),
}).strict().superRefine((v, ctx) => {
  if (v.source === "request") {
    if (v.area === "header") ctx.addIssue({ code: "custom", path: ["area"], message: "요청 출처는 요청 영역을 사용하세요" });
    if (v.pointer === undefined) ctx.addIssue({ code: "custom", path: ["pointer"], message: "요청 출처에는 pointer가 필요합니다" });
    if (v.header !== undefined) ctx.addIssue({ code: "custom", path: ["header"], message: "요청 출처에는 header를 사용할 수 없습니다" });
  } else {
    if (v.area !== "body" && v.area !== "header") ctx.addIssue({ code: "custom", path: ["area"], message: "응답 출처는 body 또는 header를 사용하세요" });
    if (v.area === "body" && v.pointer === undefined) ctx.addIssue({ code: "custom", path: ["pointer"], message: "응답 본문에는 pointer가 필요합니다" });
    if (v.area === "header" && !v.header) ctx.addIssue({ code: "custom", path: ["header"], message: "응답 헤더에는 header가 필요합니다" });
    if (v.area === "body" && v.header !== undefined) ctx.addIssue({ code: "custom", path: ["header"], message: "응답 본문에는 header를 사용할 수 없습니다" });
    if (v.area === "header" && v.pointer !== undefined) ctx.addIssue({ code: "custom", path: ["pointer"], message: "응답 헤더에는 pointer를 사용할 수 없습니다" });
  }
});
export const scenarioSchema = z.object({
  version: z.literal(1), id: z.string().min(1), name: z.string().min(1),
  description: z.string().optional(), onFailure: z.enum(["stop", "continue"]).default("stop"),
  environments: z.array(z.string().min(1)).min(1).optional(),
  inputs: z.record(z.string(), z.object({
    type: z.enum(["string", "number", "boolean", "object", "array"]),
    required: z.boolean().default(false), sensitive: z.boolean().default(false),
  }).strict()).default({}),
  vars: z.record(z.string(), value).default({}),
  steps: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1).optional(), description: z.string().optional(),
    server: z.string().min(1),
    api: z.union([
      z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]), path: z.string().startsWith("/") }).strict(),
      z.object({ operationId: z.string().min(1) }).strict(),
    ]),
    input: scenarioInputSchema.optional(),
    request: z.object({
      pathParams: z.record(z.string(), value).optional(),
      query: z.record(z.string(), value).optional(),
      headers: z.record(z.string(), z.string()).optional(), body: value.optional(),
      cookies: z.record(z.string(), value).optional(),
    }).strict().default({}),
    expect: z.array(expectation).optional(), extract: z.array(extraction).default([]),
  }).strict()).min(1),
  valueBindings: z.array(valueBinding).default([]),
}).strict().superRefine((s, ctx) => {
  const ids = new Set<string>();
  const bindingNames = new Set<string>();
  s.valueBindings.forEach((binding, index) => {
    if (["constructor", "prototype"].includes(binding.name))
      ctx.addIssue({ code: "custom", path: ["valueBindings", index, "name"], message: "예약된 변수 이름" });
    if (bindingNames.has(binding.name))
      ctx.addIssue({ code: "custom", path: ["valueBindings", index, "name"], message: "중복 값 변수 이름" });
    bindingNames.add(binding.name);
  });
  s.steps.forEach((step, index) => {
    if (ids.has(step.id)) ctx.addIssue({ code: "custom", path: ["steps", index, "id"], message: "중복 단계 ID" });
    ids.add(step.id);
    const targets = step.extract.map(e => e.target);
    if (new Set(targets).size !== targets.length)
      ctx.addIssue({ code: "custom", path: ["steps", index, "extract"], message: "중복 저장 대상" });
  });
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type ValueBinding = Scenario["valueBindings"][number];
export type Json = z.infer<typeof value>;

export function scenarioStepLabel(step: { id: string; name?: string }): string {
  return step.name?.trim() || step.id;
}

/**
 * OpenAPI owns endpoint metadata. Keep only scenario-owned step data when a
 * visual editor serializes a scenario, while still accepting the legacy
 * per-step description field when older YAML is imported.
 */
export function normalizeScenarioForStorage(scenario: Scenario): Scenario {
  return {
    ...scenario,
    steps: scenario.steps.map(({ description: _description, ...step }) => step),
  };
}

export function parseScenario(source: string): Scenario {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join("\n"));
  return scenarioSchema.parse(doc.toJS({ maxAliasCount: 50 }));
}
