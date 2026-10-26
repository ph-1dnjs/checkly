import { generateUpload, maxUploadBytes, multipartSchema, type Multipart } from "../shared/multipart";

export function buildMultipart(input: Multipart): { body: FormData; trace: Record<string, unknown>[] } {
  const parts = multipartSchema.parse(input);
  const body = new FormData();
  const trace = parts.map(part => {
    if (part.kind === "text") { body.append(part.name, part.value); return { name: part.name, value: part.value }; }
    const file = part.file;
    const bytes = file.source.kind === "inline" ? Buffer.from(file.source.base64, "base64") : Buffer.from(generateUpload(file.source.format, file.source.size));
    if (bytes.length > maxUploadBytes) throw new Error("파일은 5MB 이하만 지원합니다");
    body.append(part.name, new Blob([new Uint8Array(bytes)], { type: file.type }), file.name);
    return { name: part.name, filename: file.name, type: file.type, size: bytes.length };
  });
  return { body, trace };
}
