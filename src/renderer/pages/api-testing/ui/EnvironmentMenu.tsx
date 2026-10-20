import { useEffect, useRef, useState } from "react";
import type { ApiProject } from "../../../../app/api-testing/shared/workspace";
import { Icon } from "../../../shared/ui/Icon";
import { ServerTag } from "../../../entities/api-testing";

import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/Input";
const hostOf = (url: string | undefined) => {
  if (!url) return "";
  try { return new URL(url).host; } catch { return url; }
};

type Props = {
  project: ApiProject;
  environmentId: string;
  /** The server whose address each row shows (the API docs' server); otherwise the first one with an address. */
  serverId?: string;
  label: string;
  title?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  /** Adds an environment with empty server addresses (filled in project settings). */
  onAdd?: (name: string) => Promise<void>;
};

/** The header's environment switch: the current environment, and a menu of the project's environments. */
export function EnvironmentMenu({ project, environmentId, serverId, label, title, disabled = false, onSelect, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = project.environments.find(environment => environment.id === environmentId);
  const close = () => { setOpen(false); setAdding(false); setName(""); setError(""); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  const rowHost = (baseUrls: Record<string, string>) => hostOf(serverId ? baseUrls[serverId] : Object.values(baseUrls).find(Boolean));
  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onAdd) return;
    if (project.environments.some(environment => environment.name === trimmed)) { setError("같은 이름의 환경이 있습니다."); return; }
    setSaving(true); setError("");
    try { await onAdd(trimmed); close(); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { setSaving(false); }
  };
  const serverNames = Object.fromEntries(project.servers.map(server => [server.id, server.name]));
  return <div ref={root} className="api-env-menu">
    <Button ref={trigger} className="api-env-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} title={title ?? (current ? `${current.name} 환경` : undefined)} disabled={disabled} onClick={() => open ? close() : setOpen(true)}>
      <span className="api-env-current">{current?.name ?? "환경 선택"}</span><Icon name="expand_more" size={16} />
    </Button>
    {open && <div role="menu" aria-label="환경 선택" className="api-env-popup">
      {!project.environments.length && <p className="api-env-empty">등록된 환경이 없습니다.<br />환경을 추가하면 서버 주소와 전역변수 값을 환경별로 나눌 수 있습니다.</p>}
      {project.environments.map(environment => <Button key={environment.id} role="menuitemradio" aria-checked={environment.id === environmentId} className="api-env-item" onClick={() => { close(); onSelect(environment.id); trigger.current?.focus(); }}>
        <Icon name="check" size={16} className="api-env-check" />
        <span className="api-env-name">{environment.name}</span>
        <span className="api-env-host">{rowHost(environment.baseUrls)}</span>
      </Button>)}
      {/* With several servers, which address each one calls in the current environment (their tag colours match the steps). */}
      {project.servers.length > 1 && current && <div className="api-env-servers" aria-label="프로젝트 서버">
        {project.servers.map(server => <div key={server.id} className="api-env-server"><ServerTag server={server.id} names={serverNames} /><span className="api-env-host">{hostOf(current.baseUrls[server.id]) || "미설정"}</span></div>)}
      </div>}
      {onAdd && <>
        <div className="api-env-sep" role="separator" />
        {adding ? <div className="api-env-add">
          <Input autoFocus aria-label="새 환경 이름" placeholder="예: staging" value={name} disabled={saving} onChange={event => { setName(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void add(); } }} />
          <Button variant="primary" disabled={saving || !name.trim()} onClick={() => void add()}>{saving ? "추가 중…" : "추가"}</Button>
        </div> : <Button role="menuitem" className="api-env-item" onClick={() => setAdding(true)}><Icon name="add" size={16} className="api-env-add-icon" />환경 추가</Button>}
        {error && <p className="api-env-error" role="alert">{error}</p>}
        {adding && !error && <p className="api-env-hint">서버 주소는 프로젝트 설정에서 입력합니다.</p>}
      </>}
    </div>}
  </div>;
}
