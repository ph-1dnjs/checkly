import type { ReactNode } from "react";

export type SummaryJsonEntry = { path: string[]; content: ReactNode };
type Node = { children: Map<string, Node>; content: ReactNode[]; omitted: boolean };
export function SummaryJson({ entries, knownPaths = [] }: { entries: SummaryJsonEntry[]; knownPaths?: string[][] }) {
  const root: Node = { children: new Map(), content: [], omitted: false };
  for (const entry of entries) {
    let node = root;
    for (const key of entry.path) {
      if (!node.children.has(key)) node.children.set(key, { children: new Map(), content: [], omitted: false });
      node = node.children.get(key)!;
    }
    node.content.push(entry.content);
  }
  for (const path of knownPaths) {
    let node = root;
    for (const key of path) {
      if (node.content.length) break;
      const child = node.children.get(key);
      if (!child) { node.omitted = true; break; }
      node = child;
    }
  }
  const render = (node: Node): ReactNode => <>{node.content.map((content, i) => <span key={i}>{content}</span>)}{(node.children.size > 0 || !node.content.length) && <>{"{"}<div className="api-summary-json-children">{[...node.children].map(([key, child]) => <div className="api-summary-json-line" key={key}><span className="api-json-syntax-key">{JSON.stringify(key)}</span>: {render(child)}{","}</div>)}{node.omitted && <div className="api-summary-ellipsis" title="설정하지 않은 필드 생략">…</div>}</div>{"}"}</>}</>;
  return <div className="api-summary-json">{render(root)}</div>;
}
