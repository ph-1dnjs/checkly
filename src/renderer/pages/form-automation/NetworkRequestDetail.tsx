import { Button } from "../../shared/ui/Button";
import { useId, useState } from "react";
import { isSessionError, stringify, type NetworkEvent } from "./liveQa";
import { bodyFields, asObject, mediaSchema, parameterFields } from "./networkFields";
import { NetworkFieldTable } from "./NetworkFieldTable";
import { NetworkValueTable } from "./NetworkValueTable";
import type { NetworkSpec } from "./networkSpec";
import { type SharedOpenApiSource } from "./sharedOpenApi";

export type NetworkRequestDetailProps = {
  event: NetworkEvent;
  sessionName: string;
  spec?: NetworkSpec;
  specLoading?: boolean;
  specSources: SharedOpenApiSource[];
  specErrors: string[];
  selectedSpecSource: string;
  onSpecSource?: (source: string) => void;
  onRefreshSpec?: () => void;
  onCopy: () => void;
  onCopyUrl: (url: string) => void;
  onCreateOverride: () => void;
};

const Icon = ({ name }: { name: string }) => <span className="msi" aria-hidden="true">{name}</span>;

export function NetworkRequestDetail({ event, sessionName, spec, specLoading, specSources, specErrors, selectedSpecSource, onSpecSource, onRefreshSpec, onCopy, onCopyUrl, onCreateOverride }: NetworkRequestDetailProps) {
  const [tab, setTab] = useState<"request" | "response">("response");
  const id = useId();
  let url = event.url;
  let path = event.url;
  try { const parsed = new URL(event.url, event.pageUrl); url = parsed.href; path = parsed.pathname; } catch { /* Keep the captured URL. */ }
  const parameters = spec ? parameterFields(spec, event) : [];
  const definition = tab === "request" ? spec?.requestBody : spec?.response;
  const media = mediaSchema(definition, tab === "response" ? event.responseContentType : undefined);
  const value = tab === "request" ? event.requestBody : event.responseBody;
  const fields = media.schema !== undefined ? bodyFields(media.schema, value, tab === "response" || asObject(definition).required === true, tab) : [];

  return <section className={`fa-request-detail fa-api-detail${isSessionError(event) ? " error" : ""}`} aria-label="API 요청 상세" data-ck-scroll="light">
    <header className="fa-api-summary">
      <div className="fa-api-heading">
        <div className="fa-api-path"><span className={`fa-method ${(event.method || "get").toLowerCase()}`}>{event.method || "GET"}</span><code title={url}>{path}</code><Button type="button" className="fa-api-icon" aria-label="전체 URL 복사" title="전체 URL 복사" onClick={() => onCopyUrl(url)}><Icon name="content_copy" /></Button></div>

      </div>
      <div className="fa-api-meta"><span className={Number(event.status) >= 400 || !event.status ? "danger" : ""}>{event.status || "연결 실패"} · {event.elapsed ?? "—"}ms</span><span className={`fa-contract-label ${event.contract?.tone || "neutral"}`}>{event.contract?.label || "스펙 미연결"}</span></div>
    </header>
    {event.error && <p className="fa-api-alert" role="status">{event.error}</p>}
    <div className="fa-payload-tabs" role="tablist" aria-label="요청·응답">
      {(["response", "request"] as const).map((item, index) => <Button type="button" key={item} id={`${id}-${item}-tab`} role="tab" aria-selected={tab === item} aria-controls={`${id}-payload`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={key => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key.key)) {
          key.preventDefault();
          const next = key.key === "Home" ? "response" : key.key === "End" ? "request" : index === 0 ? "request" : "response";
          setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus();
        }
      }}>{item === "request" ? "요청" : "응답"}</Button>)}

    </div>
    <div className="fa-payload-content" id={`${id}-payload`} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`} key={tab}>
      {tab === "request" && <div className="fa-value-table-wrap"><table className="fa-network-values" aria-label="요청 정보"><tbody>
        {[['메서드', event.method || 'GET'], ['주소', url], ['세션', event.browserSessionName || sessionName]].map(([label, text]) => <tr key={label}><th scope="row">{label}</th><td><code>{text}</code></td></tr>)}
      </tbody></table></div>}
      {tab === "request" && (() => {
        try {
          const query = Object.fromEntries(new URL(event.url, event.pageUrl).searchParams.entries());
          return Object.keys(query).length ? <NetworkValueTable value={query} label="요청 파라미터" /> : null;
        } catch { return null; }
      })()}
      {event.contract?.tone === "danger" && <div className="fa-contract-warning" role="status"><Icon name="warning" /><span><strong>스펙과 다른 값이 있어요.</strong><br />{event.contract.detail}</span></div>}
      {value !== undefined ? <NetworkValueTable value={value} label={tab === "request" ? "실제 요청" : "실제 응답"} /> : <p className="fa-payload-empty">{tab === "request" ? "전송한 본문이 없습니다." : "수집된 응답 본문이 없습니다."}</p>}
      {fields.length > 0 && <details className="fa-schema-details"><summary>스펙 필드 상세 · 타입·필수 여부</summary><NetworkFieldTable fields={fields} direction={tab} label={tab === "request" ? "요청 본문 필드" : "응답 본문 필드"} /></details>}
      <details className="fa-payload-raw"><summary>원본 JSON</summary>{value !== undefined && <><h4>실제 {tab === "request" ? "요청" : "응답"}</h4><pre>{value === undefined ? "본문 없음" : stringify(value)}</pre></>}{definition != null && <><h4>Swagger 정의</h4><pre>{stringify(definition)}</pre></>}{tab === "request" && parameters.length > 0 && <><h4>Swagger 파라미터</h4><pre>{stringify(spec?.parameters)}</pre></>}</details>
    </div>
    <footer className="fa-api-footer">
      <details className="fa-api-metadata"><summary>요청 정보</summary><dl><div><dt>전체 URL</dt><dd>{url}</dd></div><div><dt>발생 시각</dt><dd>{new Date(event.at).toLocaleString("ko-KR")}</dd></div><div><dt>페이지</dt><dd>{event.pageUrl || "—"}</dd></div></dl>{spec?.description && <p>{spec.description}</p>}{event.contract?.detail && <p>{event.contract.detail}</p>}</details>
    </footer>
    <div className="fa-api-actions"><Button variant="secondary" size="large" onClick={onCreateOverride}><Icon name="swap_horiz" /> 이 응답 바꿔 보기</Button><Button variant="secondary" size="large" onClick={onCopy}><Icon name="content_copy" /> 스펙 복사</Button></div>
  </section>;
}
