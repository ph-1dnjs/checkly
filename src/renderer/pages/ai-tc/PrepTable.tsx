import { Fragment, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { runnable, type AiTcCase } from "../../../app/ipc/ai-tc/model";
import { Badge, BadgeToggle, Check, WorkHead, matches, type Tone } from "./parts";
import { CommonConditions } from "./CommonConditions";

/** Step 2 준비: 실행할 TC 선택 · 실행 순서 · 테스트 데이터 */
export const PrepTable = ({ model }: { model: AiTcModel }) => {
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState("");
  const all = model.cases.filter(runnable);
  const isOn = (item: AiTcCase) => model.picked.includes(item.key);
  const order = new Map(model.readyList.map((entry, index) => [entry.item.key, index + 1]));
  const pool = all.filter(item => (filter === "on" ? isOn(item) : filter === "off" ? !isOn(item) : true)).filter(item => matches(query, item));
  const rows: Array<{ group: string; items: AiTcCase[]; depth: number } | { item: AiTcCase }> = [];
  const addGroups = (items: AiTcCase[], depth: number) => {
    const groups = new Map<string, AiTcCase[]>();
    for (const item of items) {
      const parts = item.id.split("-");
      if (depth >= parts.length || !parts[depth]) {
        rows.push({ item });
        continue;
      }
      const group = parts.slice(0, depth + 1).join("-");
      groups.set(group, [...(groups.get(group) ?? []), item]);
    }
    for (const [group, members] of groups) {
      if (depth < 2 || members.length >= 2) rows.push({ group, items: members, depth });
      addGroups(members, depth + 1);
    }
  };
  addGroups(pool, 0);
  const visibleOn = pool.filter(isOn).length;
  const toggle = (items: AiTcCase[], on: boolean) => (on ? model.deselect(items.map(item => item.key)) : model.select(items.map(item => item.key)));

  const dataState = (item: AiTcCase): { tone: Tone; text: string } | null => {
    if (!isOn(item)) return null;
    if (model.prepareErrors[item.key]) return { tone: "warn", text: "세팅 실패" };
    if (!model.prepared[item.key] && model.preparing) return { tone: model.preparing.currentKey === item.key ? "run" : "wait", text: model.preparing.currentKey === item.key ? "세팅 중" : "세팅 대기" };
    const ready = model.readiness(item);
    if (ready.state === "todo") return { tone: "warn", text: "입력 필요" };
    if (ready.state === "blocked") return { tone: "fail", text: "Blocked" };
    const prep = model.prepared[item.key];
    const given = item.data.filter(need => need.kind === "given").length;
    if (!prep) return model.preparing ? { tone: "run", text: "세팅 중" } : { tone: "wait", text: given ? `엑셀 값 ${given}` : "세팅 안 됨" };
    return { tone: "ok", text: `${model.autoPrepare ? "자동 세팅" : "직접 입력"} ${given + prep.data.length + prep.files.length}` };
  };

  return (
    <div className="aitcx-ws">
      <CommonConditions workbook={model.workbook} options={model.options} />
      <WorkHead title="실행 순서" sub={`${model.picked.length} / ${all.length}개 선택 · 선행 TC 기준 자동 정렬`}
        chips={[{ key: "all", label: "전체", count: all.length }, { key: "on", label: "선택", count: model.picked.length }, { key: "off", label: "선택 안 함", count: all.length - model.picked.length }]}
        filter={filter} onFilter={setFilter} shown={pool.length} query={query} onQuery={setQuery} />
      <div className="aitc-pad-bottom">
        <Button variant="secondary" disabled={!model.autoPrepare || Boolean(model.preparing) || model.live || !model.picked.length} title={!model.autoPrepare ? "AI 데이터 자동 준비를 켜야 다시 세팅할 수 있습니다." : undefined} onClick={() => { if (window.confirm("선택한 TC의 입력값과 파일을 다시 준비합니다. 수정한 값은 바뀔 수 있습니다. 계속할까요?")) model.regeneratePreparation(); }}>테스트 데이터 다시 세팅</Button>{" "}
        <Button variant="secondary" disabled={Boolean(model.cantRun) || model.live} onClick={() => void model.loadSavedNeeds()}>저장된 절차의 데이터 항목 불러오기</Button>{" "}
        <Button variant="secondary" disabled={Boolean(model.cantRun) || model.starting || model.live} onClick={() => { if (window.confirm("저장된 동작을 현재 데이터로 실행합니다. 등록·저장이 중복될 수 있습니다. 계속할까요?")) void model.start("saved"); }}>저장된 절차로 빠른 실행</Button>{" "}
        <Button variant="secondary" disabled={Boolean(model.cantRun) || model.starting || model.live} onClick={() => { if (window.confirm("저장된 동작을 현재 데이터로 실행합니다. 등록·저장이 중복될 수 있으며 미승인 결과는 AI로 판정합니다. 계속할까요?")) void model.start("assisted"); }}>저장된 절차로 AI 보조 실행</Button>
      </div>
      {/* 디자인 미반영: 남은 선행 모두 "이미 준비됨"(confirmAllRefs), 선행 순환 경고, TC 제외(toggleExcluded), TC 상세(사전 조건·기대 결과·계정 안내) — 기존 PrepView.tsx 참고 */}
      <div className="aitcx-table-box">
        <table className="aitcx-table">
          <thead>
            <tr>
              <th className="w44"><Check on={pool.length > 0 && visibleOn === pool.length} part={visibleOn > 0} label="보이는 TC 모두 선택" onToggle={() => toggle(pool, visibleOn === pool.length)} /></th>
              <th className="w56">순서</th><th className="w120">ID</th><th>TC명</th><th className="w120">선행</th><th className="w140">테스트 데이터</th>
              {/* 디자인 미반영: 예상 시간 열 — TC별 예상 소요 데이터 없음 */}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              if ("group" in row) {
                const n = row.items.filter(isOn).length;
                return (
                  <tr className="group" key={`group-${row.group}`}>
                    <td><Check on={n === row.items.length} part={n > 0} label={`${row.group} 전체 선택`} onToggle={() => toggle(row.items, n === row.items.length)} /></td>
                    <td colSpan={5}><Button className="aitcx-group" style={{ marginLeft: row.depth * 16 }} onClick={() => toggle(row.items, n === row.items.length)}><b>{row.group}</b><span>{n} / {row.items.length}</span></Button></td>
                  </tr>
                );
              }
              const item = row.item;
              const on = isOn(item);
              const state = dataState(item);
              const open = on && openKey === item.key;
              return (
                <Fragment key={item.key}>
                  <tr className={on ? "" : "off"}>
                    <td><Check on={on} label={`${item.id} 선택`} onToggle={() => toggle([item], on)} /></td>
                    <td className="mono mute">{on ? order.get(item.key) ?? "—" : "—"}</td>
                    <td className="mono">{item.id}</td>
                    <td>{item.title}</td>
                    <td className="mono mute">{item.refs.join(", ") || "—"}</td>
                    <td>{state ? <BadgeToggle tone={state.tone} open={open} onToggle={() => setOpenKey(open ? "" : item.key)}>{state.text}</BadgeToggle> : <span className="mute">—</span>}</td>
                  </tr>
                  {open && <tr className="detail"><td colSpan={6}><DataDetail model={model} item={item} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!pool.length && <div className="aitcx-empty-row">조건에 맞는 TC가 없습니다</div>}
      </div>
    </div>
  );
};

const DataDetail = ({ model, item }: { model: AiTcModel; item: AiTcCase }) => {
  const prep = model.prepared[item.key];
  const given = item.data.filter(need => need.kind === "given");
  const ready = model.readiness(item);
  const decision = model.refOf(item);
  const selectedRefs = model.selectedRefs(item);
  const edit = (index: number, key: "label" | "value", value: string) =>
    model.editPrepared(item.key, current => ({ ...current, data: current.data.map((entry, at) => (at === index ? { ...entry, [key]: value } : entry)) }));
  return (
    <div className="aitcx-data">
      <div className="aitcx-data-head">
        <strong>테스트 데이터</strong>
        <span className={ready.state === "ok" && prep ? "t-ok" : "t-warn"}><i />{model.prepareErrors[item.key] ? "세팅 실패" : !prep && model.preparing ? (model.preparing.currentKey === item.key ? "세팅 중" : "세팅 대기") : ready.state !== "ok" ? ready.todos.join(" · ") || "확인 필요" : prep ? (model.autoPrepare ? "자동 세팅됨" : "직접 입력") : "세팅 안 됨"}</span>
      </div>
      {/* 디자인 미반영(실행에 필요해 임시 유지): 선행 TC 확인 — 이번 실행에 없는 선행은 "이미 준비됨"으로 확인해야 실행할 수 있다. */}
      {item.refs.length > 0 && (
        <div className="aitcx-ref">
          <span className="msi" aria-hidden="true">link</span><b>{item.refs.join(", ")}</b>
          <span>{decision === "link" ? "선행으로 연결됨 · 선행 실패 시 Blocked" : decision === "ready" ? "이미 준비된 상태로 확인" : "선행 확인 필요"}</span>
          <span className="aitcx-push">
            {!decision ? <>
              <Button variant="ghost" onClick={() => model.setRef(item.key, "ready")}>이미 준비됨</Button>
              {selectedRefs.length > 0 && <Button variant="ghost" onClick={() => model.setRef(item.key, "link")}>선행으로 확인</Button>}
            </> : <Button variant="ghost" onClick={() => model.setRef(item.key, undefined)}>변경</Button>}
          </span>
        </div>
      )}
      {given.map(need => (
        <div key={need.id} className="aitcx-field">
          <span className="aitcx-field-key" title="엑셀 원문 값">{need.label}</span>
          <Input mono readOnly value={need.value} aria-label={`${need.label} 값`} />
          <span />
        </div>
      ))}
      {!prep && model.preparing && !model.prepareErrors[item.key] && <div className="aitcx-mute">{model.preparing.currentKey === item.key ? "AI가 이 TC의 입력값과 업로드 파일을 세팅하고 있습니다." : "앞선 TC의 세팅이 끝나면 진행합니다."} ({model.preparing.done}/{model.preparing.total})</div>}
      {!prep && model.prepareErrors[item.key] && <div className="aitcx-mute t-warn">세팅 실패: {model.prepareErrors[item.key]} {!model.preparing && <Button variant="ghost" onClick={model.retryPreparation}>실패한 TC 다시 시도</Button>}</div>}
      {prep && <>
        {prep.note && <div className="aitcx-mute">{prep.note}</div>}
        {prep.data.map((entry, index) => (
          <div key={index} className="aitcx-field">
            <Input value={entry.label} aria-label="항목" placeholder="항목" onChange={event => edit(index, "label", event.target.value)} />
            <Input mono value={entry.value} aria-label={`${entry.label} 값`} placeholder="입력 필요" invalid={!entry.value.trim()} spellCheck={false} onChange={event => edit(index, "value", event.target.value)} />
            <Button variant="ghost" iconOnly aria-label={`${entry.label} 제거`} onClick={() => model.editPrepared(item.key, current => ({ ...current, data: current.data.filter((_, at) => at !== index) }))}><span className="msi" aria-hidden="true">close</span></Button>
          </div>
        ))}
        {prep.files.map((file, index) => (
          <div key={file.token} className="aitcx-file">
            <span className="msi" aria-hidden="true">attach_file</span>
            <span className="aitcx-file-text"><b>{file.label}</b><span>{file.name}</span><small>{file.spec} · 임시 파일 자동 등록</small></span>
            <Button variant="ghost" onClick={() => void model.replacePreparedFile(item.key, index)}>교체</Button>
            <Button variant="ghost" iconOnly aria-label={`${file.label} 제거`} onClick={() => model.editPrepared(item.key, current => ({ ...current, files: current.files.filter((_, at) => at !== index) }))}><span className="msi" aria-hidden="true">close</span></Button>
          </div>
        ))}
        {!prep.data.length && !prep.files.length && !given.length && <div className="aitcx-mute">{model.autoPrepare ? "입력이 필요 없는 TC로 판단했습니다." : "필요한 값을 아래에서 추가하세요."}</div>}
        <div className="aitcx-data-actions">
          <Button variant="ghost" onClick={() => model.editPrepared(item.key, current => ({ ...current, data: [...current.data, { label: "", value: "" }] }))}>+ 값 추가</Button>
          <Button variant="ghost" onClick={() => void model.addPreparedFile(item.key)}>+ 파일 추가</Button>
        </div>
      </>}
    </div>
  );
};
