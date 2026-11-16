import { type ReactElement, type ReactNode } from "react";
import { browserSessionPartition, type BrowserSession } from "./model";
import type { NetworkSpec } from "./networkSpec";
import type { SharedOpenApiSource } from "./sharedOpenApi";
import { NetworkRequestDetail } from "./NetworkRequestDetail";
import {
  isSessionError,
  isNetworkFailure,
  isContractWarning,
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

import { Button } from "../../shared/ui/Button";
import { Popover } from "../../shared/ui/Popover";
import { Input } from "../../shared/ui/Input";
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
  spec,
  specLoading,
  specSources = [],
  specErrors = [],
  selectedSpecSource = "",
  onSpecSource,
  onRefreshSpec,
  onCopyUrl,
  filter,
  activeSessionName,
  heading = "이 세션의 요청",
  onSelect,
  onBack,
  onFilter,
  onCopy,
  onCreateOverride,
  onClear,
  onDownload,
  description = "이 로그인 세션의 API·페이지 오류만 표시",
  emptyDescription = "사이트에서 조회·저장 등의 동작을 실행해 보세요.",
}: {
  events: NetworkEvent[];
  selectedEvent: NetworkEvent | null;
  spec?: NetworkSpec;
  specLoading?: boolean;
  specSources?: SharedOpenApiSource[];
  specErrors?: string[];
  selectedSpecSource?: string;
  onSpecSource?: (source: string) => void;
  onRefreshSpec?: () => void;
  onCopyUrl: (url: string) => void;
  filter: "all" | "errors" | "warnings";
  activeSessionName: string;
  heading?: string;
  onSelect: (event: NetworkEvent) => void;
  onBack: () => void;
  onFilter: (filter: "all" | "errors" | "warnings") => void;
  onCopy: () => void;
  onCreateOverride: () => void;
  onClear: () => void;
  onDownload: () => void;
  description?: string;
  emptyDescription?: string;
}): ReactElement => {
  const errorCount = events.filter(isNetworkFailure).length;
  const isWarning = isContractWarning;
  const warningCount = events.filter(isWarning).length;
  const visible = filter === "errors" ? events.filter(isNetworkFailure) : filter === "warnings" ? events.filter(isWarning) : events;
  return (
    <>
      {!selectedEvent && <>
      <div className="fa-network-heading"><strong>{heading}</strong><span title={description}>{activeSessionName} · 화면을 움직이면 쌓여요</span>
        <Popover label="네트워크 더보기" panelClassName="fa-network-menu" triggerClassName="fa-more-trigger" triggerText={<MaterialIcon name="more_horiz" />}>
          <Button variant="ghost" disabled={!events.length} onClick={onDownload}><MaterialIcon name="download" /> 기록 내려받기</Button>
          <Button variant="ghost" className="danger" disabled={!events.length} onClick={onClear}><MaterialIcon name="delete" /> 모두 지우기</Button>
        </Popover>
      </div>
      <div className="fa-network-filters" role="group" aria-label="요청 필터">
        <Button aria-pressed={filter === "all"} onClick={() => onFilter("all")}><span>전체 요청</span><b>{events.length}</b></Button>
        <Button className="danger" aria-pressed={filter === "errors"} onClick={() => onFilter("errors")}><span>오류</span><b>{errorCount}</b></Button>
        <Button className="warning" aria-pressed={filter === "warnings"} onClick={() => onFilter("warnings")}><span>스펙 경고</span><b>{warningCount}</b></Button>
      </div>
      <div className="fa-request-list" data-ck-scroll="light">
        {!visible.length ? (
          <EmptyState icon={filter === "errors" ? "check_circle" : "lan"} title={filter === "errors" ? "저장된 오류가 없습니다" : "아직 수집된 기록이 없습니다"} description={filter === "errors" ? "페이지와 API가 정상적으로 동작하고 있습니다." : emptyDescription} />
        ) : visible.map((item) => {
          const failed = isNetworkFailure(item);
          const method = item.type === "navigation" ? "PAGE" : item.method || "ERROR";
          let title = item.error || item.url;
          if (item.category !== "page") {
            try { title = new URL(item.url).pathname; } catch { /* 원문 유지 */ }
          }
          return (
            <Button className={`fa-request-row${failed ? " error" : ""}${isWarning(item) ? " warning" : ""}`} key={item.id} onClick={() => onSelect(item)}>
              <span className={`fa-method ${method.toLowerCase()}`}>{method}</span>
              <strong title={title}>{title}</strong><small>{item.category === "page" ? shortTime(item.at) : `${item.status || "연결 실패"} · ${item.elapsed ?? "-"}ms${item.overridden ? " · OVERRIDE" : ""}`}</small>
              <MaterialIcon name={failed ? "error" : isWarning(item) ? "warning" : "check_circle"} />
            </Button>
          );
        })}
      </div>
      </>}
      {selectedEvent && <div className="fa-detail-back"><Button variant="ghost" onClick={onBack}><MaterialIcon name="chevron_left" /> 요청 목록</Button></div>}
      {selectedEvent && (["fetch", "xhr"].includes(selectedEvent.type) ? <NetworkRequestDetail
        key={selectedEvent.id}
        event={selectedEvent}
        sessionName={activeSessionName}
        spec={spec}
        specLoading={specLoading}
        specSources={specSources}
        specErrors={specErrors}
        selectedSpecSource={selectedSpecSource}
        onSpecSource={onSpecSource}
        onRefreshSpec={onRefreshSpec}
        onCopy={onCopy}
        onCopyUrl={onCopyUrl}
        onCreateOverride={onCreateOverride}
      /> : <div className={`fa-request-detail${isSessionError(selectedEvent) ? " error" : ""}`}>
        <div className="fa-detail-title"><strong>{selectedEvent.type === "navigation" ? "페이지 활동" : "오류 상세"}</strong><Status tone={isSessionError(selectedEvent) ? "danger" : "neutral"}>{selectedEvent.type === "navigation" ? "페이지 이동" : "페이지 오류"}</Status></div>
        <p>{selectedEvent.error || selectedEvent.contract?.detail}</p>
        <dl><div><dt>발생 시각</dt><dd>{new Date(selectedEvent.at).toLocaleString("ko-KR")}</dd></div><div><dt>페이지</dt><dd>{selectedEvent.pageUrl || selectedEvent.url}</dd></div></dl>
        <details><summary>기술 정보 보기</summary><pre>{stringify({ error: selectedEvent.error, source: selectedEvent.source, line: selectedEvent.line, stack: selectedEvent.stack })}</pre></details>
      </div>)}
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
      <div className="fa-inspector-heading"><div><strong>현재 세션 저장소</strong><span>{activeSession.name}에 저장된 브라우저 값만 표시</span></div><Button variant="secondary" onClick={onRefresh} disabled={busy}><MaterialIcon name={busy ? "progress_activity" : "refresh"} /> 새로고침</Button></div>
      <div className="fa-storage-session"><MaterialIcon name="database" /><span><strong>{activeSession.name}</strong><small>{current ? snapshot.origin || host : host}</small></span><Status tone={busy ? "warning" : "success"}>{busy ? "읽는 중" : "현재 세션"}</Status></div>
      <div className="fa-storage-meta"><code>{browserSessionPartition(activeSession.id)}</code><span>{current && snapshot.capturedAt ? `${shortTime(snapshot.capturedAt)} 기준` : "아직 읽지 않음"}</span></div>
      <div className="fa-storage-tabs" role="group" aria-label="저장소 종류">
        {(["localStorage", "sessionStorage", "cookies"] as const).map((value) => <Button key={value} className={bucket === value ? "active" : ""} onClick={() => onBucket(value)}>{value === "cookies" ? "쿠키" : value} <b>{counts[value]}</b></Button>)}
      </div>
      <div className="fa-storage-tools"><Input aria-label="저장소 검색" leading={<MaterialIcon name="search" />} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="key 또는 value 검색" /><Button variant="secondary" disabled={!filtered.length} onClick={() => onCopy(filtered, bucket)}><MaterialIcon name="content_copy" /> 전체 복사</Button></div>
      <div className="fa-storage-list">
        {busy && !current ? <EmptyState icon="progress_activity" title="현재 세션을 읽는 중입니다" description="잠시 기다려 주세요." />
          : error ? <EmptyState icon="error" title={error} description="현재 사이트의 저장소 접근 정책을 확인해 주세요." />
            : filtered.length ? filtered.map((item, index) => <article className="fa-storage-entry" key={`${item.key}-${index}`}><header><code>{item.key}</code><span>{item.bytes.toLocaleString()} B</span><Button variant="ghost" iconOnly aria-label={`${item.key} 복사`} onClick={() => onCopy([item], item.key)}><MaterialIcon name="content_copy" /></Button></header><pre>{readableStorageValue(item.value)}</pre></article>)
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
  const fieldName = path.length ? path.join(".") : "response";
  const type = resolved.type || (Array.isArray(value) ? "array" : value !== null && typeof value === "object" ? "object" : typeof value);
  if (type === "object" && value && !Array.isArray(value)) {
    return <>{Object.entries(value as Record<string, unknown>).map(([key, child]) => <OverrideFieldEditor key={[...path, key].join(".")} document={document} schema={resolved.properties?.[key]} value={child} path={[...path, key]} onChange={onChange} depth={depth + 1} />)}</>;
  }
  if (type === "array" && Array.isArray(value)) {
    return <details className="fa-override-array" open={depth < 2}><summary>{fieldName} <span>{value.length}개 · array</span></summary><div>{value.slice(0, 20).map((child, index) => <OverrideFieldEditor key={[...path, index].join(".")} document={document} schema={resolved.items} value={child} path={[...path, index]} onChange={onChange} depth={depth + 1} />)}{value.length > 20 && <p>앞의 20개 항목만 표시합니다. 전체 데이터는 JSON에서 수정할 수 있습니다.</p>}</div></details>;
  }
  const enumValues = resolved.enum || resolved.oneOf?.map((item) => item.const).filter((item) => item !== undefined);
  const label = <span><strong>{fieldName}</strong><small>{enumValues?.length ? `enum · ${type}` : type}{resolved.description ? ` · ${resolved.description}` : ""}</small></span>;
  if (enumValues?.length) return <label className="fa-override-field">{label}<select value={JSON.stringify(value)} onChange={(event) => onChange(path, enumValues.find((option) => JSON.stringify(option) === event.target.value))}>{resolved.nullable && <option value="null">null</option>}{enumValues.map((option) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</select></label>;
  if (type === "boolean") return <label className="fa-override-field">{label}<select value={String(value)} onChange={(event) => onChange(path, event.target.value === "true")}><option value="true">true</option><option value="false">false</option></select></label>;
  if (type === "number" || type === "integer") return <label className="fa-override-field">{label}<Input type="number" step={type === "integer" ? 1 : "any"} min={resolved.minimum} max={resolved.maximum} value={value == null ? "" : String(value)} onChange={(event) => onChange(path, event.target.value === "" ? null : Number(event.target.value))} /></label>;
  if (String(value ?? "").length > 100) return <label className="fa-override-field textarea">{label}<textarea value={String(value ?? "")} onChange={(event) => onChange(path, event.target.value)} /></label>;
  return <label className="fa-override-field">{label}<Input type={resolved.format === "date" ? "date" : resolved.format === "date-time" ? "datetime-local" : "text"} value={value === null ? "null" : String(value ?? "")} onChange={(event) => onChange(path, event.target.value)} /></label>;
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
  onChooseResponse,
  onCreateBlank,
  editing,
  onEditing,
  onToggleRule,
  onSave,
  onReset,
  onDelete,
  note = "저장하면 정확히 일치하는 API를 다시 조회합니다. 서버와 다른 사용자 데이터에는 영향을 주지 않습니다.",
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
  onChooseResponse: () => void;
  onCreateBlank: () => void;
  editing: boolean;
  onEditing: (value: boolean) => void;
  onToggleRule: (id: string, enabled: boolean) => void;
  onSave: () => void;
  onReset: () => void;
  onDelete: () => void;
  note?: string;
}): ReactElement => (
  <>
    {!selected ? <div className="fa-override-welcome"><span className="fa-welcome-icon"><MaterialIcon name="swap_horiz" /></span><strong>서버 응답을 바꿔서 테스트해요</strong><p>오류 화면이나 드문 데이터를 서버를 고치지 않고 확인할 수 있어요.<br />바꾼 응답은 이 화면에만 적용돼요.</p><Button variant="primary" size="large" onClick={onChooseResponse}><MaterialIcon name="lan" /> 네트워크에서 응답 고르기</Button><Button variant="ghost" onClick={onCreateBlank}>직접 만들기</Button></div> : !editing ? <div className="fa-override-list">
      <div className="fa-override-list-heading"><strong>바꾼 응답</strong><span>켜 둔 것만 이 화면에 적용돼요</span><Button variant="secondary" onClick={onCreateBlank}><MaterialIcon name="add" /> 추가</Button></div>
      {overrides.map(rule => <article className={`fa-rule-card${rule.enabled ? " enabled" : ""}`} key={rule.id}>
        <div><strong><span className={`fa-method ${rule.method.toLowerCase()}`}>{rule.method}</span><code title={rule.match}>{rule.match}</code></strong><small><b>{rule.status}</b> · {rule.body && typeof rule.body === "object" && "message" in rule.body ? String(rule.body.message) : rule.name}</small></div>
        <Button variant="ghost" onClick={() => { onSelect(rule.id); onEditing(true); }}>편집</Button>
        <Button className="fa-rule-toggle" role="switch" aria-label={`${rule.method} ${rule.match} 적용`} aria-checked={rule.enabled} onClick={() => onToggleRule(rule.id, !rule.enabled)}><span /></Button>
      </article>)}
    </div> : <div className="fa-override-editor">
      <div className="fa-detail-back"><Button variant="ghost" onClick={() => onEditing(false)}><MaterialIcon name="chevron_left" /> 바꾼 응답 목록</Button></div>
      <div className="fa-override-heading"><strong>응답 바꾸기</strong><Popover label="규칙 상태·고급 설정" triggerClassName="fa-more-trigger" triggerText={<MaterialIcon name="more_horiz" />}><div className="fa-override-options"><label>적용할 API<select value={selected.id} onChange={(event) => onSelect(event.target.value)}>{overrides.map((item) => <option value={item.id} key={item.id}>{item.method} · {item.match}</option>)}</select></label>
      <div className={`fa-override-status ${status.tone}`}><MaterialIcon name={status.applied ? "check_circle" : selected.enabled ? "pending" : "circle"} /><span><strong>{status.title}</strong><small>{status.detail}</small></span><Status tone={status.tone}>{status.applied ? "OVERRIDE" : selected.enabled ? "대기" : "원본"}</Status></div>
      <div className="fa-override-switch"><Button className={selected.enabled ? "on" : ""} onClick={() => onUpdate({ enabled: !selected.enabled })}><span><i /></span>{selected.enabled ? "이 응답 오버라이드 활성" : "오버라이드 비활성"}</Button><Button variant="danger" iconOnly className="danger" aria-label="오버라이드 규칙 삭제" onClick={onDelete}><MaterialIcon name="delete" /></Button></div>
      <label>상태 코드<Input type="number" value={selected.status} onChange={event => onUpdate({ status: Number(event.target.value) || 200 })} /></label>
      <Button variant="secondary" disabled={!selected.enabled} onClick={onReset}><MaterialIcon name="restart_alt" /> 초기화</Button>
      </div></Popover></div>
      <div className="fa-override-target"><strong>어떤 요청을</strong><div><select aria-label="오버라이드 요청 메서드" value={selected.method} onChange={event => onUpdate({ method: event.target.value })}>{["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].map(method => <option key={method}>{method}</option>)}</select><Input mono aria-label="오버라이드 API 경로" value={selected.match} onChange={event => onUpdate({ match: event.target.value })} /></div></div>
      <div className="fa-override-label">이렇게 응답해요</div>
      <div className="fa-status-presets" role="group" aria-label="응답 상태 코드">{[[200, "성공"], [400, "잘못된 요청"], [401, "인증 실패"], [500, "서버 오류"]].map(([code, label]) => <Button key={code} aria-pressed={selected.status === code} onClick={() => onUpdate({ status: Number(code) })}><b>{code}</b> {label}</Button>)}</div>
      <div className="fa-override-tabs"><Button aria-pressed={editorMode === "fields"} className={editorMode === "fields" ? "active" : ""} onClick={() => onEditorMode("fields")}>항목으로</Button><Button aria-pressed={editorMode === "json"} className={editorMode === "json" ? "active" : ""} onClick={() => onEditorMode("json")}>JSON</Button></div>
      {editorMode === "fields" ? <div className="fa-override-fields">{parsedBody && typeof parsedBody === "object" ? <OverrideFieldEditor document={openApi} schema={schema} value={parsedBody} onChange={onFieldChange} /> : <div className="fa-override-json-error"><MaterialIcon name="error" /> JSON 형식을 먼저 수정해 주세요.</div>}</div> : <label>Response body JSON<textarea className="fa-override-json" spellCheck={false} value={bodyText} onChange={(event) => onBodyText(event.target.value)} /></label>}
      <p className="fa-override-note"><MaterialIcon name="info" /> {note}</p>
      <div className="fa-override-actions"><Button variant="secondary" size="large" onClick={() => onEditing(false)}>목록으로</Button><Button variant="primary" size="large" onClick={onSave}><MaterialIcon name="check" /> 저장 및 적용</Button></div>
    </div>}
  </>
);
