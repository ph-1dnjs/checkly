import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSession, RecordingScope, SessionRecording } from "../../shared/model/electron-api/live-session";
import { Button } from "../../shared/ui/Button";
import { SessionPlayer } from "./SessionPlayer";

const statusLabel: Record<LiveSession["status"], string> = {
  recording: "오류 후 수집 중", saved: "저장됨", interrupted: "중단된 기록", error: "저장 오류",
};

export const SessionRecordingsDialog = ({ onClose }: { onClose: () => void }) => {
  const dialog = useRef<HTMLElement>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"local" | "team">("local");
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [scope, setScope] = useState<RecordingScope>("local");
  const [uploadableIds, setUploadableIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const uploadInFlight = useRef(false);
  const listRequest = useRef(0);
  const request = useRef(0);
  const api = window.electronAPI?.liveSession;
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>(".ls-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input:not(:disabled), [tabindex="0"]') ?? [])];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  const refresh = useCallback(async () => {
    if (!api) return;
    const current = request.current;
    const listVersion = ++listRequest.current;
    try {
      const result = await api.list(scope);
      if (current !== request.current || listVersion !== listRequest.current) return;
      setSessions(result.sessions); setMode(result.mode ?? "local"); setError(result.error ?? "");
      setUploadableIds(result.uploadableIds ?? []);
      setSelectedIds(previous => previous.filter(id => result.uploadableIds?.includes(id)));
      return result;
    }
    catch (cause) { if (current === request.current && listVersion === listRequest.current) setError(`목록을 불러오지 못했습니다: ${String(cause)}`); }
  }, [api, scope]);
  useEffect(() => {
    void refresh();
    const off = api?.onChanged(() => { if (scope === "local" && !uploadInFlight.current) void refresh(); });
    const offAuth = window.electronAPI?.auth?.onSessionChange(() => {
      request.current++; setSessions([]); setRecording(null); setConfirmDelete(null); setLoading(false); setDownloadMessage("");
      setScope("local"); setSelectedIds([]); setUploadableIds([]); setUploadMessage("");
      if (scope === "local") void refresh();
    });
    return () => { off?.(); offAuth?.(); request.current++; };
  }, [api, refresh, scope]);

  const open = async (id: string) => {
    if (!api) return;
    const current = ++request.current;
    setLoading(true); setError(""); setRecording(null); setConfirmDelete(null); setDownloadMessage("");
    try {
      const result = await api.read(id, scope);
      if (current !== request.current) return;
      setRecording(result); setDocumentId(result.documents[0]?.id ?? "");
    } catch (cause) { if (current === request.current) setError(`기록을 열지 못했습니다: ${String(cause)}`); }
    finally { if (current === request.current) setLoading(false); }
  };
  const document = recording?.documents.find(item => item.id === documentId);
  const switchScope = (next: RecordingScope) => {
    if (next === scope) return;
    request.current++; setScope(next); setSessions([]); setRecording(null); setConfirmDelete(null);
    setSelectedIds([]); setUploadableIds([]); setError(""); setUploadMessage(""); setDownloadMessage(""); setLoading(false);
  };
  const uploadSelected = async () => {
    if (!api || uploadInFlight.current || !selectedIds.length) return;
    const current = request.current;
    uploadInFlight.current = true; setUploading(true); setError(""); setUploadMessage("");
    try {
      const result = await api.upload(selectedIds);
      if (current !== request.current) return;
      const refreshed = await refresh();
      if (current !== request.current) return;
      setSelectedIds(result.failed.map(item => item.id).filter(id => refreshed?.uploadableIds?.includes(id)));
      setUploadMessage(`${result.uploaded.length}개 전송 완료${result.failed.length ? ` · ${result.failed.length}개 실패. 실패한 기록을 다시 선택해 전송할 수 있습니다.` : ""}`);
      if (result.failed.length) setError(result.failed.map(item => `${sessions.find(session => session.id === item.id)?.title || "기록"}: ${item.message}`).join("\n"));
    } catch (cause) { if (current === request.current) setError(`기록을 전송하지 못했습니다: ${String(cause)}`); }
    finally {
      uploadInFlight.current = false; setUploading(false);
      if (current !== request.current) void refresh();
    }
  };

  return <div className="ls-dialog-backdrop">
    <section ref={dialog} className="ls-recordings-dialog" role="dialog" aria-modal="true" aria-label="브라우저 기록">
      <header className="ls-dialog-header">
        <h2>브라우저 기록</h2>
        <span className="ls-local-note">오류 전후 5초 · 입력값 마스킹 · 기본 로컬 저장</span>
        <Button variant="secondary" className="button ls-close" onClick={onClose} aria-label="브라우저 기록 닫기">닫기</Button>
      </header>
    {!api && <div className="ls-notice">로컬 기록·재생은 Electron 앱에서 사용할 수 있습니다.</div>}
    {error && <div className="ls-notice ls-error" role="alert">{error}</div>}
    <div className="ls-sharing-toolbar">
      <div role="group" aria-label="기록 위치" className="ls-scope-buttons">
        <Button variant="secondary" aria-pressed={scope === "local"} disabled={uploading || busy} onClick={() => switchScope("local")}>로컬 기록</Button>
        <Button variant="secondary" aria-pressed={scope === "team"} disabled={mode !== "team" || uploading || busy} onClick={() => switchScope("team")}>서버 기록</Button>
      </div>
    </div>
    <p className="ls-sharing-note" role="status">{uploadMessage || (scope === "team"
      ? "팀에서 공유한 기록입니다. 서버에서 삭제해도 이 PC의 로컬 기록은 남습니다."
      : mode === "team" ? "기록과 API 로그는 이 PC에 저장됩니다. 체크한 기록의 화면과 해당 구간의 API 로그만 서버로 보냅니다."
        : "기록과 API 로그는 이 PC에 저장됩니다. 서버로 보내려면 로그인해 주세요.")}</p>
    <div className="ls-workbench">
      <aside className="ls-session-list" aria-label="저장된 세션">
        <div className="ls-section-label">{scope === "team" ? "서버 기록" : "로컬 기록"} <span>{sessions.length}</span>
          <div className="ls-session-list-actions">
            {scope === "local" && selectedIds.length > 0 && <Button variant="primary" disabled={mode !== "team" || uploading || busy} onClick={() => void uploadSelected()}>
              {uploading ? "전송 중…" : `서버로 보내기 (${selectedIds.length})`}
            </Button>}
            <Button variant="secondary" disabled={uploading || busy} onClick={() => void refresh()}>새로고침</Button>
          </div>
        </div>
        {sessions.map(session => <div data-session-id={session.id} className={`ls-session-row${scope === "local" ? " with-checkbox" : ""}${recording?.session.id === session.id ? " selected" : ""}${selectedIds.includes(session.id) ? " checked" : ""}`} key={session.id}>
          {scope === "local" && <label className="ls-upload-checkbox">
            <input type="checkbox" aria-label={`${session.title || "브라우저 테스트"} 서버 전송 선택`} checked={selectedIds.includes(session.id)}
              disabled={uploading || busy || !uploadableIds.includes(session.id)} onChange={event => {
                setSelectedIds(previous => event.target.checked ? [...previous, session.id] : previous.filter(id => id !== session.id));
              }} />
          </label>}
          <div className="ls-session-content">
            <Button className="ls-session-open" disabled={uploading} onClick={() => void open(session.id)}>
              <strong>{session.title || "브라우저 테스트"}</strong>
              <span className="ls-session-url ls-mono">{session.url}</span>
              <span className="ls-session-meta"><span className={`ls-status ${session.status}`}>{statusLabel[session.status]}</span></span>
              <span className="ls-session-meta ls-mono">{new Date(session.startedAt).toLocaleString("ko-KR")} · {(session.bytes / 1024).toFixed(0)} KB</span>
            </Button>
            {session.error && <p className="ls-error">{session.error}</p>}
            {session.syncStatus === "error" && <p className="ls-error">전송 실패, 다시 선택해 전송하세요.</p>}
            {session.status === "recording" && <span className="ls-local-note">오류 발생 후 5초간의 상황을 수집하고 있습니다.</span>}
            {session.status !== "recording" && (confirmDelete === session.id ? <div className="ls-delete-confirm">
              <span>{scope === "team" ? "서버에서 삭제할까요? 팀원도 볼 수 없게 됩니다." : "이 PC의 기록을 삭제할까요? 서버 사본은 유지됩니다."}</span>
              <Button variant="secondary" className="button" disabled={busy || uploading} onClick={async () => {
                setBusy(true);
                try {
                  await api?.remove(session.id, scope);
                  if (recording?.session.id === session.id) { request.current++; setRecording(null); }
                  setConfirmDelete(null); await refresh();
                } catch (cause) { setError(String(cause)); }
                finally { setBusy(false); }
              }}>삭제 확인</Button>
              <Button variant="secondary" className="button" onClick={() => setConfirmDelete(null)}>취소</Button>
            </div> : <Button variant="ghost" className="ls-delete" disabled={uploading} aria-label={`${session.title} 삭제`} onClick={() => setConfirmDelete(session.id)}>{scope === "team" ? "서버에서 삭제" : "로컬에서 삭제"}</Button>)}
          </div>
        </div>)}
        {!sessions.length && <div className="ls-empty">{scope === "team" ? "서버에 공유된 기록이 없습니다." : "이 PC에 저장된 오류 기록이 없습니다. 오류 전후 5초만 로컬에 자동 저장합니다."}</div>}
      </aside>
      <section className="ls-detail" aria-label="세션 재생">
        {recording ? <>
          <div className="ls-detail-header">
            <strong>{recording.session.title}</strong>
            <select aria-label="기록된 페이지" value={documentId} onChange={event => setDocumentId(event.target.value)}>
              {recording.documents.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title || item.url}</option>)}
            </select>
            <Button variant="secondary" className="button" disabled={downloading || !document?.events.some(event => event.type === 2) || recording.session.status === "recording"} onClick={async () => {
              if (!api || !document) return;
              const current = request.current;
              setDownloading(true); setDownloadMessage(""); setError("");
              try {
                const destination = await api.downloadVideo(recording.session.id, document.id, scope);
                if (current === request.current && destination) setDownloadMessage(`MP4 저장 완료: ${destination}`);
              } catch (cause) { if (current === request.current) setError(`영상을 저장하지 못했습니다: ${String(cause)}`); }
              finally { setDownloading(false); }
            }}>{downloading ? "MP4 저장 중…" : "MP4 다운로드"}</Button>
          </div>
          <p className="ls-timeline-note" role="status">{downloadMessage || "선택한 페이지의 화면만 MP4로 저장합니다. 소리와 API 타임라인은 포함하지 않습니다."}</p>
          {document ? <SessionPlayer key={document.id} document={document} startAt={recording.session.captureStartAt} endAt={recording.session.captureEndAt} errorAt={recording.session.trigger?.at} logs={recording.logs} logsWarning={recording.logsWarning} /> : <div className="ls-empty">기록된 화면이 없습니다.</div>}
        </> : <div className="ls-empty ls-detail-empty">
          <span className="msi" aria-hidden="true">screen_record</span>
          <h2>{loading ? "기록을 불러오는 중…" : "테스트 과정을 다시 확인하세요"}</h2>
          <p>왼쪽 세션을 선택하면 화면과 동작 타임라인을 재생합니다.</p>
          <p>{scope === "team" ? "같은 프로젝트 팀원이 선택해 공유한 기록을 확인할 수 있습니다." : "기록은 이 PC에 저장됩니다. 필요한 기록만 체크해 서버로 보낼 수 있습니다."} 페이지 이동·새로고침·팝업은 페이지 선택에서 확인할 수 있습니다.</p>
        </div>}
      </section>
    </div>
    </section>
  </div>;
};
