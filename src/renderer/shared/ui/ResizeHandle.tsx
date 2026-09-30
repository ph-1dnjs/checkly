import { useCallback, useState, type RefObject } from "react";

const storageKey = (key: string) => `checkly:panel-width:${key}`;

/**
 * A remembered pixel width for the left pane of a two-pane layout (null = the layout's default).
 * Kept in this browser/app only; unreadable storage just means the default.
 */
export function useStoredWidth(key: string): [number | null, (width: number | null) => void] {
  const [width, setWidth] = useState<number | null>(() => {
    try { const value = Number(localStorage.getItem(storageKey(key))); return Number.isFinite(value) && value > 0 ? value : null; }
    catch { return null; }
  });
  const update = useCallback((next: number | null) => {
    setWidth(next);
    try { if (next === null) localStorage.removeItem(storageKey(key)); else localStorage.setItem(storageKey(key), String(Math.round(next))); }
    catch { /* The width still applies for this session. */ }
  }, [key]);
  return [width, update];
}

/**
 * Vertical divider between two panes: drag, or focus and use ←/→, to resize the left pane;
 * double-click resets it. The layout places it (absolutely) on the left pane's edge.
 */
export function ResizeHandle({ label, container, pane = ":scope > :first-child", min, max, onChange }: {
  label: string;
  /** The two-pane layout. */
  container: RefObject<HTMLElement | null>;
  /** Selector (within the layout) of the left pane; its first child by default. */
  pane?: string;
  min: number;
  /** Largest left pane, as a fraction of the layout's width. */
  max: number;
  onChange: (width: number | null) => void;
}) {
  const bounds = () => {
    const element = container.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const left = rect.left + parseFloat(getComputedStyle(element).paddingLeft || "0");
    const width = element.querySelector(pane)?.getBoundingClientRect().width ?? min;
    return { left, pane: width, limit: Math.max(min, rect.width * max) };
  };
  const clamp = (width: number, limit: number) => Math.min(Math.max(width, min), limit);
  return <div className="panel-resize-handle" role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
    title="끌어서 폭 조절 · 더블클릭하면 기본 폭"
    onDoubleClick={() => onChange(null)}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const box = bounds(); if (!box) return;
      event.preventDefault();
      onChange(clamp(box.pane + (event.key === "ArrowRight" ? 16 : -16), box.limit));
    }}
    onPointerDown={event => {
      const box = bounds(); if (!box || event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("panel-resizing");
      const move = (moveEvent: PointerEvent) => onChange(clamp(moveEvent.clientX - box.left, box.limit));
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        document.body.classList.remove("panel-resizing");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }} />;
}
