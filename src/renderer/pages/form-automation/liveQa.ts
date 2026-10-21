import { isNextInternalNetworkEvent } from "../../../app/ipc/form-automation/networkFilter";
export { isNextInternalNetworkEvent } from "../../../app/ipc/form-automation/networkFilter";

export type JsonValue = unknown;

export type ContractResult = {
  tone: "success" | "danger" | "neutral";
  label: string;
  detail: string;
  operation?: OpenApiOperation;
};

export type NetworkEvent = {
  id: string;
  type: "fetch" | "xhr" | "navigation" | "page-error" | "resource-error" | "unhandled-rejection" | "console-error" | string;
  category?: "page" | "activity" | string;
  method?: string;
  url: string;
  pageUrl?: string;
  status?: number;
  requestBody?: JsonValue;
  responseBody?: JsonValue;
  responseContentType?: string;
  nextInternal?: boolean;
  elapsed?: number;
  overridden?: boolean;
  error?: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  at: string;
  browserSessionId?: string;
  browserSessionName?: string;
  contract?: ContractResult;
};

export const mergeNetworkEvents = (current: NetworkEvent[], saved: NetworkEvent[]): NetworkEvent[] => {
  const events = new Map<string, NetworkEvent>();
  for (const event of [...current, ...saved]) {
    if (!isNextInternalNetworkEvent(event) && !events.has(event.id)) events.set(event.id, event);
  }
  return [...events.values()]
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, 1000);
};

export type OverrideRule = {
  id: string;
  name: string;
  match: string;
  method: string;
  status: number;
  enabled: boolean;
  body: JsonValue;
  sourceBody?: JsonValue;
  sourceUrl?: string;
};

export type StorageItem = { key: string; value: string; bytes: number };

export type StorageSnapshot = {
  browserSessionId: string;
  href: string;
  origin: string;
  localStorage: { items: StorageItem[]; error: string };
  sessionStorage: { items: StorageItem[]; error: string };
  cookies: StorageItem[];
  indexedDB: string[];
  caches: string[];
  capturedAt: number;
};

export type OpenApiSchema = {
  $ref?: string;
  allOf?: OpenApiSchema[];
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  enum?: unknown[];
  oneOf?: Array<OpenApiSchema & { const?: unknown }>;
  nullable?: boolean;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
  pattern?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
};

type OpenApiResponse = {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperationBody = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: { $ref?: string; required?: boolean; description?: string; content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, OpenApiResponse>;
};

export type OpenApiDocument = {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OpenApiOperationBody | unknown[] | string>>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
};

export type OpenApiOperation = {
  id: string;
  method: string;
  path: string;
  operation: OpenApiOperationBody;
  summary: string;
  parameters: unknown[];
  requestSchema?: OpenApiSchema;
  successResponse?: [string, OpenApiResponse];
  errorResponse?: [string, OpenApiResponse];
};

export const EMPTY_STORAGE_SNAPSHOT: StorageSnapshot = {
  browserSessionId: "",
  href: "",
  origin: "",
  localStorage: { items: [], error: "" },
  sessionStorage: { items: [], error: "" },
  cookies: [],
  indexedDB: [],
  caches: [],
  capturedAt: 0,
};

export const safeJson = (value: unknown): unknown => {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
};

export const stringify = (value: unknown): string => JSON.stringify(value, null, 2);

export const readableStorageValue = (value: string): string => {
  const parsed = safeJson(value);
  return parsed === undefined ? value : stringify(parsed);
};

export const shortTime = (value: string | number | Date = new Date()): string =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export const isSessionError = (item?: NetworkEvent | null): boolean =>
  Boolean(
    item?.category === "page"
    || item?.error
    || item?.contract?.tone === "danger"
    || Number(item?.status) === 0
    || Number(item?.status) >= 400,
  );

export const pathMatches = (template: string, eventUrl: string): boolean => {
  try {
    const pathname = new URL(eventUrl, "https://qa.local").pathname;
    const pattern = template
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{[^/]+\\\}/g, "[^/]+");
    return new RegExp(`^${pattern}/?$`).test(pathname);
  } catch {
    return false;
  }
};

export const normalizedEndpointPath = (value: string): string => {
  try {
    const pathname = new URL(value, "https://qa.local").pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return String(value || "").trim();
  }
};

