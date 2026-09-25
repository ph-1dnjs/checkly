import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

const tokens = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\b(?:true|false|null)\b)/g;

export function JsonCode({ value, copyable = true }: { value: unknown; copyable?: boolean }) {
  const json = JSON.stringify(value, null, 2) ?? String(value);
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
  const parts: ReactNode[] = [];
  let position = 0;

  for (const match of json.matchAll(tokens)) {
    const start = match.index;
    if (start > position) parts.push(json.slice(position, start));
    const kind = match[1] ? "key" : match[2] ? "string" : match[3] ? "number" : match[0] === "null" ? "null" : "boolean";
    parts.push(<span className={`api-json-syntax-${kind}`} key={start}>{match[0]}</span>);
    position = start + match[0].length;
  }
  if (position < json.length) parts.push(json.slice(position));

  return <div className={`api-json-view${copyable ? "" : " api-json-view-no-copy"}`}>
    {copyable && <button type="button" className="api-json-copy" data-state={copyState} aria-label={copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "JSON 복사"} title={copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "JSON 복사"} onClick={copy} />}
    <pre className="api-highlighted-json"><code>{parts}</code></pre>
  </div>;
}
