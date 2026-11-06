import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { VERDICT_LABEL, aggregate, type AiTcVerdict } from "../../../app/ipc/ai-tc/model";
import { verdictTone } from "./RunView";

const FILTERS: AiTcVerdict[] = ["pass", "fail", "blocked", "check", "pending", "na"];
const EDITS: AiTcVerdict[] = ["pass", "fail", "blocked", "check", "na"];

export const ResultView = ({ model }: { model: AiTcModel }) => {
  const run = model.run;
  const [filter, setFilter] = useState<AiTcVerdict | "all">("all");
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<{ caseKey: string; expectedId: string } | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const selectedCase = run?.cases.find(item => item.key === sel?.caseKey) ?? run?.cases[0];
  const selected = selectedCase?.expected.find(item => item.id === sel?.expectedId) ?? selectedCase?.expected[0];

  useEffect(() => {
    setImage(null);
    setNote(selected?.note ?? "");
    if (selected?.captureId) void model.loadCapture(selected.captureId).then(setImage);
  }, [run?.runId, selectedCase?.key, selected?.id, selected?.captureId]);

  if (!run || !selectedCase || !selected) {
    return <div className="aitc-empty"><h2>결과가 없습니다</h2><p>실행이 끝나면 TC와 기대 결과별 판정·근거를 확인할 수 있습니다.</p></div>;
  }
  const finished = !model.live;
  const verdicts = run.cases.map(item => aggregate(item.expected.map(expected => expected.verdict)));
  const count = (verdict: AiTcVerdict) => verdicts.filter(item => item === verdict).length;
  const shown = run.cases.map((item, index) => ({ item, index })).filter(({ index }) => filter === "all" || verdicts[index] === filter);
  const allExpected = run.cases.flatMap(item => item.expected);
  const withEvidence = allExpected.filter(item => item.by !== "system" && item.basis.length).length;
  const seconds = run.endedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : 0;
  const actions = selectedCase.actions.filter(action => action.expected === selected.id);
  const checks = selectedCase.recording?.filter(step => step.type === "verify" && step.expected === selected.id && step.candidate) ?? [];
  const check = checks.length === 1 && checks[0]?.type === "verify" ? checks[0] : undefined;
  const by = selected.by === "user" ? `사용자 수정 · 원래 ${VERDICT_LABEL[selected.original ?? "pending"]}` : selected.by === "ai" ? `AI 판정 · ${run.provider}` : selected.by === "automation" ? "승인된 조건 자동 검증" : "앱 기록 · 실행 불가 사유";

  return (
    <section className="aitc-result">
      <div className="aitc-result-top">
        <div className="aitc-pills">
          <Button className={`aitc-pill all${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>전체<b>{run.cases.length}</b></Button>
          <span className="aitc-pill-sep" aria-hidden="true" />
          {FILTERS.map(verdict => {
            const n = count(verdict);
            if (verdict === "na" && !n) return null;
            return (
              <Button key={verdict} className={`aitc-pill ${verdictTone(verdict)}${filter === verdict ? " active" : ""}${n ? "" : " empty"}`} title={`${VERDICT_LABEL[verdict]}만 보기`} onClick={() => setFilter(filter === verdict ? "all" : verdict)}>
                {VERDICT_LABEL[verdict]}<b>{n}</b>
              </Button>
            );
          })}
        </div>
        <div className="aitc-metrics">
          <span>근거 연결 <b>{withEvidence}<em> / {allExpected.length}</em></b></span>
          <span>소요 <b>{seconds ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : "—"}</b></span>
          {run.previousRun && <span title="준비 단계 제외. 작업 시간은 사용자 대기·오류 응답 대기를 제외한 경과 시간입니다.">직전 실행 대비 · 전체 {(run.previousRun.elapsedMs / 1000).toFixed(1)}초 → {seconds}초{run.previousRun.userWaitMs !== undefined && run.userWaitMs !== undefined && run.endedAt ? ` · 대기 제외 ${Math.max(0, (run.previousRun.elapsedMs - run.previousRun.userWaitMs) / 1000).toFixed(1)}초 → ${Math.max(0, (Date.parse(run.endedAt) - Date.parse(run.startedAt) - run.userWaitMs) / 1000).toFixed(1)}초` : ""} · 모델 호출 {run.previousRun.modelCalls} → {run.budget.modelCalls}회 · 입력 {run.previousRun.input.toLocaleString()} → {run.usage?.input.toLocaleString() ?? "미확인"} · 출력 {run.previousRun.output.toLocaleString()} → {run.usage?.output.toLocaleString() ?? "미확인"}{run.previousRun.unknown || run.usage?.unknown ? " · 미확인 호출 포함" : ""}</span>}
          {run.preparationUsage && (["claude", "codex"] as const).map(provider => { const usage = run.preparationUsage![provider]; return (usage.input || usage.output || usage.cached || usage.write || usage.unknown) ? <span key={provider} title="준비 화면 세션 누계이며 이번 실행에 선택하지 않은 TC의 준비·재시도도 포함될 수 있습니다.">준비 ({provider}) 입력 {usage.input.toLocaleString()} · 출력 {usage.output.toLocaleString()} · 캐시 읽기 {usage.cached.toLocaleString()} · 생성 {usage.write.toLocaleString()}{usage.unknown ? ` · 미확인 ${usage.unknown}회` : ""}</span> : null; })}
          {run.usage && <span title={run.provider === "Claude CLI" ? "준비 단계 제외. Claude 입력 토큰에는 캐시 읽기·생성이 포함되지 않습니다." : "준비 단계 제외. Codex 입력 토큰에는 캐시 읽기가 포함됩니다."}>확인된 실행 토큰 <b>입력 {run.usage.input.toLocaleString()} · 출력 {run.usage.output.toLocaleString()}</b> · 캐시 읽기 {run.usage.cachedInput.toLocaleString()} · 캐시 생성 {run.usage.cacheWrite.toLocaleString()}{run.usage.unknown > 0 ? ` · 미확인 ${run.usage.unknown}회` : ""}</span>}
          {run.usageByPhase && (Object.entries(run.usageByPhase) as ["explore" | "judge" | "retry" | "repair", NonNullable<typeof run.usage>][]).map(([phase, usage]) => <span key={phase}>실행 {({ explore: "탐색·동작", judge: "판정", retry: "형식 오류·실패", repair: "수정 제안" })[phase]} · 입력 {usage.input.toLocaleString()} · 출력 {usage.output.toLocaleString()} · 캐시 읽기 {usage.cachedInput.toLocaleString()} · 생성 {usage.cacheWrite.toLocaleString()}{usage.unknown ? ` · 미확인 ${usage.unknown}회` : ""}</span>)}
          <span className="aitc-mute">{run.provider} · {run.allowedHosts[0]}</span>
          <Button variant="secondary" disabled={!finished || model.starting || run.status !== "done"} title="기존 데이터를 다시 사용하며 등록·저장 동작도 다시 실행합니다. 실행 전 테스트 환경과 데이터를 확인하세요." onClick={() => { if (window.confirm("이전 데이터와 동작을 그대로 다시 실행합니다. 등록·저장 동작이 중복될 수 있습니다. 계속할까요?")) void model.replay(); }}>빠른 재실행</Button>
          <Button variant="secondary" disabled={!finished || model.starting || run.status !== "done"} title="승인된 자동 검증 조건이 없는 기대 결과만 AI로 판정합니다." onClick={() => { if (window.confirm("이전 동작을 다시 실행하며 등록·저장이 중복될 수 있습니다. 승인된 조건이 없는 결과는 AI로 판정합니다. 계속할까요?")) void model.replay(true); }}>AI 보조 재실행</Button>
          <Button variant="secondary" disabled={!finished} onClick={model.openFolder} title="캡처·영상·result.json 폴더"><span className="msi" aria-hidden="true">folder_open</span>캡처 폴더</Button>
          {run.video && <Button variant="secondary" disabled={!finished} onClick={() => void model.downloadVideo()}><span className="msi" aria-hidden="true">videocam</span>영상 다운로드</Button>}
          <Button variant="primary" disabled={!finished} onClick={() => void model.exportResult()}><span className="msi" aria-hidden="true">download</span>결과 다운로드</Button>
        </div>
        <div className="aitc-segbar">
          {FILTERS.map(verdict => count(verdict) ? <span key={verdict} className={verdictTone(verdict)} style={{ flex: count(verdict) }} title={`${VERDICT_LABEL[verdict]} ${count(verdict)}`} /> : null)}
        </div>
      </div>
      <div className="aitc-result-grid">
        <div className="aitc-result-list">
          <div className="aitc-list-head"><strong>{filter === "all" ? "전체 TC" : `${VERDICT_LABEL[filter]} TC`}</strong>
            {filter !== "all" && <Button className="aitc-link aitc-push" onClick={() => setFilter("all")}>전체 보기</Button>}
          </div>
          <div className="aitc-scroll aitc-pad-bottom">
            {!shown.length && <div className="aitc-empty small"><span className="msi" aria-hidden="true">filter_list_off</span><strong>{filter === "all" ? "결과가 없습니다" : `${VERDICT_LABEL[filter]} TC가 없습니다`}</strong><Button variant="secondary" onClick={() => setFilter("all")}>전체 보기</Button></div>}
            {shown.map(({ item, index }) => {
              const verdict = verdicts[index]!;
              const open = openKeys[item.key] ?? (filter !== "all" || item.key === selectedCase.key);
              return (
                <div key={item.key} className="aitc-res-tc">
                  <Button className="aitc-res-row" aria-expanded={open} onClick={() => setOpenKeys({ ...openKeys, [item.key]: !open })}>
                    <span className="msi" aria-hidden="true">{open ? "expand_more" : "chevron_right"}</span>
                    <span className="aitc-res-body">
                      <span className="aitc-res-top"><b>{item.id}</b><span className="aitc-mini">{item.expected.map(expected => <i key={expected.id} className={verdictTone(expected.verdict)} title={`${expected.id} ${VERDICT_LABEL[expected.verdict]}`} />)}</span></span>
                      <span className="aitc-res-title">{item.title}</span>
                      {item.reason && verdict !== "pass" && <span className={`aitc-res-reason${verdict === "fail" ? " fail" : ""}`}>{item.reason}</span>}
                    </span>
                    <span className={`aitc-v big ${verdictTone(verdict)}`}><i />{VERDICT_LABEL[verdict]}</span>
                  </Button>
                  {open && item.expected.map(expected => {
                    const on = item.key === selectedCase.key && expected.id === selected.id;
                    return (
                      <Button key={expected.id} className={`aitc-res-exp${on ? " active" : ""}`} onClick={() => setSel({ caseKey: item.key, expectedId: expected.id })}>
                        <b>{expected.id}</b>
                        <span><span className="aitc-ink">{expected.text}</span><small>{expected.observation || "관찰 없음"}</small></span>
                        <span className={`aitc-v ${verdictTone(expected.verdict)}`}><i />{VERDICT_LABEL[expected.verdict]}{expected.by === "user" && <span className="msi" title="사용자 수정" aria-label="사용자 수정">edit</span>}</span>
                      </Button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="aitc-evidence">
          <div className="aitc-pane-head">EVIDENCE<span>{selectedCase.id} · {selected.id}</span></div>
          <div className="aitc-scroll aitc-pad-bottom">
            <div className="aitc-ev-head">
              <div className="aitc-row-between"><span className={`aitc-v big ${verdictTone(selected.verdict)}`}><i />{VERDICT_LABEL[selected.verdict]}</span><small className="aitc-mute">{by}</small><small className="aitc-mono-mute aitc-push">{selected.at ?? "—"}</small></div>
              <p>{selected.text}</p>
            </div>
            <div className="aitc-ev-block"><div className="aitc-caption">실제 관찰</div><p>{selected.observation || "관찰 없음"}</p></div>
            {selectedCase.timing && <div className="aitc-ev-block"><div className="aitc-caption">TC 실행 시간 내역</div><p>AI 응답 {(selectedCase.timing.modelMs / 1000).toFixed(1)}초 · 화면 관찰 {(selectedCase.timing.observationMs / 1000).toFixed(1)}초 · 브라우저 동작 {(selectedCase.timing.browserMs / 1000).toFixed(1)}초</p><small>사용자 대기 시간 제외. 빠른 재실행은 이 내역에서 제외됩니다.</small></div>}
            {selectedCase.usage && <div className="aitc-ev-block"><div className="aitc-caption">TC 모델 사용량</div><p>입력 {selectedCase.usage.input.toLocaleString()} · 출력 {selectedCase.usage.output.toLocaleString()} · 캐시 읽기 {selectedCase.usage.cachedInput.toLocaleString()} · 캐시 생성 {selectedCase.usage.cacheWrite.toLocaleString()}{selectedCase.usage.unknown ? ` · 미확인 ${selectedCase.usage.unknown}회` : ""}</p><small>준비 단계 제외. {run.provider === "Claude CLI" ? "캐시 입력 별도" : "입력에 캐시 읽기 포함"}.</small></div>}
            {selectedCase.repairSuggestion && <div className="aitc-ev-block"><div className="aitc-caption">AI 수정 후보 · 실행하지 않음</div><p>{selectedCase.repairSuggestion.reason}</p><pre>{JSON.stringify(selectedCase.repairSuggestion.step, null, 2)}</pre><small>같은 종류의 동작이라면 대상만 임시 적용할 수 있습니다. 재실행에 성공하기 전에는 저장된 절차가 바뀌지 않습니다.</small><Button variant="secondary" disabled={!finished} onClick={() => void model.applyRepair(selectedCase.key)}>대상 임시 적용</Button></div>}
            {check?.candidate && <div className="aitc-ev-block"><div className="aitc-caption">재실행 검증 조건 후보</div><p>화면에 정확히 표시: {check.candidate.text}</p><p>이 문구의 표시만으로 위 기대 결과를 검증할 수 있는지 확인하세요. 승인해도 현재 판정은 바뀌지 않습니다.</p><Button variant="secondary" disabled={!finished} onClick={() => void model.approveAssertion(selectedCase.key, selected.id, !check.approved)}>{check.approved ? "승인 취소" : "검증 조건 승인"}</Button></div>}
            <div className="aitc-ev-capture">
              {image ? <img src={image} alt={`${selectedCase.id} ${selected.id} 근거 캡처`} /> : <div><span>근거 캡처</span><small>{selected.captureId ? `${selected.captureId} · 불러오는 중` : "없음"}</small></div>}
            </div>
            <div className="aitc-ev-block">
              <div className="aitc-caption">근거</div>
              <div className="aitc-basis">{selected.basis.length ? selected.basis.map((basis, index) => <div key={index}><span>{basis.k}</span><b>{basis.v}</b></div>) : <div><span>사유</span><b>{selected.observation || "—"}</b></div>}</div>
              {actions.length > 0 && <>
                <div className="aitc-caption">동작 이력</div>
                <div className="aitc-basis">{actions.map(action => <div key={action.seq}><span>#{action.seq} {action.op}</span><b>{action.target}{action.result ? ` → ${action.result}` : ""}</b></div>)}</div>
              </>}
              <div className="aitc-caption">판정 수정</div>
              <div className="aitc-seg aitc-seg-fill">
                {EDITS.map(verdict => (
                  <Button key={verdict} className={selected.verdict === verdict ? "active" : ""} disabled={!finished}
                    onClick={() => void model.review(selectedCase.key, selected.id, verdict === (selected.original ?? selected.verdict) && selected.by === "user" ? null : verdict, note)}>
                    {VERDICT_LABEL[verdict]}
                  </Button>
                ))}
              </div>
              <Input className="aitc-note-input" value={note} placeholder="수정 이유" disabled={!finished} onChange={event => setNote(event.target.value)}
                onBlur={() => { if (note !== (selected.note ?? "")) void model.review(selectedCase.key, selected.id, selected.by === "user" ? selected.verdict as AiTcVerdict : null, note); }} />
              <div className="aitc-mute aitc-save-note">
                {run.saveError ? <span className="fail">{run.saveError}</span> : "결과·캡처는 이 PC에만 저장됩니다. 팀 공유 저장은 아직 제공하지 않습니다."}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};
