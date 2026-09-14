import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

type Point = { x: number; y: number };
type DrawCommand =
  | { kind: "pen"; points: Point[]; color: string; lineWidth: number }
  | { kind: "eraser"; points: Point[]; color: string; lineWidth: number }
  | { kind: "rectangle"; start: Point; end: Point; color: string; lineWidth: number }
  | { kind: "check"; x: number; y: number; size: number; color: string; lineWidth: number }
  | { kind: "text"; x: number; y: number; text: string; color: string; lineWidth: number; fontSize: number };

type Tool = "pen" | "rectangle" | "check" | "text" | "eraser";

type TextDraft = {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  scale: number;
  color: string;
  value: string;
};

export type ScreenshotCapture = {
  dataUrl: string;
  size: { width: number; height: number };
};

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span className="msi" aria-hidden="true">{name}</span>
);

export const ScreenshotEditor = ({
  capture,
  onCancel,
  onCopy,
}: {
  capture: ScreenshotCapture;
  onCancel: () => void;
  onCopy: (dataUrl: string) => Promise<void>;
}): ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const activeCommandRef = useRef<DrawCommand | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [commands, setCommands] = useState<DrawCommand[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#ef4454");
  const [brushSize, setBrushSize] = useState(6);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [copying, setCopying] = useState(false);

  const drawCommand = useCallback((context: CanvasRenderingContext2D, command: DrawCommand) => {
    context.save();
    context.strokeStyle = command.color;
    context.fillStyle = command.color;
    context.lineWidth = command.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (command.kind === "eraser") context.globalCompositeOperation = "destination-out";
    if (command.kind === "pen" || command.kind === "eraser") {
      if (command.points.length === 1) {
        context.beginPath();
        context.arc(command.points[0].x, command.points[0].y, command.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.beginPath();
        command.points.forEach((point, index) => {
          if (index) context.lineTo(point.x, point.y);
          else context.moveTo(point.x, point.y);
        });
        context.stroke();
      }
    } else if (command.kind === "check") {
      context.beginPath();
      context.moveTo(command.x - command.size * 0.5, command.y);
      context.lineTo(command.x - command.size * 0.12, command.y + command.size * 0.38);
      context.lineTo(command.x + command.size * 0.58, command.y - command.size * 0.48);
      context.stroke();
    } else if (command.kind === "rectangle") {
      const x = Math.min(command.start.x, command.end.x);
      const y = Math.min(command.start.y, command.end.y);
      const width = Math.abs(command.end.x - command.start.x);
      const height = Math.abs(command.end.y - command.start.y);
      context.globalAlpha = 0.12;
      context.fillRect(x, y, width, height);
      context.globalAlpha = 1;
      context.strokeRect(x, y, width, height);
    } else {
      context.font = `700 ${command.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      context.textBaseline = "top";
      context.shadowColor = "rgba(0, 0, 0, .45)";
      context.shadowBlur = Math.max(2, command.fontSize * 0.08);
      context.fillText(command.text, command.x, command.y);
    }
    context.restore();
  }, []);

  const redraw = useCallback((activeCommand?: DrawCommand | null) => {
    const canvas = canvasRef.current;
    const sourceImage = sourceImageRef.current;
    if (!canvas || !sourceImage) return;
    if (!annotationCanvasRef.current) annotationCanvasRef.current = document.createElement("canvas");
    const annotationCanvas = annotationCanvasRef.current;
    if (annotationCanvas.width !== canvas.width || annotationCanvas.height !== canvas.height) {
      annotationCanvas.width = canvas.width;
      annotationCanvas.height = canvas.height;
    }
    const annotationContext = annotationCanvas.getContext("2d");
    const context = canvas.getContext("2d");
    if (!annotationContext || !context) return;
    annotationContext.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    commands.forEach((command) => drawCommand(annotationContext, command));
    if (activeCommand) drawCommand(annotationContext, activeCommand);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    context.drawImage(annotationCanvas, 0, 0);
  }, [commands, drawCommand]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = new Image();
    setReady(false);
    setCommands([]);
    setTextDraft(null);
    annotationCanvasRef.current = null;
    image.onload = () => {
      if (!canvas) return;
      sourceImageRef.current = image;
      canvas.width = capture.size?.width || image.naturalWidth;
      canvas.height = capture.size?.height || image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    image.src = capture.dataUrl;
    return () => { image.onload = null; };
  }, [capture]);

  useEffect(() => { if (ready) redraw(); }, [commands, ready, redraw]);

  useEffect(() => {
    if (!textDraft) return;
    const frame = window.requestAnimationFrame(() => textInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [textDraft?.x, textDraft?.y]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") onCancel();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setCommands((items) => items.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
      scale: canvas.width / bounds.width,
    };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const point = canvasPoint(event);
    if (tool === "text") {
      event.preventDefault();
      setTextDraft({
        x: point.x,
        y: point.y,
        screenX: Math.max(8, Math.min(event.clientX, window.innerWidth - 425)),
        screenY: Math.max(82, Math.min(event.clientY, window.innerHeight - 52)),
        scale: point.scale,
        color,
        value: "",
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "check") {
      setCommands((items) => [...items, {
        kind: "check",
        x: point.x,
        y: point.y,
        size: 42 * point.scale,
        color,
        lineWidth: brushSize * 1.25 * point.scale,
      }]);
      return;
    }
    activeCommandRef.current = tool === "rectangle"
      ? { kind: "rectangle", start: point, end: point, color, lineWidth: brushSize * point.scale }
      : { kind: tool, points: [point], color, lineWidth: brushSize * (tool === "eraser" ? 4 : 1) * point.scale };
    redraw(activeCommandRef.current);
  };

  const continueDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const command = activeCommandRef.current;
    if (!command || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = canvasPoint(event);
    if (command.kind === "rectangle") {
      command.end = point;
      redraw(command);
      return;
    }
    if (command.kind !== "pen" && command.kind !== "eraser") return;
    const previous = command.points.at(-1)!;
    if ((point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 < 2) return;
    command.points.push(point);
    redraw(command);
  };

  const finishDrawing = () => {
    const command = activeCommandRef.current;
    if (!command) return;
    activeCommandRef.current = null;
    if (command.kind === "rectangle"
      && Math.abs(command.end.x - command.start.x) < 3
      && Math.abs(command.end.y - command.start.y) < 3) {
      redraw();
      return;
    }
    setCommands((items) => [...items, command]);
  };

  const commitText = (value?: string) => {
    const text = String(value ?? textDraft?.value ?? "").trim();
    if (text && textDraft) {
      setCommands((items) => [...items, {
        kind: "text",
        x: textDraft.x,
        y: textDraft.y,
        text,
        color: textDraft.color,
        lineWidth: 1,
        fontSize: 24 * textDraft.scale,
      }]);
    }
    setTextDraft(null);
  };

  const copyCapture = async () => {
    const canvas = canvasRef.current;
    if (!ready || copying || !canvas) return;
    setCopying(true);
    try { await onCopy(canvas.toDataURL("image/png")); }
    finally { setCopying(false); }
  };

  const toolDescription: Record<Tool, string> = {
    pen: "화면 위에 자유롭게 표시하세요.",
    rectangle: "드래그해서 영역을 네모로 표시합니다.",
    check: "클릭한 위치에 체크를 표시합니다.",
    text: "원하는 위치를 클릭하고 글자를 입력합니다.",
    eraser: "드래그해서 주석을 지웁니다.",
  };

  return (
    <div className="fa-capture-editor" role="dialog" aria-modal="true" aria-label="화면 캡처 편집">
      <canvas
        ref={canvasRef}
        aria-label="캡처 이미지 주석 영역"
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />
      {textDraft && (
        <div
          className="fa-capture-text-editor"
          style={{ left: textDraft.screenX, top: textDraft.screenY, color: textDraft.color }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            ref={textInputRef}
            aria-label="캡처에 넣을 텍스트"
            placeholder="텍스트 입력 후 Enter"
            value={textDraft.value}
            onChange={(event) => setTextDraft((draft) => draft ? { ...draft, value: event.target.value } : draft)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") { event.preventDefault(); commitText(event.currentTarget.value); }
              if (event.key === "Escape") { event.preventDefault(); setTextDraft(null); }
            }}
          />
          <button aria-label="텍스트 적용" disabled={!textDraft.value.trim()} onClick={() => commitText(textDraft.value)}><MaterialIcon name="check" /></button>
          <button aria-label="텍스트 입력 취소" onClick={() => setTextDraft(null)}><MaterialIcon name="close" /></button>
        </div>
      )}
      <div className="fa-capture-toolbar">
        <div className="fa-capture-title"><MaterialIcon name="photo_camera" /><span><strong>화면 캡처 모드</strong><small>{toolDescription[tool]}</small></span></div>
        <div className="fa-capture-tools" role="group" aria-label="주석 도구">
          {([
            ["pen", "draw", "펜"],
            ["rectangle", "crop_square", "네모"],
            ["check", "check", "체크"],
            ["text", "title", "텍스트"],
            ["eraser", "ink_eraser", "지우개"],
          ] as Array<[Tool, string, string]>).map(([value, icon, label]) => (
            <button key={value} className={tool === value ? "active" : ""} onClick={() => setTool(value)}><MaterialIcon name={icon} /> {label}</button>
          ))}
        </div>
        <div className="fa-capture-colors" role="group" aria-label="주석 색상">
          {["#ef4454", "#ffbf2f", "#2e7cf6", "#ffffff"].map((value) => (
            <button
              key={value}
              aria-label={`${value} 색상`}
              disabled={tool === "eraser"}
              className={color === value ? "active" : ""}
              style={{ "--fa-capture-color": value } as CSSProperties}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
        <label className="fa-capture-size">굵기<input type="range" min="3" max="14" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
        <button className="fa-capture-undo" disabled={!commands.length} onClick={() => setCommands((items) => items.slice(0, -1))}><MaterialIcon name="undo" /> 실행 취소</button>
        <span className="fa-capture-divider" />
        <button className="fa-capture-cancel" onClick={onCancel}>취소</button>
        <button className="fa-capture-complete" disabled={!ready || copying || Boolean(textDraft)} onClick={() => void copyCapture()}><MaterialIcon name="content_copy" /> {copying ? "복사 중…" : "완료 · 클립보드 복사"}</button>
      </div>
    </div>
  );
};
