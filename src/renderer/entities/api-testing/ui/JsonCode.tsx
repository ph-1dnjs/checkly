import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { isSensitiveKey, sensitiveSegments } from "../../../../app/api-testing/shared/sensitive";
import { useSensitiveValues } from "../context/sensitive-values";

const masked = "api-sensitive-value";

/**
 * Renders JSON.stringify(value, null, 2) layout with syntax spans. Values under
 * sensitive keys and occurrences of known secrets get the masked class, which
 * the "민감값 숨기기" toggle hides.
 */
function renderJson(value: unknown, known: readonly string[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let key = 0;
  const push = (text: string, kind?: string, sensitive = false) => {
    parts.push(kind || sensitive ? <span key={key++} className={[kind && `api-json-syntax-${kind}`, sensitive && masked].filter(Boolean).join(" ")}>{text}</span> : text);
  };
  const quoted = (text: string) => JSON.stringify(text).slice(1, -1);
  const visit = (node: unknown, indent: string, sensitive: boolean) => {
    if (node === null || typeof node === "boolean") return push(String(node), node === null ? "null" : "boolean", sensitive);
    if (typeof node === "number") return push(Number.isFinite(node) ? String(node) : "null", Number.isFinite(node) ? "number" : "null", sensitive);
    if (typeof node === "string") {
      if (sensitive) return push(JSON.stringify(node), "string", true);
      const segments = sensitiveSegments(node, known);
      if (segments.length === 1) return push(JSON.stringify(node), "string");
      push('"', "string");
      segments.forEach(segment => push(quoted(segment.text), "string", segment.sensitive));
      return push('"', "string");
    }
    const inner = `${indent}  `;
    if (Array.isArray(node)) {
      if (!node.length) return push("[]");
      push("[\n");
      node.forEach((item, index) => {
        push(inner);
        visit(item === undefined || typeof item === "function" ? null : item, inner, sensitive);
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
        visit(item, inner, sensitive || isSensitiveKey(name));
        push(index < entries.length - 1 ? ",\n" : "\n");
      });
      return push(`${indent}}`);
    }
    push(String(node));
  };
  visit(value, "", false);
  return parts;
}

export function JsonCode({ value, copyable = true, known: extraKnown = [] }: { value: unknown; copyable?: boolean; known?: readonly string[] }) {
  const json = JSON.stringify(value, null, 2) ?? String(value);
  const { known } = useSensitiveValues();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    if (event.currentTarget.closest(".api-hide-values")) return;
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
    <pre className="api-highlighted-json"><code>{renderJson(value, [...known, ...extraKnown])}</code></pre>
  </div>;
}
