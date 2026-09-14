import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import DOMPurify from "dompurify";

let engine: Promise<typeof import("mermaid")["default"]> | undefined;
function loadEngine() {
  return engine ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", maxTextSize: 50_000,
      suppressErrorRendering: true, flowchart: { htmlLabels: false }, htmlLabels: false });
    return mermaid;
  });
}

type DiagramDefinition = { source: string; title: string };

function htmlText(markup: string, collapseWhitespace = true): string {
  const text = new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "";
  return collapseWhitespace ? text.replace(/\s+/g, " ").trim() : text;
}

const mermaidDivPattern = /<div\b[^>]*class\s*=\s*["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
const mermaidFencePattern = /```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/i;

function extractDiagramSource(markup: string): string | undefined {
  const div = markup.match(mermaidDivPattern);
  if (div) return htmlText(div[1], false).trim();
  const fence = markup.match(mermaidFencePattern);
  return fence?.[1].trim();
}

function extractDiagramTitle(markup: string): string {
  const summary = markup.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  return (summary ? htmlText(summary[1]) : "") || "Mermaid 다이어그램 보기";
}

export function Diagram({ source, title }: DiagramDefinition) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [svgMarkup, setSvgMarkup] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(100);
  const renderDiagram = async () => {
    setStatus("loading");
    try {
      if (source.length > 50_000) throw new Error("Diagram too large");
      const mermaid = await loadEngine();
      const { svg } = await mermaid.render(`api-mermaid-${crypto.randomUUID()}`, source);
      const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject", "a", "image"] });
      // Diagram markup never receives host privileges or network access.
      setSvgMarkup(clean);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };
  const open = () => {
    setZoom(100);
    if (!dialog.current?.open) dialog.current?.showModal();
    if (status === "ready" && svgMarkup) {
      return;
    }
    if (status !== "loading") void renderDiagram();
  };
  return <div className="api-diagram">
    <button ref={trigger} type="button" className="api-diagram-trigger" aria-haspopup="dialog" disabled={status === "loading"} onClick={open}>
      {title}{status === "loading" ? " · 그리는 중…" : ""}
    </button>
    {status === "error" && <p role="alert">다이어그램을 표시하지 못했습니다. 버튼을 다시 눌러 재시도하세요.</p>}
    <dialog ref={dialog} className="api-diagram-dialog" onClose={() => trigger.current?.focus()}>
      <div className="api-actions"><strong className="api-diagram-title">{title}</strong>
        <button type="button" onClick={() => setZoom(v => Math.max(60, v - 20))}>축소</button><span>{zoom}%</span>
        <button type="button" onClick={() => setZoom(v => Math.min(250, v + 20))}>확대</button>
        <button type="button" onClick={() => dialog.current?.close()}>닫기</button>
      </div>
      <div className="api-diagram-viewport">
        {svgMarkup ? <div className="api-diagram-zoom" style={{ width: `${zoom}%`, minWidth: zoom >= 100 ? "100%" : undefined }} dangerouslySetInnerHTML={{ __html: svgMarkup }} /> : status === "error" ? <p role="alert">다이어그램을 표시하지 못했습니다. 닫고 버튼을 다시 눌러 재시도하세요.</p> : <p>다이어그램을 그리는 중…</p>}
      </div>
    </dialog>
  </div>;
}

/** Keep Swagger's HTML sanitization; render only explicit Mermaid blocks separately. */
export function DescriptionMarkdown({ Original, source, ...props }: { Original: ComponentType<any>; source?: string; [key: string]: any }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const prepared = useMemo(() => {
    const diagrams: DiagramDefinition[] = [];
    const marker = (diagramSource: string, title = "Mermaid 다이어그램 보기") => `<pre>CHECKLYDIAGRAM${id}_${diagrams.push({ source: diagramSource, title }) - 1}</pre>`;
    let text = source ?? "";
    text = text.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, details => {
      const diagramSource = extractDiagramSource(details);
      return diagramSource ? marker(diagramSource, extractDiagramTitle(details)) : details;
    });
    text = text
      .replace(mermaidDivPattern, (_, content: string) => marker(htmlText(content, false).trim()))
      .replace(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/g, (_, content: string) => marker(content.trim()));
    return { text, diagrams };
  }, [source, id]);
  useEffect(() => {
    if (!prepared.diagrams.length || !root.current) return;
    let live = true;
    const mounted = new Map<HTMLElement, Root>();
    const scan = () => {
      for (const [node, renderer] of mounted) if (!node.isConnected) { renderer.unmount(); mounted.delete(node); }
      root.current?.querySelectorAll("pre").forEach(node => {
        if (mounted.has(node)) return;
        const index = prepared.diagrams.findIndex((_, i) => node.textContent?.trim() === `CHECKLYDIAGRAM${id}_${i}`);
        if (index < 0) return;
        node.textContent = "";
        const renderer = createRoot(node); mounted.set(node, renderer);
        renderer.render(<Diagram {...prepared.diagrams[index]} />);
      });
    };
    const observer = new MutationObserver(scan);
    observer.observe(root.current, { childList: true, subtree: true });
    queueMicrotask(() => { if (live) scan(); });
    return () => { live = false; observer.disconnect(); queueMicrotask(() => mounted.forEach(renderer => renderer.unmount())); };
  }, [prepared, id]);
  return <div ref={root} className="api-rich-description" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Original {...props} source={prepared.text} />
  </div>;
}
