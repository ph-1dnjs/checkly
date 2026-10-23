import { Button } from "../../shared/ui/Button";
import type { BrowserLog, RecordedBody } from "../../shared/model/electron-api/live-session";

const Body = ({ body, label }: { body?: RecordedBody; label: string }) => body?.state === "captured"
  ? <pre className="ls-mono" aria-label={label}>{body.text}</pre>
  : <p className="ls-payload-empty">{body?.state === "empty" ? "본문이 없습니다." : body?.note ?? "이 기록에는 본문이 저장되어 있지 않습니다. 새로 수집한 실패 기록부터 확인할 수 있습니다."}</p>;

export const RecordedApiDetail = ({ log, onClose }: { log: BrowserLog; onClose: () => void }) => <section className="ls-api-detail" aria-label="기록된 API 상세" data-ck-scroll="light">
  <header className="ls-api-detail-header">
    <strong>API 상세</strong>
    <span className={`ls-mono${log.is_error ? " ls-error" : ""}`}>{log.method ?? "API"} · {log.status === 0 ? "연결 실패" : log.status ?? "상태 알 수 없음"}{log.duration_ms !== null ? ` · ${log.duration_ms} ms` : ""}</span>
    <Button variant="ghost" onClick={onClose} aria-label="API 상세 닫기">닫기</Button>
  </header>
  <div className="ls-api-address ls-mono">{log.url}</div>
  {log.page_url && <p className="ls-api-page ls-mono">페이지: {log.page_url}</p>}
  <p className="ls-payload-note">실패한 API의 JSON 본문만 저장합니다. 민감한 필드명과 일부 개인정보 형식을 마스킹하며, 본문당 최대 12KB입니다.</p>
  <div className="ls-payload-columns">
    <section aria-label="Request 요청"><h3>Request <span>요청 본문</span></h3><Body body={log.payload?.request} label="저장된 요청 본문" /></section>
    <section aria-label="Response 응답"><h3>Response <span>응답 본문</span></h3>
      {log.payload?.responseContentType && <p className="ls-payload-type ls-mono">{log.payload.responseContentType}</p>}
      <Body body={log.payload?.response} label="저장된 응답 본문" />
    </section>
  </div>
</section>;
