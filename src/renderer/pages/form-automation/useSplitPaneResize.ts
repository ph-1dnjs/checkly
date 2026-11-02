import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

export const useSplitPaneResize = (enabled: boolean) => {
  const [ratio, setRatio] = useState(0.5);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    handle: HTMLDivElement;
    pointerId: number;
    startX: number;
    startRatio: number;
    width: number;
  } | null>(null);

  const stop = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    setResizing(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [enabled, stop]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return;
    const handle = event.currentTarget;
    const width = (handle.parentElement?.getBoundingClientRect().width ?? 0) - handle.getBoundingClientRect().width;
    if (width <= 0) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    drag.current = { handle, pointerId: event.pointerId, startX: event.clientX, startRatio: ratio, width };
    setResizing(true);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setRatio(clampRatio(current.startRatio + (event.clientX - current.startX) / current.width));
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault();
    setRatio((current) => event.key === "Home" ? MIN_RATIO : event.key === "End" ? MAX_RATIO
      : event.key === "Enter" ? 0.5 : clampRatio(current + (event.key === "ArrowLeft" ? -0.05 : 0.05)));
  };

  return {
    ratio,
    resizing,
    separatorProps: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      onDoubleClick: () => setRatio(0.5),
      onKeyDown: keyDown,
      "aria-valuemin": MIN_RATIO * 100,
      "aria-valuemax": MAX_RATIO * 100,
      "aria-valuenow": Math.round(ratio * 100),
      "aria-valuetext": `왼쪽 ${Math.round(ratio * 100)}%, 오른쪽 ${Math.round((1 - ratio) * 100)}%`,
    },
  };
};
