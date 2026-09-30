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

function cleanDiagram(svg: string): string {
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["foreignObject", "a", "image"] });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    walker.currentNode.textContent = (walker.currentNode.textContent ?? "").replace(/&#(\d+);/g, (original, number) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : original);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

// Decorate only configuration JSON leaves; endpoint labels and API diagrams stay intact.
function decorateFlowBadges(root: Element | null) {
  if (!root) return;
  const ns = "http://www.w3.org/2000/svg";
  root.querySelectorAll<SVGTextElement>("g.node.request text, g.node.response text").forEach(text => {
    if (text.dataset.aligned) return;
    const left = text.getBBox().x;
    text.style.textAnchor = "start";
    text.style.whiteSpace = "pre";
    let depth = 0;
    text.querySelectorAll(":scope > tspan").forEach((line, index) => {
      const content = (line.textContent ?? "").trim();
      if (/^[}\]]/.test(content)) depth = Math.max(0, depth - 1);
      line.setAttribute("x", String(left + (index ? depth * 14 : 0)));
      if (/[{\[]$/.test(content)) depth++;
    });
    text.dataset.aligned = "true";
  });
  root.querySelectorAll<SVGTSpanElement>("g.node.request text > tspan, g.node.response text > tspan").forEach(line => {
    if (line.dataset.badge) return;
    const match = (line.textContent ?? "").match(/^(\s*"(?:[^"\\]|\\.)*"\s*:)\s*("(?:[^"\\]|\\.)*")(,?)$/);
    if (!match) return;
    const value: string = JSON.parse(match[2]);
    const text = line.closest("text")!;
    const group = text.parentElement!;
    line.dataset.badge = "true";
    line.textContent = `${match[1]}  `;
    const badge = document.createElementNS(ns, "tspan");
    badge.textContent = value;
    const global = value.includes("전역변수");
    const linked = /단계|시나리오/.test(value);
    badge.setAttribute("fill", global ? "#65459a" : linked ? "#267653" : "#17607f");
    line.append(badge, document.createTextNode(`  ${match[3]}`));
    const bounds = badge.getBBox();
    const background = document.createElementNS(ns, "rect");
    Object.entries({ x: bounds.x - 4, y: bounds.y - 1, width: bounds.width + 8, height: bounds.height + 2, rx: 7 }).forEach(([key, value]) => background.setAttribute(key, String(value)));
    background.setAttribute("fill", global ? "#f6f1fc" : linked ? "#f1faf5" : "#edf7fa");
    background.setAttribute("stroke", global ? "#c9b9e6" : linked ? "#b8dec9" : "#a8cfe0");
    background.setAttribute("stroke-width", "0.7");
    group.insertBefore(background, text);
  });
}

export function InlineDiagram({ source, onSelect }: { source: string; onSelect: (index: number, area?: "request" | "response") => void }) {
  const [markup, setMarkup] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setError(false);
    void loadEngine().then(engine => engine.render(`api-flow-${crypto.randomUUID()}`, source)).then(({ svg }) => {
      if (live) setMarkup(cleanDiagram(svg));
    }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [source]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    decorateFlowBadges(root.current);
    root.current?.querySelectorAll<SVGElement>("g.node").forEach(node => {
      if (!/(?:^|-)flowchart-(?:s|req|res)\d+-\d+$/.test(node.id)) return;
      node.setAttribute("role", "button"); node.setAttribute("tabindex", "0");
      node.setAttribute("aria-label", `${node.textContent} 단계 편집`);
    });
    root.current?.querySelectorAll("tspan.text-inner-tspan").forEach(node => {
      node.textContent = (node.textContent ?? "").replace(/&#(\d+);/g, (original, number) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : original);
    });
  }, [markup]);
  const select = (target: EventTarget | null) => {
    const node = target instanceof Element ? target.closest("g.node") : null;
    const match = node?.id.match(/(?:^|-)flowchart-(s|req|res)(\d+)-\d+$/);
    if (match) onSelect(Number(match[2]), match[1] === "req" ? "request" : match[1] === "res" ? "response" : undefined);
  };
  return <div ref={root} className="api-inline-flow" onClick={e => select(e.target)} onKeyDown={e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(e.target); }
  }}>{error ? <p role="alert">흐름을 표시하지 못했습니다.</p> : markup ? <div dangerouslySetInnerHTML={{ __html: markup }} /> : <p>흐름을 그리는 중…</p>}</div>;
}

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
  useEffect(() => { decorateFlowBadges(dialog.current); }, [svgMarkup]);
  const trigger = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(100);
  const renderDiagram = async () => {
    setStatus("loading");
    try {
      if (source.length > 50_000) throw new Error("Diagram too large");
      const mermaid = await loadEngine();
      const { svg } = await mermaid.render(`api-mermaid-${crypto.randomUUID()}`, source);
      const clean = cleanDiagram(svg);
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
