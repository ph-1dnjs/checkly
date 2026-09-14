import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { scenarioStepLabel, type Json, type Scenario } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation, ApiResponse, ApiScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import { RequestAuthPanel } from "./RequestAuthPanel";
import { DescriptionMarkdown } from "./DescriptionMarkdown";
import { Diagram } from "./DescriptionMarkdown";
import { scenarioFlow } from "./scenario-flow";
import { SelectedApiList } from "./SelectedApiList";
import type { OnRunAction } from "./useRunAction";
import { ScenarioBuilder } from "./ScenarioBuilder";
import type { ApiProject, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import { apiReference } from "./scenario-builder-model";

const StableSwaggerUI = memo(SwaggerUI);
const submitMethods = ["get", "put", "post", "delete", "options", "head", "patch"];

type SwaggerMap = {
  get: (key: string, notSetValue?: unknown) => unknown;
  keySeq?: () => { toArray: () => unknown[] };
  toJS?: () => unknown;
};

type SwaggerSystem = {
  layoutActions: { show: (key: string[], shown: boolean) => void; updateFilter: (filter: string) => void };
  specActions: {
    changeParam: (pathMethod: string[], name: string, location: string, value: unknown) => unknown;
    execute: (args: { path: string; method: string }) => unknown;
    setRequest: (path: string, method: string, request: Record<string, unknown>) => unknown;
    setMutatedRequest?: (path: string, method: string, request: Record<string, unknown>) => unknown;
    setResponse: (path: string, method: string, response: Record<string, unknown>) => unknown;
  };
  specSelectors: {
    taggedOperations: () => SwaggerMap;
    operationWithMeta: (path: string, method: string) => SwaggerMap;
    parameterValues: (pathMethod: string[], isXml?: boolean) => SwaggerMap;
  };
  oas3Selectors?: { requestBodyValue: (path: string, method: string) => unknown };
  oas3Actions?: { setRequestBodyValue: (args: { value: string; pathMethod: string[] }) => unknown };
};

type Selection = { path: string; method: string };
type SwaggerDeepLinkKey = ["operations-tag", string] | ["operations", string, string];
type MutableRef<T> = { current: T };
type SwaggerComponent = ComponentType<any>;

function deepLinkHash(key: SwaggerDeepLinkKey, shown: boolean): string {
  if (!shown) return "#/";
  if (key[0] === "operations-tag") return `#/${encodeURIComponent(key[1])}`;
  return `#/${encodeURIComponent(key[1])}/${encodeURIComponent(key[2])}`;
}

function deepLinkKeyFromHash(hash: string): SwaggerDeepLinkKey | undefined {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(part => {
    try { return decodeURIComponent(part); }
    catch { return part; }
  });
  if (parts[0] === "operations-tag" && parts[1]) return ["operations-tag", parts[1]];
  if (parts[0] === "operations" && parts[1] && parts[2]) return ["operations", parts[1], parts[2]];
  if (parts[0] && parts[1]) return ["operations", parts[0], parts.slice(1).join("/")];
  if (parts[0]) return ["operations-tag", parts[0]];
  return undefined;
}

function updateDeepLinkHash(key: unknown, shown: unknown): void {
  if (!Array.isArray(key) || typeof shown !== "boolean") return;
  const [kind, tag, operationId] = key;
  if (kind !== "operations-tag" && kind !== "operations") return;
  const hash = deepLinkHash(
    kind === "operations-tag"
      ? ["operations-tag", String(tag)]
      : ["operations", String(tag), String(operationId)],
    shown,
  );
  if (window.location.hash === hash) return;
  try {
    if (window.history && typeof window.history.pushState === "function") {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    } else {
      window.location.hash = hash.slice(1);
    }
  } catch {
    window.location.hash = hash.slice(1);
  }
}

function scrollToDeepLink(key: SwaggerDeepLinkKey): void {
  const root = document.querySelector(".api-swagger-renderer");
  if (!root) return;
  const target = key[0] === "operations-tag"
    ? [...root.querySelectorAll<HTMLElement>(".opblock-tag")].find(element => element.dataset.tag === key[1])
    : [...root.querySelectorAll<HTMLElement>(".opblock")].find(element =>
      element.dataset.checklyDeepLinkTag === key[1] && element.dataset.checklyDeepLinkOperation === key[2]);
  target?.scrollIntoView({ block: "start" });
}

function applyDeepLink(system: SwaggerSystem | null, hash: string): void {
  const key = deepLinkKeyFromHash(hash);
  if (!key || !system) return;
  system.layoutActions.show(key, true);
  window.setTimeout(() => scrollToDeepLink(key), 0);
}

function handleSwaggerClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".api-rich-description")) return;
  const operationPath = target.closest<HTMLElement>(".opblock-summary-path, .opblock-summary-path__deprecated");
  if (operationPath) {
    const operation = operationPath.closest<HTMLElement>(".opblock");
    const tag = operation?.dataset.checklyDeepLinkTag;
    const operationId = operation?.dataset.checklyDeepLinkOperation;
    if (tag && operationId) updateDeepLinkHash(["operations", tag, operationId], !operation?.classList.contains("is-open"));
    return;
  }
  const tagElement = target.closest<HTMLElement>(".opblock-tag");
  const tag = tagElement?.dataset.tag;
  if (tag) updateDeepLinkHash(["operations-tag", tag], tagElement?.dataset.isOpen !== "true");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPlain(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { toJS?: () => unknown };
  return typeof candidate.toJS === "function" ? candidate.toJS() : value;
}

