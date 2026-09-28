import { useEffect, useState } from "react";
import type { ApiOperation } from "../../../app/api-testing/shared/workspace";

/**
 * Picks another API for a step (e.g. after a path was renamed). Only the API reference changes;
 * the step's request values, links and checks stay and are flagged if the new API lacks them.
 */
export function ApiReplaceModal({ stepNumber, current, operations, onPick, onClose }: {
  stepNumber: number; current: string; operations: ApiOperation[]; onPick: (operation: ApiOperation) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = operations.filter(operation => !operation.warnings.length && `${operation.method} ${operation.path} ${operation.summary} ${operation.tag}`.toLocaleLowerCase().includes(needle));
  return <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="api-value-modal api-replace-modal" role="dialog" aria-modal="true" aria-label={`${stepNumber}단계 API 바꾸기`} onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><p className="api-value-modal-kicker">{stepNumber}단계 API 바꾸기</p><h2>새로 연결할 API</h2><small>지금: <code>{current}</code></small></div>
        <button type="button" aria-label="API 바꾸기 닫기" onClick={onClose}>×</button>
      </header>
      <p className="api-value-modal-note">요청값·응답 연결·검증은 그대로 둡니다. 새 API 명세에 없는 요청값은 편집 화면에 따로 표시되어 제거할 수 있습니다.</p>
      <input type="search" autoFocus aria-label="바꿀 API 검색" placeholder="경로·제목·태그로 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <ul className="api-replace-list" data-scroll="light">
        {matches.slice(0, 80).map(operation => <li key={operation.key}><button type="button" onClick={() => onPick(operation)}>
          <span className="api-method" data-method={operation.method}>{operation.method}</span><code>{operation.path}</code><span>{operation.summary}</span>
        </button></li>)}
        {!matches.length && <li className="api-field-help">맞는 API가 없습니다.</li>}
        {matches.length > 80 && <li className="api-field-help">{matches.length - 80}개 더 있습니다. 검색어를 좁혀 주세요.</li>}
      </ul>
      <footer><button type="button" onClick={onClose}>닫기</button></footer>
    </section>
  </div>;
}
