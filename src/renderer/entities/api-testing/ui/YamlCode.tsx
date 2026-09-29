import type { ReactNode } from "react";

const scalarKind = (text: string) => {
  const value = text.trim();
  if (!value) return "";
  if (/\{\{[^}]+\}\}/.test(value)) return "template";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  if (/^(true|false)$/.test(value)) return "boolean";
  if (/^(null|~)$/.test(value)) return "null";
  return "string";
};

function scalar(text: string): ReactNode {
  const kind = scalarKind(text);
  return kind ? <span className={`api-yaml-${kind}`}>{text}</span> : text;
}

/**
 * Read-only YAML with light highlighting (keys, list dashes, scalar types, {{templates}})
 * and a blank line between list items at the same depth as `steps`, so steps read as blocks.
 */
export function YamlCode({ source, label }: { source: string; label?: string }) {
  const lines = source.replace(/\n$/, "").split("\n");
  const stepIndent = lines.find(line => /^\s*- /.test(line))?.search(/\S/) ?? -1;
  return <pre className="api-yaml" aria-label={label}>{lines.map((line, index) => {
    const indent = line.match(/^\s*/)![0];
    let rest = line.slice(indent.length);
    const parts: ReactNode[] = [indent];
    const startsItem = rest.startsWith("- ");
    if (startsItem) { parts.push(<span key="dash" className="api-yaml-dash">- </span>); rest = rest.slice(2); }
    if (rest.startsWith("#")) parts.push(<span key="c" className="api-yaml-comment">{rest}</span>);
    else {
      const pair = /^([^:#{}[\],]+?):(\s|$)(.*)$/.exec(rest);
      if (pair) parts.push(<span key="k" className="api-yaml-key">{pair[1]}</span>, ":", pair[2], scalar(pair[3]));
      else parts.push(scalar(rest));
    }
    const gap = startsItem && indent.length === stepIndent && index > 0 && lines.slice(0, index).some(prev => prev.search(/\S/) === stepIndent && /^\s*- /.test(prev));
    return <span key={index} className="api-yaml-line">{gap && "\n"}{parts}{"\n"}</span>;
  })}</pre>;
}
