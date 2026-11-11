import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { aggregate, runnable } from "../../../app/ipc/ai-tc/model";
import type { Control } from "./BrowserStage";
import { SCREENS } from "./ChatPanel";
import { mmss } from "./parts";

const LABELS = ["가져오기", "준비", "실행", "결과"];

/** 상단 4단계 프로세스 바(상세형): 단계 · 소요 시간 · 요약 */
export const ProcessBar = ({ model, step, control, now }: { model: AiTcModel; step: number; control: Control; now: number }) => {
  const run = model.run;
  const total = run?.cases.length ?? 0;
  const verdicts = run?.cases.map(item => aggregate(item.expected.map(expected => expected.verdict))) ?? [];
  const finished = verdicts.filter(verdict => !["pending", "running", "waiting"].includes(verdict)).length;
  const issues = { fail: verdicts.filter(verdict => verdict === "fail").length, check: verdicts.filter(verdict => ["blocked", "check"].includes(verdict)).length };
  const elapsed = run ? Math.round(((run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.startedAt)) / 1000) : 0;
  const ex = model.cases.filter(item => !runnable(item)).length;
  const runSub = !run ? "" : run.status === "waiting" ? (control === "user" ? "직접 제어 중" : "제어 인계 대기") : run.status === "error" ? "오류로 정지"
    : run.status === "cancelled" ? "실행 취소됨" : run.status === "done" ? "실행 완료" : `실행 중 ${model.progress.percent}% · ${finished} / ${total}`;
  const info = [
    { done: `${model.cases.length - ex} TC · ${ex}개 제외`, cur: model.workbook ? "파일 확인" : "엑셀 파일 선택", time: "" },
    { done: `${model.picked.length}개 선택 · ${model.environmentName}`, cur: model.preparing ? `데이터 세팅 중 ${model.preparing.done}/${model.preparing.total}` : "순서·설정 확인", time: "" },
    { done: `${finished} / ${total} 실행`, cur: runSub, time: run ? mmss(elapsed) : "" },
    { done: "", cur: run ? `Fail ${issues.fail} · 확인 필요 ${issues.check}` : "", time: "" },
  ];

  return (
    <div className="aitcx-process">
      <div role="list" aria-label="진행 단계" className="aitcx-chevrons">
        {LABELS.map((label, k) => {
          const state = k < step ? "done" : k === step ? (k === 3 && (issues.fail || issues.check) ? "err" : "cur") : "future";
          // 이전 단계로 돌아가기. 실행 기록이 있으면 실행·결과로 다시 이동할 수 있다(실행 중에는 이동하지 않음).
          const canGo = k !== step && !(step === 2 && model.live) && (k < step || (k >= 2 && Boolean(run)) || (k === 1 && model.picked.length > 0));
          const sub = state === "done" ? info[k]!.done : state === "future" ? "대기" : info[k]!.cur;
          return (
            <Button key={label} role="listitem" className={`aitcx-chevron ${state}${k === 0 ? " first" : k === 3 ? " last" : ""}`} disabled={!canGo}
              title={canGo ? `${label}(으)로 이동` : undefined} aria-current={k === step ? "step" : undefined} onClick={() => model.setScreen(SCREENS[k]!)}>
              <span className="aitcx-chevron-top">
                {(state === "done" || state === "err") && <span className="msi" aria-hidden="true">{state === "done" ? "check_circle" : "error"}</span>}
                <strong>Step {k + 1} · {label}</strong>
                {(state === "done" || (state === "cur" && k === 2)) && info[k]!.time && <em>{info[k]!.time}</em>}
              </span>
              <span className="aitcx-chevron-sub">{sub}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
