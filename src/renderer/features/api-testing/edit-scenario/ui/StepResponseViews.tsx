import { type ReactNode } from "react";
import { type Json } from "../../../../../app/api-testing/shared/scenario";
import type { ApiOperation } from "../../../../../app/api-testing/shared/workspace";
import { responseFields } from "../../../../entities/api-testing";
import { type ResponseGlobalNameSuggestion } from "../lib/response-global-name";
import { JsonCode } from "../../../../entities/api-testing";
import { responseDocuments, type ResponseField, type ResponseBadge, responseFieldKey, jsonPointerValue, responseFieldsFromValue, responseFieldsWithoutArrayItems, responseToken } from "../model/step-response-model";

export function ResponseGlobalNameField({ value, suggestions, onChange }: { value: string; suggestions: ResponseGlobalNameSuggestion[]; onChange: (value: string) => void }) {
  return <label>전역변수 이름
    <input aria-label="응답 전역변수 이름" value={value} onChange={event => onChange(event.target.value)} placeholder="예: accessToken" />
    <span className="api-global-name-quick-label">빠른 설정</span>
    <span className="api-global-name-quick" aria-label="전역변수 이름 빠른 설정">
      {suggestions.map(suggestion => <button type="button" key={suggestion.id} className={value === suggestion.name ? "is-selected" : ""} title={suggestion.detail} onClick={() => onChange(suggestion.name)}><strong>{suggestion.label}</strong><code>{suggestion.name}</code></button>)}
    </span>
    <small className="api-global-name-help">필드명 또는 엔드포인트 경로를 기준으로 자동 입력할 수 있습니다.</small>
  </label>;
}

export function ResponseBadgeList({ badges }: { badges: ResponseBadge[] }) {
  if (!badges.length) return null;
  return <span className="api-response-json-badges" aria-label="응답값 설정">{badges.map((badge, index) => <span key={`${badge.tone}-${badge.label}-${index}`} className={`api-response-json-badge is-${badge.tone}`} title={badge.title}>{badge.label}</span>)}</span>;
}

export function ResponseJson({ fields, preview, onSelect, selected, badges }: { fields: ResponseField[]; preview?: Json; onSelect: (pointer: string) => void; selected: string | null; badges?: (pointer: string) => ResponseBadge[] }) {
  const visibleFields = responseFieldsWithoutArrayItems(fields);
  const render = (field: ResponseField): ReactNode => {
    const children = visibleFields.filter(child => child.pointer !== field.pointer && child.pointer.slice(0, child.pointer.lastIndexOf("/")) === field.pointer);
    const container = field.type === "object" || field.type === "array";
    const compactContainer = container && children.length === 0;
    const value = jsonPointerValue(preview, field.pointer);
    const token = compactContainer ? field.type === "array" ? "[]" : "{}" : responseToken(value, field.type);
    const responseBadges = badges?.(field.pointer) ?? [];
    return <span key={field.pointer} data-summary-field={field.pointer ? `response:body:${field.pointer}` : undefined}>
      {field.pointer ? <><button type="button" className="api-json-token api-json-key-token" aria-label={`${field.pointer} 키 선택`} aria-pressed={selected === field.pointer} onClick={() => onSelect(field.pointer)}>{responseFieldKey(field.pointer)}</button><ResponseBadgeList badges={responseBadges} /><code>: <span className={`api-json-value-token api-json-type-${field.type}`}>{token}</span></code></> : <><button type="button" className="api-json-token api-json-root-token" aria-label="전체 응답 선택" aria-pressed={selected === field.pointer} onClick={() => onSelect(field.pointer)}>{token}</button><ResponseBadgeList badges={responseBadges} /></>}
      {children.map((child, i) => <span className="api-json-line" key={child.pointer}>{render(child)}{i < children.length - 1 ? "," : ""}</span>)}
      {container && !compactContainer && <span>{field.type === "array" ? "]" : "}"}</span>}
    </span>;
  };
  return <div className="api-json-code">{visibleFields.filter(field => field.pointer === "").map(field => render(field))}</div>;
}

export function ResponsePicker({ operation, spec, onSelect, actionLabel = "값 사용", selectedPointer = null, showPreview = true, badges }: { operation?: ApiOperation; spec?: Json; onSelect: (pointer: string) => void; actionLabel?: string; selectedPointer?: string | null; showPreview?: boolean; badges?: (pointer: string) => ResponseBadge[] }) {
  const fields = operation ? responseFields(operation.responses, spec) : [];
  const documents = responseDocuments(operation?.responses ?? {}, spec);
  return <div className="api-response-picker">
    {!fields.length && <p>선택 가능한 응답 구조가 없습니다. OpenAPI 응답 스키마를 확인하세요.</p>}
    {documents.map(document => {
      const documentFields: ResponseField[] = fields.filter(field => field.status === document.status);
      const selectableFields = documentFields.length > 0 ? documentFields : document.preview === undefined ? [] : responseFieldsFromValue(document.preview, document.status);
      return <details className="api-response-definition" key={document.status} open={documents.length === 1}>
        <summary><code>{document.status}</code><span>{document.description}</span></summary>
        {document.mediaType && <small className="api-response-media">{document.mediaType}</small>}
        {showPreview && document.preview !== undefined && <details className="api-response-json-reference">
          <summary>{document.previewLabel === "Schema" ? "응답 구조 원문 보기" : "응답 예시 원문 보기"}</summary>
          <JsonCode value={document.preview} copyable={false} />
        </details>}
        {selectableFields.length > 0 && <div className="api-response-json-selector" aria-label={`${document.status} 응답 JSON 항목 선택`}>
          <header><strong>응답 JSON</strong><small>항목을 눌러 {actionLabel}</small></header>
          <ResponseJson fields={selectableFields} preview={document.preview} onSelect={onSelect} selected={selectedPointer} badges={badges} />
        </div>}
      </details>;
    })}
  </div>;
}
