import { Fragment, useState } from "react";
import { Button } from "../../shared/ui/Button";

function ValueRow({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const nested = value !== null && typeof value === "object";
  const entries = nested ? Object.entries(value).slice(0, 100) : [];
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const display = Array.isArray(value) ? `${value.length}개` : nested ? "" : JSON.stringify(value) ?? "—";
  return <>
    <tr>
      <th scope="row" style={{ paddingLeft: 12 + depth * 12 }}>
        {entries.length > 0 && depth < 8 ? <Button aria-label={`${name} ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="msi" aria-hidden="true">{expanded ? "expand_more" : "chevron_right"}</span>{name}</Button> : name}
      </th>
      <td><code>{display}</code><small>{type}</small></td>
    </tr>
    {expanded && depth < 8 && entries.map(([key, child]) => <ValueRow key={key} name={key} value={child} depth={depth + 1} />)}
    {expanded && nested && Object.keys(value).length > 100 && <tr><td colSpan={2}>처음 100개 항목입니다. 전체 값은 원본 JSON에서 확인하세요.</td></tr>}
  </>;
}

/** 스키마 연결 여부와 무관하게 수집된 응답을 같은 표로 읽는다. */
export function NetworkValueTable({ value, label }: { value: unknown; label: string }) {
  const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [["본문", value]] as const;
  return <div className="fa-value-table-wrap"><table className="fa-network-values" aria-label={label}><tbody>
    {entries.map(([key, child]) => <Fragment key={key}><ValueRow name={key} value={child} /></Fragment>)}
  </tbody></table></div>;
}
