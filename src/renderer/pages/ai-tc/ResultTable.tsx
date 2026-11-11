import { Fragment, useState } from "react";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { aggregate, type AiTcLiveVerdict } from "../../../app/ipc/ai-tc/model";
import { Badge, BadgeToggle, WorkHead, matches, mmss, toneOf, VERDICT_TEXT } from "./parts";
import { Button } from "../../shared/ui/Button";

const RANK: Record<AiTcLiveVerdict, number> = { fail: 0, blocked: 1, check: 2, waiting: 3, running: 3, pending: 4, na: 5, pass: 6 };
const isIssue = (verdict: AiTcLiveVerdict) => verdict !== "pass" && verdict !== "na";
const CALL_REASON = { format: "응답 형식 오류", call: "호출 실패·취소", guard: "안전 검사 중단", page: "페이지 변경", snapshot: "화면 내용 변경", observation: "화면 관찰 실패", unexpected: "예상과 다른 응답" };

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
      <div className="aitc-pad-bottom">
        {run.preparationUsage && (["claude", "codex"] as const).map(provider => { const usage = run.preparationUsage![provider]; return (usage.input || usage.output || usage.cached || usage.write || usage.unknown) ? <p key={provider}>준비 ({provider}, 화면 세션 누계) 입력 {usage.input.toLocaleString()} · 출력 {usage.output.toLocaleString()} · 캐시 읽기 {usage.cached.toLocaleString()} · 생성 {usage.write.toLocaleString()}{usage.unknown ? ` · 미확인 ${usage.unknown}회` : ""}</p> : null; })}
        {run.usage && <p>실행 토큰 입력 {run.usage.input.toLocaleString()} · 출력 {run.usage.output.toLocaleString()} · 캐시 읽기 {run.usage.cachedInput.toLocaleString()} · 생성 {run.usage.cacheWrite.toLocaleString()}{run.usage.unknown ? ` · 미확인 ${run.usage.unknown}회` : ""} · {run.provider === "Claude CLI" ? "캐시 별도" : "캐시 읽기 입력에 포함"}</p>}
        <Button variant="secondary" disabled={run.status !== "done" || model.starting} onClick={() => { if (window.confirm("이전 데이터와 동작을 다시 실행합니다. 등록·저장이 중복될 수 있습니다. 계속할까요?")) void model.replay(); }}>빠른 재실행</Button>{" "}
        <Button variant="secondary" disabled={run.status !== "done" || model.starting} onClick={() => { if (window.confirm("이전 동작을 다시 실행하며 등록·저장이 중복될 수 있습니다. 승인된 조건이 없는 결과는 AI로 판정합니다. 계속할까요?")) void model.replay(true); }}>AI 보조 재실행</Button>
        <small> 빠른 재실행은 승인된 검증 조건이 없으면 확인 필요로 중단합니다.</small>
      </div>
      {/* 디자인 미반영: 근거 패널(캡처 이미지·근거·동작 이력), 판정 수정·수정 이유(review), 검증 조건 승인(approveAssertion), AI 수정 후보 임시 적용(applyRepair),
          TC 실행 시간, 직전 실행 대비, 캡처 폴더 열기, 영상 다운로드, 판정 분포 막대, 결과 저장 실패 안내(saveError) — 기존 ResultView.tsx 참고 */}
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
                          {item.recording?.filter(step => step.type === "verify" && step.candidate).map((step, index) => step.type === "verify" && step.candidate && <div key={`${step.expected}-${index}`}><p>{step.expected} 재실행 검증 후보: 화면에 정확히 표시 · {step.candidate.text}</p><small>이 문구만으로 기대 결과를 검증할 수 있는지 확인하세요. 승인해도 현재 판정은 바뀌지 않습니다.</small>{" "}<Button variant="secondary" disabled={run.status !== "done"} onClick={() => void model.approveAssertion(item.key, step.expected, !step.approved)}>{step.approved ? "승인 취소" : "검증 조건 승인"}</Button></div>)}
                          {!!item.modelCalls?.length && <div><strong>호출별 측정</strong><p>문자 수는 토큰이 아니며 원문은 저장하지 않습니다.</p>{item.modelCalls.map((call, index) => <p key={index}>{index + 1}회 · {({ explore: "탐색·동작", judge: "판정", retry: "형식 오류·실패", repair: "수정 제안" })[call.phase]} · 시도 {call.attempt} · 프롬프트 {call.promptChars.toLocaleString()}자 · 트리 {call.snapshotChars.toLocaleString()}자 · 이미지 {call.image ? "전송" : "없음"} · {({ pending: "처리 중", used: "사용", discarded: "폐기", error: "오류" })[call.outcome]}{call.reason ? ` (${CALL_REASON[call.reason]})` : ""} · {call.usage ? `입력 ${call.usage.input.toLocaleString()} · 출력 ${call.usage.output.toLocaleString()} · 캐시 읽기 ${call.usage.cachedInput?.toLocaleString() ?? "미확인"} · 생성 ${call.usage.cacheWrite?.toLocaleString() ?? "미확인"}` : "사용량 미확인"}</p>)}</div>}
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
