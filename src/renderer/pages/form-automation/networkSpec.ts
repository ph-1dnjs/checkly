import { type NetworkEvent, type OpenApiDocument } from "./liveQa";
import { matchSharedOpenApi, type SharedOpenApiSource } from "./sharedOpenApi";

/** Expand local references for display, retaining recursive/unresolved references. */
export function expandSpecReferences(document: OpenApiDocument, value: unknown, references: string[] = [], depth = 0): unknown {
  if (depth > 30 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => expandSpecReferences(document, item, references, depth + 1));
  const object = value as Record<string, unknown>;
  if (typeof object.$ref === "string" && object.$ref.startsWith("#/") && !references.includes(object.$ref)) {
    const target = object.$ref.slice(2).split("/").reduce<unknown>((current, key) => (
      current && typeof current === "object" ? (current as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined
    ), document);
    if (target && typeof target === "object" && !Array.isArray(target)) {
      const { $ref, ...siblings } = object;
      return expandSpecReferences(document, { ...target, ...siblings }, [...references, $ref as string], depth + 1);
    }
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, expandSpecReferences(document, item, references, depth + 1)]));
}

export function specForNetworkEvent(sources: SharedOpenApiSource[], event: NetworkEvent, sourceId = "") {
  const match = matchSharedOpenApi(sources, event.url, event.method, event.pageUrl, sourceId);
  if (!match) return undefined;
  const operation = match.operation;
  const document = match.source.document;
  const responses = operation.operation.responses || {};
  const responseStatus = [String(event.status), `${String(event.status)[0]}XX`, "default"].find(status => responses[status]);
  const response = responseStatus ? expandSpecReferences(document, responses[responseStatus]) as { content?: Record<string, { schema?: unknown }> } : undefined;
  return {
    source: match.source.label,
    matchedUrl: match.url,
    matchKind: match.kind,
    baseUrl: match.source.baseUrl,
    importedAt: match.source.importedAt,
    description: operation.operation.description,
    title: document.info?.title,
    method: operation.method,
    path: operation.path,
    summary: operation.summary,
    parameters: expandSpecReferences(document, operation.parameters),
    requestBody: expandSpecReferences(document, operation.operation.requestBody),
    responseStatus,
    response,
    hasResponseSchema: Object.values(response?.content || {}).some(media => media.schema !== undefined),
  };
}

export type NetworkSpec = NonNullable<ReturnType<typeof specForNetworkEvent>>;