function mapValue(map: unknown, key: string): unknown {
  if (!map || typeof map !== "object") return undefined;
  const candidate = map as { get?: (name: string, notSetValue?: unknown) => unknown };
  return typeof candidate.get === "function" ? candidate.get(key) : undefined;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function operationSpec(operation: ApiOperation): Record<string, unknown> {
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

function fallbackSpec(catalog: ApiCatalog, baseUrl: string): Record<string, unknown> {
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

function buildSpec(catalog: ApiCatalog, baseUrl: string): Record<string, unknown> {
  const raw = isRecord(catalog.spec) ? catalog.spec : fallbackSpec(catalog, baseUrl);
  return baseUrl ? { ...raw, servers: [{ url: baseUrl }] } : raw;
}

function requestBodyValue(catalog: ApiCatalog, selection: Selection, system: SwaggerSystem): Json | undefined {
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

function buildRequest(catalog: ApiCatalog, selection: Selection, system: SwaggerSystem): Scenario["steps"][number]["request"] {
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

function requestUrl(baseUrl: string, path: string, request: Scenario["steps"][number]["request"]): string {
  const pathParams = request.pathParams ?? {};
  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(pathParams[name] ?? `{${name}}`)));
  try {
    const base = new URL(baseUrl);
    const url = new URL(`${base.toString().replace(/\/$/, "")}${resolvedPath}`);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
    }
    return url.toString();
  } catch {
    return resolvedPath;
  }
}

function displayRequest(selection: Selection, url: string, request: Scenario["steps"][number]["request"]): Record<string, unknown> {
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

function responseText(body: Json | undefined): string {
  if (body === undefined) return "";
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

function responseFromApi(response: ApiResponse, url: string): Record<string, unknown> {
  return {
    status: response.httpStatus ?? 0,
    headers: response.headers ?? {},
    text: responseText(response.body),
    duration: response.durationMs,
    url,
  };
}

function responseFromError(error: unknown, url: string): Record<string, unknown> {
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

function tagNames(system: SwaggerSystem, catalog: ApiCatalog): string[] {
  const tagged = system.specSelectors.taggedOperations?.();
  const keySeq = tagged?.keySeq?.();
  const names = keySeq?.toArray?.().filter((value): value is string => typeof value === "string") ?? [];
  if (names.length) return names;
  return [...new Set([
    ...(catalog.tags?.map(tag => tag.name) ?? []),
    ...catalog.operations.flatMap(operation => operation.tags?.length ? operation.tags : [operation.tag || "기타"]),
  ])];
}

function createSwaggerPlugin(options: {
  catalogRef: MutableRef<ApiCatalog>;
  baseUrlRef: MutableRef<string>;
  bridgeRef: MutableRef<ApiTestingBridge>;
  scopeRef: MutableRef<ApiScope>;
  systemRef: MutableRef<SwaggerSystem | null>;
  selectedRef: MutableRef<Selection | null>;
  busyRef: MutableRef<boolean>;
  publishSelection: (selection: Selection | null) => void;
  setBusy: (busy: boolean) => void;
  composingRef: MutableRef<boolean>;
  editRef: MutableRef<(pathMethod: string[], area: string, name: string, value: unknown) => void>;
}) {
  return () => ({
    fn: {
      // Filter the operation lists, not the spec: keep request editors and responses intact.
      opsFilter: (taggedOps: any, phrase: string) => {
        const query = phrase.trim().toLocaleLowerCase();
        if (!query) return taggedOps;
        return taggedOps.map((group: any, tag: string) => {
          if (tag.toLocaleLowerCase().includes(query)) return group;
          return group.set("operations", group.get("operations").filter((op: any) => {
            const operation = op.get("operation");
            return [op.get("method"), op.get("path"), `${options.baseUrlRef.current.replace(/\/$/, "")}${op.get("path")}`,
              operation?.get("operationId"), operation?.get("summary"), operation?.get("description")]
              .some(value => typeof value === "string" && value.toLocaleLowerCase().includes(query));
          }));
        }).filter((group: any) => group.get("operations").size > 0);
      },
    },
    wrapComponents: {
      DeepLink: (Original: SwaggerComponent) => function AccessibleDeepLink(props: any) {
        return <Original {...props} enabled />;
      },
      Markdown: (Original: SwaggerComponent) => function InteractiveDescription(props: any) {
        return <DescriptionMarkdown Original={Original} {...props} />;
      },
      AuthorizeBtnContainer: () => function WorkspaceAuthorize(props: any) {
        const Button = props.getComponent("authorizeBtn");
        return <Button getComponent={props.getComponent} isAuthorized={false}
          showPopup={!!props.authSelectors.shownDefinitions()}
          onClick={() => props.authActions.showDefinitions(props.authSelectors.definitionsToAuthorize())} />;
      },
      FilterContainer: (Original: SwaggerComponent) => function SearchOperations(props: any) {
        const root = useRef<HTMLDivElement>(null);
        useLayoutEffect(() => {
          const input = root.current?.querySelector("input");
          input?.setAttribute("placeholder", "태그 · 메서드 · 경로 · 이름 · 설명 검색");
          input?.setAttribute("aria-label", "API 문서 검색");
        });
        const setTags = (shown: boolean) => {
          const system = options.systemRef.current;
          if (system) for (const tag of tagNames(system, options.catalogRef.current)) system.layoutActions.show(["operations-tag", tag], shown);
        };
        const Authorize = props.getComponent("AuthorizeBtnContainer", true);
        return <div ref={root} className="api-doc-search-tools"><Original {...props} />
          {!props.specSelectors.securityDefinitions() && <Authorize />}
          <div className="api-actions api-doc-controls">
            <button type="button" onClick={() => setTags(true)}>태그 모두 펼치기</button>
            <button type="button" onClick={() => setTags(false)}>태그 모두 접기</button>
          </div>
        </div>;
      },
      authorizationPopup: () => function GlobalAuthorization(props: any) {
        const closeButton = useRef<HTMLButtonElement>(null);
        useEffect(() => {
          const previous = document.activeElement;
          closeButton.current?.focus();
          const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") props.authActions.showDefinitions(false);
          };
          document.addEventListener("keydown", escape);
          return () => {
            document.removeEventListener("keydown", escape);
            if (previous instanceof HTMLElement) previous.focus();
          };
        }, []);
        return <div className="dialog-ux">
          <div className="backdrop-ux" onClick={() => props.authActions.showDefinitions(false)} />
          <div className="modal-ux" role="dialog" aria-label="API 요청 인증">
            <div className="modal-dialog-ux"><div className="modal-ux-inner">
              <div className="modal-ux-header"><h3>전역 변수 토큰 연결</h3>
                <button ref={closeButton} onClick={() => props.authActions.showDefinitions(false)} aria-label="인증 설정 닫기">닫기</button>
              </div>
              <div className="modal-ux-content"><RequestAuthPanel scope={options.scopeRef.current} bridge={options.bridgeRef.current} /></div>
            </div></div>
          </div>
        </div>;
      },
      operation: (Original: SwaggerComponent) => function AccessibleOperation(props: any) {
        const operation = props.operation as SwaggerMap | undefined;
        const path = textValue(mapValue(operation, "path"));
        const method = textValue(mapValue(operation, "method"));
        const tag = textValue(mapValue(operation, "tag"));
        const operationId = textValue(mapValue(operation, "operationId")) || textValue(mapValue(operation, "id"));
        const isShown = props.isShown === true || mapValue(operation, "isShown") === true;
        useLayoutEffect(() => {
          if (!tag || !operationId) return;
          const target = [...document.querySelectorAll<HTMLElement>(".api-swagger-renderer .opblock")]
            .find(element => element.id.endsWith(`-${operationId}`));
          if (target) {
            target.dataset.checklyPath = path;
            target.dataset.checklyMethod = method;
            target.dataset.checklyDeepLinkTag = tag;
            target.dataset.checklyDeepLinkOperation = operationId;
          }
        }, [operationId, tag]);
        useEffect(() => {
          if (isShown && path && method) options.publishSelection({ path, method });
          else if (options.selectedRef.current?.path === path && options.selectedRef.current?.method === method) options.publishSelection(null);
        }, [isShown, method, path]);
        return <Original {...props} />;
      },
      parameterRow: (Original: SwaggerComponent) => function AccessibleParameterRow(props: any) {
        const rawParam = props.rawParam as SwaggerMap | undefined;
        const name = textValue(mapValue(rawParam, "name"));
        const location = textValue(mapValue(rawParam, "in"));
        useLayoutEffect(() => {
          if (!name || !location) return;
          // Avoid allocating and scanning every parameter row for each mounted parameter.
          const input = document.querySelector<HTMLElement>(`.swagger-ui tr[data-param-name="${CSS.escape(name)}"][data-param-in="${CSS.escape(location)}"] input, .swagger-ui tr[data-param-name="${CSS.escape(name)}"][data-param-in="${CSS.escape(location)}"] textarea, .swagger-ui tr[data-param-name="${CSS.escape(name)}"][data-param-in="${CSS.escape(location)}"] select`);
          input?.setAttribute("aria-label", `${location} ${name}`);
          const row = input?.closest<HTMLElement>("tr");
          row?.setAttribute("data-checkly-param-name", name);
          row?.setAttribute("data-checkly-param-in", location);
        }, [location, name]);
        return <Original {...props} />;
      },
      liveResponse: (Original: SwaggerComponent) => function AccessibleLiveResponse(props: any) {
        return <div role="region" aria-label="API 응답"><Original {...props} /></div>;
      },
      responses: (Original: SwaggerComponent) => function AccessibleResponses(props: any) {
        return <div role="region" aria-label="Responses 응답 명세"><Original {...props} /></div>;
      },
      RequestBodyEditor: (Original: SwaggerComponent) => function AccessibleRequestBodyEditor(props: any) {
        const containerRef = useRef<HTMLDivElement>(null);
        useLayoutEffect(() => {
          containerRef.current?.querySelector("textarea")?.setAttribute("aria-label", "요청 본문 JSON");
        });
        return <div ref={containerRef} data-checkly-body-editor><Original {...props} /></div>;
      },
    },
    statePlugins: {
      layout: {
        wrapActions: {
          show: (original: (...args: any[]) => unknown) => (...args: any[]) => {
            const result = original(...args);
            updateDeepLinkHash(args[0], args[1]);
            return result;
          },
        },
      },
      spec: {
        wrapActions: {
          changeParamByIdentity: (original: (...args: any[]) => unknown) => (...args: any[]) => {
            const result = original(...args);
            const param = args[1];
            options.editRef.current(args[0], textValue(mapValue(param, "in")), textValue(mapValue(param, "name")), args[2]);
            return result;
          },
          execute: (original: (args: Record<string, unknown>) => unknown, system: SwaggerSystem) => (args: Record<string, unknown> = {}) => {
            if (options.composingRef.current) return;
            const path = textValue(args.path);
            const method = textValue(args.method);
            if (!path || !method) return original(args);
            const selection = { path, method };
            options.selectedRef.current = selection;
            options.busyRef.current = true;
            options.setBusy(true);
            options.publishSelection(selection);
            return (async () => {
              let url = path;
              try {
                const request = buildRequest(options.catalogRef.current, selection, system);
                url = requestUrl(options.baseUrlRef.current, path, request);
                const shownRequest = displayRequest(selection, url, request);
                system.specActions.setRequest(path, method, shownRequest);
                system.specActions.setMutatedRequest?.(path, method, shownRequest);
                const response = await options.bridgeRef.current.executeLive(options.scopeRef.current, `${method.toUpperCase()} ${path}`, request);
                if (response.httpStatus === undefined && response.error) system.specActions.setResponse(path, method, responseFromError(response.error, url));
                else system.specActions.setResponse(path, method, responseFromApi(response, url));
              } catch (error) {
                system.specActions.setResponse(path, method, responseFromError(error, url));
              } finally {
                options.busyRef.current = false;
                options.setBusy(false);
                options.publishSelection(selection);
              }
            })();
          },
        },
      },
      oas3: { wrapActions: {
        setRequestBodyValue: (original: (args: any) => unknown) => (args: any) => {
          const result = original(args);
          options.editRef.current(args.pathMethod, "body", "", args.value);
          return result;
        },
      } },
    },
  });
}

export function ApiDocumentation({ catalog, scope, bridge, baseUrl, busy, onBusy, onRunAction, project, initialEdit, onEditConsumed }: {
  catalog: ApiCatalog; scope: ApiScope; bridge: ApiTestingBridge; baseUrl: string; busy: boolean;
  onBusy: (value: boolean) => void; onRunAction: OnRunAction;
  project: ApiProject;
  initialEdit?: { saved: SavedApiScenario; scenario: Scenario };
  onEditConsumed?: () => void;
}) {
  const [composing, setComposing] = useState(Boolean(initialEdit));
  useEffect(() => { if (initialEdit) onEditConsumed?.(); }, []);
  const [composeView, setComposeView] = useState<"select" | "edit">("select");
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const restoring = useRef(false);
  const rawBodies = useRef(new Map<string, string>());
  const editRef = useRef<(pathMethod: string[], area: string, name: string, value: unknown) => void>(() => {});
  const composeToolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!composing) return;
    const frame = requestAnimationFrame(() => composeToolbar.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [composing]);
  const [draft, setDraft] = useState<Scenario>(() => initialEdit?.scenario ?? ({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] }));
  const [saved, setSaved] = useState<SavedApiScenario | null>(initialEdit?.saved ?? null);
  const flowSource = useMemo(() => scenarioFlow(draft), [draft]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const newScenario = () => {
    setActiveStepId(null); rawBodies.current.clear();
    setComposeView("select");
    setDraft({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] });
    setSaved(null); setDirty(false); setIssues([]); setNotice(""); setConfirmClose(false);
    setEditorVersion(version => version + 1);
  };
  const changeDraft = (next: Scenario) => { setDraft(next); setDirty(true); setNotice(""); setIssues([]); };
  useEffect(() => { onBusy(composing || saving); }, [composing, saving, onBusy]);
  useEffect(() => {
    if (!composing || !dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [composing, dirty]);
  const composingRef = useRef(composing);
  composingRef.current = composing;
  const catalogRef = useRef(catalog);
  const baseUrlRef = useRef(baseUrl);
  const bridgeRef = useRef(bridge);
  const scopeRef = useRef(scope);
  const systemRef = useRef<SwaggerSystem | null>(null);
  editRef.current = (pathMethod, area, name, value) => {
    if (restoring.current || !composing || !activeStepId || !pathMethod) return;
    const current = draft.steps.find(s => s.id === activeStepId);
    if (!current) return;
    const op = catalog.operations.find(o => "operationId" in current.api ? o.operationId === current.api.operationId : o.path === current.api.path && o.method.toUpperCase() === current.api.method);
    if (!op || op.path !== pathMethod[0] || op.method.toLowerCase() !== pathMethod[1]?.toLowerCase()) return;
    const request = { ...current.request };
    if (area === "body") {
      if (typeof value !== "string") return;
      rawBodies.current.set(current.id, value);
      try {
        const trimmed = value.trim();
        request.body = trimmed ? /^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(trimmed) ? trimmed : JSON.parse(trimmed) : undefined;
      }
      catch { setDirty(true); setNotice("본문 JSON 문법을 확인하세요. 입력 내용은 이 단계에 유지됩니다."); return; }
    } else {
      const key = area === "path" ? "pathParams" : area === "query" ? "query" : area === "header" ? "headers" : area === "cookie" ? "cookies" : null;
      if (!key || !name) return;
      const values: Record<string, Json> = { ...request[key] };
      const plain = value && typeof (value as any).toJS === "function" ? (value as any).toJS() : value;
      if (plain === undefined) delete values[name]; else values[name] = plain as Json & string;
      if (key === "headers") request.headers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
      else if (key === "cookies") request.cookies = values;
      else request[key] = values;
    }
    setDraft(previous => ({ ...previous, steps: previous.steps.map(s => s.id === current.id ? { ...s, request } : s) }));
    setDirty(true);
  };
  const locateCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => locateCleanup.current?.(), []);
  const locateStep = (step: Scenario["steps"][number]) => {
    locateCleanup.current?.();
    const system = systemRef.current;
    const operation = catalog.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
    if (!system || !operation || step.server !== scope.serverId) { setNotice("현재 Swagger 명세에서 이 API를 찾을 수 없습니다."); return; }
    setActiveStepId(step.id);
    const restoreRequest = () => {
      restoring.current = true;
      try {
        for (const param of operation.parameters) {
          const area = param.location === "path" ? "pathParams" : param.location === "query" ? "query" : param.location === "header" ? "headers" : param.location === "cookie" ? "cookies" : null;
          if (area) system.specActions.changeParam([operation.path, operation.method.toLowerCase()], param.name, param.location, step.request[area]?.[param.name]);
        }
        system.oas3Actions?.setRequestBodyValue({ pathMethod: [operation.path, operation.method.toLowerCase()], value: rawBodies.current.get(step.id) ?? (step.request.body === undefined ? "" : JSON.stringify(step.request.body, null, 2)) });
      } finally { restoring.current = false; }
    };
    system.layoutActions.updateFilter("");
    for (const tag of operation.tags?.length ? operation.tags : [operation.tag]) system.layoutActions.show(["operations-tag", tag], true);
    const root = document.querySelector(".api-swagger-renderer");
    if (!root) return;
    let highlighted: HTMLElement | undefined;
    const find = () => {
      const target = [...root.querySelectorAll<HTMLElement>(".opblock")].find(el => el.dataset.checklyPath === operation.path && el.dataset.checklyMethod?.toUpperCase() === operation.method.toUpperCase());
      if (!target) return false;
      highlighted = target;
      const tag = target.dataset.checklyDeepLinkTag, id = target.dataset.checklyDeepLinkOperation;
      if (tag && id) { system.layoutActions.show(["operations", tag, id], true); updateDeepLinkHash(["operations", tag, id], true); }
      // Swagger mounts the request editor only after the operation opens. Restoring
      // before that mount gets replaced by the example value on first selection.
      requestAnimationFrame(restoreRequest);
      target.scrollIntoView({ block: "center" });
      target.classList.add("api-located-operation");
      return true;
    };
    const observer = new MutationObserver(() => { if (find()) observer.disconnect(); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checkly-path", "data-checkly-method"] });
    const frame = requestAnimationFrame(() => { if (find()) observer.disconnect(); });
    const timeout = window.setTimeout(() => { observer.disconnect(); highlighted?.classList.remove("api-located-operation"); }, 2500);
    locateCleanup.current = () => { cancelAnimationFrame(frame); window.clearTimeout(timeout); observer.disconnect(); highlighted?.classList.remove("api-located-operation"); };
  };
  const selectedRef = useRef<Selection | null>(null);
  const busyRef = useRef(busy);
  catalogRef.current = catalog;
  baseUrlRef.current = baseUrl;
  bridgeRef.current = bridge;
  scopeRef.current = scope;
  busyRef.current = busy;

  const publishSelection = (selection: Selection | null) => {
    selectedRef.current = selection;
    if (!selection || composingRef.current) {
      onRunAction(null);
      return;
    }
    onRunAction({
      disabled: busyRef.current,
      run: () => {
        const current = systemRef.current;
        const selected = selectedRef.current;
        if (current && selected && !composingRef.current) void current.specActions.execute(selected);
      },
    });
  };
  const plugin = useMemo(() => createSwaggerPlugin({ catalogRef, baseUrlRef, bridgeRef, scopeRef, systemRef, selectedRef, busyRef, publishSelection, setBusy: onBusy, composingRef, editRef }), []);
  const plugins = useMemo(() => [plugin], [plugin]);
  const onComplete = useMemo(() => (value: unknown) => {
    systemRef.current = value as SwaggerSystem;
    applyDeepLink(systemRef.current, window.location.hash);
  }, []);
  const spec = useMemo(() => buildSpec(catalog, baseUrl), [baseUrl, catalog]);

  useLayoutEffect(() => {
    if (!composing) return;
    const root = document.querySelector<HTMLElement>(".api-swagger-renderer");
    if (!root) return;
    const created = new Set<HTMLButtonElement>();
    const addButton = (host: Element, data: Record<string, string>, label: string) => {
      if (host.querySelector(":scope > .api-operation-add")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "api-operation-add";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = saving;
      for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
      const icon = document.createElement("span");
      icon.className = "msi";
      icon.textContent = "add_link";
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
      host.append(button);
      created.add(button);
    };
    const install = () => {
      for (const block of root.querySelectorAll<HTMLElement>(".opblock")) {
        const path = block.dataset.checklyPath;
        const method = block.dataset.checklyMethod;
        const summary = block.querySelector<HTMLElement>(":scope > .opblock-summary");
        if (path && method && summary) addButton(summary, { checklyPath: path, checklyMethod: method }, "시나리오에 API 추가");
      }
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checkly-path", "data-checkly-method", "data-checkly-param-name", "data-checkly-param-in"] });
    return () => { observer.disconnect(); for (const button of created) button.remove(); };
  }, [catalog.importedAt, composing, saving]);

  useEffect(() => {
    const handleNavigation = () => applyDeepLink(systemRef.current, window.location.hash);
    window.addEventListener("hashchange", handleNavigation);
    window.addEventListener("popstate", handleNavigation);
    const timer = window.setTimeout(handleNavigation, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", handleNavigation);
      window.removeEventListener("popstate", handleNavigation);
    };
  }, []);

  useEffect(() => {
    return () => {
      onRunAction(null);
      if (busyRef.current) void bridge.cancel(scopeRef.current);
      onBusy(false);
    };
  }, [bridge, onBusy, onRunAction, scope.environmentId, scope.projectId, scope.serverId]);

  return <section className="api-documentation api-swagger-ui" aria-label="API 문서 목록" onClick={handleSwaggerClick}
    onClickCapture={event => {
      if (!composing || !(event.target instanceof Element)) return;
      const addButton = event.target.closest<HTMLElement>(".api-operation-add");
      if (addButton) {
        event.preventDefault(); event.stopPropagation();
        if (saving) return;
        const block = addButton.closest<HTMLElement>(".opblock");
        const operation = catalog.operations.find(o => o.path === block?.dataset.checklyPath && o.method.toLowerCase() === block?.dataset.checklyMethod?.toLowerCase());
        if (operation) changeDraft({ ...draft, steps: [...draft.steps, {
          id: `step-${crypto.randomUUID()}`, name: operation.summary || `${operation.method} ${operation.path}`,
          server: scope.serverId, api: apiReference(operation), request: {}, extract: [],
        }] });
        return;
      }
      if (saving) return;
    }}>
    <div className="api-actions" ref={composeToolbar}>
      <button type="button" disabled={saving || (!composing && busy)} aria-pressed={composing} onClick={() => {
        if (composing && dirty) { setConfirmClose(true); return; }
        setComposing(!composing); onRunAction(null);
      }}>{composing ? "작성 닫기" : "시나리오 작성"}</button>
      {composing && <button type="button" className="api-primary" disabled={saving || !draft.steps.length} onClick={() => setComposeView(composeView === "select" ? "edit" : "select")}>{composeView === "select" ? `선택한 API ${draft.steps.length}개 · 시나리오 작성` : "API 추가"}</button>}
      {composing && saved && <button type="button" disabled={saving || dirty} onClick={newScenario}>새 시나리오</button>}
      {composing && <span role="status">{draft.steps.length}개 단계 · {dirty ? "저장 전" : saved ? "저장됨" : "API를 선택하세요"}</span>}
      {composing && composeView === "select" && <span className="api-compose-legend"><span className="msi" aria-hidden="true">add_link</span>추가 · <span className="msi" aria-hidden="true">expand_more</span>상세 열기</span>}
      {composing && activeStepId && <span role="status">현재 확인: {draft.steps.findIndex(s => s.id === activeStepId) + 1}단계 · 값 설정은 오른쪽 시나리오 편집기에서 진행합니다.</span>}
      {composing && draft.steps.length > 0 && <Diagram key={flowSource} source={flowSource} title="흐름 보기 · 호출 순서와 응답 연결" />}
    </div>
    {confirmClose && <div role="alert" className="api-warning">저장하지 않은 변경사항이 있습니다. 계속 작성해서 저장하거나 변경사항을 버리고 닫으세요.
      <button type="button" onClick={() => setConfirmClose(false)}>계속 작성</button>
      <button type="button" onClick={() => { newScenario(); setComposing(false); }}>변경사항 버리고 닫기</button>
    </div>}
    <p className="api-spec-meta">실시간 응답은 원문으로 표시됩니다. 토큰·개인정보가 포함될 수 있으니 복사·화면 공유에 주의하세요. 응답은 자동 저장하지 않습니다.</p>
    <div className={composing ? `api-compose-flow${composeView === "select" ? " api-selection-layout" : ""}` : undefined}>
    <div className="api-swagger-renderer" hidden={composing && composeView === "edit"} data-scroll="light">
      <StableSwaggerUI
        spec={spec}
        plugins={plugins}
        onComplete={onComplete}
        docExpansion="list"
        deepLinking
        filter
        displayRequestDuration
        validatorUrl={null}
        defaultModelsExpandDepth={-1}
        defaultModelExpandDepth={1}
        supportedSubmitMethods={submitMethods}
        showExtensions={false}
        showCommonExtensions={false}
      />
    </div>
    {composing && composeView === "select" && <aside className="api-selection-basket" aria-label="선택한 API" data-scroll="light">
      <h2>선택한 API · {draft.steps.length}개</h2>
      {!draft.steps.length && <p>Swagger 행의 체인 아이콘으로 엔드포인트를 추가하세요. 행 본문은 상세 열기입니다.</p>}
      <SelectedApiList scenario={draft} disabled={saving} onChange={changeDraft} onLocate={locateStep} />
      {notice && <p role="status">{notice}</p>}
      <button type="button" className="api-primary" disabled={saving || !draft.steps.length} onClick={() => setComposeView("edit")}>선택 완료 · 시나리오 편집</button>
    </aside>}
    {composing && <aside hidden={composeView !== "edit"} className="api-compose-editor" aria-label="Swagger 시나리오 작성" data-scroll="light" onChangeCapture={() => { setDirty(true); setNotice(""); }}>
      <header><h2>시나리오 작성</h2><span>선택 → 설정 → 검사·저장</span></header>
      <ScenarioBuilder key={editorVersion} source="" value={draft} onChange={changeDraft} embedded saving={saving} bindings={{}} project={project} scope={scope} bridge={bridge} onCancel={() => {}} onApply={async yaml => {
        setSaving(true); setNotice(""); setIssues([]);
        try {
          for (const step of draft.steps) {
            const raw = rawBodies.current.get(step.id);
            if (raw?.trim() && !/^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(raw.trim())) { try { JSON.parse(raw); } catch { throw new Error(`${scenarioStepLabel(step)}: Swagger에서 입력한 본문 JSON 문법을 확인하세요.`); } }
          }
          const preview = await bridge.previewScenario(scope, yaml, {});
          setIssues(preview.issues);
          const item = await (preview.issues.length ? bridge.saveScenarioDraft : bridge.saveScenario)(scope, yaml, {}, saved?.id === preview.scenario.id ? saved.updatedAt : undefined);
          setSaved(item); setDirty(false);
          setNotice(preview.issues.length ? "초안으로 저장했습니다. 아래 항목을 보완하세요." : "시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.");
        } catch (error) { setIssues([(error as Error).message]); }
        finally { setSaving(false); }
      }} />
      {notice && <p role="status">{notice}</p>}
      {issues.length > 0 && <ul role="alert" className="api-warning">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    </aside>}
    </div>
  </section>;
}