export const resolveSchema = (
  document: OpenApiDocument | null,
  rawSchema?: OpenApiSchema,
  references: string[] = [],
): OpenApiSchema | undefined => {
  if (!rawSchema) return undefined;
  if (rawSchema.$ref) {
    if (!rawSchema.$ref.startsWith("#/") || references.includes(rawSchema.$ref)) return undefined;
    const target = rawSchema.$ref
      .replace("#/", "")
      .split("/")
      .map(key => key.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce<unknown>((value, key) => (
        value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined
      ), document);
    const { $ref, ...siblings } = rawSchema;
    return target && typeof target === "object"
      ? resolveSchema(document, { ...target, ...siblings }, [...references, $ref]) : undefined;
  }
  if (rawSchema.allOf) {
    return rawSchema.allOf
      .map((part) => resolveSchema(document, part, references))
      .filter(Boolean)
      .reduce<OpenApiSchema>((combined, part) => ({
        ...combined,
        ...part,
        properties: { ...combined.properties, ...part?.properties },
        required: [...new Set([...(combined.required || []), ...(part?.required || [])])],
      }), { ...rawSchema, allOf: undefined });
  }
  return rawSchema;
};

export const validateSchema = (
  document: OpenApiDocument | null,
  rawSchema: OpenApiSchema | undefined,
  value: unknown,
  location = "$",
): string[] => {
  const schema = resolveSchema(document, rawSchema);
  if (!schema) return [];
  const errors: string[] = [];
  const type = schema.type || (schema.properties ? "object" : undefined);
  if (value === null || value === undefined)
    return schema.nullable ? [] : [`${location}: 값이 없습니다.`];
  if (type === "object" && (typeof value !== "object" || Array.isArray(value)))
    return [`${location}: 객체여야 합니다.`];
  if (type === "array" && !Array.isArray(value)) return [`${location}: 배열이어야 합니다.`];
  if (type === "string" && typeof value !== "string") return [`${location}: 문자열이어야 합니다.`];
  if ((type === "number" || type === "integer") && (
    typeof value !== "number" || (type === "integer" && !Number.isInteger(value))
  )) return [`${location}: ${type === "integer" ? "정수" : "숫자"}여야 합니다.`];
  if (type === "boolean" && typeof value !== "boolean") return [`${location}: boolean이어야 합니다.`];
  if (type === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required || [])
      if (!(key in object)) errors.push(`${location}.${key}: 필수 필드가 없습니다.`);
    if (schema.additionalProperties === false)
      for (const key of Object.keys(object))
        if (!schema.properties?.[key]) errors.push(`${location}.${key}: 스키마에 없는 필드입니다.`);
    for (const [key, child] of Object.entries(schema.properties || {}))
      if (key in object) errors.push(...validateSchema(document, child, object[key], `${location}.${key}`));
  }
  if (type === "array")
    (value as unknown[]).forEach((item, index) =>
      errors.push(...validateSchema(document, schema.items, item, `${location}[${index}]`)));
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${location}: ${schema.minLength}자 이상이어야 합니다.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${location}: ${schema.maxLength}자 이하여야 합니다.`);
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      errors.push(`${location}: 이메일 형식이 아닙니다.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`${location}: 패턴 ${schema.pattern}과 일치하지 않습니다.`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${location}: 최소값은 ${schema.minimum}입니다.`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${location}: 최대값은 ${schema.maximum}입니다.`);
  }
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${location}: 허용값은 ${schema.enum.join(", ")}입니다.`);
  return errors;
};

const documentOperations = new WeakMap<OpenApiDocument, OpenApiOperation[]>();

export const operationsFromDocument = (document: OpenApiDocument | null): OpenApiOperation[] => {
  if (!document) return [];
  const cached = documentOperations.get(document);
  if (cached) return cached;
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
  const operations = Object.entries(document.paths || {}).flatMap(([path, rawPathItem]) => {
    const pathItem = resolveSchema(document, rawPathItem as OpenApiSchema) as typeof rawPathItem | undefined;
    if (!pathItem) return [];
    const common = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    return Object.entries(pathItem).flatMap(([method, rawOperation]) => {
      if (!methods.has(method) || !rawOperation || typeof rawOperation !== "object" || Array.isArray(rawOperation)) return [];
      const operation = rawOperation as OpenApiOperationBody;
      const parameters = new Map<string, unknown>();
      for (const raw of [...common, ...(operation.parameters || [])]) {
        const parameter = resolveSchema(document, raw as OpenApiSchema) as { name?: string; in?: string } | undefined;
        if (parameter) parameters.set(`${parameter.in}:${parameter.name}`, parameter);
      }
      const requestBody = resolveSchema(document, operation.requestBody as OpenApiSchema) as OpenApiOperationBody["requestBody"];
      const responseEntries = Object.entries(operation.responses || {}) as Array<[string, OpenApiResponse]>;
      return [{
        id: operation.operationId || `${method}-${path}`,
        method: method.toUpperCase(),
        path,
        operation: { ...operation, requestBody },
        summary: operation.summary || operation.operationId || path,
        parameters: [...parameters.values()],
        requestSchema: requestBody?.content?.["application/json"]?.schema,
        successResponse: responseEntries.find(([status]) => /^2\d\d$/.test(status)),
        errorResponse: responseEntries.find(([status]) => /^[45]\d\d$/.test(status)),
      }];
    });
  }).sort((a, b) => (a.path.match(/\{/g)?.length || 0) - (b.path.match(/\{/g)?.length || 0));
  documentOperations.set(document, operations);
  return operations;
};

const responseSchemaFor = (document: OpenApiDocument | null, response?: OpenApiResponse): OpenApiSchema | undefined => {
  const resolved = resolveSchema(document, response) as OpenApiResponse | undefined;
  return resolved?.content?.["application/json"]?.schema || Object.values(resolved?.content || {})[0]?.schema;
};

export const contractForEvent = (
  document: OpenApiDocument | null,
  event: NetworkEvent,
): ContractResult => {
  if (!document)
    return { tone: "neutral", label: "스펙 미연결", detail: "설정/API 테스트에 등록된 문서 중 이 요청 주소에 맞는 문서가 없습니다." };
  const operation = operationsFromDocument(document).find(
    (item) => item.method === event.method && pathMatches(item.path, event.url),
  );
  if (!operation)
    return { tone: "neutral", label: "스펙 미연결", detail: "일치하는 OpenAPI operation이 없습니다." };
  const requestErrors = operation.requestSchema && event.requestBody != null
    ? validateSchema(document, operation.requestSchema, event.requestBody)
    : [];
  const responses = operation.operation.responses;
  const expectedResponse = responses?.[String(event.status)]
    || responses?.[`${String(event.status)[0]}XX`]
    || responses?.default;
  if (!expectedResponse)
    return { tone: "danger", label: "계약 불일치", detail: `HTTP ${event.status ?? "알 수 없음"}: 문서에 정의되지 않은 응답 상태입니다.`, operation };
  const responseSchema = responseSchemaFor(document, expectedResponse);
  const responseErrors = responseSchema ? validateSchema(document, responseSchema, event.responseBody) : [];
  const errors = [...requestErrors, ...responseErrors];
  if (!errors.length && !responseSchema)
    return { tone: "neutral", label: "응답 스키마 없음", detail: `HTTP ${event.status}: 문서에 응답 본문 스키마가 정의되어 있지 않습니다.`, operation };
  return errors.length
    ? { tone: "danger", label: "계약 불일치", detail: errors.slice(0, 4).join("\n"), operation }
    : { tone: "success", label: "계약 일치", detail: `${operation.method} ${operation.path}`, operation };
};

export const overrideResponseSchema = (
  document: OpenApiDocument | null,
  rule?: OverrideRule,
): OpenApiSchema | undefined => {
  if (!rule) return undefined;
  const operation = operationsFromDocument(document).find(
    (item) => item.method === rule.method && pathMatches(item.path, rule.sourceUrl || rule.match),
  );
  if (!operation) return undefined;
  const response = operation.operation.responses?.[String(rule.status)]
    || operation.successResponse?.[1]
    || operation.errorResponse?.[1];
  return responseSchemaFor(document, response);
};

export const apiEventClipboardText = (event: NetworkEvent, fallbackUrl: string): string => {
  let url = event.url || event.pageUrl || fallbackUrl || "-";
  try { url = new URL(url, event.pageUrl || fallbackUrl).toString(); } catch { /* 원문 유지 */ }
  let pageUrl = event.pageUrl || fallbackUrl || "-";
  try { pageUrl = new URL(pageUrl, fallbackUrl).toString(); } catch { /* 원문 유지 */ }
  const sections = [
    `method: ${String(event.method || "-").toUpperCase()}`,
    `url: ${url}`,
    `pageUrl: ${pageUrl}`,
  ];
  let hasBody = false;
  const appendBody = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    hasBody = true;
    sections.push("", `${label}:`, typeof value === "string" ? value : stringify(value));
  };
  appendBody("request", event.requestBody);
  appendBody("response", event.responseBody);
  if (!hasBody && event.error) appendBody("response", event.error);
  return sections.join("\n");
};

export const browserStorageScript = `(async () => {
  const byteSize = (value) => {
    try { return new TextEncoder().encode(String(value ?? '')).length; }
    catch { return String(value ?? '').length; }
  };
  const readStorage = (storage) => {
    const items = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key == null) continue;
        const value = storage.getItem(key) ?? '';
        items.push({ key, value, bytes: byteSize(value) });
      }
      return { items: items.sort((a, b) => a.key.localeCompare(b.key)), error: '' };
    } catch (error) { return { items, error: error.message }; }
  };
  const cookies = (() => {
    try {
      return String(document.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const separator = part.indexOf('=');
        const key = separator < 0 ? part : part.slice(0, separator);
        const value = separator < 0 ? '' : part.slice(separator + 1);
        return { key, value, bytes: byteSize(value) };
      }).sort((a, b) => a.key.localeCompare(b.key));
    } catch { return []; }
  })();
  let databases = [];
  let cacheNames = [];
  try { if (indexedDB.databases) databases = (await indexedDB.databases()).map((item) => item.name).filter(Boolean); } catch {}
  try { if (self.caches) cacheNames = await caches.keys(); } catch {}
  return {
    href: location.href,
    origin: location.origin,
    localStorage: readStorage(window.localStorage),
    sessionStorage: readStorage(window.sessionStorage),
    cookies,
    indexedDB: databases,
    caches: cacheNames,
    capturedAt: Date.now(),
  };
})()`;
