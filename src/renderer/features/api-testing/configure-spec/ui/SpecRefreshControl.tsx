import { useEffect, useId, useState } from "react";
import type { ApiCatalog, ApiSpecSync } from "../../../../../app/api-testing/shared/workspace";
import { Button } from "../../../../shared/ui/Button";
import { Icon } from "../../../../shared/ui/Icon";
import { specRefreshStatus } from "../model/spec-refresh-status";

export function SpecRefreshControl({ catalog, sync, loading, refreshing, error, disabled, scopeLabel, onRefresh }: {
  catalog: ApiCatalog | null; sync: ApiSpecSync | null; loading: boolean; refreshing: boolean; error: string;
  disabled: boolean; scopeLabel: string; onRefresh: () => void;
}) {
  const statusId = useId();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const status = specRefreshStatus(catalog, sync, loading, refreshing, error, now);
  const label = catalog ? "API 문서 갱신" : "API 문서 등록";
  return <div className={`api-spec-refresh is-${status.tone}`} aria-label="API 문서 상태">
    <Button variant="secondary" aria-label={label} aria-describedby={statusId} disabled={disabled || loading} onClick={onRefresh} title={[`${scopeLabel} · ${label}`, !sync?.url ? "가져오기 설정 열기" : sync.username && !sync.hasSavedAccount ? "문서 비밀번호 입력 필요" : "", catalog && `동기화 시각: ${new Date(catalog.importedAt).toLocaleString()}`, error].filter(Boolean).join("\n")}>
      <i className="api-spec-state-dot" aria-hidden="true" />
      <span className="api-spec-refresh-label"><span>{label}</span><span id={statusId} role="status" className="api-spec-refresh-status">{status.text}{status.detail && <small> · {status.detail}</small>}</span></span>
      <Icon name="refresh" size={16} className={refreshing ? "is-spinning" : undefined} />
    </Button>
  </div>;
}
