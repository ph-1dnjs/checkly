import { useEffect, useLayoutEffect, useRef } from "react";
import type { ApiCatalog, ApiScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import { RequestAuthPanel } from "./RequestAuthPanel";
import { DescriptionMarkdown } from "./DescriptionMarkdown";
import { type SwaggerMap, type SwaggerSystem, type Selection, type MutableRef, type SwaggerComponent } from "./swagger-types";
import { updateDeepLinkHash } from "./swagger-deep-link";
import { mapValue, textValue, buildRequest, requestUrl, displayRequest, responseFromApi, responseFromError, tagNames } from "./swagger-request";

export const submitMethods = ["get", "put", "post", "delete", "options", "head", "patch"];
export function createSwaggerPlugin(options: {
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
                url = requestUrl(options.baseUrlRef.current, path, request, options.catalogRef.current.operations.find(operation => operation.path === path && operation.method.toLowerCase() === method.toLowerCase()));
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
