import type { ReactNode } from "react";
import { isArrayIndexSegment } from "../lib/settings-summary-model";

export type SummaryJsonEntry = { path: string[]; content: ReactNode };
type Node = { children: Map<string, Node>; content: ReactNode[]; omitted: number };

/**
 * Pretty-printed JSON (2-space indent, commas only between members) of just the configured
 * fields. Values are React content (plain JSON text or badges); known fields that are not
 * configured are summarised as one "…" line per object.
 */
export function SummaryJson({ entries, knownPaths = [] }: { entries: SummaryJsonEntry[]; knownPaths?: string[][] }) {
  const root: Node = { children: new Map(), content: [], omitted: 0 };
  for (const entry of entries) {
    let node = root;
    for (const key of entry.path) {
      if (!node.children.has(key)) node.children.set(key, { children: new Map(), content: [], omitted: 0 });
      node = node.children.get(key)!;
    }
    node.content.push(entry.content);
  }
  const missing = new Map<Node, Set<string>>();
  for (const path of knownPaths) {
    let node = root;
    for (const key of path) {
      if (node.content.length) break;
      const child = node.children.get(key);
      if (!child) { missing.set(node, (missing.get(node) ?? new Set()).add(key)); break; }
      node = child;
    }
  }
  for (const [node, keys] of missing) node.omitted = keys.size;

  const lines: ReactNode[] = [];
  const line = (depth: number, content: ReactNode) => lines.push(<div className="api-summary-json-line" key={lines.length} style={{ paddingLeft: `${depth * 2}ch` }}>{content}</div>);
  const visit = (node: Node, depth: number, prefix: ReactNode, comma: boolean) => {
    const tail = comma ? "," : "";
    // Value and its comma stay together; a long badge wraps inside instead of leaving "," alone.
    if (node.content.length) { line(depth, <>{prefix}<span className="api-summary-json-value">{node.content.map((content, i) => <span key={i}>{content}</span>)}{tail}</span></>); return; }
    const members = [...node.children];
    if (!members.length && !node.omitted) { line(depth, <>{prefix}{"{}"}{tail}</>); return; }
    // Array positions print as list items without keys.
    const array = members.length > 0 && members.every(([key]) => isArrayIndexSegment(key));
    line(depth, <>{prefix}{array ? "[" : "{"}</>);
    members.forEach(([key, child], index) => visit(child, depth + 1, array ? null : <><span className="api-json-syntax-key">{JSON.stringify(key)}</span>{": "}</>, index < members.length - 1 || node.omitted > 0));
    if (node.omitted) line(depth + 1, <span className="api-summary-ellipsis" title="값을 설정하지 않은 필드는 생략합니다">… 설정 안 한 필드 {node.omitted}개</span>);
    line(depth, <>{array ? "]" : "}"}{tail}</>);
  };
  visit(root, 0, null, false);
  return <div className="api-summary-json">{lines}</div>;
}
