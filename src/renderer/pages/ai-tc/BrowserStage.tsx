import { useEffect, useRef, type MouseEvent } from "react";
import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { TONE_ICON, toneOf } from "./parts";

export type Control = "ai" | "user";

/** Step 3 실행: 현재 TC · 기대 결과 진행 · 실시간 브라우저 화면 · 제어 인계 */
export const BrowserStage = ({ model, control, onTakeover, onGiveBack, onSkip }: {
  model: AiTcModel; control: Control; onTakeover: () => void; onGiveBack: () => void; onSkip: () => void;
}) => {
  const run = model.run;
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewportRef.current;
    const resize = window.electronAPI?.aiTc?.resize;
    if (!element || !run || !resize) return;
    let timer: ReturnType<typeof setTimeout>;
    let queue = Promise.resolve();
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.min(8192, Math.round(entry.contentRect.width));
      const height = Math.min(8192, Math.round(entry.contentRect.height));
      if (!width || !height) return;
      clearTimeout(timer);
      timer = setTimeout(() => { queue = queue.then(() => resize(run.runId, { width, height })).catch(() => {}); }, 100);
    });
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [run?.runId]);
  if (!run) return <div className="aitc-empty"><h2>실행 기록이 없습니다</h2><p>준비 단계에서 실행을 시작하세요.</p></div>;
  const status = run.status;
  const current = run.cases[run.current] ?? run.cases[0]!;
  const wait = status === "waiting" ? run.wait : undefined;
  const isUser = Boolean(wait) && control === "user";
  const isWait = Boolean(wait) && !isUser;
  const mode = isUser ? { label: "직접 제어 중", tone: "user" }
    : wait ? { label: "인계 대기", tone: "warn" }
      : status === "running" ? { label: "AI 제어 중", tone: "run" }
        : status === "error" ? { label: "오류로 정지", tone: "fail" }
          : status === "cancelled" ? { label: "취소됨", tone: "wait" } : { label: "완료", tone: "ok" };
  const toViewport = (event: MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(run.viewport.width, (event.clientX - rect.left) / rect.width * run.viewport.width)),
      y: Math.max(0, Math.min(run.viewport.height, (event.clientY - rect.top) / rect.height * run.viewport.height)),
    };
  };

  return (
    <div className="aitcx-stage">
      <div className="aitcx-stage-head">
        <div><b>{current.id}</b><span>{run.current + 1} / {run.cases.length}</span></div>
        <strong>{current.title}</strong>
      </div>
      <div className="aitcx-exp-chips">
        {current.expected.map(expected => {
          const tone = toneOf(expected.verdict);
          return <span key={expected.id} className="aitcx-exp-chip" title={expected.text}><span className={`msi t-${tone}`} aria-hidden="true">{TONE_ICON[tone]}</span><b>{expected.id}</b><span>{expected.text}</span></span>;
        })}
      </div>
      <div className="aitcx-progress" aria-label={`진행 ${model.progress.percent}%`}><i style={{ width: `${model.progress.percent}%` }} /></div>
      <div className={`aitcx-browser${isUser ? " user" : ""}`}>
        <div className="aitcx-browser-bar">
          {([["back", "arrow_back", "뒤로"], ["forward", "arrow_forward", "앞으로"], ["reload", "refresh", "새로고침"]] as const).map(([type, icon, label]) => (
            <Button key={type} variant="secondary" iconOnly disabled={!isUser} aria-label={label} title={label} onClick={() => model.browserEvent({ type })}><span className="msi" aria-hidden="true">{icon}</span></Button>
          ))}
          <div className={`aitcx-url${run.outOfDomain ? " out" : ""}`} title={run.outOfDomain ? `${run.url} · 허용 목록 밖` : run.url}>
            <span className="msi" aria-hidden="true">{run.outOfDomain ? "gpp_maybe" : "lock"}</span><span>{run.url || "about:blank"}</span>
          </div>
          <span className={`aitcx-mode t-${mode.tone}`}><i />{mode.label}</span>
          {isUser && <Button variant="primary" onClick={onGiveBack}><span className="msi" aria-hidden="true">smart_toy</span>AI에게 돌려주기</Button>}
          {/* 디자인만 있음: AI 실행 중 "직접 제어"로 먼저 가져오기 — 실행기는 사용자 대기(waiting) 상태에서만 사용자 조작을 받는다. */}
          {/* 디자인 미반영: 캡처 상태 표시(OBSERVING·CAPTURE PAUSED 등) */}
        </div>
        <div className="aitcx-viewport" ref={viewportRef}>
          {model.preview ? (
            <img src={model.preview} alt={isUser ? "직접 조작할 브라우저 화면" : "대상 페이지 화면"} tabIndex={isUser ? 0 : -1}
              onClick={isUser ? event => { model.browserEvent({ type: "click", ...toViewport(event) }); event.currentTarget.focus(); } : undefined}
              onWheel={isUser ? event => model.browserEvent({ type: "wheel", ...toViewport(event), deltaX: Math.max(-3000, Math.min(3000, event.deltaX)), deltaY: Math.max(-3000, Math.min(3000, event.deltaY)) }) : undefined}
              onKeyDown={isUser ? event => {
                if (event.key === "Unidentified" || event.key === "Process" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) model.browserEvent({ type: "text", text: event.key });
                else model.browserEvent({ type: "key", key: `${event.metaKey ? "Meta+" : event.ctrlKey ? "Control+" : event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key === " " ? "Space" : event.key}` });
              } : undefined}
              onPaste={isUser ? event => { event.preventDefault(); const text = event.clipboardData.getData("text"); if (text) model.browserEvent({ type: "text", text }); } : undefined} />
          ) : (
            <div className="aitcx-viewport-empty"><small>실시간 브라우저 화면</small><span>{run.capture ? "첫 관찰을 기다리는 중" : "화면을 불러오는 중"}</span></div>
          )}
          {/* 디자인 미반영: AI가 보고 있는 요소 강조 상자(run.highlight), 브라우저 입력값 보내기 칸(비밀번호 입력용) */}
          {isUser && (
            <div className="aitcx-user-pill"><span className="msi" aria-hidden="true">pan_tool</span>직접 제어 중 · AI 대기
              <Button variant="primary" onClick={onGiveBack}>AI에게 돌려주기</Button>
            </div>
          )}
          {isWait && wait && (
            <div className="aitcx-wait">
              <div role="alertdialog" aria-label="제어 인계" className="aitcx-wait-card">
                <div className="aitcx-wait-title"><span className="msi" aria-hidden="true">pan_tool</span><strong>{wait.kind === "confirm" && wait.confirm ? `${wait.confirm.target} 클릭을 진행할까요?` : "AI가 제어를 넘겼어요"}</strong></div>
                {wait.kind === "confirm" && wait.confirm ? (
                  <div className="aitcx-wait-rows">
                    {[["TC", wait.confirm.expected], ["영향", wait.confirm.impact], ["URL", wait.confirm.url]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
                  </div>
                ) : <p>{wait.title}{wait.body ? ` · ${wait.body}` : ""}</p>}
                {wait.kind === "confirm" ? (
                  <div className="aitcx-wait-actions">
                    <Button variant="primary" onClick={() => model.decide("allow")}>이번만 허용</Button>
                    <Button variant="secondary" onClick={() => model.decide("handoff")}>직접 처리</Button>
                    <Button variant="secondary" onClick={() => model.decide("block")} title="Blocked로 기록">건너뛰기</Button>
                  </div>
                ) : (
                  <div className="aitcx-wait-actions">
                    <Button variant="primary" className="aitcx-grow" onClick={onTakeover}><span className="msi" aria-hidden="true">pan_tool</span>직접 제어하기</Button>
                    <Button variant="secondary" onClick={onSkip} title="Blocked로 기록하고 다음으로 진행">건너뛰기</Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="aitcx-browser-foot"><span>Chromium · {run.viewport.width}×{run.viewport.height}</span><span>컨텍스트 유지</span><span className="aitcx-push">run {run.runId.slice(0, 8)}</span></div>
      </div>
      {/* 디자인 미반영: AI 동작 로그(관찰·클릭·입력·판정), 실행 한도 게이지(동작·시간·모델 호출), 실행 토큰 사용량·토큰 경고(budget.tokenWarning), 전체 기대 결과 진행 테이프 — 기존 RunView.tsx 참고 */}
    </div>
  );
};
