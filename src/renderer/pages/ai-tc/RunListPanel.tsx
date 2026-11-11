import { useEffect, useRef } from "react";
import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { aggregate } from "../../../app/ipc/ai-tc/model";
import { TONE_ICON, caseGroups, toneOf } from "./parts";

/** 실행 중 왼쪽 "목록" 패널: 시나리오별 TC 진행 */
export const RunListPanel = ({ model, onClose }: { model: AiTcModel; onClose: () => void }) => {
  const run = model.run;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>("[data-running='1']");
    if (row && box.current) box.current.scrollTo({ top: row.offsetTop - 80, behavior: "smooth" });
  }, [run?.current]);
  const cases = (run?.cases ?? []).map((item, index) => ({ ...item, index, verdict: aggregate(item.expected.map(expected => expected.verdict)) }));
  const done = cases.filter(item => !["pending", "running", "waiting"].includes(item.verdict)).length;

  return (
    <div className="aitcx-list">
      <div className="aitcx-pane-head"><strong>TC 목록</strong><small>{done} / {cases.length}</small>
        <Button variant="ghost" iconOnly className="aitcx-push" aria-label="목록 닫기" onClick={onClose}><span className="msi" aria-hidden="true">left_panel_close</span></Button>
      </div>
      <div className="aitcx-list-scroll" ref={box}>
        {caseGroups(cases).map(([group, items]) => (
          <div key={group}>
            <div className="aitcx-list-head"><b>{group}</b><small>{items.filter(item => !["pending", "running", "waiting"].includes(item.verdict)).length} / {items.length}</small></div>
            {items.map(item => {
              const isCurrent = model.live && item.index === run?.current;
              const tone = isCurrent ? "run" : toneOf(item.verdict);
              return (
                <div key={item.key} data-running={isCurrent ? "1" : "0"} className={`aitcx-list-row${isCurrent ? " current" : ""}${tone === "wait" ? " idle" : ""}`}>
                  <span className={`msi t-${tone}`} aria-hidden="true">{TONE_ICON[tone]}</span>
                  <b>{item.id}</b><span title={item.title}>{item.title}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
