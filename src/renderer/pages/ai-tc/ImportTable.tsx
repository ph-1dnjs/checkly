import { useState } from "react";
import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { AI_TC_LIMITS, runnable } from "../../../app/ipc/ai-tc/model";
import { Badge, WorkHead, matches } from "./parts";
import { CommonConditions } from "./CommonConditions";

const AutoPreparation = ({ model }: { model: AiTcModel }) => <div className="aitc-pad-bottom">
  <Button role="switch" aria-label="AI 데이터 자동 준비" aria-checked={model.autoPrepare} onClick={() => model.setAutoPrepare(!model.autoPrepare)}>AI 데이터 자동 준비 {model.autoPrepare ? "켜짐" : "꺼짐"}</Button>
  <p className="aitc-mute">저장된 절차를 사용할 때 끄면 준비 단계에서 AI를 호출하지 않습니다. 필요한 값은 직접 입력합니다.</p>
</div>;

/** Step 1 가져오기: 읽은 TC 미리보기(시트 · ID · TC명 · 기대 결과 · 상태) */
export const ImportTable = ({ model }: { model: AiTcModel }) => {
  const [filter, setFilter] = useState<"all" | "ok" | "ex">("all");
  const [query, setQuery] = useState("");
  const { workbook, cases } = model;

  if (!workbook) {
    return (
      <div className="aitc-empty">
        <span className="aitc-empty-icon msi" aria-hidden="true">upload_file</span>
        <h2>TC 엑셀을 가져오세요</h2>
        <p>.xlsx 파일의 TC 시트를 읽어 TC ID·테스트 단계·기대 결과를 확인합니다. 원본 파일은 바꾸지 않으며 매크로와 수식은 실행하지 않습니다.</p>
        <p className="aitc-mute">최대 {AI_TC_LIMITS.fileBytes / 1024 / 1024}MB · 시트 {AI_TC_LIMITS.sheets}개 · 시트당 {AI_TC_LIMITS.rowsPerSheet}행 · 칸당 {AI_TC_LIMITS.cellChars}자</p>
        <AutoPreparation model={model} />
        <Button variant="primary" size="large" disabled={model.importing} onClick={() => void model.importFile()}>
          <span className="msi" aria-hidden="true">table_view</span>{model.importing ? "읽는 중…" : "엑셀 파일 선택"}
        </Button>
      </div>
    );
  }

  const ex = cases.filter(item => !runnable(item));
  const ok = cases.filter(runnable);
  const pool = filter === "ex" ? ex : filter === "ok" ? ok : [...ex, ...ok];
  const rows = pool.filter(item => matches(query, item));
  const sheets = new Set(cases.map(item => item.sheet)).size;

  return (
    <div className="aitcx-ws">
      <CommonConditions workbook={workbook} options={model.options} />
      <AutoPreparation model={model} />
      <WorkHead title="TC 미리보기" sub={`시트 ${sheets}개 · ${cases.length}행 중 ${ok.length}개 실행 가능`}
        action={<Button variant="secondary" className="aitcx-push" disabled={model.importing} onClick={() => void model.importFile()}><span className="msi" aria-hidden="true">upload_file</span>다른 파일 가져오기</Button>}
        chips={[{ key: "all", label: "전체", count: cases.length }, { key: "ok", label: "정상", count: ok.length }, { key: "ex", label: "제외", count: ex.length }]}
        filter={filter} onFilter={setFilter} shown={rows.length} query={query} onQuery={setQuery} />
      {/* 디자인 미반영: 시트 목록·숨긴 시트/행 포함 토글, 열 매핑 수정, TC 상세 펼침(사전 조건·단계·데이터·기대 결과 분리 수정·경고), 가져오기 상태 도넛, 선행 해제 되돌리기 알림 — 기존 ImportView.tsx 참고 */}
      <div className="aitcx-table-box">
        <table className="aitcx-table">
          <thead><tr><th className="w96">시트</th><th className="w120">ID</th><th>TC명</th><th>기대 결과</th><th className="w170">상태</th></tr></thead>
          <tbody>
            {rows.map(item => {
              const bad = !runnable(item);
              return (
                <tr key={item.key} className={bad ? "warn" : ""}>
                  <td>{item.sheet}</td>
                  <td className="mono">{item.id || "—"}</td>
                  <td>{item.title}</td>
                  <td className="body">{item.expected.length ? `${item.expected[0]!.text}${item.expected.length > 1 ? ` 외 ${item.expected.length - 1}` : ""}` : "—"}</td>
                  <td>{bad ? <Badge tone="warn">제외 · {item.errors.join(", ")}</Badge> : <Badge tone="ok">정상</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="aitcx-empty-row">조건에 맞는 TC가 없습니다</div>}
      </div>
    </div>
  );
};
