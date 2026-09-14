import { type MouseEvent, type ReactElement, type ReactNode } from "react";
import { browserSessionPartition, type BrowserSession } from "./model";
import {
  isSessionError,
  readableStorageValue,
  resolveSchema,
  shortTime,
  stringify,
  type NetworkEvent,
  type OpenApiDocument,
  type OpenApiSchema,
  type OverrideRule,
  type StorageItem,
  type StorageSnapshot,
} from "./liveQa";

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span className="msi" aria-hidden="true">{name}</span>
);

const EmptyState = ({ icon, title, description }: { icon: string; title: string; description: string }) => (
  <div className="fa-panel-empty"><MaterialIcon name={icon} /><strong>{title}</strong><span>{description}</span></div>
);

const Status = ({ tone = "neutral", children }: { tone?: string; children: ReactNode }) => (
  <span className={`fa-panel-status ${tone}`}>{children}</span>
);

export const NetworkPanel = ({
  events,
  selectedEvent,
  filter,
  activeSessionName,
  onSelect,
  onFilter,
  onCopy,
  onCreateOverride,
  onClear,
  onDownload,
  listHeight,
  onResizeList,
  onResetListHeight,
}: {
  events: NetworkEvent[];
  selectedEvent: NetworkEvent | null;
  filter: "all" | "errors";
  activeSessionName: string;
  onSelect: (event: NetworkEvent) => void;
  onFilter: (filter: "all" | "errors") => void;
  onCopy: () => void;
  onCreateOverride: () => void;
  onClear: () => void;
  onDownload: () => void;
  listHeight: number;
  onResizeList: (event: MouseEvent<HTMLDivElement>) => void;
  onResetListHeight: () => void;
}): ReactElement => {
  const errorCount = events.filter(isSessionError).length;
  const visible = filter === "errors" ? events.filter(isSessionError) : events;
  return (
    <>
      <div className={`fa-network-health${errorCount ? " danger" : ""}`}>
        <MaterialIcon name={errorCount ? "error" : "verified_user"} />
        <span><strong>{errorCount ? `오류 ${errorCount}건을 발견했습니다` : "현재까지 발견된 오류가 없습니다"}</strong><small>{errorCount ? "서버·네트워크·페이지 오류를 표시합니다." : "활동 기록은 앱을 종료해도 로컬에 보관됩니다."}</small></span>
      </div>
      <div className="fa-inspector-heading">
        <div><strong>{activeSessionName} 타임라인</strong><span>이 로그인 세션의 API·페이지 오류만 표시</span></div>
        {events.length > 0 && <div className="fa-heading-actions"><button onClick={onDownload}><MaterialIcon name="download" /> 다운로드</button><button onClick={onClear}><MaterialIcon name="delete" /> 전체 삭제</button></div>}
      </div>
      <div className="fa-network-filters">
        <button className={filter === "all" ? "active" : ""} onClick={() => onFilter("all")}>전체 {events.length}</button>
        <button className={filter === "errors" ? "active danger" : "danger"} onClick={() => onFilter("errors")}><MaterialIcon name="error" /> 오류만 {errorCount}</button>
      </div>
      <div className="fa-request-list" style={{ height: listHeight }}>
        {!visible.length ? (
          <EmptyState icon={filter === "errors" ? "check_circle" : "lan"} title={filter === "errors" ? "저장된 오류가 없습니다" : "아직 수집된 기록이 없습니다"} description={filter === "errors" ? "페이지와 API가 정상적으로 동작하고 있습니다." : "사이트에서 조회·저장 등의 동작을 실행해 보세요."} />
        ) : visible.map((item) => {
          const failed = isSessionError(item);
          const method = item.method || "ERROR";
          let title = item.error || item.url;
          if (item.category !== "page") {
            try { title = new URL(item.url).pathname; } catch { /* 원문 유지 */ }
          }
          return (
            <button className={`fa-request-row${failed ? " error" : ""}${selectedEvent?.id === item.id ? " selected" : ""}`} key={item.id} onClick={() => onSelect(item)}>
              <span className={`fa-method ${method.toLowerCase()}`}>{method}</span>
              <span><strong>{title}</strong><small>{item.category === "page" ? `${item.type} · ${shortTime(item.at)}` : `${item.status || "연결 실패"} · ${item.elapsed ?? "-"}ms${item.overridden ? " · OVERRIDE" : ""}`}</small></span>
              <MaterialIcon name={failed ? "cancel" : "check_circle"} />
            </button>
          );
        })}
      </div>
      <div
        className="fa-timeline-resizer"
        role="separator"
        aria-label="네트워크 목록 높이 조절"
        title="위아래로 드래그해서 요청 목록 높이 조절 · 더블클릭해서 초기화"
        onMouseDown={onResizeList}
        onDoubleClick={onResetListHeight}
      ><MaterialIcon name="drag_handle" /></div>
      {selectedEvent && (
        <div className={`fa-request-detail${isSessionError(selectedEvent) ? " error" : ""}`}>
          <div className="fa-detail-title">
            <strong>{isSessionError(selectedEvent) ? "오류 상세" : selectedEvent.type === "navigation" ? "페이지 활동" : "계약 검사"}</strong>
            <div>
              {["fetch", "xhr"].includes(selectedEvent.type) && <button onClick={onCopy}><MaterialIcon name="content_copy" /> API 스펙 복사</button>}
              <Status tone={isSessionError(selectedEvent) ? "danger" : selectedEvent.contract?.tone}>{selectedEvent.category === "page" ? "페이지 오류" : selectedEvent.type === "navigation" ? "페이지 이동" : selectedEvent.contract?.label || "스펙 미연결"}</Status>
            </div>
          </div>
          <p>{selectedEvent.error || selectedEvent.contract?.detail}</p>
          <dl>
            <div><dt>발생 시각</dt><dd>{new Date(selectedEvent.at).toLocaleString("ko-KR")}</dd></div>
            <div><dt>상태</dt><dd>{selectedEvent.category === "page" || selectedEvent.type === "navigation" ? selectedEvent.type : `${selectedEvent.status || "Network error"} · ${selectedEvent.elapsed ?? "-"}ms`}</dd></div>
            <div><dt>페이지</dt><dd>{selectedEvent.pageUrl || selectedEvent.url}</dd></div>
          </dl>
          {["fetch", "xhr"].includes(selectedEvent.type) && <button className="fa-create-override" onClick={onCreateOverride}><MaterialIcon name="tune" /> 이 응답으로 오버라이드 만들기</button>}
          <details><summary>기술 정보 보기</summary><pre>{stringify({ error: selectedEvent.error, source: selectedEvent.source, line: selectedEvent.line, stack: selectedEvent.stack, request: selectedEvent.requestBody, response: selectedEvent.responseBody })}</pre></details>
        </div>
      )}
    </>
  );
};

