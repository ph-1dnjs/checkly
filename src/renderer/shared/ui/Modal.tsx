import { useEffect, type ReactNode } from "react";

type Props = {
  label: string;
  backdropClassName: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
};

/** Mount only while open. The caller owns the contents and styling. */
export function Modal({ label, backdropClassName, className, onClose, children }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className={backdropClassName} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={className} role="dialog" aria-modal="true" aria-label={label} onMouseDown={event => event.stopPropagation()}>
      {children}
    </section>
  </div>;
}
