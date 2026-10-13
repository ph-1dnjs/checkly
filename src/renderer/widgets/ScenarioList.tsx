import type { WebScenarioRecord } from "../../app/ipc/web-scenario/types";
import { Button } from "../shared/ui/Button";

type Props = {
  records: WebScenarioRecord[];
  activeId: string | null;
  busy: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
};
export const ScenarioList = ({ records, activeId, busy, loading, onSelect, onNew, onRefresh }: Props) => (
  <aside className="scenario-files" data-ck-scroll="light">
    <div className="scenario-files-label">
      <span>시나리오</span>
      <Button disabled={busy || loading} onClick={onRefresh}>새로고침</Button>
      <Button disabled={busy} onClick={onNew}>새 시나리오</Button>
    </div>
    {loading && <p role="status">시나리오를 불러오는 중입니다.</p>}
    {!loading && !records.length && <p className="scenario-files-empty">저장된 시나리오가 없습니다. 새 시나리오를 작성하세요.</p>}
    {records.map(record => (
      <Button key={record.id} disabled={busy} className={record.id === activeId ? "active" : ""} onClick={() => onSelect(record.id)}>
        <span className="msi" aria-hidden="true">description</span>
        <div>
          <strong>{record.title}</strong>
          <small>{record.createdBy} 작성 · {record.updatedBy} 수정</small>
          <small>{new Date(record.updatedAt).toLocaleString("ko-KR")}</small>
        </div>
      </Button>
    ))}
  </aside>
);
