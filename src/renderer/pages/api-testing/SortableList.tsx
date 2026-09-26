import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../shared/ui/Icon";

type Props<T> = {
  items: T[];
  /** Stable per item across reorders; used for animation and focus. */
  itemKey: (item: T, index: number) => string;
  /** Screen-reader name of an item, e.g. "2단계 POST /login". */
  itemLabel: (item: T, index: number) => string;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  /** Row content after the drag handle. `position` is where the item shows now, including a drag preview. */
  renderItem: (item: T, index: number, position: number) => ReactNode;
  className?: string;
  itemClassName?: (item: T, index: number) => string;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Reorderable list: drag a row by its handle (or use ↑/↓ on the handle). While dragging,
 * the row stays in the list as a placeholder at its new position and the other rows slide
 * out of the way, so the result is visible before dropping.
 */
export function SortableList<T>({ items, itemKey, itemLabel, disabled = false, onMove, renderItem, className, itemClassName }: Props<T>) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const offsets = useRef(new Map<string, number>());
  const previousOrder = useRef("");
  const focusKey = useRef<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  // Drag events can arrive before React re-renders, so event handlers read the live value here.
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const updateDrag = (next: { from: number; to: number } | null) => { dragRef.current = next; setDrag(next); };

  // Preview order while dragging. The DOM keeps the original order until the drop:
  // moving the dragged node would make the browser cancel the drag.
  const order = items.map((_, index) => index);
  if (drag && drag.from !== drag.to) order.splice(drag.to, 0, ...order.splice(drag.from, 1));
  const keys = items.map((item, index) => itemKey(item, index));
  const layout = useRef<{ tops: number[]; heights: number[]; gap: number } | null>(null);
  const shift = (index: number) => {
    const measured = layout.current;
    if (!drag || !measured) return 0;
    let top = measured.tops[0];
    for (const current of order) {
      if (current === index) return top - measured.tops[index];
      top += measured.heights[current] + measured.gap;
    }
    return 0;
  };

  // FLIP: rows that changed position slide from where they were.
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const next = new Map<string, number>();
    const rows = [...root.querySelectorAll<HTMLElement>(":scope > [data-sort-key]")];
    for (const row of rows) next.set(row.dataset.sortKey!, row.getBoundingClientRect().top - top);
    const orderKey = keys.join("\0");
    if (orderKey !== previousOrder.current && previousOrder.current && !reducedMotion()) {
      for (const row of rows) {
        const before = offsets.current.get(row.dataset.sortKey!);
        const after = next.get(row.dataset.sortKey!);
        if (before === undefined || after === undefined || before === after) continue;
        row.animate([{ transform: `translateY(${before - after}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    previousOrder.current = orderKey;
    offsets.current = next;
    if (focusKey.current) {
      root.querySelector<HTMLElement>(`:scope > [data-sort-key="${CSS.escape(focusKey.current)}"] [data-sort-handle]`)?.focus();
      focusKey.current = null;
    }
  });

  const commit = (from: number, to: number, key: string) => {
    if (from === to) return;
    onMove(from, to);
    setAnnouncement(`${itemLabel(items[from], from)}을(를) ${to + 1}번째로 옮겼습니다.`);
    setMoved(key);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setMoved(null), 900);
  };

  return <>
    <ol ref={list} className={`api-sortable${drag ? " is-sorting" : ""}${className ? ` ${className}` : ""}`}
      // Both dragenter and dragover must be cancelled for the list to accept the drop.
      onDragEnter={event => { if (dragRef.current) event.preventDefault(); }}
      onDragOver={event => { if (dragRef.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={event => {
        const current = dragRef.current;
        if (!current) return;
        event.preventDefault();
        commit(current.from, current.to, itemKey(items[current.from], current.from));
        updateDrag(null);
      }}>
      {items.map((item, index) => {
        const key = keys[index];
        const position = order.indexOf(index);
        const dragging = drag?.from === index;
        const offset = shift(index);
        return <li key={key} data-sort-key={key} style={offset ? { transform: `translateY(${offset}px)` } : undefined}
          className={`api-sortable-item${itemClassName ? ` ${itemClassName(item, index)}` : ""}${dragging ? " is-dragging" : ""}${moved === key ? " is-moved" : ""}`}
          onDragOver={event => {
            const current = dragRef.current;
            if (!current || disabled) return;
            event.preventDefault();
            // Where this row shows in the preview, and where it would be without the dragged row.
            const rest = index > current.from ? index - 1 : index;
            const shown = index === current.from ? current.to : rest >= current.to ? rest + 1 : rest;
            if (shown === current.to) return;
            // Past the middle of a row means "after it".
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            const base = shown > current.to ? shown - 1 : shown;
            const to = Math.min(items.length - 1, after ? base + 1 : base);
            if (to !== current.to) updateDrag({ ...current, to });
          }}>
          <button type="button" className="api-sort-handle" data-sort-handle disabled={disabled} draggable={!disabled}
            aria-label={`${itemLabel(item, index)} 순서 변경`} title="드래그하거나 ↑·↓ 키로 순서 변경"
            onDragStart={event => {
              const row = event.currentTarget.closest("li");
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
              if (row) {
                // Drag the whole row, not just the small handle icon.
                const rect = row.getBoundingClientRect();
                event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
              }
              const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-sort-key]") ?? [])].map(element => element.getBoundingClientRect());
              layout.current = { tops: rows.map(rect => rect.top), heights: rows.map(rect => rect.height), gap: rows.length > 1 ? rows[1].top - rows[0].bottom : 0 };
              // Style as a placeholder only after the browser has captured the drag image.
              dragRef.current = { from: index, to: index };
              window.setTimeout(() => { if (dragRef.current) setDrag(dragRef.current); }, 0);
            }}
            onDragEnd={() => updateDrag(null)}
            onKeyDown={event => {
              if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              const to = index + (event.key === "ArrowUp" ? -1 : 1);
              if (to < 0 || to >= items.length) return;
              focusKey.current = key;
              commit(index, to, key);
            }}><Icon name="drag_indicator" size={16} /></button>
          {renderItem(item, index, position)}
        </li>;
      })}
    </ol>
    <span role="status" className="api-sortable-announcement">{announcement}</span>
  </>;
}
