import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSession, RecordingScope, SessionRecording } from "../../shared/model/electron-api/live-session";
import { Button } from "../../shared/ui/Button";
import { SessionPlayer } from "./SessionPlayer";

const statusLabel: Record<Exclude<LiveSession["status"], "saved">, string> = {
  recording: "오류 후 수집 중", interrupted: "중단된 기록", error: "저장 오류",
};

export const SessionRecordingsDialog = ({ onClose, initialTeamId }: { onClose: () => void; initialTeamId?: string }) => {
  const dialog = useRef<HTMLElement>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [recording, setRecording] = useState<SessionRecording | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmSelectedDelete, setConfirmSelectedDelete] = useState(false);
  const [deleteToast, setDeleteToast] = useState<{ message: string; id: number } | null>(null);
  const toastId = useRef(0);
  const showDeleteToast = (count: number) => setDeleteToast({ message: `${count}개 기록을 삭제했어요`, id: ++toastId.current });
  useEffect(() => {
    if (!deleteToast) return;
    const timer = window.setTimeout(() => setDeleteToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [deleteToast]);
  const deleteInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"local" | "team">(initialTeamId ? "team" : "local");
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [scope, setScope] = useState<RecordingScope>(initialTeamId ? "team" : "local");
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
    const workspace = dialog.current?.closest(".form-automation-page");
    const background = Array.from(workspace?.querySelectorAll<HTMLElement>(":scope > .fa-screen-header, :scope > .form-automation-workbench") ?? []);
    const previousInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    dialog.current?.querySelector<HTMLButtonElement>(".ls-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      previous?.focus();
    };
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
      const selectableIds = scope === "team" ? result.sessions.filter(session => session.status !== "recording").map(session => session.id) : result.uploadableIds ?? [];
      setSelectedIds(previous => previous.filter(id => selectableIds.includes(id)));
      return result;
    }
    catch (cause) { if (current === request.current && listVersion === listRequest.current) setError(`목록을 불러오지 못했습니다: ${String(cause)}`); }
  }, [api, scope]);
  useEffect(() => {
    void refresh();
    const off = api?.onChanged(() => { if (scope === "local" && !uploadInFlight.current) void refresh(); });
    const offAuth = window.electronAPI?.auth?.onSessionChange(() => {
      request.current++; setSessions([]); setRecording(null); setLoading(false); setDownloadMessage("");
      setScope("local"); setSelectedIds([]); setUploadableIds([]); setUploadMessage("");
      setConfirmSelectedDelete(false); setDeleteToast(null);
      if (scope === "local") void refresh();
    });
    return () => { off?.(); offAuth?.(); request.current++; };
  }, [api, refresh, scope]);

  const open = async (id: string) => {
    if (!api) return;
    const current = ++request.current;
    setLoading(true); setError(""); setRecording(null); setConfirmSelectedDelete(false); setDownloadMessage("");
    try {
      const result = await api.read(id, scope);
      if (current !== request.current) return;
      setRecording(result); setDocumentId(result.documents[0]?.id ?? "");
    } catch (cause) { if (current === request.current) setError(`기록을 열지 못했습니다: ${String(cause)}`); }
    finally { if (current === request.current) setLoading(false); }
  };
  useEffect(() => { if (initialTeamId) void open(initialTeamId).then(() => refresh()); }, [initialTeamId]);
  const document = recording?.documents.find(item => item.id === documentId);
  const switchScope = (next: RecordingScope) => {
    if (next === scope) return;
    request.current++; setScope(next); setSessions([]); setRecording(null);
    setSelectedIds([]); setUploadableIds([]); setError(""); setUploadMessage(""); setDownloadMessage(""); setLoading(false);
    setConfirmSelectedDelete(false); setDeleteToast(null);
  };

  const deletableIds = sessions.filter(session => session.status !== "recording").map(session => session.id);
  const selectableIds = scope === "team" ? deletableIds : sessions.filter(session => uploadableIds.includes(session.id)).map(session => session.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));
  const deleteSelected = async () => {
    if (!api || busy || deleteInFlight.current || !selectedIds.length) return;
    const ids = selectedIds.filter(id => deletableIds.includes(id));
    const current = ++request.current;
    deleteInFlight.current = true; setBusy(true); setLoading(false); setError(""); setDeleteToast(null);
    const deleted: string[] = [];
    const failed: { id: string; message: string }[] = [];
    try {
      for (const id of ids) {
        // Stop issuing deletes if the dialog closes or the account changes.
        if (current !== request.current) return;
        try { await api.remove(id, scope); deleted.push(id); }
        catch (cause) { failed.push({ id, message: String(cause) }); }
      }
      if (current !== request.current) return;
      setSessions(previous => previous.filter(session => !deleted.includes(session.id)));
      setSelectedIds(failed.map(item => item.id));
      if (recording && deleted.includes(recording.session.id)) { setRecording(null); setDownloadMessage(""); }
      setConfirmSelectedDelete(false);
      await refresh();
      if (current !== request.current) return;
      if (deleted.length) showDeleteToast(deleted.length);
      if (failed.length) setError(failed.map(item => `${sessions.find(session => session.id === item.id)?.title || "기록"}: ${item.message}`).join("\n"));
    } finally { deleteInFlight.current = false; setBusy(false); }
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
    <section ref={dialog} className="ls-recordings-dialog" role="dialog" aria-modal="false" aria-label="브라우저 기록">
      <header className="ls-dialog-header">
        <Button variant="ghost" iconOnly className="ls-close" onClick={onClose} aria-label="브라우저 기록 닫기"><span className="msi" aria-hidden="true">chevron_left</span></Button><span className="msi" aria-hidden="true">history</span><h2>브라우저 기록</h2>
        <span className="ls-local-note"><span className="msi" aria-hidden="true">bolt</span> 오류가 나면 전후 5초를 자동 저장해요</span>
      </header>
    {!api && <div className="ls-notice">로컬 기록·재생은 Electron 앱에서 사용할 수 있습니다.</div>}
    {error && <div className="ls-notice ls-error" role="alert">{error}</div>}
    <div className="ls-workbench">
      <aside className="ls-session-list" aria-label="저장된 세션">
    <div className="ls-sharing-toolbar">
      <div role="group" aria-label="기록 위치" className="ls-scope-buttons">
        <Button aria-pressed={scope === "local"} disabled={uploading || busy} onClick={() => switchScope("local")}><span className="msi" aria-hidden="true">computer</span> 이 PC</Button>
        <Button aria-pressed={scope === "team"} disabled={mode !== "team" || uploading || busy} onClick={() => switchScope("team")}><span className="msi" aria-hidden="true">cloud</span> 서버</Button>
      </div>
    </div>
    <p className="ls-sharing-note" role="status"><span className="msi" aria-hidden="true">info</span><span>{uploadMessage || (scope === "team"
      ? "서버 기록은 저장 후 30일이 지나면 자동 삭제됩니다. 이 PC의 로컬 기록은 남습니다."
      : mode === "team" ? "기록과 API 로그는 이 PC에 저장됩니다. 체크한 기록의 화면과 해당 구간의 API 로그만 서버로 보냅니다."
        : "기록과 API 로그는 이 PC에 저장됩니다. 서버로 보내려면 로그인해 주세요.")}</span></p>

        <div className="ls-section-label"><span className="ls-recording-count">{sessions.length}개 기록</span>
          <label className="ls-select-all">
            <input type="checkbox" aria-label={scope === "team" ? "서버 기록 전체 선택" : "로컬 기록 전체 선택"} checked={allSelected}
              ref={element => { if (element) element.indeterminate = selectedIds.length > 0 && !allSelected; }}
              disabled={busy || uploading || !selectableIds.length} onChange={event => {
                setSelectedIds(event.target.checked ? selectableIds : []); setConfirmSelectedDelete(false);
              }} /> 전체 선택
          </label>
          <div className="ls-session-list-actions">
            <Button variant="ghost" iconOnly aria-label="기록 새로고침" disabled={uploading || busy} onClick={() => void refresh()}><span className="msi" aria-hidden="true">refresh</span></Button>
          </div>
        </div>
        {confirmSelectedDelete && selectedIds.length > 0 && <div className="ls-bulk-delete-confirm ls-delete-confirm">
          <span>선택한 {scope === "team" ? "서버" : "이 PC의"} 기록 {selectedIds.length}개를 삭제할까요? {scope === "team" ? "팀원도 볼 수 없게 됩니다. 이 PC의 로컬 기록은 유지됩니다." : "서버 사본은 유지됩니다."}</span>
          <Button variant="danger" disabled={busy} onClick={() => void deleteSelected()}>선택한 {selectedIds.length}개 삭제 확인</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmSelectedDelete(false)}>취소</Button>
        </div>}
        <div className="ls-session-rows">
        {sessions.map(session => <div data-session-id={session.id} className={`ls-session-row with-checkbox${recording?.session.id === session.id ? " selected" : ""}${selectedIds.includes(session.id) ? " checked" : ""}`} key={session.id}>
          <label className="ls-upload-checkbox">
            <input type="checkbox" aria-label={`${session.title || "브라우저 테스트"} ${scope === "team" ? "서버 삭제 선택" : "서버 전송 선택"}`} checked={selectedIds.includes(session.id)}
              disabled={uploading || busy || (scope === "team" ? session.status === "recording" : !uploadableIds.includes(session.id))} onChange={event => {
                setSelectedIds(previous => event.target.checked ? [...previous, session.id] : previous.filter(id => id !== session.id));
                setConfirmSelectedDelete(false);
              }} />
          </label>
          <div className="ls-session-content">
            <Button className="ls-session-open" disabled={uploading || busy} onClick={() => void open(session.id)}>
              <span className="ls-record-title"><strong>{session.title || "브라우저 테스트"}</strong>{session.trigger && <b className="ls-error-count">오류 1</b>}</span>
              <span className="ls-session-url ls-mono">{session.url}</span>
              {session.status !== "saved" && <span className="ls-session-meta"><span className={`ls-status ${session.status}`}>{statusLabel[session.status]}</span></span>}
              <span className="ls-session-meta ls-mono">{new Date(session.startedAt).toLocaleString("ko-KR")} · {(session.bytes / 1024).toFixed(0)} KB</span>
            </Button>
            {session.error && <p className="ls-error">{session.error}</p>}
            {session.syncStatus === "error" && <p className="ls-error">전송 실패, 다시 선택해 전송하세요.</p>}
            {session.status === "recording" && <span className="ls-local-note">오류 발생 후 5초간의 상황을 수집하고 있습니다.</span>}
            {session.status !== "recording" && <Button variant="ghost" iconOnly className="ls-delete" disabled={uploading || busy}
              title={scope === "team" ? "서버에서 삭제" : "로컬에서 삭제"}
              aria-label={`${session.title || "브라우저 테스트"} ${scope === "team" ? "서버에서 삭제" : "로컬에서 삭제"}`}
              onClick={() => { void (async () => {
                if (!api) return;
                setBusy(true); setError(""); setConfirmSelectedDelete(false);
                try {
                  await api.remove(session.id, scope);
                  showDeleteToast(1);
                  if (recording?.session.id === session.id) { request.current++; setRecording(null); }
                  await refresh();
                } catch (cause) { setError(String(cause)); }
                finally { setBusy(false); }
              })(); }}><span className="msi" aria-hidden="true">delete</span></Button>}
          </div>
        </div>)}
        {!sessions.length && <div className="ls-empty">{scope === "team" ? "서버에 공유된 기록이 없습니다." : "이 PC에 저장된 오류 기록이 없습니다. 오류 전후 5초를 자동 저장합니다."}</div>}
        </div>
        {selectedIds.length > 0 && <div className="ls-selection-actions">
          <span>{selectedIds.length}개 선택</span>
          <Button variant="secondary" className="ls-selection-delete" disabled={busy || uploading} onClick={() => setConfirmSelectedDelete(true)}>선택 삭제</Button>
          {scope === "local" && <Button variant="primary" disabled={mode !== "team" || uploading || busy} onClick={() => void uploadSelected()}><span className="msi" aria-hidden="true">cloud_upload</span>{uploading ? "전송 중…" : "서버로 보내기"}</Button>}
        </div>}
      </aside>
      <section className="ls-detail" aria-label="세션 재생">
        {recording ? <>
          <div className="ls-detail-header">
            <div className="ls-detail-title"><strong>{recording.session.title} {recording.session.trigger && <span className="ls-error-count">오류 {Math.max(1, recording.logs?.filter(log => log.is_error).length ?? 0)}</span>}</strong><small className="ls-mono">{recording.session.url}</small></div>
            <select aria-label="기록된 페이지" value={documentId} onChange={event => setDocumentId(event.target.value)}>
              {recording.documents.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title || item.url}</option>)}
            </select>
            <Button variant="secondary" title="선택한 페이지의 화면만 MP4로 저장합니다. 소리와 API 타임라인은 포함하지 않습니다." className="button" disabled={busy || downloading || !document?.events.some(event => event.type === 2) || recording.session.status === "recording"} onClick={async () => {
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
          {downloadMessage && <p className="ls-timeline-note" role="status">{downloadMessage}</p>}
          {recording.session.notes && <div className="ls-recording-notes"><strong>참고사항</strong><p>{recording.session.notes}</p></div>}
          {document ? <SessionPlayer key={document.id} document={document} startAt={recording.session.captureStartAt} endAt={recording.session.captureEndAt} errorAt={recording.session.trigger?.at} logs={recording.logs} logsWarning={recording.logsWarning} /> : <div className="ls-empty">기록된 화면이 없습니다.</div>}
        </> : <div className="ls-empty ls-detail-empty">
          <span className="ls-empty-icon"><span className="msi" aria-hidden="true">play_circle</span></span>
          <h2>{loading ? "기록을 불러오는 중…" : "기록을 골라 다시 보세요"}</h2>
          <p>화면 영상과 클릭·페이지 이동·API 요청을 시간 순서로 함께 볼 수 있어요.</p>
          <ol className="ls-empty-steps"><li><b>1</b> 왼쪽에서 기록 고르기</li><li><b>2</b> 재생하며 타임라인 보기</li><li><b>3</b> 필요하면 서버로 보내기</li></ol>
        </div>}
      </section>
    </div>
    {deleteToast && <div className="ls-delete-toast" role="status"><span className="msi" aria-hidden="true">check_circle</span>{deleteToast.message}</div>}
    </section>
  </div>;
};
