import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import "../../styles/popover.css";

type Props = {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
};

/** Non-modal disclosure: outside click, focus leaving, and Escape dismiss it. */
export function Popover({ label, children, disabled = false, className, triggerClassName, panelClassName }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: Event) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className={["shared-popover", className].filter(Boolean).join(" ")} ref={root}>
    <button type="button" ref={trigger} className={triggerClassName} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{label}</button>
    {open && <div id={id} ref={panel} role="dialog" aria-label={label} tabIndex={-1} className={["shared-popover-panel", panelClassName].filter(Boolean).join(" ")} data-scroll="light">
      <button type="button" className="shared-popover-close" aria-label={`${label} 닫기`} onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button>
      {children}
    </div>}
  </div>;
}
