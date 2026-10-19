import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSession, SessionRecording } from "../../shared/model/electron-api/live-session";
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
    try {
      const result = await api.list();
      if (current !== request.current) return;
      setSessions(result.sessions); setMode(result.mode ?? "local"); setError(result.error ?? "");
    }
    catch (cause) { if (current === request.current) setError(`목록을 불러오지 못했습니다: ${String(cause)}`); }
  }, [api]);
  useEffect(() => {
    void refresh();
    const off = api?.onChanged(() => void refresh());
    const offAuth = window.electronAPI?.auth?.onSessionChange(() => {
      request.current++; setSessions([]); setRecording(null); setConfirmDelete(null); setLoading(false);
      void refresh();
    });
    return () => { off?.(); offAuth?.(); request.current++; };
  }, [api, refresh]);

  const open = async (id: string) => {
    if (!api) return;
    const current = ++request.current;
    setLoading(true); setError(""); setRecording(null); setConfirmDelete(null);
    try {
      const result = await api.read(id);
      if (current !== request.current) return;
      setRecording(result); setDocumentId(result.documents[0]?.id ?? "");
    } catch (cause) { if (current === request.current) setError(`기록을 열지 못했습니다: ${String(cause)}`); }
    finally { if (current === request.current) setLoading(false); }
  };
  const document = recording?.documents.find(item => item.id === documentId);

  return <div className="ls-dialog-backdrop">
    <section ref={dialog} className="ls-recordings-dialog" role="dialog" aria-modal="true" aria-label="브라우저 기록">
      <header className="ls-dialog-header">
        <h2>브라우저 기록</h2>
        <span className="ls-local-note">오류 전후 5초 · 입력값 마스킹 · {mode === "team" ? "팀 공유" : "로컬 저장"}</span>
        <button className="button ls-close" onClick={onClose} aria-label="브라우저 기록 닫기">닫기</button>
      </header>
    {!api && <div className="ls-notice">로컬 기록·재생은 Electron 앱에서 사용할 수 있습니다.</div>}
    {error && <div className="ls-notice ls-error" role="alert">{error}</div>}
    <div className="ls-workbench">
      <aside className="ls-session-list" aria-label="저장된 세션">
        <div className="ls-section-label">{mode === "team" ? "팀 오류 기록" : "로컬 세션"} <span>{sessions.length}</span>
          <button className="button" onClick={() => void refresh()}>새로고침</button>
        </div>
        {sessions.map(session => <div data-session-id={session.id} className={`ls-session-row${recording?.session.id === session.id ? " selected" : ""}`} key={session.id}>
          <button className="ls-session-open" onClick={() => void open(session.id)}>
            <strong>{session.title || "브라우저 테스트"}</strong>
            <span className="ls-session-url ls-mono">{session.url}</span>
            <span className="ls-session-meta"><span className={`ls-status ${session.status}`}>{statusLabel[session.status]}</span>
              <span>{session.source === "scenario" ? "자동 시나리오" : "수동 테스트"}</span></span>
            <span className="ls-session-meta ls-mono">{new Date(session.startedAt).toLocaleString("ko-KR")} · {(session.bytes / 1024).toFixed(0)} KB</span>
          </button>
          {session.error && <p className="ls-error">{session.error}</p>}
          {session.syncStatus && <p className={session.syncStatus === "error" ? "ls-error" : "ls-local-note"}>
            {session.syncStatus === "uploaded" ? "팀에 업로드됨" : session.syncStatus === "pending" ? "팀 업로드 대기" : session.syncError || "팀 업로드 실패 · 자동 재시도"}
          </p>}
          {session.trigger && <p className="ls-trigger">{session.trigger.type}{session.trigger.status !== undefined ? ` · HTTP ${session.trigger.status}` : ""}</p>}
          {session.status === "recording" && <span className="ls-local-note">오류 발생 후 5초간의 상황을 수집하고 있습니다.</span>}
          {session.status !== "recording" && (confirmDelete === session.id ? <div className="ls-delete-confirm">
            <span>기록을 삭제할까요?</span>
            <button className="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await api?.remove(session.id);
                if (recording?.session.id === session.id) { request.current++; setRecording(null); }
                setConfirmDelete(null); await refresh();
              } catch (cause) { setError(String(cause)); }
              finally { setBusy(false); }
            }}>삭제 확인</button>
            <button className="button" onClick={() => setConfirmDelete(null)}>취소</button>
          </div> : <button className="ls-delete" aria-label={`${session.title} 삭제`} onClick={() => setConfirmDelete(session.id)}>삭제</button>)}
        </div>)}
        {!sessions.length && <div className="ls-empty">저장된 오류 기록이 없습니다.<br />오류 전후 5초만 자동 저장합니다. {mode === "team" ? "정상 API 호출과 페이지 이동은 로그만 전송합니다." : "평소 동작은 파일에 저장하지 않습니다."}</div>}
      </aside>
      <section className="ls-detail" aria-label="세션 재생">
        {recording ? <>
          <div className="ls-detail-header">
            <strong>{recording.session.title}</strong>
            <select aria-label="기록된 페이지" value={documentId} onChange={event => setDocumentId(event.target.value)}>
              {recording.documents.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title || item.url}</option>)}
            </select>
          </div>
          {document ? <SessionPlayer key={document.id} document={document} startAt={recording.session.captureStartAt} endAt={recording.session.captureEndAt} errorAt={recording.session.trigger?.at} /> : <div className="ls-empty">기록된 화면이 없습니다.</div>}
        </> : <div className="ls-empty ls-detail-empty">
          <span className="msi" aria-hidden="true">screen_record</span>
          <h2>{loading ? "기록을 불러오는 중…" : "테스트 과정을 다시 확인하세요"}</h2>
          <p>왼쪽 세션을 선택하면 화면과 동작 타임라인을 재생합니다.</p>
          <p>{mode === "team" ? "같은 프로젝트 팀원의 오류 기록을 함께 확인할 수 있습니다. 삭제하면 팀 공유 기록도 삭제됩니다." : "기록은 이 PC에 저장됩니다."} 페이지 이동·새로고침·팝업은 페이지 선택에서 확인할 수 있습니다.</p>
        </div>}
      </section>
    </div>
    </section>
  </div>;
};
