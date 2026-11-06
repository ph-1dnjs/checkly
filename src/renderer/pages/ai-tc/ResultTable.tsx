import { Fragment, useState } from "react";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { aggregate, type AiTcLiveVerdict } from "../../../app/ipc/ai-tc/model";
import { Badge, BadgeToggle, WorkHead, matches, mmss, toneOf, VERDICT_TEXT } from "./parts";

const RANK: Record<AiTcLiveVerdict, number> = { fail: 0, blocked: 1, check: 2, waiting: 3, running: 3, pending: 4, na: 5, pass: 6 };
const isIssue = (verdict: AiTcLiveVerdict) => verdict !== "pass" && verdict !== "na";

/** Step 4 결과: 실패·확인 필요 먼저, TC별 기대 결과(E1…) 판정과 사유 */
export const ResultTable = ({ model }: { model: AiTcModel }) => {
  const run = model.run;
  const cases = (run?.cases ?? []).map(item => ({ item, verdict: aggregate(item.expected.map(expected => expected.verdict)) }));
  const issues = cases.filter(entry => isIssue(entry.verdict)).length;
  const [filter, setFilter] = useState<"all" | "issue" | "ok">(issues ? "issue" : "all");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState("");
  if (!run) return <div className="aitc-empty"><h2>결과가 없습니다</h2><p>실행이 끝나면 TC와 기대 결과별 판정을 확인할 수 있습니다.</p></div>;

  const seconds = run.endedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : 0;
  const rows = cases
    .filter(({ verdict }) => filter === "all" || (filter === "issue" ? isIssue(verdict) : !isIssue(verdict)))
    .filter(({ item }) => matches(query, item))
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);

  return (
    <div className="aitcx-ws">
      <WorkHead title="결과" sub={`${run.allowedHosts[0] ?? ""} · ${run.cases.length} TC${seconds ? ` · ${mmss(seconds)}` : ""}`}
        chips={[{ key: "all", label: "전체", count: cases.length }, { key: "issue", label: "실패·확인 필요", count: issues }, { key: "ok", label: "통과", count: cases.length - issues }]}
        filter={filter} onFilter={setFilter} shown={rows.length} query={query} onQuery={setQuery} />
      {/* 디자인 미반영: 근거 패널(캡처 이미지·근거·동작 이력), 판정 수정·수정 이유(review), 검증 조건 승인(approveAssertion), AI 수정 후보 임시 적용(applyRepair),
          TC 실행 시간·모델 사용량, 직전 실행 대비·준비/실행 토큰 요약, 빠른 재실행·AI 보조 재실행(replay), 캡처 폴더 열기, 영상 다운로드, 판정 분포 막대, 결과 저장 실패 안내(saveError) — 기존 ResultView.tsx 참고 */}
      <div className="aitcx-table-box">
        <table className="aitcx-table">
          <thead><tr><th className="w120">ID</th><th>TC명</th><th className="w140">결과</th><th>사유</th></tr></thead>
          <tbody>
            {rows.map(({ item, verdict }) => {
              const open = openKey === item.key;
              const bad = item.expected.find(expected => isIssue(expected.verdict));
              const why = bad ? `${bad.id} · ${item.reason || bad.observation || VERDICT_TEXT[bad.verdict]}` : item.expected.length > 1 ? `E1–E${item.expected.length} 모두 통과` : "E1 통과";
              return (
                <Fragment key={item.key}>
                  <tr className={verdict === "fail" ? "fail" : ""}>
                    <td className="mono">{item.id}</td>
                    <td>{item.title}</td>
                    <td><BadgeToggle tone={toneOf(verdict)} open={open} onToggle={() => setOpenKey(open ? "" : item.key)}>{VERDICT_TEXT[verdict]} · E{item.expected.length}</BadgeToggle></td>
                    <td className={bad ? "" : "mute"}>{why}</td>
                  </tr>
                  {open && (
                    <tr className="detail">
                      <td colSpan={4}>
                        <div className="aitcx-ev">
                          {item.expected.map(expected => (
                            <div key={expected.id} className="aitcx-ev-row">
                              <span className="aitcx-ev-id">{expected.id}</span>
                              <span>{expected.text}</span>
                              <Badge tone={toneOf(expected.verdict)}>{VERDICT_TEXT[expected.verdict]}</Badge>
                              <span className={isIssue(expected.verdict) ? "" : "mute"}>{expected.observation || (isIssue(expected.verdict) ? "—" : "일치")}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="aitcx-empty-row">조건에 맞는 TC가 없습니다</div>}
      </div>
    </div>
  );
};
