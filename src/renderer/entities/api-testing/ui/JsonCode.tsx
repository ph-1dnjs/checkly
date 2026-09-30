import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
/** Renders JSON.stringify(value, null, 2) layout with syntax spans (values shown as is, like Swagger). */
function renderJson(value: unknown): ReactNode[] {
  const parts: ReactNode[] = [];
  let key = 0;
  const push = (text: string, kind?: string) => {
    parts.push(kind ? <span key={key++} className={`api-json-syntax-${kind}`}>{text}</span> : text);
  };
  const visit = (node: unknown, indent: string) => {
    if (node === null || typeof node === "boolean") return push(String(node), node === null ? "null" : "boolean");
    if (typeof node === "number") return push(Number.isFinite(node) ? String(node) : "null", Number.isFinite(node) ? "number" : "null");
    if (typeof node === "string") return push(JSON.stringify(node), "string");
    const inner = `${indent}  `;
    if (Array.isArray(node)) {
      if (!node.length) return push("[]");
      push("[\n");
      node.forEach((item, index) => {
        push(inner);
        visit(item === undefined || typeof item === "function" ? null : item, inner);
        push(index < node.length - 1 ? ",\n" : "\n");
      });
      return push(`${indent}]`);
    }
    if (typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>).filter(([, item]) => item !== undefined && typeof item !== "function");
      if (!entries.length) return push("{}");
      push("{\n");
      entries.forEach(([name, item], index) => {
        push(inner);
        push(JSON.stringify(name), "key");
        push(": ");
        visit(item, inner);
        push(index < entries.length - 1 ? ",\n" : "\n");
      });
      return push(`${indent}}`);
    }
    push(String(node));
  };
  visit(value, "");
  return parts;
}

export function JsonCode({ value, copyable = true }: { value: unknown; copyable?: boolean }) {
  const json = JSON.stringify(value, null, 2) ?? String(value);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    try {
      await navigator.clipboard.writeText(json);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 1200);
  };

  return <div className={`api-json-view${copyable ? "" : " api-json-view-no-copy"}`}>
    {copyable && <button type="button" className="api-json-copy" data-state={copyState} aria-label={copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "JSON 복사"} title={copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "JSON 복사"} onClick={copy} />}
    <pre className="api-highlighted-json"><code>{renderJson(value)}</code></pre>
  </div>;
}
