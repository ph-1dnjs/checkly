import { useState } from "react";
import { Popover } from "../../shared/ui/Popover";

/** Reuses the common disclosure and requires a separate explicit confirmation. */
export function DeleteAction({ label, description, disabled, onDelete }: {
  label: string; description: string; disabled?: boolean; onDelete: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return <Popover label={label} disabled={disabled}>
    <p>{description}</p><p>삭제하면 되돌릴 수 없습니다.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={working} onClick={async () => {
      setWorking(true); setError("");
      try { await onDelete(); }
      catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
      finally { setWorking(false); }
    }}>{working ? "삭제 중…" : `${label} 확인`}</button>
  </Popover>;
}
