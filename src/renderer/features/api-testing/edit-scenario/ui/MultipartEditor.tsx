import { useRef, useState } from "react";
import { maxUploadBytes, type Multipart } from "../../../../../app/api-testing/shared/multipart";
import { Button } from "../../../../shared/ui/Button";
import { Input } from "../../../../shared/ui/Input";

export function MultipartEditor({ value, onChange }: { value: Multipart; onChange: (value: Multipart) => void }) {
  const [name, setName] = useState("file");
  const [filename, setFilename] = useState("sample.txt");
  const [format, setFormat] = useState<"txt" | "csv" | "json">("txt");
  const [size, setSize] = useState("1024");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const currentValue = useRef(value);
  currentValue.current = value;
  const add = (part: Multipart[number]) => {
    if (!part.name.trim()) { setError("필드명을 입력하세요"); return; }
    if (currentValue.current.length >= 20) { setError("필드는 최대 20개입니다"); return; }
    setError(""); onChange([...currentValue.current, part]);
  };
  return <section aria-label="multipart 파일 및 텍스트">
    <p className="api-field-help">선택한 파일 내용은 시나리오에 저장되어 팀에 공유됩니다. 파일당 최대 5MB, 필드는 최대 20개입니다.</p>
    {value.map((part, index) => <div key={index} className="api-actions"><code>{part.name}: {part.kind === "text" ? part.value : `${part.file.name} (${part.file.source.kind === "generated" ? `${part.file.source.size} bytes · 생성` : "첨부"})`}</code><Button onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`${index + 1}번 multipart 필드 삭제`}>삭제</Button></div>)}
    <label>필드명<Input aria-label="multipart 필드명" value={name} onChange={event => setName(event.target.value)} /></label>
    <label>텍스트 값<Input aria-label="multipart 텍스트 값" value={text} onChange={event => setText(event.target.value)} /></label>
    <Button onClick={() => add({ kind: "text", name, value: text })}>텍스트 필드 추가</Button>
    <label>내 파일 선택<input type="file" aria-label="업로드 파일 선택" disabled={reading || value.length >= 20} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (!name.trim()) { setError("필드명을 입력하세요"); return; }
      if (file.size > maxUploadBytes) { setError("파일은 5MB 이하만 지원합니다"); return; }
      setReading(true);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error("파일을 읽지 못했습니다"));
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file);
        });
        add({ kind: "file", name, file: { name: file.name, type: file.type || "application/octet-stream", source: { kind: "inline", base64 } } });
      } catch { setError("파일을 읽지 못했습니다"); } finally { setReading(false); }
    }} /></label>
    <label>생성 파일명<Input aria-label="생성 파일명" value={filename} onChange={event => setFilename(event.target.value)} /></label>
    <label>파일 형식<select aria-label="생성 파일 형식" value={format} onChange={event => { const next = event.target.value as typeof format; setFormat(next); setFilename(`sample.${next}`); }}><option value="txt">TXT</option><option value="csv">CSV</option><option value="json">JSON</option></select></label>
    <label>크기 (바이트)<Input aria-label="생성 파일 크기" type="number" min={1} max={maxUploadBytes} value={size} onChange={event => setSize(event.target.value)} /></label>
    <Button disabled={reading} onClick={() => {
      const bytes = Number(size);
      if (!filename.trim() || filename.length > 255 || !Number.isInteger(bytes) || bytes < 1 || bytes > maxUploadBytes) { setError("파일명(255자 이하)과 크기(1바이트~5MB)를 확인하세요"); return; }
      add({ kind: "file", name, file: { name: filename, type: { txt: "text/plain", csv: "text/csv", json: "application/json" }[format], source: { kind: "generated", format, size: bytes } } });
    }}>테스트 파일 생성·추가</Button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
