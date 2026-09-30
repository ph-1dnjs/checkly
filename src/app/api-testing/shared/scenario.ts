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

/** Authoring-format problem with a concrete fix; shown to the user as-is. */
export class ScenarioFormatError extends Error {}

const methodPath = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/;
const globalsRef = z.string().regex(/^globals\.[A-Za-z][A-Za-z0-9_]*$/, "globals.이름 형식으로 쓰세요");
const authoringExtraction = z.object({
  source: z.enum(["body", "header"]).default("body"),
  pointer: pointer.optional(), header: z.string().optional(),
  target: globalsRef,
  sensitive: z.boolean().default(false),
}).strict().superRefine((v, ctx) => {
  if (v.source === "body" ? v.pointer === undefined : !v.header)
    ctx.addIssue({ code: "custom", message: "추출할 pointer 또는 header가 필요합니다" });
});
const authoringStep = z.object({
  name: z.string().min(1).optional(),
  server: z.string().min(1).optional(),
  api: z.string().trim().regex(methodPath, "api는 'POST /bos/login' 형식으로 쓰세요"),
  auth: z.union([z.literal("none"), globalsRef]).optional(),
  inputs: z.array(scenarioInputSchema).optional(),
  pathParams: z.record(z.string(), value).optional(),
  query: z.record(z.string(), value).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  cookies: z.record(z.string(), value).optional(),
  body: value.optional(),
  expect: z.array(expectation).optional(),
  extract: z.array(authoringExtraction).optional(),
}).strict();
const authoringScenario = z.object({
  id: z.string().min(1).optional(), name: z.string().min(1), description: z.string().optional(),
  server: z.string().min(1).optional(), auth: globalsRef.optional(),
  onFailure: z.enum(["stop", "continue"]).optional(),
  environments: z.array(z.string().min(1)).min(1).optional(),
  steps: z.array(authoringStep).min(1),
}).strict();

// Keys of retired syntaxes, with the one way to write the same thing now.
const retiredScenarioKeys: Record<string, string> = {
  version: "version은 쓰지 않습니다. 지우세요",
  inputs: "실행 중 입력은 해당 단계의 inputs에 쓰고 {{inputs.이름}}으로 사용하세요",
  vars: "vars는 쓰지 않습니다. 값은 요청에 직접 쓰거나 앞 단계 값은 {{steps.N.response.body./경로}}로 쓰세요",
  valueBindings: "valueBindings는 쓰지 않습니다. 앞 단계 값은 {{steps.N.response.body./경로}}로 쓰세요",
};
const retiredStepKeys: Record<string, string> = {
  id: "단계 id는 쓰지 않습니다. 앞 단계 값은 단계 번호로 {{steps.N.…}}처럼 참조하세요",
  request: "request: 없이 body·query·pathParams·headers·cookies를 단계 바로 아래 쓰세요",
  input: "input 대신 inputs 목록을 쓰세요: inputs: [{ name: code, label: 인증번호 }]",
  description: "단계 설명은 쓰지 않습니다. API 설명은 명세에서 표시합니다",
};

function assertCurrentSyntax(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const data = raw as Record<string, unknown>;
  const problems = Object.keys(retiredScenarioKeys).filter(key => Object.hasOwn(data, key)).map(key => retiredScenarioKeys[key]);
  (Array.isArray(data.steps) ? data.steps : []).forEach((step, index) => {
    if (!step || typeof step !== "object") return;
    for (const key of Object.keys(retiredStepKeys)) if (Object.hasOwn(step, key)) problems.push(`${index + 1}단계: ${retiredStepKeys[key]}`);
    const api = (step as Record<string, unknown>).api;
    if (api !== undefined && typeof api !== "string") problems.push(`${index + 1}단계: api는 'POST /bos/login' 형식의 문자열로 쓰세요`);
  });
  if (problems.length) throw new ScenarioFormatError([...new Set(problems)].join("\n"));
}

