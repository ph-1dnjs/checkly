import type { ApiScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import { contractForEvent, operationsFromDocument, pathMatches, type NetworkEvent, type OpenApiDocument, type OpenApiOperation } from "./liveQa";

export type SharedOpenApiSource = {
  scope: ApiScope;
  label: string;
  baseUrl: string;
  document: OpenApiDocument;
  documentUrl?: string;
  importedAt?: string;
};

export const openApiSourceId = (source: SharedOpenApiSource) =>
  `${source.scope.projectId}/${source.scope.environmentId}/${source.scope.serverId}`;

/** API testing resolves team/local settings and saved document credentials. */
export async function loadSharedOpenApi(bridge: ApiTestingBridge, preferredProjectId = "", preferredEnvironmentId = "", refresh = false) {
  const projects = await bridge.listProjects();
  const selected = preferredProjectId ? projects.filter(item => item.id === preferredProjectId) : projects;
  const results = await Promise.all(selected.flatMap(project => {
    const environments = [...project.environments].sort((a, b) => Number(b.id === preferredEnvironmentId) - Number(a.id === preferredEnvironmentId));
    return environments.flatMap(environment => project.servers.map(async server => {
      const baseUrl = environment.baseUrls[server.id];
      if (!baseUrl) return {};
      const scope = { projectId: project.id, environmentId: environment.id, serverId: server.id };
      const label = `${project.name} · ${server.name} · ${environment.name}`;
      let catalog: Awaited<ReturnType<ApiTestingBridge["getCatalog"]>> = null;
      let documentUrl: string | undefined;
      let error: string | undefined;
      try {
        catalog = await bridge.getCatalog(scope);
        if (!catalog?.spec || refresh) {
          const sync = await bridge.getSpecSync(scope);
          documentUrl = sync.url;
          if (sync.url) catalog = await bridge.importSpec(scope, { kind: "url", url: sync.url, ...(sync.hasSavedAccount ? { useSavedAuth: true } : {}) });
          else if (!catalog?.spec) throw new Error("설정/API 테스트에 Swagger 문서 주소를 등록해 주세요.");
        }
      } catch (cause) {
        error = `${label}: ${cause instanceof Error ? cause.message : String(cause)}${catalog?.spec ? " (저장된 문서를 표시합니다.)" : ""}`;
      }
      if (!catalog?.spec || typeof catalog.spec !== "object" || Array.isArray(catalog.spec))
        return { error: error || `${label}: 저장된 OpenAPI 원문이 없습니다. API 테스트에서 문서를 다시 가져오세요.` };
      return { source: { scope, label, baseUrl, document: catalog.spec as OpenApiDocument, documentUrl, importedAt: catalog.importedAt }, error };
    }));
  }));
  return {
    projectName: selected.map(project => project.name).join(", "),
    sources: results.flatMap(result => result.source ? [result.source] : []),
    errors: results.flatMap(result => result.error ? [result.error] : []),
  };
}

type SpecMatch = { source: SharedOpenApiSource; url: string; operation: OpenApiOperation; kind: "address" | "path" | "selected" };

/** Compare both full paths and paths relative to the configured server base. */
export function resolveSharedOpenApi(sources: SharedOpenApiSource[], url: string, method = "GET", pageUrl?: string, sourceId = "") {
  const candidates: Array<SpecMatch & { sameOrigin: boolean; specificity: number }> = [];
  let knownOrigin = false;
  for (const source of sources) {
    if (sourceId && openApiSourceId(source) !== sourceId) continue;
    try {
      const base = new URL(source.baseUrl);
      const request = new URL(url, pageUrl);
      const prefix = base.pathname.replace(/\/+$/, "");
      const withinBase = !prefix || request.pathname === prefix || request.pathname.startsWith(`${prefix}/`);
      const sameOrigin = base.origin === request.origin && withinBase;
      knownOrigin ||= sameOrigin;
      const paths = [request.pathname];
      if (prefix && withinBase)
        paths.push(request.pathname.slice(prefix.length) || "/");
      const operation = operationsFromDocument(source.document).find(item => item.method === method.toUpperCase()
        && paths.some(path => pathMatches(item.path, path)));
      if (!operation) continue;
      const matchedPath = paths.find(path => pathMatches(operation.path, path))!;
      request.pathname = matchedPath;
      candidates.push({ source, url: request.href, operation, sameOrigin, specificity: prefix.length,
        kind: sourceId ? "selected" : sameOrigin ? "address" : "path" });
    } catch { /* Invalid URLs cannot establish a document connection. */ }
  }
  // A known host must never silently use another server's contract.
  const eligible = sourceId ? candidates : knownOrigin ? candidates.filter(item => item.sameOrigin) : candidates;
  const ranked = eligible.sort((a, b) => b.specificity - a.specificity);
  const best = knownOrigin && !sourceId ? ranked.filter(item => item.specificity === ranked[0]?.specificity) : ranked;
  const match: SpecMatch | undefined = best.length === 1 ? best[0] : undefined;
  const reason = sourceId && !candidates.length ? "선택한 문서에 이 요청의 경로·메서드가 없습니다."
    : best.length > 1 ? "경로·메서드가 일치하는 문서가 여러 개입니다. 서버·환경에 맞는 문서를 선택해 주세요."
    : !sources.length ? "불러온 Swagger 문서가 없습니다. 설정/API 테스트의 문서 주소를 확인해 주세요."
    : "불러온 Swagger 문서에 이 요청의 경로·메서드가 없습니다.";
  return { match, candidates: best, reason };
}

export function matchSharedOpenApi(sources: SharedOpenApiSource[], url: string, method?: string, pageUrl?: string, sourceId = "") {
  return resolveSharedOpenApi(sources, url, method, pageUrl, sourceId).match;
}

export function contractForSharedEvent(sources: SharedOpenApiSource[], event: NetworkEvent, sourceId = "") {
  const { match, reason } = resolveSharedOpenApi(sources, event.url, event.method, event.pageUrl, sourceId);
  if (!match) return { tone: "neutral" as const, label: "스펙 미연결", detail: reason };
  if (match.kind === "path") return { tone: "neutral" as const, label: "문서 확인 필요", detail: "경로·메서드가 일치하는 Swagger 문서를 찾았습니다. 서버 주소가 달라 계약 검사는 보류합니다. 문서를 선택하면 해당 문서로 검사합니다.", operation: match.operation };
  return contractForEvent(match.source.document, { ...event, method: match.operation.method, url: match.url });
}
