import { useState } from "react";
import type { ApiCatalog, ApiSpecSync } from "../../../app/api-testing/shared/workspace";
import { Icon } from "../../shared/ui/Icon";
import { DeleteAction } from "./DeleteAction";

type Props = {
  scopeLabel: string;
  catalog: ApiCatalog | null;
  sync: ApiSpecSync | null;
  disabled: boolean;
  url: string; onUrlChange: (url: string) => void;
  authKind: string; onAuthKindChange: (kind: string) => void;
  username: string; onUsernameChange: (value: string) => void;
  password: string; onPasswordChange: (value: string) => void;
  remember: boolean; onRememberChange: (value: boolean) => void;
  /** Resolves true when a catalog was imported. */
  onImport: (kind: "file" | "url", url?: string) => Promise<boolean>;
  onDeleteCatalog: () => Promise<void>;
  onDeleteSavedAccount: () => void;
};

/**
 * Where the current server·environment's OpenAPI spec comes from. Once a spec is loaded it
 * folds into one summary line; the form opens from "설정" (or by itself when nothing is loaded).
 */
export function SpecSourcePanel(props: Props) {
  const { catalog, sync, disabled, url } = props;
  const [open, setOpen] = useState(!catalog);
  const failed = sync?.status === "failed";
  const sameUrl = Boolean(sync?.url) && url.trim() === sync?.url;
  const importUrl = async () => { if (await props.onImport("url")) setOpen(false); };
  const importFile = async () => { if (await props.onImport("file")) setOpen(false); };
  const syncedAt = sync?.lastAttemptAt ? new Date(sync.lastAttemptAt).toLocaleString() : catalog ? new Date(catalog.importedAt).toLocaleString() : "";
  return <section className={`api-spec-source${open ? " is-open" : ""}`} aria-label="API 명세 가져오기">
    <div className="api-spec-summary">
      <span className="api-spec-summary-label">명세</span>
      <span className="api-spec-scope" title="명세는 서버·환경마다 따로 저장됩니다">{props.scopeLabel}</span>
      {catalog || sync?.url ? <span className="api-spec-summary-source">
        <code title={sync?.url ?? "파일에서 가져온 명세"}>{sync?.url ?? "파일에서 가져옴"}</code>
        {sync?.username && <span>Basic · {sync.username}</span>}
        {syncedAt && <span role="status" className={failed ? "is-failed" : undefined}>{failed ? `최근 동기화 실패 · 기존 문서 유지 · ${syncedAt}` : `최근 동기화 성공 · ${syncedAt}`}</span>}
      </span> : <span className="api-spec-summary-source">아직 가져온 명세가 없습니다.</span>}
      <span className="api-spec-summary-actions">
        {sync?.url && <button type="button" className={failed ? "api-primary" : undefined} aria-label="명세 새로고침" disabled={disabled} onClick={() => void props.onImport("url", sync.url)}>{failed ? "다시 시도" : "새로고침"}</button>}
        <button type="button" aria-label="명세 설정" aria-expanded={open} disabled={disabled && !open} onClick={() => setOpen(value => !value)}>설정<Icon name="expand_more" size={16} className="api-spec-settings-chevron" /></button>
      </span>
    </div>
    {open && <div className="api-spec-form">
      <div className="api-spec-form-row">
        <label className="api-spec-url">명세 URL<input aria-label="OpenAPI URL" type="url" placeholder="https://…/v3/api-docs (OpenAPI JSON/YAML)" value={url} disabled={disabled} onChange={event => props.onUrlChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && url.trim() && !event.nativeEvent.isComposing) void importUrl(); }} /></label>
        <button type="button" className="api-primary" disabled={disabled || !url.trim()} onClick={() => void importUrl()}>{sameUrl ? "새로고침" : "가져오기"}</button>
        <span className="api-spec-or">또는</span>
        <button type="button" disabled={disabled} onClick={() => void importFile()}>파일 가져오기</button>
      </div>
      <div className="api-spec-form-row">
        <label>문서 인증<select aria-label="Swagger 인증 방식" value={props.authKind} disabled={disabled} onChange={event => props.onAuthKindChange(event.target.value)}><option value="none">인증 없음</option><option value="basic">Basic 인증</option></select></label>
        {props.authKind === "basic" && <>
          <label>아이디<input aria-label="Swagger 아이디" autoComplete="off" value={props.username} disabled={disabled} onChange={event => props.onUsernameChange(event.target.value)} /></label>
          <label>비밀번호<input aria-label="Swagger 비밀번호" data-value-visibility="sensitive" type="text" autoComplete="off" placeholder={sync?.hasSavedAccount && sameUrl && sync.username === props.username && props.remember ? "비워두면 저장된 계정 사용" : undefined} value={props.password} disabled={disabled} onChange={event => props.onPasswordChange(event.target.value)} /></label>
          <label className="api-remember" title={sync?.secureStorageAvailable ? "비밀번호를 OS 보안 기능으로 암호화해 이 기기에 저장합니다" : "이 환경에서는 OS 보안 저장소를 쓸 수 없어 계정을 기억할 수 없습니다"}><input type="checkbox" aria-label="이 기기에 계정 기억" disabled={disabled || !sync?.secureStorageAvailable} checked={props.remember} onChange={event => props.onRememberChange(event.target.checked)} />이 기기에 계정 기억</label>
        </>}
        {catalog && <span className="api-spec-delete"><DeleteAction label="명세 삭제" disabled={disabled} description={`${props.scopeLabel}의 API ${catalog.operations.length}개와 명세 주소·저장 계정·인증 연결을 삭제합니다. 시나리오는 유지되지만 이 명세를 쓰는 단계는 명세를 다시 가져오기 전까지 실행할 수 없습니다.`} onDelete={async () => { await props.onDeleteCatalog(); setOpen(true); }} /></span>}
      </div>
      {/* Only worth saying when a password would actually go over plain HTTP. */}
      {props.authKind === "basic" && /^http:\/\//i.test(url.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url.trim()) && <p className="api-field-help api-spec-http-warning">HTTP 주소라 비밀번호가 암호화되지 않고 전송됩니다. 가능하면 HTTPS 주소를 쓰세요.</p>}
      {sync?.hasSavedAccount && <p className="api-field-help api-spec-saved-account">{sameUrl ? "이 주소에 저장된 계정이 있습니다." : "저장된 계정은 기존 명세 주소에만 쓰입니다."}<button type="button" className="api-compose-link" disabled={disabled} onClick={props.onDeleteSavedAccount}>저장된 계정 삭제</button></p>}
    </div>}
  </section>;
}