/**
 * Reads the one authoring format (see stringifyScenario) into the runner model:
 * steps get generated ids, {{inputs.x}} of step inputs become runner vars and
 * {{steps.N.…}} become value links.
 */
export function parseScenario(source: string): Scenario {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join("\n"));
  const raw = doc.toJS({ maxAliasCount: 50 });
  assertCurrentSyntax(raw);
  const authored = authoringScenario.parse(raw);
  const used = new Set<string>();
  const declared = new Set<string>();
  const problems: string[] = [];
  const steps = authored.steps.map((step, index) => {
    const [, method, path] = methodPath.exec(step.api.trim())!;
    const base = `${method}_${path}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}_${suffix}`;
    used.add(id);
    const server = step.server ?? authored.server;
    if (!server) problems.push(`${index + 1}단계: server를 시나리오 또는 단계에 쓰세요`);
    (step.inputs ?? []).forEach(input => declared.add(input.name));
    const check = (text: string) => {
      for (const match of text.matchAll(/\{\{vars\.[^}]*\}\}/g)) problems.push(`${index + 1}단계: ${match[0]}는 쓰지 않습니다. 앞 단계 값은 {{steps.N.…}}, 실행 입력은 {{inputs.이름}}으로 쓰세요`);
      for (const match of text.matchAll(/\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}/g))
        if (!declared.has(match[1])) problems.push(`${index + 1}단계: {{inputs.${match[1]}}}를 쓰려면 이 단계나 앞 단계의 inputs에 ${match[1]}을 정의하세요`);
      // Step input values live in the runner's vars.
      return text.replace(/\{\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}\}/g, "{{vars.$1}}");
    };
    const request = mapStrings({ pathParams: step.pathParams, query: step.query, headers: step.headers, cookies: step.cookies, body: step.body }, check);
    return {
      id, ...(step.name ? { name: step.name } : {}), server: server ?? "", api: { method, path },
      ...(step.auth ? { auth: step.auth } : {}), ...(step.inputs?.length ? { inputs: step.inputs } : {}),
      request: Object.fromEntries(Object.entries(request).filter(([, v]) => v !== undefined)),
      ...(step.expect ? { expect: mapStrings(step.expect, check) } : {}),
      extract: step.extract ?? [],
    };
  });
  if (problems.length) throw new ScenarioFormatError([...new Set(problems)].join("\n"));
  return expandStepReferences(scenarioSchema.parse({
    version: 1, id: authored.id ?? `scenario-${encodeURIComponent(authored.name)}`, name: authored.name,
    ...(authored.description !== undefined ? { description: authored.description } : {}),
    ...(authored.auth ? { auth: authored.auth } : {}), ...(authored.onFailure ? { onFailure: authored.onFailure } : {}),
    ...(authored.environments ? { environments: authored.environments } : {}),
    steps,
  }));
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
      if (from < 0 || from >= index) throw new ScenarioFormatError(`${index + 1}단계 연결은 앞선 단계만 참조할 수 있습니다 (${number}단계)`);
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



/** Compact authoring format. Keep identities when saving an existing editor document. */
/**
 * The one authoring format used by people, the AI and saved files:
 * earlier-step values as {{steps.N.…}}, step inputs as {{inputs.name}}, no step ids.
 * preserveIds keeps the scenario id (saved files); internal link names never appear.
 */
