import { useState, type CSSProperties } from "react";
import { Button } from "../../shared/ui/Button";
import type { AiTcModel } from "../../app/hooks/useAiTc";
import { AI_TC_FIELDS, AI_TC_LIMITS, runnable, type AiTcCase } from "../../../app/ipc/ai-tc/model";

const groupOf = (item: AiTcCase) => item.scenarioId || item.id.replace(/-?TC\d+$/i, "") || "ID 없음";

export const Toggle = ({ label, on, onToggle, hint }: { label: string; on: boolean; onToggle: () => void; hint?: string }) => (
  <Button role="switch" aria-checked={on} className="aitc-switch-row" onClick={onToggle}>
    <span className="aitc-switch-label">{label}</span>
    {hint && <span className="aitc-switch-hint">{hint}</span>}
    <span className={`aitc-switch${on ? " on" : ""}`} aria-hidden="true"><i /></span>
  </Button>
);

export const ImportView = ({ model }: { model: AiTcModel }) => {
  const { workbook, cases, sheet, picked } = model;
  const [filter, setFilter] = useState<"all" | "err">("all");
  const [openKey, setOpenKey] = useState("");
  const [mapOpen, setMapOpen] = useState(false);
  const [statOpen, setStatOpen] = useState(false);
  const [editing, setEditing] = useState("");

  if (!workbook) {
    return (
      <div className="aitc-empty">
        <span className="aitc-empty-icon msi" aria-hidden="true">upload_file</span>
        <h2>TC 엑셀을 가져오세요</h2>
        <p>.xlsx 파일의 TC 시트를 읽어 TC ID·테스트 단계·기대 결과를 확인합니다. 원본 파일은 바꾸지 않으며 매크로와 수식은 실행하지 않습니다.</p>
        <p className="aitc-mute">최대 {AI_TC_LIMITS.fileBytes / 1024 / 1024}MB · 시트 {AI_TC_LIMITS.sheets}개 · 시트당 {AI_TC_LIMITS.rowsPerSheet}행 · 칸당 {AI_TC_LIMITS.cellChars}자</p>
        <Toggle label="AI 데이터 자동 준비" hint="끄면 준비 화면에서 값을 직접 입력합니다" on={model.autoPrepare} onToggle={() => model.setAutoPrepare(!model.autoPrepare)} />
        <Button variant="primary" size="large" disabled={model.importing} onClick={() => void model.importFile()}>
          <span className="msi" aria-hidden="true">table_view</span>{model.importing ? "읽는 중…" : "엑셀 파일 선택"}
        </Button>
      </div>
    );
  }

  const current = workbook.sheets.find(item => item.name === sheet);
  const sheetCases = cases.filter(item => item.sheet === sheet);
  const errRows = sheetCases.filter(item => !runnable(item));
  const visible = sheetCases.filter(item => filter === "all" || !runnable(item));
  const selectable = visible.filter(runnable);
  const inView = selectable.filter(item => picked.includes(item.key)).length;
  const allOn = selectable.length > 0 && inView === selectable.length;
  const groups = new Map<string, AiTcCase[]>();
  for (const item of visible) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
  const requiredMapped = AI_TC_FIELDS.filter(field => field.required && current?.mapping[field.field]).length;
  const mappedCols = new Set(Object.values(current?.mapping ?? {}));
  const refCols = (current?.headers ?? []).filter(header => !mappedCols.has(header.col));
  const okN = sheetCases.length - errRows.length;
  const okPct = sheetCases.length ? (okN / sheetCases.length) * 100 : 0;
  const errorKinds = ["빈 ID", "중복 ID", "테스트 단계 없음", "기대 결과 없음"];
  const pickedBySheet = new Map<string, AiTcCase[]>();
  for (const item of model.pickedCases) pickedBySheet.set(item.sheet, [...(pickedBySheet.get(item.sheet) ?? []), item]);

  return (
    <section className="aitc-grid aitc-import">
      <aside className="aitc-pane">
        <div className="aitc-pane-head">SHEETS</div>
        <div className="aitc-scroll">
          {workbook.sheets.filter(item => model.options.hiddenSheets || !item.hidden || item.name === sheet).map(item => {
            const isTc = Boolean(item.headerRow);
            const tcCases = cases.filter(entry => entry.sheet === item.name);
            const err = tcCases.filter(entry => !runnable(entry)).length;
            return (
              <Button key={item.name} className={`aitc-sheet${item.name === sheet ? " active" : ""}${isTc ? "" : " ref"}`} disabled={!isTc} onClick={() => { model.setSheet(item.name); setOpenKey(""); }} aria-current={item.name === sheet ? "true" : undefined}>
                <span className="msi" aria-hidden="true">{isTc ? "table_rows" : "description"}</span>
                <span className="aitc-sheet-text">
                  <strong>{item.name}</strong>
                  <small>{isTc ? `${tcCases.length} TC` : "TC 머리글 없음 · 참고"}{item.hidden ? " · 숨김" : ""}</small>
                </span>
                {err > 0 && <span className="aitc-err-badge" title="오류 행">{err}</span>}
              </Button>
            );
          })}
        </div>
        <div className="aitc-pane-foot">
          <div className="aitc-caption">가져오기 옵션</div>
          <Toggle label="AI 데이터 자동 준비" hint="끄면 준비 화면에서 값을 직접 입력합니다" on={model.autoPrepare} onToggle={() => model.setAutoPrepare(!model.autoPrepare)} />
          <Toggle label="숨긴 시트 포함" on={model.options.hiddenSheets} onToggle={() => model.setOptions({ ...model.options, hiddenSheets: !model.options.hiddenSheets })} />
          <Toggle label="숨긴 행 포함" on={model.options.hiddenRows} onToggle={() => model.setOptions({ ...model.options, hiddenRows: !model.options.hiddenRows })} />
          <Button variant="secondary" className="aitc-full" disabled={model.importing} onClick={() => void model.importFile()}>다른 파일 가져오기</Button>
        </div>
      </aside>

      <section className="aitc-main">
        <div className="aitc-bar">
          <span className="aitc-bar-title"><i className={requiredMapped === 3 ? "ok" : "fail"} />열 매핑</span>
          <span className="aitc-bar-meta">필수 <b>{requiredMapped}/3</b></span>
          <Button variant="secondary" className="aitc-push" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>
            매핑 수정<span className="msi" aria-hidden="true">{mapOpen ? "expand_less" : "expand_more"}</span>
          </Button>
        </div>
        {mapOpen && current && (
          <div className="aitc-map">
            <div className="aitc-map-grid">
              {AI_TC_FIELDS.map(field => (
                <label key={field.field} className="aitc-map-cell">
                  <span>{field.label}{field.required && <em>필수</em>}</span>
                  <select value={current.mapping[field.field] ?? ""} onChange={event => model.setMapping(current.name, field.field, event.target.value ? Number(event.target.value) : undefined)}>
                    <option value="">선택 안 함</option>
                    {current.headers.map(header => <option key={header.col} value={header.col}>{header.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="aitc-ref-cols">
              <span>참고 열 · 실행 지시로 쓰지 않음</span>
              {refCols.map(header => <span key={header.col} className="aitc-chip">{header.label}</span>)}
            </div>
          </div>
        )}
        <div className="aitc-bar">
          <Button role="checkbox" aria-checked={allOn ? true : inView ? "mixed" : false} title="보이는 TC 모두 선택" className={`aitc-check${inView ? " on" : ""}`}
            onClick={() => (allOn ? model.deselect(selectable.map(item => item.key)) : model.select(selectable.map(item => item.key)))}>
            <span className="msi" aria-hidden="true">{allOn ? "check" : inView ? "remove" : ""}</span>
          </Button>
          <div className="aitc-seg">
            <Button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체<span>{sheetCases.length}</span></Button>
            <Button className={filter === "err" ? "active" : ""} onClick={() => setFilter("err")}>오류<span className={errRows.length ? "fail" : ""}>{errRows.length || ""}</span></Button>
          </div>
        </div>
        <div className="aitc-scroll aitc-pad-bottom">
          {!visible.length && <div className="aitc-note">{filter === "err" ? "오류 행이 없습니다." : "이 시트에서 읽은 TC가 없습니다. 열 매핑을 확인하세요."}</div>}
          {[...groups.entries()].map(([label, rows]) => {
            const errors = rows.filter(item => !runnable(item)).length;
            return (
              <div key={label}>
                <div className="aitc-group-head"><b>{label}</b>{errors > 0 && <span>오류 {errors}</span>}</div>
                {rows.map(item => {
                  const locked = !runnable(item);
                  const on = !locked && picked.includes(item.key);
                  const open = openKey === item.key;
                  return (
                    <div key={item.key} className={`aitc-tc${open ? " open" : ""}${locked ? " error" : ""}`}>
                      <div className="aitc-tc-row">
                        <Button role="checkbox" aria-checked={on} aria-disabled={locked} disabled={locked} title={locked ? "오류 수정 전 실행할 수 없음" : undefined}
                          className={`aitc-check${on ? " on" : ""}`} onClick={() => (on ? model.deselect([item.key]) : model.select([item.key]))} aria-label={`${item.id || "빈 ID"} 선택`}>
                          <span className="msi" aria-hidden="true">{on ? "check" : ""}</span>
                        </Button>
                        <Button className="aitc-tc-body" aria-expanded={open} onClick={() => setOpenKey(open ? "" : item.key)}>
                          <span className="aitc-tc-meta">
                            <b className={item.id ? "" : "fail"}>{item.id || "(빈 ID)"}</b>
                            {item.kind && <span className="aitc-kind">{item.kind}</span>}
                            {item.refs.map(ref => <span key={ref} className="aitc-ref" title="선행 후보"><span className="msi" aria-hidden="true">link</span>{ref}</span>)}
                            {item.warnings.length > 0 && <span className="aitc-warn" title={item.warnings.join(" · ")}><span className="msi" aria-hidden="true">warning</span>{item.warnings.length}</span>}
                          </span>
                          <span className="aitc-tc-step" title={item.stepsRaw} style={{ WebkitLineClamp: openKey && !open ? 1 : 2 } as CSSProperties}>{item.steps.join(" → ") || "테스트 단계가 비어 있습니다"}</span>
                          {!openKey && <span className={`aitc-tc-exp${item.expected.length ? "" : " fail"}`} title={item.expected.map(e => e.text).join(" / ")}>
                            {item.expected.length ? `${item.expected[0]!.text}${item.expected.length > 1 ? ` 외 ${item.expected.length - 1}` : ""}` : "기대 결과가 비어 있습니다"}
                          </span>}
                        </Button>
                        <span className={`aitc-status ${locked ? "fail" : on ? "on" : "off"}`}><i />{locked ? item.errors.join(" · ") : on ? "선택됨" : "미선택"}</span>
                      </div>
                      {open && (
                        <div className="aitc-tc-detail">
                          <div>
                            <div className="aitc-caption">사전 조건</div>
                            <p>{item.pre || "—"}</p>
                            <div className="aitc-caption">테스트 단계</div>
                            {item.steps.map((step, index) => <div key={index} className="aitc-num-line"><span>{index + 1}</span>{step}</div>)}
                            {item.data.length > 0 && <><div className="aitc-caption">테스트 데이터</div>{item.data.map(need => <div key={need.id} className="aitc-num-line"><span>{need.id}</span>{need.kind === "given" ? need.value : `${need.label} · 준비 단계에서 입력`}</div>)}</>}
                          </div>
                          <div>
                            <div className="aitc-caption aitc-row-between">기대 결과 · 검증 단위
                              <Button className="aitc-link" onClick={() => {
                                if (editing === item.key) { setEditing(""); return; }
                                if (model.splitEdits[item.key] === undefined) model.setSplit(item.key, item.expected.map(e => e.text).join("\n"));
                                setEditing(item.key);
                              }}>{editing === item.key ? "완료" : "분리 수정"}</Button>
                            </div>
                            {editing === item.key ? (
                              <>
                                <textarea className="aitc-textarea" aria-label="기대 결과(한 줄에 하나)" value={model.splitEdits[item.key] ?? ""} onChange={event => model.setSplit(item.key, event.target.value)} rows={Math.max(3, item.expected.length + 1)} />
                                <div className="aitc-row-between aitc-mute">한 줄이 검증 단위 하나입니다.<Button className="aitc-link" onClick={() => { model.setSplit(item.key, undefined); setEditing(""); }}>원래대로</Button></div>
                              </>
                            ) : (
                              <div className="aitc-exp-list">
                                {item.expected.map(expected => <div key={expected.id}><b>{expected.id}</b><span>{expected.text}</span></div>)}
                                {!item.expected.length && <div className="fail">기대 결과가 비어 있습니다</div>}
                              </div>
                            )}
                            {model.splitEdits[item.key] !== undefined && editing !== item.key && <div className="aitc-mute">사용자가 분리를 수정함 · 원문: {item.expectedRaw || "(빈 칸)"}</div>}
                            {item.warnings.map(warning => <div key={warning} className="aitc-warn-line"><span className="msi" aria-hidden="true">warning</span>{warning}</div>)}
                            <div className="aitc-src">{item.sheet} · {item.row}행 · 원문 보존</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <aside className="aitc-pane aitc-pane-right">
        <div className="aitc-stat">
          <div className="aitc-pane-head">가져오기 상태<span>{sheet}</span></div>
          <div className="aitc-donut-row">
            <div className="aitc-donut" title={`실행 가능 ${okN} · 오류 ${errRows.length}`}
              style={{ background: `conic-gradient(var(--ck-color-pass) 0 ${okPct}%, #fff ${okPct}% calc(${okPct}% + 0.6%), var(--ck-color-fail) calc(${okPct}% + 0.6%) 100%)` }}>
              <div><b>{okN}</b><small>/ {sheetCases.length}</small></div>
            </div>
            <div className="aitc-legend">
              <span><i className="ok" />실행 가능</span>
              <span><i className="fail" />오류</span>
            </div>
          </div>
          <Button className="aitc-detail-toggle" aria-expanded={statOpen} onClick={() => setStatOpen(!statOpen)}>상세<span className="msi" aria-hidden="true">{statOpen ? "expand_less" : "expand_more"}</span></Button>
          {statOpen && (
            <div className="aitc-stat-detail">
              <Button className="aitc-stat-row" onClick={() => setFilter("all")}><i className="ok" />실행 가능<b>{okN}</b></Button>
              <div className="aitc-stat-row sub"><i className="blue" />선행 참조<b>{sheetCases.filter(item => item.refs.length).length}</b></div>
              {sheetCases.filter(item => item.refs.length).map(item => <div key={item.key} className="aitc-stat-item"><span>{item.row}행</span>{item.id}<em>← {item.refs.join(", ")}</em></div>)}
              <Button className="aitc-stat-row" onClick={() => setFilter("err")}><i className="fail" />오류<b className={errRows.length ? "fail" : ""}>{errRows.length}</b></Button>
              {errorKinds.map(kind => {
                const rows = errRows.filter(item => item.errors.includes(kind));
                return rows.length ? (
                  <div key={kind}>
                    <div className="aitc-stat-row sub"><i className="fail" />{kind}<b>{rows.length}</b></div>
                    {rows.map(item => <div key={item.key} className="aitc-stat-item"><span>{item.row}행</span><b className={item.id ? "" : "fail"}>{item.id || "(빈 ID)"}</b></div>)}
                  </div>
                ) : null;
              })}
            </div>
          )}
        </div>
        <div className="aitc-pane-head">선택한 TC<Button className="aitc-link aitc-push" onClick={model.clearSelection}>비우기</Button></div>
        <div className="aitc-scroll aitc-min">
          {[...pickedBySheet.entries()].map(([name, items]) => (
            <div key={name}>
              <div className="aitc-sub-head">{name}</div>
              {items.map(item => (
                <div key={item.key} className="aitc-picked">
                  <div><b>{item.id}</b><span title={item.title}>{item.title}</span></div>
                  <Button variant="ghost" iconOnly title="빼기" aria-label={`${item.id} 빼기`} onClick={() => model.deselect([item.key])}><span className="msi" aria-hidden="true">close</span></Button>
                </div>
              ))}
            </div>
          ))}
          {!picked.length && <div className="aitc-note">선택한 TC가 없습니다.</div>}
        </div>
        <footer className="aitc-pane-foot">
          <div className="aitc-field"><span>사용할 AI CLI</span>
            <div className="aitc-seg aitc-seg-fill" role="group" aria-label="사용할 AI CLI">
              {(["claude", "codex"] as const).map(tool => {
                const installed = model.tools?.find(entry => entry.tool === tool);
                return <Button key={tool} className={model.tool === tool ? "active" : ""} aria-pressed={model.tool === tool} disabled={!installed} title={installed?.version ?? "설치된 CLI를 찾지 못했습니다"} onClick={() => model.setTool(tool)}>{tool === "claude" ? "Claude CLI" : "Codex CLI"}</Button>;
              })}
            </div>
            <small className="aitc-mute">{model.tools === null ? "설치된 CLI를 확인하고 있습니다." : "선택한 CLI로 테스트 데이터를 준비하고 실행합니다."}</small>
          </div>
          <div className="aitc-kpis">
            <div><small>TC</small><b>{picked.length}</b></div>
            <div><small>EXPECTED</small><b>{model.pickedCases.reduce((sum, item) => sum + item.expected.length, 0)}</b></div>
          </div>
          <Button variant="primary" className="aitc-full" disabled={!picked.length} onClick={() => model.setScreen("prep")}>준비로 이동<span className="msi" aria-hidden="true">arrow_forward</span></Button>
        </footer>
      </aside>

      {model.cascade && (
        <div className="aitc-cascade" role="status">
          <span className="msi" aria-hidden="true">link_off</span>
          <div>
            <strong>선행 TC 해제로 연결된 TC <b>{model.cascade.keys.length}</b>개도 해제됨</strong>
            <small>{model.cascade.keys.map(key => model.byKey.get(key)?.id).join(" · ")}</small>
          </div>
          <Button variant="secondary" onClick={model.undoCascade}>되돌리기</Button>
          <Button variant="ghost" iconOnly aria-label="닫기" onClick={() => model.setCascade(null)}><span className="msi" aria-hidden="true">close</span></Button>
        </div>
      )}
    </section>
  );
};