export const StoragePanel = ({
  activeSession,
  currentPageUrl,
  snapshot,
  busy,
  bucket,
  query,
  onBucket,
  onQuery,
  onRefresh,
  onCopy,
}: {
  activeSession: BrowserSession;
  currentPageUrl: string;
  snapshot: StorageSnapshot;
  busy: boolean;
  bucket: "localStorage" | "sessionStorage" | "cookies";
  query: string;
  onBucket: (bucket: "localStorage" | "sessionStorage" | "cookies") => void;
  onQuery: (query: string) => void;
  onRefresh: () => void;
  onCopy: (items: StorageItem[], label: string) => void;
}): ReactElement => {
  const current = snapshot.browserSessionId === activeSession.id;
  const counts = current ? {
    localStorage: snapshot.localStorage.items.length,
    sessionStorage: snapshot.sessionStorage.items.length,
    cookies: snapshot.cookies.length,
  } : { localStorage: 0, sessionStorage: 0, cookies: 0 };
  const items = current ? (bucket === "cookies" ? snapshot.cookies : snapshot[bucket].items) : [];
  const filtered = items.filter((item) => `${item.key} ${item.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  const error = current && bucket !== "cookies" ? snapshot[bucket].error : "";
  let host = currentPageUrl;
  try { host = new URL(currentPageUrl).host; } catch { /* 원문 유지 */ }
  return (
    <>
      <div className="fa-inspector-heading"><div><strong>현재 세션 저장소</strong><span>{activeSession.name}에 저장된 브라우저 값만 표시</span></div><button onClick={onRefresh} disabled={busy}><MaterialIcon name={busy ? "progress_activity" : "refresh"} /> 새로고침</button></div>
      <div className="fa-storage-session"><MaterialIcon name="database" /><span><strong>{activeSession.name}</strong><small>{current ? snapshot.origin || host : host}</small></span><Status tone={busy ? "warning" : "success"}>{busy ? "읽는 중" : "현재 세션"}</Status></div>
      <div className="fa-storage-meta"><code>{browserSessionPartition(activeSession.id)}</code><span>{current && snapshot.capturedAt ? `${shortTime(snapshot.capturedAt)} 기준` : "아직 읽지 않음"}</span></div>
      <div className="fa-storage-tabs" role="group" aria-label="저장소 종류">
        {(["localStorage", "sessionStorage", "cookies"] as const).map((value) => <button key={value} className={bucket === value ? "active" : ""} onClick={() => onBucket(value)}>{value === "cookies" ? "쿠키" : value} <b>{counts[value]}</b></button>)}
      </div>
      <div className="fa-storage-tools"><label><MaterialIcon name="search" /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="key 또는 value 검색" /></label><button disabled={!filtered.length} onClick={() => onCopy(filtered, bucket)}><MaterialIcon name="content_copy" /> 전체 복사</button></div>
      <div className="fa-storage-list">
        {busy && !current ? <EmptyState icon="progress_activity" title="현재 세션을 읽는 중입니다" description="잠시 기다려 주세요." />
          : error ? <EmptyState icon="error" title={error} description="현재 사이트의 저장소 접근 정책을 확인해 주세요." />
            : filtered.length ? filtered.map((item, index) => <article className="fa-storage-entry" key={`${item.key}-${index}`}><header><code>{item.key}</code><span>{item.bytes.toLocaleString()} B</span><button aria-label={`${item.key} 복사`} onClick={() => onCopy([item], item.key)}><MaterialIcon name="content_copy" /></button></header><pre>{readableStorageValue(item.value)}</pre></article>)
              : <EmptyState icon="database" title={query ? "검색 결과가 없습니다" : `현재 ${bucket}에 저장된 값이 없습니다`} description={query ? "다른 key나 value로 검색해 보세요." : "현재 페이지에서 로그인이나 저장 동작을 수행해 보세요."} />}
      </div>
      <div className="fa-storage-secondary"><span>IndexedDB <b>{current ? snapshot.indexedDB.length : 0}</b><small>{current && snapshot.indexedDB.length ? snapshot.indexedDB.join(", ") : "없음"}</small></span><span>Cache Storage <b>{current ? snapshot.caches.length : 0}</b><small>{current && snapshot.caches.length ? snapshot.caches.join(", ") : "없음"}</small></span></div>
      <p className="fa-storage-footnote"><MaterialIcon name="info" /> 보안 속성으로 인해 HttpOnly 쿠키는 페이지에서 읽을 수 없습니다.</p>
    </>
  );
};

const OverrideFieldEditor = ({
  document,
  schema,
  value,
  path = [],
  onChange,
  depth = 0,
}: {
  document: OpenApiDocument | null;
  schema?: OpenApiSchema;
  value: unknown;
  path?: Array<string | number>;
  onChange: (path: Array<string | number>, value: unknown) => void;
  depth?: number;
}): ReactElement => {
  const resolved = resolveSchema(document, schema) || {};
  const fieldName = path.length ? String(path[path.length - 1]) : "response";
  const type = resolved.type || (Array.isArray(value) ? "array" : value !== null && typeof value === "object" ? "object" : typeof value);
  if (type === "object" && value && !Array.isArray(value)) {
    return <fieldset className={`fa-override-group${depth === 0 ? " root" : ""}`}><legend>{fieldName}<small>object</small></legend>{Object.entries(value as Record<string, unknown>).map(([key, child]) => <OverrideFieldEditor key={[...path, key].join(".")} document={document} schema={resolved.properties?.[key]} value={child} path={[...path, key]} onChange={onChange} depth={depth + 1} />)}</fieldset>;
  }
  if (type === "array" && Array.isArray(value)) {
    return <details className="fa-override-array" open={depth < 2}><summary>{fieldName} <span>{value.length}개 · array</span></summary><div>{value.slice(0, 20).map((child, index) => <OverrideFieldEditor key={[...path, index].join(".")} document={document} schema={resolved.items} value={child} path={[...path, index]} onChange={onChange} depth={depth + 1} />)}{value.length > 20 && <p>앞의 20개 항목만 표시합니다. 전체 데이터는 JSON에서 수정할 수 있습니다.</p>}</div></details>;
  }
  const enumValues = resolved.enum || resolved.oneOf?.map((item) => item.const).filter((item) => item !== undefined);
  const label = <span><strong>{fieldName}</strong><small>{enumValues?.length ? `enum · ${type}` : type}{resolved.description ? ` · ${resolved.description}` : ""}</small></span>;
  if (enumValues?.length) return <label className="fa-override-field">{label}<select value={JSON.stringify(value)} onChange={(event) => onChange(path, enumValues.find((option) => JSON.stringify(option) === event.target.value))}>{resolved.nullable && <option value="null">null</option>}{enumValues.map((option) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</select></label>;
  if (type === "boolean") return <label className="fa-override-field">{label}<select value={String(value)} onChange={(event) => onChange(path, event.target.value === "true")}><option value="true">true</option><option value="false">false</option></select></label>;
  if (type === "number" || type === "integer") return <label className="fa-override-field">{label}<input type="number" step={type === "integer" ? 1 : "any"} min={resolved.minimum} max={resolved.maximum} value={value == null ? "" : String(value)} onChange={(event) => onChange(path, event.target.value === "" ? null : Number(event.target.value))} /></label>;
  if (String(value ?? "").length > 100) return <label className="fa-override-field textarea">{label}<textarea value={String(value ?? "")} onChange={(event) => onChange(path, event.target.value)} /></label>;
  return <label className="fa-override-field">{label}<input type={resolved.format === "date" ? "date" : resolved.format === "date-time" ? "datetime-local" : "text"} value={value === null ? "null" : String(value ?? "")} onChange={(event) => onChange(path, event.target.value)} /></label>;
};

export const OverridePanel = ({
  openApi,
  overrides,
  selected,
  bodyText,
  editorMode,
  status,
  schema,
  parsedBody,
  onSelect,
  onUpdate,
  onBodyText,
  onEditorMode,
  onFieldChange,
  onCreate,
  onSave,
  onReset,
  onDelete,
}: {
  openApi: OpenApiDocument | null;
  overrides: OverrideRule[];
  selected?: OverrideRule;
  bodyText: string;
  editorMode: "fields" | "json";
  status: { tone: string; title: string; detail: string; applied: boolean };
  schema?: OpenApiSchema;
  parsedBody: unknown;
  onSelect: (id: string) => void;
  onUpdate: (patch: Partial<OverrideRule>) => void;
  onBodyText: (value: string) => void;
  onEditorMode: (mode: "fields" | "json") => void;
  onFieldChange: (path: Array<string | number>, value: unknown) => void;
  onCreate: () => void;
  onSave: () => void;
  onReset: () => void;
  onDelete: () => void;
}): ReactElement => (
  <>
    <div className="fa-inspector-heading"><div><strong>응답 오버라이드</strong><span>현재 웹뷰에만 적용되는 테스트 데이터</span></div><button onClick={onCreate}><MaterialIcon name="add" /> 선택 응답 복제</button></div>
    {!selected ? <EmptyState icon="tune" title="응답 규칙이 없습니다" description="네트워크 응답을 선택한 뒤 오버라이드로 복제해 보세요." /> : <div className="fa-override-editor">
      <label>적용할 API<select value={selected.id} onChange={(event) => onSelect(event.target.value)}>{overrides.map((item) => <option value={item.id} key={item.id}>{item.method} · {item.match}</option>)}</select></label>
      <div className={`fa-override-status ${status.tone}`}><MaterialIcon name={status.applied ? "check_circle" : selected.enabled ? "pending" : "circle"} /><span><strong>{status.title}</strong><small>{status.detail}</small></span><Status tone={status.tone}>{status.applied ? "OVERRIDE" : selected.enabled ? "대기" : "원본"}</Status></div>
      <div className="fa-override-meta"><label>정확한 API 경로<input value={selected.match} onChange={(event) => onUpdate({ match: event.target.value })} /></label><label>상태 코드<input type="number" value={selected.status} onChange={(event) => onUpdate({ status: Number(event.target.value) || 200 })} /></label></div>
      <div className="fa-override-switch"><button className={selected.enabled ? "on" : ""} onClick={() => onUpdate({ enabled: !selected.enabled })}><span><i /></span>{selected.enabled ? "이 응답 오버라이드 활성" : "오버라이드 비활성"}</button><button className="danger" aria-label="오버라이드 규칙 삭제" onClick={onDelete}><MaterialIcon name="delete" /></button></div>
      <div className="fa-override-tabs"><button className={editorMode === "fields" ? "active" : ""} onClick={() => onEditorMode("fields")}><MaterialIcon name="tune" /> 필드 편집</button><button className={editorMode === "json" ? "active" : ""} onClick={() => onEditorMode("json")}><MaterialIcon name="code" /> JSON</button><Status tone={schema ? "success" : "neutral"}>{schema ? "Swagger 타입" : "타입 자동 추론"}</Status></div>
      {editorMode === "fields" ? <div className="fa-override-fields">{parsedBody && typeof parsedBody === "object" ? <OverrideFieldEditor document={openApi} schema={schema} value={parsedBody} onChange={onFieldChange} /> : <div className="fa-override-json-error"><MaterialIcon name="error" /> JSON 형식을 먼저 수정해 주세요.</div>}</div> : <label>Response body JSON<textarea className="fa-override-json" spellCheck={false} value={bodyText} onChange={(event) => onBodyText(event.target.value)} /></label>}
      <p className="fa-override-note"><MaterialIcon name="info" /> 저장하면 정확히 일치하는 API를 다시 조회합니다. 서버와 다른 사용자 데이터에는 영향을 주지 않습니다.</p>
      <div className="fa-override-actions"><button disabled={!selected.enabled} onClick={onReset}><MaterialIcon name="restart_alt" /> 초기화</button><button className="primary" onClick={onSave}><MaterialIcon name="save" /> 저장 및 적용</button></div>
    </div>}
  </>
);