export function stringifyScenario(scenario: Scenario, preserveIds = false, resolveApi?: (step: Scenario["steps"][number]) => { method: string; path: string } | undefined, serverNames: Record<string, string> = {}): string {
  const normalized = normalizeScenarioForStorage(scenario);
  const replacements = new Map<string, string>();
  for (const binding of normalized.valueBindings) {
    const index = normalized.steps.findIndex(step => step.id === binding.step);
    // A link whose source step was deleted has no valid reference; the field is left empty.
    replacements.set(`{{vars.${binding.name}}}`, index < 0 ? "" : `{{steps.${index + 1}.${binding.source}.${binding.area}.${binding.header ?? binding.pointer ?? ""}}}`);
  }
  for (const step of normalized.steps) for (const input of scenarioStepInputs(step)) replacements.set(`{{vars.${input.name}}}`, `{{inputs.${input.name}}}`);
  normalized.steps = mapStrings(normalized.steps, text => {
    for (const [from, to] of replacements) text = text.split(from).join(to);
    return text;
  });
  const { id, name, description, environments, steps, onFailure, auth } = normalized;
  const commonServer = steps.every(step => step.server === steps[0].server) ? steps[0].server : undefined;
  const extractFor = (extract: Scenario["steps"][number]["extract"]) =>
    extract.map(({ source, sensitive, ...e }) => ({ ...(source !== "body" ? { source } : {}), ...e, ...(sensitive ? { sensitive } : {}) }));
  return stringify({
    ...(preserveIds ? { id } : {}), name,
    ...(description !== undefined ? { description } : {}),
    ...(commonServer ? { server: serverNames[commonServer] ?? commonServer } : {}),
    ...(auth ? { auth } : {}),
    ...(onFailure !== "stop" ? { onFailure } : {}),
    ...(environments ? { environments } : {}),
    steps: steps.map(original => {
      const { name: stepName, server, api, auth: stepAuth, request, expect, extract } = original;
      const resolved = "method" in api ? api : resolveApi?.(original);
      const inputs = scenarioStepInputs(original);
      return {
        ...(stepName ? { name: stepName } : {}),
        ...(!commonServer ? { server: serverNames[server] ?? server } : {}),
        api: resolved ? `${resolved.method.toUpperCase()} ${resolved.path}` : api,
        ...(stepAuth ? { auth: stepAuth } : {}),
        // Defaults (string, required, sensitive) are omitted.
        ...(inputs.length ? { inputs: inputs.map(({ type, required, sensitive, ...input }) => ({ ...input, ...(type !== "string" ? { type } : {}), ...(!required ? { required } : {}), ...(!sensitive ? { sensitive } : {}) })) } : {}),
        // Fixed order so saving is stable regardless of edit order.
        ...Object.fromEntries((["pathParams", "query", "headers", "cookies", "body"] as const).filter(area => request[area] !== undefined).map(area => [area, request[area]])),
        ...(expect?.length ? { expect } : {}),
        ...(extract.length ? { extract: extractFor(extract) } : {}),
      };
    }),
  });
}

// ─ Check wording (editor, run results and suite reports) ─
export const verificationOperatorLabels: Record<"exists" | "equals" | "contains", string> = { exists: "존재하는지", equals: "기대값과 같은지", contains: "포함하는지" };
export const verificationSourceLabels = { body: "응답 본문", status: "HTTP 상태", header: "응답 헤더" } as const;

/** Expected values are typed as plain text: JSON when it parses (200, true, {"a":1}), otherwise a string. */
export function parseExpectedValue(text: string): Json {
  try { return JSON.parse(text) as Json; } catch { return text; }
}

/** Inverse of parseExpectedValue: a string that would parse as another JSON type keeps its quotes. */
export function expectedValueText(value: Json | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return parseExpectedValue(value) === value ? value : JSON.stringify(value);
  return JSON.stringify(value);
}

/** A step check in words: `target` (what is checked) and `rule`; no expectation = the automatic 2xx check. */
export function describeCheck(expectation?: { source: "status" | "body" | "header"; pointer?: string; header?: string; operator: "exists" | "equals" | "contains"; value?: Json }): { target: string; rule: string } {
  if (!expectation) return { target: "HTTP 상태", rule: "2xx (자동 확인)" };
  const target = expectation.source === "status" ? verificationSourceLabels.status : expectation.source === "header" ? expectation.header ?? "응답 헤더" : expectation.pointer || "전체 응답";
  return { target, rule: `${verificationOperatorLabels[expectation.operator]}${expectation.operator !== "exists" ? ` ${expectedValueText(expectation.value)}` : ""}` };
}
