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
  const by = selected.by === "user" ? `사용자 수정 · 원래 ${VERDICT_LABEL[selected.original ?? "pending"]}` : selected.by === "ai" ? `AI 판정 · ${run.provider}` : "앱 기록 · 실행 불가 사유";

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
          <span className="aitc-mute">{run.provider} · {run.allowedHosts[0]}</span>
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
