import { useEffect, useRef, useState } from "react";
import { Replayer } from "@rrweb/replay";
import type { eventWithTime } from "@rrweb/types";
import "@rrweb/replay/dist/style.css";
import type { SessionDocument } from "../../shared/model/electron-api/live-session";

const clock = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const SessionPlayer = ({ document, startAt, endAt, errorAt }: { document: SessionDocument; startAt?: number; endAt?: number; errorAt?: number }) => {
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const player = useRef<Replayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const firstTime = document.events[0]?.timestamp ?? 0;
  const startTime = Math.max(firstTime, startAt ?? firstTime);
  const lastTime = document.events.at(-1)?.timestamp ?? startTime;
  const endTime = Math.max(startTime, Math.min(lastTime, endAt ?? lastTime));
  const baseOffset = startTime - firstTime;
  // rrweb casts events strictly before the requested time. Include the first
  // snapshot even when the slider is at zero, so backward seeking rebuilds DOM/scroll.
  const firstSnapshotOffset = Math.max(0, (document.events.find(event => event.type === 2)?.timestamp ?? firstTime) - firstTime) + 1;

  useEffect(() => {
    if (!root.current || !stage.current) return;
    setError(""); setPosition(0); setPlaying(false); setSpeed(1);
    if (!document.events.some(event => event.type === 2)) {
      setError("이 페이지에는 재생할 화면 기록이 없습니다.");
      return;
    }
    let replayer: Replayer;
    try {
      replayer = new Replayer(document.events as eventWithTime[], {
        root: root.current, speed: 1, showWarning: false, showDebug: false,
        mouseTail: false, loadTimeout: 1000,
      });
    } catch (cause) { setError(`재생기를 열지 못했습니다: ${String(cause)}`); return; }
    player.current = replayer;
    const total = endTime - startTime;
    setDuration(total);
    // The constructor emits its initial resize synchronously, before listeners
    // can subscribe. Start from the recorded viewport rather than a guessed size.
    const meta = document.events.find(event => event.type === 4)?.data as { width?: number; height?: number } | undefined;
    let dimensions = { width: Number(meta?.width) || Number(replayer.iframe.width) || 1280,
      height: Number(meta?.height) || Number(replayer.iframe.height) || 720 };
    const fit = () => {
      const container = stage.current;
      if (!container || !dimensions.width || !dimensions.height) return;
      const scale = Math.min(container.clientWidth / dimensions.width, container.clientHeight / dimensions.height, 1);
      replayer.wrapper.style.width = `${dimensions.width}px`;
      replayer.wrapper.style.height = `${dimensions.height}px`;
      replayer.iframe.style.width = `${dimensions.width}px`;
      replayer.iframe.style.height = `${dimensions.height}px`;
      replayer.iframe.style.maxWidth = "none";
      replayer.wrapper.style.transformOrigin = "top left";
      replayer.wrapper.style.transform = `scale(${scale})`;
      replayer.wrapper.style.marginLeft = `${Math.max(0, (container.clientWidth - dimensions.width * scale) / 2)}px`;
    };
    replayer.on("resize", size => { dimensions = size as typeof dimensions; fit(); });
    replayer.on("finish", () => { setPlaying(false); setPosition(total); });
    const observer = new ResizeObserver(fit);
    observer.observe(stage.current);
    replayer.pause(Math.max(firstSnapshotOffset, baseOffset));
    fit();
    const timer = window.setInterval(() => {
      if (replayer.service.state.matches("playing")) {
        const current = replayer.getCurrentTime() - baseOffset;
        setPosition(Math.max(0, Math.min(total, current)));
        if (current >= total) { replayer.pause(); setPlaying(false); }
      }
    }, 100);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      replayer.destroy();
      player.current = null;
    };
  }, [document, startAt, endAt]);

  const seek = (value: number) => {
    player.current?.pause(Math.max(firstSnapshotOffset, value + baseOffset));
    setPlaying(false); setPosition(value);
  };
  const activities = document.events.filter(event => {
    const data = event.data as { source?: number; type?: number };
    if (event.timestamp < startTime || event.timestamp > endTime) return false;
    return event.type === 4 || (event.type === 3 && (data.source === 5 || data.source === 3 || (data.source === 2 && data.type === 2)));
  }).slice(0, 500);
  const label = (event: typeof activities[number]) => {
    if (event.type === 4) return "페이지 화면";
    const source = (event.data as { source: number }).source;
    return source === 5 ? "입력 (마스킹)" : source === 3 ? "스크롤" : "클릭";
  };

  return <div className="ls-player">
    <div className="ls-player-main">
      <div className="ls-stage" ref={stage}>
        <div ref={root} />
        {error && <div className="ls-empty" role="alert">{error}</div>}
      </div>
      <div className="ls-controls">
        <button className="button" disabled={!!error} onClick={() => {
          if (playing) player.current?.pause();
          else player.current?.play(Math.max(firstSnapshotOffset, baseOffset + (position >= duration ? 0 : position)));
          setPlaying(!playing);
        }}>{playing ? "일시정지" : "재생"}</button>
        <input aria-label="재생 위치" type="range" min={0} max={duration} value={position} step={100}
          disabled={!!error} onChange={event => seek(Number(event.target.value))} />
        <span className="ls-mono">{clock(position)} / {clock(duration)}</span>
        <select aria-label="재생 속도" value={speed} onChange={event => {
          const value = Number(event.target.value); setSpeed(value); player.current?.setConfig({ speed: value });
        }}>{[0.5, 1, 2, 4].map(value => <option key={value} value={value}>{value}×</option>)}</select>
      </div>
    </div>
    <aside className="ls-activities" aria-label="동작 타임라인">
      <div className="ls-section-label">동작 타임라인 <span>{activities.length}{activities.length === 500 ? "+" : ""}</span></div>
      {errorAt !== undefined && errorAt >= startTime && errorAt <= endTime && <button className="ls-trigger" onClick={() => seek(errorAt - startTime)}>
        <span className="ls-mono">{clock(errorAt - startTime)}</span><span>오류 발생</span>
      </button>}
      {activities.map((event, index) => <button key={index} onClick={() => seek(event.timestamp - startTime)}>
        <span className="ls-mono">{clock(event.timestamp - startTime)}</span><span>{label(event)}</span>
      </button>)}
      {!activities.length && <p>기록된 동작이 없습니다.</p>}
    </aside>
  </div>;
};
