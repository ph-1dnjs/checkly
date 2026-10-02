import { useState } from "react";
import { searchesVisibleList, ServerTag } from "../../../../entities/api-testing";

/** `unavailable` = listed like Swagger but not offered to the AI (e.g. non-JSON bodies Checkly cannot run yet). `server` is the server id. */
export type PickableOperation = { id: string; server: string; method: string; path: string; summary: string; tags: string[]; unavailable?: string };

/**
 * Swagger-like picker: operations grouped by tag in collapsible sections, searchable by tag,
 * path (or a pasted URL), title or server name; several words must all appear. A tag (or server) checkbox picks
 * every operation in it; rows pick single operations. With two or more servers, servers come first, then their tags,
 * so the same tag or path on two servers stays apart.
 */
export function ApiPicker({ operations, servers, picked, disabled, onChange }: {
  operations: PickableOperation[];
  /** Server id → name, in the project's order. */
  servers: Record<string, string>;
  picked: string[]; disabled?: boolean; onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = new Set(picked);
  const needle = query.trim();
  const fits = searchesVisibleList(query);
  const manyServers = Object.keys(servers).length > 1;
  const usable = operations.filter(item => !item.unavailable).length;
  const toggle = (ids: string[], on: boolean) => onChange(on ? [...new Set([...picked, ...ids])] : picked.filter(id => !ids.includes(id)));
  // Tag groups of some operations, filtered by the search (the server name counts as part of the tag).
  const tagGroups = (items: PickableOperation[]) => {
    const groups = new Map<string, PickableOperation[]>();
    for (const operation of items) for (const tag of operation.tags.length ? operation.tags : ["태그 없음"]) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(operation);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right, "ko")).flatMap(([tag, list]) => {
      if (!needle) return [[tag, list] as const];
      const matched = list.filter(item => fits(item, manyServers ? `${tag} ${servers[item.server] ?? ""}` : tag));
      return matched.length ? [[tag, matched] as const] : [];
    });
  };
  const sections = (manyServers ? Object.keys(servers) : [""]).map(server => ({ server, groups: tagGroups(manyServers ? operations.filter(item => item.server === server) : operations) })).filter(section => section.groups.length);
  const usableIds = (items: readonly PickableOperation[]) => items.filter(item => !item.unavailable).map(item => item.id);
  const visibleIds = [...new Set(sections.flatMap(section => section.groups.flatMap(([, items]) => usableIds(items))))];
  // A group's "pick all" box, and its count ("2/6" once some are picked).
  const groupCheckbox = (label: string, ids: string[]) => {
    const count = ids.filter(id => selected.has(id)).length;
    return <input type="checkbox" aria-label={`${label} 전체 선택`} disabled={disabled || !ids.length} checked={count > 0 && count === ids.length}
      ref={element => { if (element) element.indeterminate = count > 0 && count < ids.length; }}
      onClick={event => event.stopPropagation()} onChange={event => toggle(ids, event.target.checked)} />;
  };
  const groupCount = (ids: string[]) => { const count = ids.filter(id => selected.has(id)).length; return <small>{count ? `${count}/${ids.length}` : ids.length}</small>; };
  const renderTags = (server: string, groups: typeof sections[number]["groups"]) => groups.map(([tag, items]) => {
    const ids = usableIds(items);
    const label = manyServers ? `${servers[server]} ${tag}` : tag;
    return <details key={`${server}:${tag}`} className="api-picker-group" open={needle ? true : undefined}>
      <summary>{groupCheckbox(label, ids)}<span className="api-picker-tag">{tag}</span>{groupCount(ids)}</summary>
      <ul>{items.map(item => <li key={item.id} className={item.unavailable ? "is-unavailable" : undefined}><label title={item.unavailable}>
        <input type="checkbox" disabled={disabled || Boolean(item.unavailable)} checked={selected.has(item.id)} onChange={event => toggle([item.id], event.target.checked)} />
        <span className="api-method" data-method={item.method}>{item.method}</span>
        <code>{item.path}</code>
        <span className="api-picker-summary">{item.unavailable ? `실행 미지원 · ${item.unavailable}` : item.summary}</span>
      </label></li>)}</ul>
    </details>;
  });
  return <div className="api-tag-picker">
    <div className="api-tag-picker-tools">
      <input type="search" aria-label="API 검색" placeholder={`${manyServers ? "서버·" : ""}태그·경로·제목으로 API ${usable}개 검색`} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" disabled={disabled || !visibleIds.length} onClick={() => toggle(visibleIds, true)}>{needle ? `검색 결과 ${visibleIds.length}개 선택` : "모두 선택"}</button>
      <button type="button" disabled={disabled || !picked.length} onClick={() => onChange([])}>선택 해제</button>
    </div>
    <p className="api-field-help">고르지 않으면 모든 API를 AI에게 줍니다. 테스트할 기능의 API만 고르면 AI가 더 정확해집니다.</p>
    <div className="api-picker-groups" data-scroll="light">
      {manyServers
        ? sections.map(({ server, groups }) => {
          const ids = [...new Set(groups.flatMap(([, items]) => usableIds(items)))];
          return <details key={server} className="api-picker-server" open={needle ? true : undefined}>
            <summary>{groupCheckbox(`${servers[server]} 서버`, ids)}<ServerTag server={server} names={servers} />{groupCount(ids)}</summary>
            <div className="api-picker-server-tags">{renderTags(server, groups)}</div>
          </details>;
        })
        : sections.flatMap(({ server, groups }) => renderTags(server, groups))}
      {!sections.length && <p className="api-field-help">‘{query}’에 맞는 API가 없습니다.</p>}
    </div>
  </div>;
}
