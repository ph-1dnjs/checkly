import type { WebScenarioRecord } from "../../app/ipc/web-scenario/types";
import { LoadingSpinner } from "../shared/ui/LoadingSpinner";
import { Button } from "../shared/ui/Button";

type Props = {
  records: WebScenarioRecord[];
  activeId: string | null;
  busy: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  newLabel?: string;
  onRefresh?: () => void;
  pickedCountByRecord?: Record<string, number>;
};
export const ScenarioList = ({ records, activeId, busy, loading, onSelect, onNew, onRefresh, pickedCountByRecord = {}, newLabel = "새 시나리오" }: Props) => (
  <aside className="scenario-files" data-ck-scroll="light">
    <div className="scenario-files-label">
      <span>시나리오</span>
      {onRefresh && <Button disabled={busy || loading} onClick={onRefresh}>새로고침</Button>}
      <Button disabled={busy} onClick={onNew}>{newLabel}</Button>
    </div>
    {loading && <LoadingSpinner label="시나리오를 불러오는 중입니다." />}
    {!loading && !records.length && <p className="scenario-files-empty">저장된 시나리오가 없습니다. 새 시나리오를 작성하세요.</p>}
    {records.map(record => (
      <Button key={record.id} disabled={busy} aria-pressed={record.id === activeId} className={record.id === activeId ? "active" : ""} onClick={() => onSelect(record.id)}>
        <span className="msi" aria-hidden="true">description</span>
        <div>
          <strong title={record.title}>{record.title}</strong>
          <small>{record.createdBy} 작성 · {record.updatedBy} 수정</small>
          <small>{new Date(record.updatedAt).toLocaleString("ko-KR")}</small>
        </div>
        {pickedCountByRecord[record.id] > 0 && <em>{pickedCountByRecord[record.id]} 선택</em>}
      </Button>
    ))}
  </aside>
);
