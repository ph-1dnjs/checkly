import { useId, useState } from "react";
import { isSessionError, stringify, type NetworkEvent } from "./liveQa";
import { bodyFields, asObject, mediaSchema, parameterFields } from "./networkFields";
import { NetworkFieldTable } from "./NetworkFieldTable";
import type { NetworkSpec } from "./networkSpec";
import { openApiSourceId, type SharedOpenApiSource } from "./sharedOpenApi";

export type NetworkRequestDetailProps = {
  event: NetworkEvent;
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

export function NetworkRequestDetail({ event, spec, specLoading, specSources, specErrors, selectedSpecSource, onSpecSource, onRefreshSpec, onCopy, onCopyUrl, onCreateOverride }: NetworkRequestDetailProps) {
  const [tab, setTab] = useState<"request" | "response">(["GET", "HEAD"].includes(event.method || "GET") ? "response" : "request");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const id = useId();
  let url = event.url;
  let path = event.url;
  try { const parsed = new URL(event.url, event.pageUrl); url = parsed.href; path = parsed.pathname; } catch { /* Keep the captured URL. */ }
  const needsConnection = !spec || spec.matchKind === "path" || specErrors.length > 0;
  const showSettings = settingsOpen;
  const parameters = spec ? parameterFields(spec, event) : [];
  const definition = tab === "request" ? spec?.requestBody : spec?.response;
  const media = mediaSchema(definition, tab === "response" ? event.responseContentType : undefined);
  const value = tab === "request" ? event.requestBody : event.responseBody;
  const fields = media.schema !== undefined ? bodyFields(media.schema, value, tab === "response" || asObject(definition).required === true, tab) : [];
  const connectionLabel = specLoading ? "Swagger 확인 중" : specErrors.length ? `Swagger 오류 ${specErrors.length}건` : !spec ? "Swagger 미연결" : spec.matchKind === "path" ? "Swagger 확인 필요" : "Swagger 연결됨";

  return <section className={`fa-request-detail fa-api-detail${isSessionError(event) ? " error" : ""}`} aria-label="API 요청 상세" data-ck-scroll="light">
    <header className="fa-api-summary">
      <div className="fa-api-heading">
        <div className="fa-api-path"><span className={`fa-method ${(event.method || "get").toLowerCase()}`}>{event.method || "GET"}</span><code title={url}>{path}</code><button type="button" className="fa-api-icon" aria-label="전체 URL 복사" title="전체 URL 복사" onClick={() => onCopyUrl(url)}><Icon name="content_copy" /></button></div>
        <div className="fa-api-actions"><button type="button" onClick={onCopy}><Icon name="content_copy" /> API 스펙 복사</button><button type="button" onClick={onCreateOverride}><Icon name="tune" /> 응답 오버라이드</button></div>
      </div>
      <div className="fa-api-meta"><span className={Number(event.status) >= 400 || !event.status ? "danger" : ""}>{event.status || "연결 실패"} · {event.elapsed ?? "—"}ms</span><span className={`fa-contract-label ${event.contract?.tone || "neutral"}`}>{event.contract?.label || "스펙 미연결"}</span><button type="button" className={`fa-spec-toggle${needsConnection ? " attention" : ""}`} aria-expanded={showSettings} aria-controls={`${id}-connection`} onClick={() => setSettingsOpen(!showSettings)}>{connectionLabel}<Icon name={showSettings ? "expand_less" : "expand_more"} /></button></div>
    </header>
    {event.error && <p className="fa-api-alert" role="status">{event.error}</p>}
    {showSettings && <section className="fa-network-spec" id={`${id}-connection`} aria-label="Swagger 연결 설정">
      <div className="fa-spec-heading"><strong>Swagger 연결</strong><button type="button" onClick={onRefreshSpec} disabled={specLoading}>{specLoading ? "불러오는 중…" : "문서 새로고침"}</button></div>
      <label className="fa-spec-source">연결 문서<select aria-label="연결할 Swagger 문서" value={selectedSpecSource} onChange={change => { onSpecSource?.(change.target.value); setSettingsOpen(false); }}>
        <option value="">자동 연결 · {specSources.length}개 문서</option>
        {specSources.map(source => <option key={openApiSourceId(source)} value={openApiSourceId(source)}>{source.label}</option>)}
      </select></label>
      {spec ? <details className="fa-spec-metadata"><summary>문서 상세</summary>
        <p>{spec.title || "API 문서"} · {spec.source}</p>
        <p>{spec.matchKind === "address" ? "서버 주소·경로·메서드 일치" : spec.matchKind === "selected" ? "직접 선택한 문서로 연결" : "경로·메서드 일치 · 서버 주소 확인 필요"}</p>
        <dl><div><dt>문서 서버</dt><dd>{spec.baseUrl}</dd></div><div><dt>API 경로</dt><dd>{spec.method} {spec.path}</dd></div>{spec.importedAt && <div><dt>가져온 시각</dt><dd>{new Date(spec.importedAt).toLocaleString("ko-KR")}</dd></div>}</dl>
        {spec.matchKind === "path" && <p>요청 서버와 문서 서버가 다릅니다. 문서를 선택하면 해당 문서로 계약을 검사합니다.</p>}
      </details> : <p>{specLoading ? "Swagger 문서를 불러오는 중입니다." : event.contract?.detail || "연결할 문서를 선택해 주세요."}</p>}
      {specErrors.length > 0 && <details className="fa-spec-errors"><summary>문서 불러오기 실패 {specErrors.length}건</summary>{specErrors.map(error => <p key={error}>{error}</p>)}</details>}
    </section>}
    <div className="fa-payload-tabs" role="tablist" aria-label="요청·응답">
      {(["request", "response"] as const).map((item, index) => <button type="button" key={item} id={`${id}-${item}-tab`} role="tab" aria-selected={tab === item} aria-controls={`${id}-payload`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={key => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key.key)) {
          key.preventDefault();
          const next = key.key === "Home" ? "request" : key.key === "End" ? "response" : index === 0 ? "response" : "request";
          setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus();
        }
      }}>{item === "request" ? "요청" : "응답"}</button>)}
      {spec?.summary && <span title={spec.summary}>{spec.summary}</span>}
    </div>
    <div className="fa-payload-content" id={`${id}-payload`} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`} key={tab}>
      {tab === "request" && parameters.length > 0 && <section className="fa-field-section"><h4>파라미터 <small>{parameters.length}개</small></h4><NetworkFieldTable fields={parameters} direction="request" label="요청 파라미터" /></section>}
      <section className="fa-field-section">
        <h4>{tab === "request" ? "요청 본문" : "응답 본문"}{media.mediaType && <small>{media.mediaType}</small>}</h4>
        {fields.length > 0 ? <NetworkFieldTable fields={fields} direction={tab} label={tab === "request" ? "요청 본문 필드" : "응답 본문 필드"} /> : <>
          <p className="fa-payload-notice">{!spec ? "연결된 스키마가 없어 실제 값만 표시합니다." : tab === "response" ? "문서에 응답 형식이 정의되어 있지 않습니다." : "문서에 요청 본문 형식이 정의되어 있지 않습니다."}</p>
          {value !== undefined ? <pre className="fa-actual-payload" aria-label={tab === "request" ? "실제 요청" : "실제 응답"}>{stringify(value)}</pre> : <p className="fa-payload-empty">{tab === "request" ? "전송한 본문이 없습니다." : "수집된 응답 본문이 없습니다."}</p>}
        </>}
      </section>
      <details className="fa-payload-raw"><summary>원본 JSON</summary>{media.schema !== undefined && <><h4>실제 {tab === "request" ? "요청" : "응답"}</h4><pre>{value === undefined ? "본문 없음" : stringify(value)}</pre></>}{definition != null && <><h4>Swagger 정의</h4><pre>{stringify(definition)}</pre></>}{tab === "request" && parameters.length > 0 && <><h4>Swagger 파라미터</h4><pre>{stringify(spec?.parameters)}</pre></>}</details>
    </div>
    <footer className="fa-api-footer">
      <details className="fa-api-metadata"><summary>요청 정보</summary><dl><div><dt>전체 URL</dt><dd>{url}</dd></div><div><dt>발생 시각</dt><dd>{new Date(event.at).toLocaleString("ko-KR")}</dd></div><div><dt>페이지</dt><dd>{event.pageUrl || "—"}</dd></div></dl>{spec?.description && <p>{spec.description}</p>}{event.contract?.detail && <p>{event.contract.detail}</p>}</details>
    </footer>
  </section>;
}
