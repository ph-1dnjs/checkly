import { parseDocument, stringify } from "yaml";
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
  source: z.enum(["body", "header"]).default("body"),
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
  auth: z.string().regex(/^globals\.[A-Za-z][A-Za-z0-9_]*$/).optional(),
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
    auth: z.union([z.literal("none"), z.string().regex(/^globals\.[A-Za-z][A-Za-z0-9_]*$/)]).optional(),
    input: scenarioInputSchema.optional(),
    inputs: z.array(scenarioInputSchema).optional(),
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
    const inputNames = (step.input ? [step.input] : []).concat(step.inputs ?? []).map(input => input.name);
    if (new Set(inputNames).size !== inputNames.length)
      ctx.addIssue({ code: "custom", path: ["steps", index, "inputs"], message: "중복 실행 입력 이름" });
  });
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type ValueBinding = Scenario["valueBindings"][number];
export type Json = z.infer<typeof value>;

/** Supports the legacy single input while allowing multiple inputs per step. */
export function scenarioStepInputs(step: Scenario["steps"][number]): ScenarioInput[] {
  return [...(step.input ? [step.input] : []), ...(step.inputs ?? [])];
}

export function scenarioStepLabel(step: { id: string; name?: string }): string {
  return step.name?.trim() || step.id;
}

export function bindingUseLocations(scenario: Scenario, name: string): string[] {
  const locations: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string" && value.includes(`{{vars.${name}}}`)) locations.push(path);
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, `${path}.${key}`));
  };
  scenario.steps.forEach((step, index) => {
    visit(step.request, `${index + 1}단계 요청`);
    visit(step.expect, `${index + 1}단계 검증`);
  });
  // Preserve indirect uses in initial variables as well.
  visit(scenario.vars, "초기 변수");
  return locations;
}

export function pruneUnusedBrokenBindings(scenario: Scenario): Scenario {
  const ids = new Set(scenario.steps.map(step => step.id));
  return { ...scenario, valueBindings: scenario.valueBindings.filter(binding => ids.has(binding.step) || bindingUseLocations(scenario, binding.name).length > 0) };
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
  return expandStepReferences(stepInputReferencesToVars(scenarioSchema.parse(expandScenario(doc.toJS({ maxAliasCount: 50 })))));
}

/** Names of run-time step inputs that are not also scenario-level inputs. */
function stepInputNames(scenario: Scenario): Set<string> {
  return new Set(scenario.steps.flatMap(step => scenarioStepInputs(step).map(input => input.name)).filter(name => !Object.hasOwn(scenario.inputs, name)));
}

/** Authoring writes {{inputs.code}} for a step input; the runner keeps step input values in vars. */
function stepInputReferencesToVars(scenario: Scenario): Scenario {
  const names = stepInputNames(scenario);
  if (!names.size) return scenario;
  const convert = (text: string) => text.replace(/\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}/g, (match, name) => names.has(name) ? `{{vars.${name}}}` : match);
  return { ...scenario, steps: scenario.steps.map(step => ({ ...step, request: mapStrings(step.request, convert), ...(step.expect ? { expect: mapStrings(step.expect, convert) } : {}) })) };
}

/** Variable name for a linked value: the last pointer segment or header name, made identifier-safe. */
export function linkVariableName(source: string): string {
  const last = source.split("/").pop()!.replace(/~1/g, "/").replace(/~0/g, "~");
  const name = last.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!name || /^\d+$/.test(name)) return "linkedValue";
  return /^[A-Za-z]/.test(name) ? name : `v_${name}`;
}

function mapStrings(value: any, change: (text: string) => string): any {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, change));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, change)]));
  return value;
}

function expandStepReferences(scenario: Scenario): Scenario {
  const bindings = [...scenario.valueBindings];
  const occupied = new Set([...Object.keys(scenario.vars), ...bindings.map(b => b.name), ...scenario.steps.flatMap(s => s.extract.map(e => e.target.slice(5))), ...scenario.steps.flatMap(s => scenarioStepInputs(s).map(i => i.name))]);
  const steps = scenario.steps.map((step, index) => {
    const convert = (text: string) => text.replace(/\{\{steps\.(\d+)\.(request|response)\.(body|header|headers|query|cookies|pathParams)\.([^{}]*)\}\}/g, (_, number, source, area, path) => {
      const from = Number(number) - 1;
      if (from < 0 || from >= index) throw new Error(`${index + 1}단계 연결은 앞선 단계만 참조할 수 있습니다 (${number}단계)`);
      let binding = bindings.find(b => b.step === scenario.steps[from].id && b.source === source && b.area === area && (area === "header" ? b.header === path : b.pointer === path));
      if (!binding) {
        const base = linkVariableName(path);
        let name = base;
        for (let suffix = 2; occupied.has(name); suffix++) name = `${base}_${suffix}`;
        occupied.add(name);
        binding = { name, step: scenario.steps[from].id, source, area, ...(area === "header" ? { header: path } : { pointer: path }), sensitive: true };
        bindings.push(binding!);
      }
      return `{{vars.${binding!.name}}}`;
    });
    return { ...step, request: mapStrings(step.request, convert), ...(step.expect ? { expect: mapStrings(step.expect, convert) } : {}) };
  });
  return scenarioSchema.parse({ ...scenario, steps, valueBindings: bindings });
}


