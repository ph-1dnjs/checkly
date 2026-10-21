import { useMemo, useState } from "react";
import type { WebScenarioRecord } from "../../app/ipc/web-scenario/types";
import { parseMarkdown } from "../shared/model/scenario";
import { LoadingSpinner } from "../shared/ui/LoadingSpinner";
import { Button } from "../shared/ui/Button";
import { Input } from "../shared/ui/Input";

type Props = {
  records: WebScenarioRecord[];
  activeId: string | null;
  busy: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  /** 없으면 새 문서 버튼을 숨긴다(대상 선택). */
  onNew?: () => void;
  onRefresh?: () => void;
  pickedCountByRecord?: Record<string, number>;
  /** 저장 전 새 문서의 제목. 있으면 목록 맨 위에 선택된 초안 행을 보여 준다. */
  draftTitle?: string;
  /** 선택된 문서에 저장하지 않은 변경이 있는지 */
  dirty?: boolean;
};

const pad2 = (value: number) => String(value).padStart(2, "0");
const shortDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** 편집·대상 선택이 같이 쓰는 문서 열: 머리(개수·새로고침·새 문서) · 검색 · 문서 행 */
export const ScenarioList = ({ records, activeId, busy, loading, onSelect, onNew, onRefresh, pickedCountByRecord = {}, draftTitle, dirty = false }: Props) => {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => Object.fromEntries(records.map(record => [record.id, parseMarkdown(record.markdown).length])), [records]);
  const keyword = query.trim().toLowerCase();
  const visible = keyword ? records.filter(record => record.title.toLowerCase().includes(keyword)) : records;
  const showDraft = draftTitle !== undefined && activeId === null;
  return (
    <aside className="scenario-files">
      <div className="scenario-files-label">
        <span>문서</span>
        <b>{records.length + (showDraft ? 1 : 0)}</b>
        {onRefresh && (
          <Button className="scenario-files-icon" aria-label="새로고침" title="새로고침" disabled={busy || loading} onClick={onRefresh}>
            <span className="msi" aria-hidden="true">refresh</span>
          </Button>
        )}
        {onNew && (
          <Button className="scenario-files-icon add" aria-label="새 시나리오" title="새 시나리오" disabled={busy} onClick={onNew}>
            <span className="msi" aria-hidden="true">add</span>
          </Button>
        )}
      </div>
      <div className="scenario-files-search">
        <Input
          type="search"
          aria-label="문서 검색"
          placeholder="문서 검색"
          value={query}
          onChange={event => setQuery(event.target.value)}
          leading={<span className="msi" aria-hidden="true">search</span>}
        />
      </div>
      <div className="scenario-files-list" data-ck-scroll="light">
        {loading && <LoadingSpinner label="시나리오를 불러오는 중입니다." />}
        {showDraft && (
          <div className="scenario-files-row active draft" aria-current="true">
            <span className="msi" aria-hidden="true">description</span>
            <div>
              <div className="scenario-files-title">
                <strong title={draftTitle || "제목 없는 시나리오"}>{draftTitle || "제목 없는 시나리오"}</strong>
                {dirty && <i className="scenario-files-dirty" title="저장 안 됨" />}
              </div>
              <small><span>새 문서</span><span aria-hidden="true">·</span><span className="mono">저장 전</span></small>
            </div>
          </div>
        )}
        {!loading && !records.length && !showDraft && <p className="scenario-files-empty">저장된 시나리오가 없습니다. 새 시나리오를 작성하세요.</p>}
        {!loading && records.length > 0 && !visible.length && <p className="scenario-files-empty">‘{query.trim()}’와 일치하는 문서가 없습니다.</p>}
        {visible.map(record => {
          const active = record.id === activeId;
          return (
            <Button key={record.id} disabled={busy} aria-pressed={active} className={`scenario-files-row${active ? " active" : ""}`} onClick={() => onSelect(record.id)}>
              <span className="msi" aria-hidden="true">description</span>
              <div>
                <div className="scenario-files-title">
                  <strong title={record.title}>{record.title}</strong>
                  {active && dirty && <i className="scenario-files-dirty" title="저장 안 됨" />}
                </div>
                <small title={`${record.createdBy} 작성 · ${record.updatedBy} 수정 · ${new Date(record.updatedAt).toLocaleString("ko-KR")}`}>
                  <span>{record.updatedBy}</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{shortDate(record.updatedAt)}</span>
                  <span className="mono scenario-files-count">{counts[record.id]}개</span>
                </small>
              </div>
              {pickedCountByRecord[record.id] > 0 && <em>{pickedCountByRecord[record.id]} 선택</em>}
            </Button>
          );
        })}
      </div>
    </aside>
  );
};
