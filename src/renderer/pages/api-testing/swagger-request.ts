// Converts between the stored catalog, Swagger UI state and Checkly requests/responses.
import { type Json, type Scenario } from "../../../app/api-testing/shared/scenario";
import { appendQueryParameter } from "../../../app/api-testing/shared/query";
import type { ApiCatalog, ApiOperation, ApiResponse } from "../../../app/api-testing/shared/workspace";
import { type SwaggerMap, type SwaggerSystem, type Selection } from "./swagger-types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toPlain(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { toJS?: () => unknown };
  return typeof candidate.toJS === "function" ? candidate.toJS() : value;
}

export function mapValue(map: unknown, key: string): unknown {
  if (!map || typeof map !== "object") return undefined;
  const candidate = map as { get?: (name: string, notSetValue?: unknown) => unknown };
  return typeof candidate.get === "function" ? candidate.get(key) : undefined;
}

export function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function operationSpec(operation: ApiOperation): Record<string, unknown> {
  const parameters = operation.parameters.map(parameter => ({
    name: parameter.name,
    in: parameter.location,
    required: parameter.required,
    ...(parameter.description ? { description: parameter.description } : {}),
    schema: { type: parameter.type },
    ...(parameter.example !== undefined ? { example: parameter.example } : {}),
  }));
  const hasBody = operation.bodySchema !== undefined || operation.bodyExample !== undefined || operation.bodyRequired;
  const requestBody = hasBody ? {
    required: operation.bodyRequired,
    content: {
      "application/json": {
        ...(operation.bodySchema !== undefined ? { schema: operation.bodySchema } : {}),
        ...(operation.bodyExample !== undefined ? { example: operation.bodyExample } : {}),
      },
    },
  } : undefined;
  return {
    tags: operation.tags?.length ? operation.tags : [operation.tag || "기타"],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    ...(operation.operationId ? { operationId: operation.operationId } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: isRecord(operation.responses) ? operation.responses : { default: { description: "응답 명세가 없습니다" } },
  };
}

export function fallbackSpec(catalog: ApiCatalog, baseUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of catalog.operations) {
    paths[operation.path] ??= {};
    paths[operation.path][operation.method.toLowerCase()] = operationSpec(operation);
  }
  return {
    openapi: "3.0.3",
    info: { title: catalog.title, version: catalog.version },
    ...(baseUrl ? { servers: [{ url: baseUrl }] } : {}),
    ...(catalog.tags?.length ? { tags: catalog.tags } : {}),
    paths,
  };
}

export function buildSpec(catalog: ApiCatalog, baseUrl: string): Record<string, unknown> {
  const raw = isRecord(catalog.spec) ? catalog.spec : fallbackSpec(catalog, baseUrl);
  return baseUrl ? { ...raw, servers: [{ url: baseUrl }] } : raw;
}

export function requestBodyValue(catalog: ApiCatalog, selection: Selection, system: SwaggerSystem): Json | undefined {
  const operation = catalog.operations.find(item => item.key === `${selection.method.toUpperCase()} ${selection.path}`);
  const operationHasBody = operation && (operation.bodySchema !== undefined || operation.bodyExample !== undefined || operation.bodyRequired);
  if (!operationHasBody) return undefined;
  let value = toPlain(system.oas3Selectors?.requestBodyValue(selection.path, selection.method));
  if ((value === undefined || value === null || value === "") && operation?.bodyExample !== undefined) value = operation.bodyExample;
  if (value === null && operation?.bodyExample === undefined) return undefined;
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    try { return JSON.parse(value) as Json; }
    catch { throw new Error("요청 본문 JSON 문법을 확인하세요"); }
  }
  return value === undefined ? undefined : value as Json;
}

export function buildRequest(catalog: ApiCatalog, selection: Selection, system: SwaggerSystem): Scenario["steps"][number]["request"] {
  const request: Scenario["steps"][number]["request"] = { pathParams: {}, query: {}, headers: {}, cookies: {} };
  const values = toPlain(system.specSelectors.parameterValues([selection.path, selection.method], false));
  const parameterValues = isRecord(values) ? values : {};
  const operation = system.specSelectors.operationWithMeta(selection.path, selection.method);
  const parameters = mapValue(operation, "parameters");
  if (parameters && typeof (parameters as { forEach?: unknown }).forEach === "function") {
    (parameters as { forEach: (callback: (parameter: SwaggerMap) => void) => void }).forEach(parameter => {
      const name = textValue(mapValue(parameter, "name"));
      const location = textValue(mapValue(parameter, "in"));
      if (!name || !["path", "query", "header", "cookie"].includes(location)) return;
      const value = toPlain(parameterValues[`${location}.${name}`]);
      if (value === undefined || value === null) return;
      if (location === "path") request.pathParams![name] = value as Json;
      else if (location === "query") request.query![name] = value as Json;
      else if (location === "header") request.headers![name] = String(value);
      else request.cookies![name] = value as Json;
    });
  }
  const body = requestBodyValue(catalog, selection, system);
  if (body !== undefined) request.body = body;
  return request;
}

export function requestUrl(baseUrl: string, path: string, request: Scenario["steps"][number]["request"], operation?: ApiOperation): string {
  const pathParams = request.pathParams ?? {};
  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(pathParams[name] ?? `{${name}}`)));
  try {
    const base = new URL(baseUrl);
    const url = new URL(`${base.toString().replace(/\/$/, "")}${resolvedPath}`);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) appendQueryParameter(url, name, value, operation?.parameters.find(parameter => parameter.location === "query" && parameter.name === name));
    }
    return url.toString();
  } catch {
    return resolvedPath;
  }
}

export function displayRequest(selection: Selection, url: string, request: Scenario["steps"][number]["request"]): Record<string, unknown> {
  const headers = { ...(request.headers ?? {}) };
  const cookies = Object.entries(request.cookies ?? {}).filter(([, value]) => value !== undefined && value !== null && typeof value !== "object").map(([name, value]) => `${name}=${String(value)}`);
  if (cookies.length) headers.cookie = [headers.cookie, ...cookies].filter(Boolean).join("; ");
  if (request.body !== undefined && !Object.keys(headers).some(name => name.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  return {
    method: selection.method.toUpperCase(),
    url,
    headers,
    ...(request.body !== undefined ? { body: typeof request.body === "string" ? request.body : JSON.stringify(request.body, null, 2) } : {}),
  };
}

export function responseText(body: Json | undefined): string {
  if (body === undefined) return "";
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

export function responseFromApi(response: ApiResponse, url: string): Record<string, unknown> {
  return {
    status: response.httpStatus ?? 0,
    headers: response.headers ?? {},
    text: responseText(response.body),
    duration: response.durationMs,
    url,
  };
}

export function responseFromError(error: unknown, url: string): Record<string, unknown> {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error invoking remote method '[^']+': Error: /, "");
  return {
    error: true,
    err: {
      name: "Checkly",
      message,
      response: { status: 0, headers: {}, text: "", duration: 0, url },
    },
  };
}

export function tagNames(system: SwaggerSystem, catalog: ApiCatalog): string[] {
  const tagged = system.specSelectors.taggedOperations?.();
  const keySeq = tagged?.keySeq?.();
  const names = keySeq?.toArray?.().filter((value): value is string => typeof value === "string") ?? [];
  if (names.length) return names;
  return [...new Set([
    ...(catalog.tags?.map(tag => tag.name) ?? []),
    ...catalog.operations.flatMap(operation => operation.tags?.length ? operation.tags : [operation.tag || "기타"]),
  ])];
}