function expandScenario(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const data = { ...raw } as Record<string, any>;
  const server = data.server;
  delete data.server;
  data.version ??= 1;
  // Deterministic across preview/save; identity is persisted by the editor on save.
  data.id ??= `scenario-${encodeURIComponent(String(data.name ?? "untitled"))}`;
  if (!Array.isArray(data.steps)) return data;
  const used = new Set(data.steps.map((s: any) => s?.id).filter(Boolean));
  data.steps = data.steps.map((rawStep: any) => {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) return rawStep;
    const step = { ...rawStep };
    if (typeof step.api === "string") {
      const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/i.exec(step.api.trim());
      if (!match) throw new Error("api는 'POST /bos/login' 형식으로 작성하세요");
      step.api = { method: match[1].toUpperCase(), path: match[2] };
    }
    step.server ??= server;
    if (step.id === undefined) {
      const base = `${step.api?.method ?? "api"}_${step.api?.path ?? step.api?.operationId ?? "step"}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      let id = base;
      for (let suffix = 2; used.has(id); suffix++) id = `${base}_${suffix}`;
      used.add(id); step.id = id;
    }
    for (const key of ["body", "query", "headers", "cookies", "pathParams"]) {
      if (!Object.hasOwn(step, key)) continue;
      if (step.request && Object.hasOwn(step.request, key)) throw new Error(`${key}와 request.${key}를 동시에 지정할 수 없습니다`);
      step.request = { ...step.request, [key]: step[key] };
      delete step[key];
    }
    if (step.extract && typeof step.extract === "object" && !Array.isArray(step.extract)) {
      step.extract = Object.entries(step.extract).map(([name, pointer]) => ({ source: "body", pointer, target: `vars.${name}` }));
    }
    return step;
  });
  return data;
}

/** Compact authoring format. Keep identities when saving an existing editor document. */
/**
 * The one authoring format used by people, the AI and saved files:
 * earlier-step values as {{steps.N.…}}, step inputs as {{inputs.name}}, no step ids.
 * preserveIds keeps the scenario id (saved files); internal link names never appear.
 */
export function stringifyScenario(scenario: Scenario, preserveIds = false, resolveApi?: (step: Scenario["steps"][number]) => { method: string; path: string } | undefined, serverNames: Record<string, string> = {}): string {
  const normalized = normalizeScenarioForStorage(pruneUnusedBrokenBindings(scenario));
  const replacements = new Map<string, string>(normalized.valueBindings.flatMap(binding => {
    const index = normalized.steps.findIndex(step => step.id === binding.step);
    return index < 0 ? [] : [[`{{vars.${binding.name}}}`, `{{steps.${index + 1}.${binding.source}.${binding.area}.${binding.header ?? binding.pointer ?? ""}}}`] as const];
  }));
  for (const name of stepInputNames(normalized)) replacements.set(`{{vars.${name}}}`, `{{inputs.${name}}}`);
  normalized.steps = mapStrings(normalized.steps, text => {
    for (const [from, to] of replacements) text = text.split(from).join(to);
    return text;
  });
  normalized.valueBindings = normalized.valueBindings.filter(binding => !replacements.has(`{{vars.${binding.name}}}`));
  const { version: _version, id, steps, valueBindings, inputs, vars, onFailure, auth, ...rest } = normalized;
  const commonServer = steps.every(step => step.server === steps[0].server) ? steps[0].server : undefined;
  // Step ids are only written when an unconvertible legacy binding still points at them.
  const referenced = new Set(valueBindings.map(binding => binding.step));
  const extractFor = (extract: Scenario["steps"][number]["extract"]) => extract.every(e => e.source === "body" && e.target.startsWith("vars.") && !e.sensitive)
    ? Object.fromEntries(extract.map(e => [e.target.slice(5), e.pointer]))
    : extract.map(({ source, sensitive, ...e }) => ({ ...(source !== "body" ? { source } : {}), ...e, ...(sensitive ? { sensitive } : {}) }));
  return stringify({
    ...(preserveIds ? { id } : {}), ...rest,
    ...(commonServer ? { server: serverNames[commonServer] ?? commonServer } : {}),
    ...(auth ? { auth } : {}),
    ...(onFailure !== "stop" ? { onFailure } : {}),
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(Object.keys(vars).length ? { vars } : {}),
    steps: steps.map(original => {
      const { id: stepId, name, server, api, auth: stepAuth, input, inputs: stepInputs, request, expect, extract, ...step } = original;
      const resolved = "method" in api ? api : resolveApi?.(original);
      const allInputs = scenarioStepInputs({ input, inputs: stepInputs } as Scenario["steps"][number]);
      return {
        ...(referenced.has(stepId) ? { id: stepId } : {}),
        ...(name ? { name } : {}),
        ...(!commonServer ? { server: serverNames[server] ?? server } : {}),
        api: resolved ? `${resolved.method.toUpperCase()} ${resolved.path}` : api,
        ...(stepAuth ? { auth: stepAuth } : {}),
        // Defaults (string, required, sensitive) are omitted.
        ...(allInputs.length ? { inputs: allInputs.map(({ type, required, sensitive, ...input }) => ({ ...input, ...(type !== "string" ? { type } : {}), ...(!required ? { required } : {}), ...(!sensitive ? { sensitive } : {}) })) } : {}),
        ...request,
        ...(expect?.length ? { expect } : {}),
        ...(extract.length ? { extract: extractFor(extract) } : {}),
        ...step,
      };
    }),
    ...(valueBindings.length ? { valueBindings } : {}),
  });
}
