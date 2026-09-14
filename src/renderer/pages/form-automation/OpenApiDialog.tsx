import { useState, type ReactElement } from "react";
import { operationsFromDocument, type OpenApiDocument } from "./liveQa";

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span className="msi" aria-hidden="true">{name}</span>
);

const parseDocument = (text: string): OpenApiDocument => {
  const document = JSON.parse(text) as OpenApiDocument;
  if (!document || typeof document !== "object" || !document.paths)
    throw new Error("paths가 있는 Swagger/OpenAPI JSON 문서가 필요합니다.");
  return document;
};
export const OpenApiDialog = ({
  document,
  onApply,
  onClose,
}: {
  document: OpenApiDocument | null;
  onApply: (document: OpenApiDocument | null) => void;
  onClose: () => void;
}): ReactElement => {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const connect = async () => {
    if (!url.trim()) { setMessage("Swagger/OpenAPI JSON URL을 입력해 주세요."); return; }
    setBusy(true);
    try {
      const result = await window.electronAPI.requestFormAutomationUrl({ url: url.trim() });
      if (!result.ok) throw new Error(`HTTP ${result.status} ${result.statusText}`);
      const next = parseDocument(result.text);
      onApply(next);
      setMessage(`${operationsFromDocument(next).length}개 operation을 연결했습니다.`);
    } catch (error) {
      setMessage(`연결 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };
  const pickFile = async () => {
    setBusy(true);
    try {
      const file = await window.electronAPI.pickFormAutomationOpenApi();
      if (!file) return;
      const next = parseDocument(file.text);
      onApply(next);
      setMessage(`${file.filePath.split("/").pop()} · ${operationsFromDocument(next).length}개 operation을 연결했습니다.`);
    } catch (error) {
      setMessage(`파일 열기 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="fa-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="fa-openapi-dialog" role="dialog" aria-modal="true" aria-label="Swagger 연결">
        <header><span><MaterialIcon name="data_object" /></span><div><strong>Swagger / OpenAPI 연결</strong><small>실제 API 요청·응답을 연결한 계약과 자동 비교합니다.</small></div><button aria-label="닫기" onClick={onClose}><MaterialIcon name="close" /></button></header>
        {document && <div className="fa-openapi-current"><MaterialIcon name="check_circle" /><span><strong>{document.info?.title || "연결된 API 문서"}</strong><small>v{document.info?.version || "-"} · {operationsFromDocument(document).length}개 operation</small></span><button onClick={() => onApply(null)}>연결 해제</button></div>}
        <label className="fa-openapi-url"><span>JSON 문서 URL</span><div><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/openapi.json" onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} /><button disabled={busy} onClick={() => void connect()}><MaterialIcon name={busy ? "progress_activity" : "link"} /> URL 연결</button></div></label>
        <div className="fa-openapi-separator"><span>또는</span></div>
        <button className="fa-openapi-file" disabled={busy} onClick={() => void pickFile()}><MaterialIcon name="upload_file" /><span><strong>로컬 JSON 파일 선택</strong><small>Swagger 2.0과 OpenAPI 3.x JSON 문서를 지원합니다.</small></span></button>
        {message && <p className={message.includes("실패") ? "danger" : ""}>{message}</p>}
        <footer><button onClick={onClose}>닫기</button></footer>
      </section>
    </div>
  );
};
