import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiCatalog, ApiDocInput, ApiScope, ApiTestingBridge } from "../../../../app/api-testing/shared/workspace";
import { docInputFromRequest } from "../../../../app/api-testing/shared/doc-inputs";
import { RequestAuthPanel } from "../../../features/api-testing/configure-request-auth";
import { DescriptionMarkdown } from "./DescriptionMarkdown";
import { type SwaggerMap, type SwaggerSystem, type Selection, type MutableRef, type SwaggerComponent } from "../model/swagger-types";
import { updateDeepLinkHash } from "../lib/swagger-deep-link";
import { mapValue, textValue, buildRequest, requestUrl, displayRequest, responseFromApi, responseFromError, tagNames } from "../lib/swagger-request";

export const submitMethods = ["get", "put", "post", "delete", "options", "head", "patch"];
export function createSwaggerPlugin(options: {
  catalogRef: MutableRef<ApiCatalog | null>;
  baseUrlRef: MutableRef<string>;
  bridgeRef: MutableRef<ApiTestingBridge>;
  scopeRef: MutableRef<ApiScope>;
  systemRef: MutableRef<SwaggerSystem | null>;
  selectedRef: MutableRef<Selection | null>;
  busyRef: MutableRef<boolean>;
  publishSelection: (selection: Selection | null) => void;
  setBusy: (busy: boolean) => void;
  composingRef: MutableRef<boolean>;
  /** Last "Try it out" values per operation key ("METHOD path"), loaded for the docs' server. */
  docInputsRef: MutableRef<Record<string, ApiDocInput>>;
}) {
  // Swagger keys parameter values by the parameter itself (not by name), so set them through the raw
  // parameters it hands its rows (ones from operationWithMeta carry values and hash differently).
  // `valueOf` returns undefined to leave a parameter as it is.
  const setParameters = (system: SwaggerSystem, path: string, method: string, parameters: unknown, valueOf: (location: string, name: string) => { value: unknown } | undefined) => {
    if (!parameters || typeof (parameters as { forEach?: unknown }).forEach !== "function") return;
    (parameters as { forEach: (callback: (parameter: SwaggerMap) => void) => void }).forEach(parameter => {
      const next = valueOf(textValue(mapValue(parameter, "in")), textValue(mapValue(parameter, "name")));
      if (next) system.specActions.changeParamByIdentity([path, method], parameter, next.value);
    });
  };
  const fillRemembered = (system: SwaggerSystem, path: string, method: string, parameters: unknown, input: ApiDocInput) => {
    const areas: Record<string, Record<string, unknown> | undefined> = { path: input.pathParams, query: input.query, header: input.headers, cookie: input.cookies };
    setParameters(system, path, method, parameters, (location, name) => {
      const value = areas[location]?.[name];
      // Array parameters are Immutable lists in Swagger's state; leave them to the user.
      if (value === undefined || Array.isArray(value)) return undefined;
      return { value: typeof value === "object" && value !== null ? JSON.stringify(value) : value };
    });
    if (input.body !== undefined) system.oas3Actions?.setRequestBodyValue({ pathMethod: [path, method], value: JSON.stringify(input.body, null, 2) });
  };
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
      parameters: (Original: SwaggerComponent) => function RememberedParameters(props: any) {
        const [path, method] = (props.pathMethod ?? []) as string[];
        const key = path && method ? `${method.toUpperCase()} ${path}` : "";
        const [remembered, setRemembered] = useState(() => Boolean(key && options.docInputsRef.current[key]));
        useEffect(() => {
          const input = key ? options.docInputsRef.current[key] : undefined;
          setRemembered(Boolean(input));
          const system = options.systemRef.current;
          if (!props.tryItOutEnabled || options.composingRef.current || !input || !system) return;
          // After Swagger's own mount-time defaults; a timer (not rAF) also runs in hidden windows.
          const timer = window.setTimeout(() => fillRemembered(system, path, method, props.parameters, input), 0);
          return () => window.clearTimeout(timer);
        }, [props.tryItOutEnabled, key]);
        const forget = () => {
          delete options.docInputsRef.current[key];
          setRemembered(false);
          void options.bridgeRef.current.forgetDocInput(options.scopeRef.current, key).catch(() => undefined);
          const system = options.systemRef.current;
          if (system) setParameters(system, path, method, props.parameters, () => ({ value: undefined }));
          props.onResetClick?.([path, method]);
        };
        return <>
          {props.tryItOutEnabled && remembered && !options.composingRef.current && <p className="api-doc-remembered" role="status">마지막으로 실행한 값을 채웠습니다. 비밀번호·토큰은 저장하지 않습니다.<button type="button" className="api-compose-link" onClick={forget}>기억한 값 지우기</button></p>}
          <Original {...props} />
        </>;
      },
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
          const catalog = options.catalogRef.current;
          if (system && catalog) for (const tag of tagNames(system, catalog)) system.layoutActions.show(["operations-tag", tag], shown);
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
              <div className="modal-ux-header"><h3>전역변수 토큰 연결</h3>
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
                const catalog = options.catalogRef.current;
                if (!catalog) throw new Error("선택한 서버·환경에 API 명세가 없습니다.");
                const request = buildRequest(catalog, selection, system);
                // Mirrors what the main process stores, so a reopened editor refills without reloading.
                const remembered = docInputFromRequest(request);
                if (remembered) options.docInputsRef.current[`${method.toUpperCase()} ${path}`] = remembered;
                else delete options.docInputsRef.current[`${method.toUpperCase()} ${path}`];
                url = requestUrl(options.baseUrlRef.current, path, request, catalog.operations.find(operation => operation.path === path && operation.method.toLowerCase() === method.toLowerCase()));
                const shownRequest = displayRequest(selection, url, request);
                system.specActions.setRequest(path, method, shownRequest);
                system.specActions.setMutatedRequest?.(path, method, shownRequest);
                const response = await options.bridgeRef.current.execute(options.scopeRef.current, `${method.toUpperCase()} ${path}`, request);
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
    },
  });
}
