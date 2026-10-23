import type { RecordedBody } from "./types";

const MAX_BODY = 12 * 1024;
const privateKey = /password|passwd|pwd|secret|token|authorization|cookie|credential|api.?key|private.?key|otp|session|email|phone|mobile|address|주민|비밀번호|연락처|이메일/i;
const redactText = (value: string): string => value
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[마스킹]")
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[마스킹]")
  .replace(/[\w.+-]{1,64}@[\w.-]{1,255}\.[a-z]{2,24}/gi, "[마스킹]")
  .replace(/\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g, "[마스킹]");

// Persist structured payloads only: unstructured text cannot be reliably scrubbed.
export const recordedBody = (input: unknown): RecordedBody => {
  if (input === undefined) return { state: "unavailable", note: "본문을 수집하지 못했습니다." };
  if (input === null || input === "") return { state: "empty" };
  try {
    let value = input;
    if (typeof value === "string") {
      if (Buffer.byteLength(value) > MAX_BODY) return { state: "omitted", note: "본문이 12KB를 초과해 저장하지 않았습니다." };
      try { value = JSON.parse(value); }
      catch { return { state: "omitted", note: "JSON이 아닌 텍스트·파일 본문은 저장하지 않습니다." }; }
    }
    let nodes = 0;
    const clean = (entry: unknown, depth: number): unknown => {
      if (++nodes > 1000 || depth > 12) throw new Error("limit");
      if (typeof entry === "string") {
        if (Buffer.byteLength(entry) > MAX_BODY) throw new Error("limit");
        return redactText(entry);
      }
      if (entry === null || typeof entry === "boolean" || typeof entry === "number") return entry;
      if (Array.isArray(entry)) return entry.map(item => clean(item, depth + 1));
      if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, item]) => {
        if (Buffer.byteLength(key) > MAX_BODY) throw new Error("limit");
        return [redactText(key), privateKey.test(key) ? "[마스킹]" : clean(item, depth + 1)];
      }));
      return null;
    };
    const text = JSON.stringify(clean(value, 0), null, 2);
    if (Buffer.byteLength(text) > MAX_BODY) return { state: "omitted", note: "본문이 12KB를 초과해 저장하지 않았습니다." };
    return { state: "captured", text };
  } catch { return { state: "omitted", note: "본문의 크기나 중첩이 수집 한도를 초과했습니다." }; }
};
