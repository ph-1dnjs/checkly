import { useState, type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";

import { Button } from "../../../shared/ui/Button";
/** Reuses the common disclosure and requires a separate explicit confirmation. */
export function DeleteAction({ label, text, description, disabled, onDelete }: {
  /** Names what is deleted (accessible name, confirm button); `text` can show just "삭제". */
  label: string; text?: ReactNode; description: string; disabled?: boolean; onDelete: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return <Popover label={label} triggerText={text} disabled={disabled} triggerClassName="api-delete-trigger" panelClassName="api-delete-confirm">
    <p>{description}</p><p>삭제하면 되돌릴 수 없습니다.</p>
    {error && <p role="alert">{error}</p>}
    <Button variant="danger" disabled={working} onClick={async () => {
 setWorking(true); setError("");
 try { await onDelete(); }
 catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
 finally { setWorking(false); }
 }}>{working ? "삭제 중…" : `${label} 확인`}</Button>
  </Popover>;
}
