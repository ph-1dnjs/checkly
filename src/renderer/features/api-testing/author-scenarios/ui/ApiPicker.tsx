import { useState } from "react";
import { searchesVisibleList } from "../../../../entities/api-testing";

/** `unavailable` = listed like Swagger but not offered to the AI (e.g. non-JSON bodies Checkly cannot run yet). */
export type PickableOperation = { id: string; method: string; path: string; summary: string; tags: string[]; unavailable?: string };

/**
 * Swagger-like picker: operations grouped by tag in collapsible sections, searchable by tag,
 * path (or a pasted URL) or title; several words must all appear. A tag checkbox picks every operation in it; rows pick single operations.
 */
export function ApiPicker({ operations, picked, disabled, onChange }: {
  operations: PickableOperation[]; picked: string[]; disabled?: boolean; onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(picked);
  const needle = query.trim();
  const fits = searchesVisibleList(query);
  const groups = new Map<string, PickableOperation[]>();
  for (const operation of operations) for (const tag of operation.tags.length ? operation.tags : ["태그 없음"]) {
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(operation);
  }
  const visible = [...groups].sort(([left], [right]) => left.localeCompare(right, "ko")).flatMap(([tag, items]) => {
    if (!needle) return [[tag, items] as const];
    const matched = items.filter(item => fits(item, tag));
    return matched.length ? [[tag, matched] as const] : [];
  });
  const usable = operations.filter(item => !item.unavailable).length;
  const visibleIds = [...new Set(visible.flatMap(([, items]) => items.filter(item => !item.unavailable).map(item => item.id)))];
  const toggle = (ids: string[], on: boolean) => onChange(on ? [...new Set([...picked, ...ids])] : picked.filter(id => !ids.includes(id)));
  return <div className="api-tag-picker">
    <div className="api-tag-picker-tools">
      <input type="search" aria-label="API 검색" placeholder={`API ${usable}개 검색: 경로·URL 붙여넣기, 제목, 태그`} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" disabled={disabled || !visibleIds.length} onClick={() => toggle(visibleIds, true)}>{needle ? `검색 결과 ${visibleIds.length}개 선택` : "모두 선택"}</button>
      <button type="button" disabled={disabled || !picked.length} onClick={() => onChange([])}>선택 해제</button>
    </div>
    <p className="api-field-help">고르지 않으면 모든 API를 AI에게 줍니다. 테스트할 기능의 API만 고르면 AI가 더 정확해집니다.</p>
    <div className="api-picker-groups" data-scroll="light">
      {visible.map(([tag, items]) => {
        const ids = items.filter(item => !item.unavailable).map(item => item.id);
        const count = ids.filter(id => selected.has(id)).length;
        return <details key={tag} className="api-picker-group" open={needle ? true : undefined}>
          <summary>
            <input type="checkbox" aria-label={`${tag} 전체 선택`} disabled={disabled || !ids.length} checked={count > 0 && count === ids.length}
              ref={element => { if (element) element.indeterminate = count > 0 && count < ids.length; }}
              onClick={event => event.stopPropagation()} onChange={event => toggle(ids, event.target.checked)} />
            <span className="api-picker-tag">{tag}</span>
            <small>{count ? `${count}/${ids.length}` : ids.length}</small>
          </summary>
          <ul>{items.map(item => <li key={item.id} className={item.unavailable ? "is-unavailable" : undefined}><label title={item.unavailable}>
            <input type="checkbox" disabled={disabled || Boolean(item.unavailable)} checked={selected.has(item.id)} onChange={event => toggle([item.id], event.target.checked)} />
            <span className="api-method" data-method={item.method}>{item.method}</span>
            <code>{item.path}</code>
            <span className="api-picker-summary">{item.unavailable ? `실행 미지원 · ${item.unavailable}` : item.summary}</span>
          </label></li>)}</ul>
        </details>;
      })}
      {!visible.length && <p className="api-field-help">‘{query}’에 맞는 API가 없습니다.</p>}
    </div>
  </div>;
}
