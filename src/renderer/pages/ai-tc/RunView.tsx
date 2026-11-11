import { useState } from "react";
import { Input } from "../../shared/ui/Input";
import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { VERDICT_LABEL, aggregate, type AiTcActionLog, type AiTcLiveVerdict } from "../../../app/ipc/ai-tc/model";

export const verdictTone = (verdict: AiTcLiveVerdict) =>
  ({ pass: "ok", fail: "fail", blocked: "blocked", check: "wait", pending: "idle", na: "na", running: "running", waiting: "wait" })[verdict];

const opTone = (op: AiTcActionLog["op"]) => (op === "관찰" ? "observe" : op === "요청" || op === "인계" ? "wait" : op === "판정" ? "judge" : "act");

export const RunView = ({ model }: { model: AiTcModel }) => {
  const [reply, setReply] = useState("");
  const [browserText, setBrowserText] = useState("");
  const run = model.run;
  if (!run) {
    return <div className="aitc-empty"><h2>실행 기록이 없습니다</h2><p>준비 단계에서 실행을 시작하세요.</p><Button variant="secondary" onClick={() => model.setScreen("prep")}>준비로 이동</Button></div>;
  }
  const status = run.status;
  const waiting = status === "waiting";
  const live = model.live;
  const word = { running: "RUNNING", waiting: "WAITING", error: "ERROR", done: "DONE", cancelled: "CANCELLED" }[status];
  const current = run.cases[run.current] ?? run.cases[0]!;
  const focus = current.expected.find(item => item.verdict === "running" || item.verdict === "waiting") ?? current.expected.find(item => item.verdict === "pending") ?? current.expected[current.expected.length - 1]!;
  const tag = status === "running" ? "검증 중" : status === "error" ? "오류로 정지" : status === "cancelled" ? "취소됨" : status === "done" ? "완료" : "사용자 대기";
  const groups: Array<{ id: string; text: string; verdict: AiTcLiveVerdict; items: AiTcActionLog[] }> = [];
  for (const action of current.actions) {
    const id = action.expected ?? "";
    let group = groups[groups.length - 1];
    if (!group || (id && group.id !== id)) {
      const expected = current.expected.find(item => item.id === id);
      group = { id, text: expected?.text ?? "관찰·준비", verdict: expected?.verdict ?? "pending", items: [] };
      groups.push(group);
    }
    group.items.push(action);
  }
  const elapsed = run.budget.caseStartedAt ? Math.max(0, Math.round(((run.endedAt ? Date.parse(run.endedAt) : Date.now()) - Date.parse(run.budget.caseStartedAt)) / 1000)) : 0;
  const budget = [
    { label: "동작", value: String(run.budget.actions), max: ` / ${run.budget.maxActions}`, pct: run.budget.actions / run.budget.maxActions },
    { label: "시간", value: `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`, max: ` / ${run.budget.maxMinutes}:00`, pct: elapsed / (run.budget.maxMinutes * 60) },
    { label: "모델 호출", value: String(run.budget.modelCalls), max: ` / ${run.budget.maxModelCalls}`, pct: run.budget.modelCalls / run.budget.maxModelCalls },
  ];
  const wait = run.wait;
  const banner = waiting && wait ? {
    tone: "wait", icon: { login: "key", confirm: "pan_tool", domain: "gpp_maybe", popup: "tab", download: "download", handoff: "back_hand" }[wait.kind],
    tag: `USER · ${{ login: "로그인 필요", confirm: "위험 동작", domain: "허용 도메인 이탈", popup: "새 탭", download: "다운로드", handoff: "사용자 인계" }[wait.kind]}`,
    title: wait.title, body: wait.body,
    actions: wait.kind === "confirm" ? [] : [
      { label: wait.kind === "login" ? "로그인 실패 · Blocked" : "Blocked로 기록", kind: "secondary" as const, go: () => model.decide("block") },
      { label: wait.kind === "login" ? "로그인 완료 · 재개" : "직접 처리 후 재개", kind: "primary" as const, go: () => { model.decide("resume", reply); setReply(""); } },
    ],
  } : status === "error" && run.error ? {
    tone: "fail", icon: "error", tag: `ERROR · ${run.error.message}`, title: "실행을 멈췄습니다", body: "테스트 Fail로 기록하지 않습니다. 확인된 결과는 보존됩니다.",
    actions: [
      { label: "여기서 종료", kind: "secondary" as const, go: () => model.decide("stop") },
      ...(run.error.retryable ? [{ label: "다시 시도", kind: "primary" as const, go: () => model.decide("resume") }] : []),
    ],
  } : status === "cancelled" ? {
    tone: "idle", icon: "cancel", tag: "CANCELLED", title: "실행 취소됨", body: "완료된 결과는 보존하고 나머지는 미실행으로 기록했습니다.",
    actions: [{ label: "결과 보기", kind: "secondary" as const, go: () => model.setScreen("result") }],
  } : null;
  const hl = run.highlight;
  const allExpected = run.cases.flatMap(item => item.expected.map(expected => ({ ...expected, tc: item.id })));

  return (
    <section className="aitc-run">
      <div className="aitc-run-top">
        <span className={`aitc-run-state ${status}`}><i />{word}</span>
        <span className="aitc-mute">TC <b className="aitc-ink">{run.current + 1}/{run.cases.length}</b></span>
        <span className="aitc-mute">{run.provider} · {run.allowedHosts[0]}</span>
        <span className="aitc-push aitc-run-pct">{model.progress.percent}%</span>
        {live && <Button variant="danger" onClick={model.cancel}><span className="msi" aria-hidden="true">stop</span>실행 취소</Button>}
        {!live && <Button variant="secondary" onClick={() => model.setScreen("result")}>결과 보기</Button>}
      </div>
      <div className="aitc-tape" aria-label={`기대 결과 ${model.progress.done}/${model.progress.total} 완료`}>
        {allExpected.map((item, index) => <span key={`${item.tc}-${item.id}-${index}`} className={verdictTone(item.verdict)} title={`${item.tc} ${item.id} · ${VERDICT_LABEL[item.verdict]}`} />)}
      </div>
      <div className="aitc-run-grid">
        <div className="aitc-pane">
          <div className="aitc-pane-head">TEST CASES</div>
          <div className="aitc-scroll aitc-pad-bottom">
            {run.cases.map((item, index) => {
              const verdict = aggregate(item.expected.map(expected => expected.verdict));
              const isCurrent = index === run.current && live;
              return (
                <div key={item.key} className={`aitc-run-tc${isCurrent ? ` active${waiting ? " wait" : ""}` : ""}`}>
                  <span className={`aitc-dot ${verdictTone(verdict)}`} />
                  <div>
                    <div className="aitc-run-tc-top"><b>{item.id}</b><span className={`aitc-v ${verdictTone(verdict)}`}>{VERDICT_LABEL[verdict]}</span></div>
                    <div className={`aitc-run-tc-title${verdict === "pending" ? " mute" : ""}`}>{item.title}</div>
                    {!isCurrent && item.reason && ["fail", "blocked", "check"].includes(verdict) && <div className="aitc-run-tc-reason">{item.reason}</div>}
                    {isCurrent && item.expected.map(expected => (
                      <div key={expected.id} className="aitc-run-exp">
                        <span className={`aitc-dot small ${verdictTone(expected.verdict)}`} />
                        <span className="aitc-mono-mute">{expected.id}</span>
                        <span className={expected.verdict === "running" || expected.verdict === "waiting" ? "strong" : expected.verdict === "pending" ? "mute" : ""}>{expected.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="aitc-stage">
          <div className={`aitc-focus ${status === "error" ? "fail" : waiting ? "wait" : status === "cancelled" ? "idle" : "running"}`}>
            <span className="aitc-focus-bar" />
            <div>
              <div className="aitc-focus-tag"><b>{focus.id} · {tag}</b><span>{current.id}</span></div>
              <div className="aitc-focus-text">{focus.text}</div>
              <div className="aitc-mute">{current.title}</div>
            </div>
          </div>
          <div className="aitc-urlbar">
            {([ ["back", "arrow_back", "뒤로"], ["forward", "arrow_forward", "앞으로"], ["reload", "refresh", "새로고침"] ] as const).map(([type, icon, label]) => <Button key={type} disabled={!waiting || wait?.kind === "confirm"} title={label} aria-label={label} onClick={() => model.browserEvent({ type })}><span className="msi" aria-hidden="true">{icon}</span></Button>)}
            <div className="aitc-url" title={run.url}>
              <i className={run.outOfDomain ? "wait" : "ok"} />
              <span>{run.url}</span>
              <small className={run.outOfDomain ? "wait" : ""}>{run.outOfDomain ? "허용 목록 밖" : "허용 도메인"}</small>
            </div>
            <span className={`aitc-cap-word ${run.capturePaused ? "wait" : status === "running" && run.capture ? "running" : ""}`}>
              {!run.capture ? "CAPTURE OFF" : run.capturePaused ? "CAPTURE PAUSED" : status === "running" ? "OBSERVING" : waiting ? "PAUSED" : "LAST FRAME"}
            </span>
          </div>
          <div className="aitc-viewport-wrap">
            <div className="aitc-viewport" style={{ aspectRatio: `${run.viewport.width} / ${run.viewport.height}` }}>
              {model.preview ? <img src={model.preview} alt={waiting ? "직접 조작할 브라우저 화면" : "대상 페이지 화면"} tabIndex={waiting ? 0 : -1}
                onClick={waiting ? event => { const rect = event.currentTarget.getBoundingClientRect(); model.browserEvent({ type: "click", x: Math.max(0, Math.min(run.viewport.width, (event.clientX - rect.left) / rect.width * run.viewport.width)), y: Math.max(0, Math.min(run.viewport.height, (event.clientY - rect.top) / rect.height * run.viewport.height)) }); event.currentTarget.focus(); } : undefined}
                onWheel={waiting ? event => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); model.browserEvent({ type: "wheel", x: Math.max(0, Math.min(run.viewport.width, (event.clientX - rect.left) / rect.width * run.viewport.width)), y: Math.max(0, Math.min(run.viewport.height, (event.clientY - rect.top) / rect.height * run.viewport.height)), deltaX: Math.max(-3000, Math.min(3000, event.deltaX)), deltaY: Math.max(-3000, Math.min(3000, event.deltaY)) }); } : undefined}
                onKeyDown={waiting ? event => { event.preventDefault(); if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) model.browserEvent({ type: "text", text: event.key }); else model.browserEvent({ type: "key", key: `${event.metaKey ? "Meta+" : event.ctrlKey ? "Control+" : event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.key === " " ? "Space" : event.key}` }); } : undefined}
                onPaste={waiting ? event => { event.preventDefault(); const text = event.clipboardData.getData("text"); if (text) model.browserEvent({ type: "text", text }); } : undefined} /> : (
                <div className="aitc-viewport-empty"><span>대상 페이지 화면</span><small>{run.capture ? "첫 관찰을 기다리는 중" : "화면을 불러오는 중"}</small></div>
              )}
              {hl && !run.capturePaused && live && (
                <div className={`aitc-hl ${waiting ? "wait" : status === "error" ? "fail" : ""}`} style={{ left: `${hl.x}%`, top: `${hl.y}%`, width: `${hl.w}%`, height: `${hl.h}%` }}>
                  <span>{hl.label}</span>
                </div>
              )}
              
            </div>
          </div>
          {waiting && wait?.kind !== "confirm" && <div className="aitc-browser-input">
            <Input type={wait?.kind === "login" ? "password" : "text"} aria-label="브라우저 입력값" placeholder="페이지 입력란을 선택한 뒤 입력하세요" value={browserText} onChange={event => setBrowserText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && browserText) { model.browserEvent({ type: "text", text: browserText }); setBrowserText(""); } }} />
            <Button variant="secondary" disabled={!browserText} onClick={() => { model.browserEvent({ type: "text", text: browserText }); setBrowserText(""); }}>입력</Button>
          </div>}
          <div className="aitc-stage-foot">
            <span><span className="msi" aria-hidden="true">sync_alt</span>컨텍스트 유지</span>
            <span className="aitc-mono">Chromium · {run.viewport.width}×{run.viewport.height}</span>
            <span className="aitc-mono aitc-push">run {run.runId.slice(0, 8)}</span>
          </div>
        </div>

        <div className="aitc-pane aitc-pane-right">
          <div className="aitc-pane-head">AI ACTIONS<span>{current.id}</span></div>
          <div className="aitc-scroll">
            {groups.map((group, index) => (
              <div key={`${group.id}-${index}`}>
                <div className="aitc-act-head"><b>{group.id || "—"}</b><span>{group.text}</span><em className={`aitc-v ${verdictTone(group.verdict)}`}>{group.id ? VERDICT_LABEL[group.verdict] : ""}</em></div>
                {group.items.map((action, itemIndex) => {
                  const last = index === groups.length - 1 && itemIndex === group.items.length - 1 && live;
                  return (
                    <div key={action.seq} className={`aitc-act${last ? (waiting ? " live wait" : " live") : ""}`}>
                      <span className={`aitc-op ${opTone(action.op)}`}>{action.op}</span>
                      <div>
                        <div className="aitc-act-target">{action.target}</div>
                        <div className="aitc-act-meta">
                          {action.result && <span className={action.tone ?? ""}>{action.result}</span>}
                          {action.captureId && <span className="aitc-cap"><span className="msi" aria-hidden="true">image</span>{action.captureId}</span>}
                          <span className="aitc-mono-mute">{action.at}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <footer className="aitc-budget">
            {budget.map(item => (
              <div key={item.label}>
                <small>{item.label}</small>
                <b>{item.value}<em>{item.max}</em></b>
                <div className="aitc-meter"><i style={{ width: `${Math.min(100, Math.round(item.pct * 100))}%` }} /></div>
              </div>
            ))}
          </footer>
          {run.usage && <div className="aitc-pad-bottom">확인된 실행 호출 토큰 · 입력 {run.usage.input.toLocaleString()} · 출력 {run.usage.output.toLocaleString()} · 캐시 읽기 {run.usage.cachedInput.toLocaleString()} · 캐시 생성 {run.usage.cacheWrite.toLocaleString()} {run.usage.unknown > 0 && `· 진행 중 또는 미확인 ${run.usage.unknown}회`}<br />준비 단계 제외 · {run.provider === "Claude CLI" ? "Claude 입력은 캐시 토큰 별도" : "Codex 입력에 캐시 읽기 포함"}</div>}
          {run.budget.tokenWarning && <div role="status" className="aitc-warn-line">{run.budget.tokenWarning}</div>}
        </div>
      </div>

      {banner && (
        <div className={`aitc-banner ${banner.tone}`} role="status" aria-live="polite">
          <span className="msi" aria-hidden="true">{banner.icon}</span>
          <div>
            <small>{banner.tag}</small>
            <strong>{banner.title}</strong>
            <p>{banner.body}</p>
            {waiting && wait?.kind === "handoff" && <Input aria-label="AI에게 전달할 답변" placeholder="확인한 내용이나 처리 결과 입력 (선택)" value={reply} maxLength={2000} onChange={event => setReply(event.target.value)} />}
            {banner.actions.length > 0 && <div className="aitc-banner-actions">{banner.actions.map(action => <Button key={action.label} variant={action.kind} onClick={action.go}>{action.label}</Button>)}</div>}
          </div>
        </div>
      )}

      {waiting && wait?.kind === "confirm" && wait.confirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="aitc-confirm-title">
          <div className="manual-modal aitc-confirm">
            <small>CONFIRM · 1회 허용</small>
            <h2 id="aitc-confirm-title">{wait.confirm.target} 클릭을 진행할까요?</h2>
            <div className="aitc-confirm-rows">
              {[["TC", wait.confirm.expected], ["대상", wait.confirm.target], ["영향", wait.confirm.impact], ["URL", wait.confirm.url]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => model.decide("block")}>Blocked로 기록</Button>
              <Button variant="secondary" onClick={() => model.decide("handoff")}>직접 처리 후 재개</Button>
              <Button variant="primary" onClick={() => model.decide("allow")}>이번만 허용</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
