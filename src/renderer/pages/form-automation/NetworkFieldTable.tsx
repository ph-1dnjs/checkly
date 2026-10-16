import { Fragment, useState } from "react";
import { childFields, fieldIssue, fieldType, fieldValue, hasFieldIssue, type FieldDirection, type NetworkField } from "./networkFields";

function FieldRows({ field, direction, depth = 0, path = field.name }: { field: NetworkField; direction: FieldDirection; depth?: number; path?: string }) {
  const [expanded, setExpanded] = useState(false);
  const children = depth < 8 ? childFields(field, direction) : [];
  const issue = fieldIssue(field);
  const nestedIssue = !issue && hasFieldIssue(field, direction);
  const value = fieldValue(field);
  const description = typeof field.schema.description === "string" ? field.schema.description : "";
  return <>
    <tr className={issue || nestedIssue ? "fa-field-invalid" : ""}>
      <td style={{ paddingLeft: 8 + Math.min(depth, 4) * 12 }}>
        <div className="fa-field-name">{children.length > 0 && <button type="button" aria-label={`${path} ${expanded ? "접기" : "펼치기"}`} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}><span className="msi" aria-hidden="true">{expanded ? "expand_more" : "chevron_right"}</span></button>}<code>{field.name}</code></div>
        {description && <span className="fa-field-description">{description}</span>}
        {field.location && <small>{field.location}</small>}
        {field.undocumented && <small>문서 외 필드</small>}
      </td>
      <td><code>{fieldType(field.schema)}</code>{Array.isArray(field.schema.enum) && <span className="fa-field-description">{field.schema.enum.map(item => JSON.stringify(item)).join(" · ")}</span>}</td>
      <td><span className={field.required ? "fa-field-required" : "fa-field-optional"}>{field.required ? "필수" : "선택"}</span></td>
      <td><code className="fa-field-value" title={value}>{value.length > 160 ? `${value.slice(0, 160)}…` : value}</code>{(issue || nestedIssue) && <span className="fa-field-error">{issue || "하위 필드 확인 필요"}</span>}</td>
    </tr>
    {expanded && children.map(child => <FieldRows key={child.name} field={child} direction={direction} depth={depth + 1} path={`${path}.${child.name}`} />)}
    {expanded && Array.isArray(field.value) && field.value.length > 100 && <tr><td colSpan={4} className="fa-field-limit">처음 100개 항목을 표시합니다. 전체 값은 원본 JSON에서 확인하세요.</td></tr>}
  </>;
}

export function NetworkFieldTable({ fields, direction, label }: { fields: NetworkField[]; direction: FieldDirection; label: string }) {
  return <table className="fa-field-table" aria-label={label}>
    <colgroup><col className="fa-field-col-name" /><col className="fa-field-col-type" /><col className="fa-field-col-required" /><col className="fa-field-col-value" /></colgroup>
    <thead><tr><th scope="col">필드</th><th scope="col">타입</th><th scope="col">필수</th><th scope="col">실제 값</th></tr></thead>
    <tbody>{fields.map((field, index) => <Fragment key={`${field.location || "body"}/${field.name}/${index}`}><FieldRows field={field} direction={direction} /></Fragment>)}</tbody>
  </table>;
}
