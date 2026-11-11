import { useState, type ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcEnvironment, AiTcModel, AiTcReadiness } from "../../app/hooks/useAiTc";
import { AI_TC_RUN_LIMITS } from "../../../app/ipc/ai-tc/model";
import { Toggle } from "./ImportView";

const READY: Record<AiTcReadiness["state"], { label: string; tone: string }> = {
  ok: { label: "준비됨", tone: "ok" },
  todo: { label: "입력 필요", tone: "wait" },
  blocked: { label: "Blocked", tone: "blocked" },
  ex: { label: "제외", tone: "idle" },
};

export const PrepView = ({ model, environment }: { model: AiTcModel; environment?: AiTcEnvironment | null }) => {
  const [filter, setFilter] = useState<"all" | "todo">("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [setOpen, setSetOpen] = useState<"env" | "ai" | "rec" | "lim" | "">("env");
  const list = model.readyList;
  const current = list.find(entry => entry.item.key === selectedKey) ?? list[0];

  if (!list.length) {
    return (
      <div className="aitc-empty">
        <h2>선택한 TC가 없습니다</h2>
        <p>가져오기에서 실행할 TC를 선택하세요.</p>
        <Button variant="secondary" onClick={() => model.setScreen("import")}>가져오기로 이동</Button>
      </div>
    );
  }

  const item = current!.item;
  const ready = current!.ready;
  const decision = model.refOf(item);
  const selectedRefs = model.selectedRefs(item);
  const excluded = ready.state === "ex";
  const given = item.data.filter(need => need.kind === "given");
  const prep = model.prepared[item.key];
  const sendOn = ["TC 원문 · 기대 결과 · 테스트 데이터", "현재 URL · 페이지 제목", "접근성 요소 (역할·이름·상태)", ...(model.imageToAi ? ["화면 이미지"] : [])];
  const sendOff = ["수동 입력 · 비밀번호 칸의 값", "로컬 파일 경로 · 업로드 파일 내용", ...(model.imageToAi ? [] : ["화면 이미지"])];
  const toolName = model.tool === "claude" ? "Claude CLI" : "Codex CLI";

  const section = (title: string, ok: boolean | null, okWord: string, todoWord: string, children: ReactNode) => (
    <div className="aitc-prep-section">
      <div className="aitc-prep-section-head">
        <strong>{title}</strong>
        <span className={`aitc-status ${ok === null ? "off" : ok ? "ok" : "wait"}`}><i />{ok === null ? okWord : ok ? okWord : todoWord}</span>
      </div>
      {children}
    </div>
  );

  const heads: Array<{ id: "env" | "ai" | "rec" | "lim"; icon: string; title: string; summary: string }> = [
    { id: "env", icon: "dns", title: "실행 환경", summary: `${model.environmentName} · ${model.endpointName || model.startUrl || "주소 없음"}` },
    { id: "ai", icon: "north_east", title: "AI 전송", summary: model.tools?.length ? toolName : "AI CLI 없음" },
    { id: "rec", icon: "videocam", title: "기록", summary: `캡처 ${model.capture ? "켜짐" : "꺼짐"} · 영상 ${model.video ? "켜짐" : "꺼짐"}` },
    { id: "lim", icon: "timer", title: "실행 한도", summary: `${AI_TC_RUN_LIMITS.actionsPerCase}회 · ${AI_TC_RUN_LIMITS.minutesPerCase}분 · 호출 ${AI_TC_RUN_LIMITS.modelCalls}회` },
  ];

  return (
    <section className="aitc-grid aitc-prep">
      <aside className="aitc-pane">
        <div className="aitc-pane-head">실행 순서</div>
        <div className="aitc-pane-tool">
          <div className="aitc-seg aitc-seg-fill">
            <Button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체<span>{list.length}</span></Button>
            <Button className={filter === "todo" ? "active" : ""} onClick={() => setFilter("todo")}>입력 필요<span className={model.notReady ? "wait" : ""}>{model.notReady || ""}</span></Button>
          </div>
          <Button variant="secondary" className="aitc-full aitc-bulk" disabled={Boolean(model.preparing) || model.live} onClick={model.regeneratePreparation} title="선택한 TC의 입력값과 임시 업로드 파일을 다시 만듭니다">
            <span className="msi" aria-hidden="true">auto_fix_high</span>{model.preparing ? `데이터 세팅 중 ${model.preparing.done}/${model.preparing.total}` : "테스트 데이터 다시 세팅"}
          </Button>
          <Button variant="secondary" className="aitc-full aitc-bulk" disabled={Boolean(model.cantRun) || model.live} onClick={() => void model.loadSavedNeeds()}>저장된 절차의 데이터 항목 불러오기</Button>
          {(["claude", "codex"] as const).map(provider => { const usage = model.prepareUsage[provider]; return (usage.input || usage.output || usage.unknown) ? <div className="aitc-mute" key={provider}>준비 토큰 ({provider}, 현재 화면 세션): 입력 {usage.input.toLocaleString()} · 출력 {usage.output.toLocaleString()} · 캐시 읽기 {usage.cached.toLocaleString()} · 캐시 생성 {usage.write.toLocaleString()}{usage.unknown ? ` · 미확인 ${usage.unknown}회` : ""} · {provider === "codex" ? "입력에 캐시 읽기 포함" : "캐시 입력 별도"}</div> : null; })}
          {model.notReady > 0 && <Button variant="secondary" className="aitc-full aitc-bulk" onClick={model.confirmAllRefs}>남은 선행 모두 "이미 준비됨"으로 확인</Button>}
        </div>
        <div className="aitc-scroll aitc-pad-bottom">
          {!model.ordered && <div className="aitc-warn-line"><span className="msi" aria-hidden="true">sync_problem</span>선행 TC가 서로를 참조합니다. 순서를 정할 수 없습니다.</div>}
          {list.map((entry, index) => ({ entry, index })).filter(({ entry }) => filter === "all" || entry.ready.state === "todo" || entry.ready.state === "blocked").map(({ entry, index }) => (
            <Button key={entry.item.key} className={`aitc-order${entry.item.key === item.key ? " active" : ""}${entry.ready.state === "ex" ? " dim" : ""}`} onClick={() => setSelectedKey(entry.item.key)}>
              <span className="aitc-seq">{String(index + 1).padStart(2, "0")}</span>
              <span className="aitc-order-body">
                <span className="aitc-order-top"><b>{entry.item.id}</b><span className={`aitc-status ${READY[entry.ready.state].tone}`}><i />{READY[entry.ready.state].label}</span></span>
                <span className="aitc-order-title">{entry.item.title}</span>
                {entry.ready.todos.length > 0 && <span className="aitc-order-todo">{entry.ready.todos.join(" · ")}</span>}
              </span>
            </Button>
          ))}
          <div className="aitc-note aitc-note-icon"><span className="msi" aria-hidden="true">sync_alt</span>TC 간 브라우저 컨텍스트를 유지합니다. 로그인·데이터 상태가 다음 TC로 이어질 수 있습니다.</div>
        </div>
      </aside>

      <section className="aitc-main">
        <div className="aitc-prep-head">
          <div>
            <div className="aitc-prep-id"><b>{item.id}</b><span>{item.sheet} · {item.row}행</span></div>
            <h2>{item.title}</h2>
          </div>
          <Button variant="secondary" onClick={() => model.toggleExcluded(item.key)}>
            <span className="msi" aria-hidden="true">{excluded ? "undo" : "block"}</span>{excluded ? "제외 취소" : "이 TC 제외"}
          </Button>
        </div>
        <div className="aitc-scroll aitc-prep-body">
          <div className="aitc-prep-inner">
            {!excluded && ready.todos.length > 0 && (
              <div className="aitc-todo-box">
                <strong>실행 전 필요</strong>
                {ready.todos.map(todo => <div key={todo}><i />{todo}</div>)}
              </div>
            )}
            {section("사전 조건", item.refs.length ? Boolean(decision) : true, item.refs.length ? "선행 확인됨" : "확인됨", "선행 확인 필요", <>
              <p className="aitc-prep-text">{item.pre || "사전 조건 없음"}</p>
              {item.refs.length > 0 && (
                <div className="aitc-ref-box">
                  <span className="aitc-ref-ids"><span className="msi" aria-hidden="true">link</span>{item.refs.join(", ")}</span>
                  <span className={decision ? "ok" : "wait"}>
                    {decision === "link" ? "선행으로 연결됨 · 선행 실패 시 Blocked" : decision === "ready" ? "이미 준비된 상태로 확인 · 근거 기록" : selectedRefs.length ? "선행 관계를 확인하세요" : "선행 TC가 이번 실행에 없습니다. 준비된 상태인지 확인하세요"}
                  </span>
                  <span className="aitc-push aitc-ref-actions">
                    {!decision ? <>
                      <Button variant="secondary" onClick={() => model.setRef(item.key, "ready")}>이미 준비됨</Button>
                      {selectedRefs.length > 0 && <Button variant="primary" onClick={() => model.setRef(item.key, "link")}>선행으로 확인</Button>}
                    </> : <Button className="aitc-link" onClick={() => model.setRef(item.key, undefined)}>변경</Button>}
                  </span>
                </div>
              )}
            </>)}
            {section("테스트 데이터", prep ? true : model.preparing ? false : null, prep ? "자동 세팅됨" : "없음", model.preparing ? "세팅 중" : "세팅 안 됨", <>
              {given.map(need => (
                <div key={need.id} className="aitc-need">
                  <div className="aitc-need-head"><span>{need.label}</span><small>엑셀 원문 값</small></div>
                  <div className="aitc-given">{need.value}</div>
                </div>
              ))}
              {!prep && model.preparing && <div className="aitc-mute">TC와 시나리오를 바탕으로 AI가 입력값과 업로드 파일을 세팅하고 있습니다 ({model.preparing.done}/{model.preparing.total}).</div>}
              {!prep && !model.preparing && model.prepareError && <div className="aitc-todo-box slim"><span className="msi" aria-hidden="true">error</span>{model.prepareError}<Button variant="secondary" className="aitc-push" onClick={model.retryPreparation}>다시 시도</Button></div>}
              {prep && <>
                <div className="aitc-need-head"><span>{model.autoPrepare ? "AI 자동 세팅" : "직접 입력"}</span><small>{prep.note || "실행 전 수정 가능"}</small></div>
                {prep.data.map((entry, index) => (
                  <div key={index} className="aitc-auto-row">
                    <Input value={entry.label} aria-label="항목" onChange={event => model.editPrepared(item.key, current => ({ ...current, data: current.data.map((value, at) => (at === index ? { ...value, label: event.target.value } : value)) }))} />
                    <Input mono value={entry.value} aria-label={`${entry.label} 값`} spellCheck={false} onChange={event => model.editPrepared(item.key, current => ({ ...current, data: current.data.map((value, at) => (at === index ? { ...value, value: event.target.value } : value)) }))} />
                    <Button variant="ghost" iconOnly aria-label={`${entry.label} 삭제`} onClick={() => model.editPrepared(item.key, current => ({ ...current, data: current.data.filter((_, at) => at !== index) }))}><span className="msi" aria-hidden="true">close</span></Button>
                  </div>
                ))}
                {prep.files.map((file, index) => (
                  <div key={file.token} className="aitc-auto-file">
                    <span className="msi" aria-hidden="true">attach_file</span>
                    <span className="aitc-auto-file-text"><b>{file.label}</b><span>{file.name}</span><small>{file.spec} · 임시 파일 자동 등록</small></span>
                    <Button className="aitc-link" onClick={() => void model.replacePreparedFile(item.key, index)}>교체</Button>
                    <Button variant="ghost" iconOnly aria-label={`${file.label} 삭제`} onClick={() => model.editPrepared(item.key, current => ({ ...current, files: current.files.filter((_, at) => at !== index) }))}><span className="msi" aria-hidden="true">close</span></Button>
                  </div>
                ))}
                {!prep.data.length && !prep.files.length && <div className="aitc-mute">{model.autoPrepare ? "입력이 필요 없는 TC로 판단했습니다." : "저장된 절차에 필요한 값을 아래에서 추가하세요."}</div>}
                <div className="aitc-auto-actions">
                  <Button className="aitc-link" onClick={() => model.editPrepared(item.key, current => ({ ...current, data: [...current.data, { label: "", value: "" }] }))}>+ 값 추가</Button>
                  <Button className="aitc-link" onClick={() => void model.addPreparedFile(item.key)}>+ 파일 추가</Button>
                </div>
              </>}

            </>)}
            {section("기대 결과", null, "원문", "", (
              <div className="aitc-timeline">
                {item.expected.map((expected, index) => (
                  <div key={expected.id} className="aitc-timeline-row">
                    <div className="aitc-timeline-rail"><i className={index ? "" : "hide"} /><b>{expected.id}</b><i className={index < item.expected.length - 1 ? "" : "hide"} /></div>
                    <div className="aitc-timeline-text">{expected.text}</div>
                  </div>
                ))}
              </div>
            ))}
            {section("계정 · 로그인", null, "수동 인계", "", <>
              <div className="aitc-prep-text"><span className="aitc-mute">로그인</span> 수동 인계 — 로그인·2차 인증이 필요하면 AI가 멈추고 브라우저에서 직접 입력하도록 안내합니다.</div>
              <div className="aitc-mute">로그인 대기 중에는 화면 캡처와 AI 전송을 멈춥니다. 비밀번호는 TC나 로그에 저장하지 않습니다.</div>
            </>)}
          </div>
        </div>
      </section>

      <aside className="aitc-pane aitc-pane-right">
        <div className="aitc-pane-head">실행 설정</div>
        <div className="aitc-scroll">
          {heads.map(head => {
            const open = setOpen === head.id;
            return (
              <div key={head.id} className="aitc-set">
                <Button className={`aitc-set-head${open ? " open" : ""}`} aria-expanded={open} onClick={() => setSetOpen(open ? "" : head.id)}>
                  <span className="msi" aria-hidden="true">{head.icon}</span>
                  <span className="aitc-set-text"><strong>{head.title}</strong><small title={head.summary}>{head.summary}</small></span>
                  <span className="msi" aria-hidden="true">{open ? "expand_less" : "expand_more"}</span>
                </Button>
                {open && head.id === "env" && (
                  <div className="aitc-set-body">
                    {environment ? <>
                      <label className="aitc-field"><span>엔드포인트</span>
                        <select value={environment.endpointId} onChange={event => environment.select({ endpointId: event.target.value })} disabled={!environment.endpoints.length}>
                          {!environment.endpoints.length && <option value="">등록된 웹 엔드포인트 없음</option>}
                          {environment.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name} · web</option>)}
                        </select>
                      </label>
                      <div className="aitc-field"><span>환경</span>
                        <div className="aitc-seg aitc-seg-fill mono">
                          {environment.environments.map(item => <Button key={item.id} className={item.id === environment.environmentId ? "active" : ""} onClick={() => environment.select({ environmentId: item.id })}>{item.name}</Button>)}
                        </div>
                      </div>
                    </> : <>
                      <label className="aitc-field"><span>시작 URL · 로컬 모드</span><Input mono value={model.localUrl} placeholder="https://qa.example.com" onChange={event => model.setLocalUrl(event.target.value)} /></label>
                      <label className="aitc-field"><span>추가 허용 도메인</span><Input mono value={model.localHosts} placeholder="www.example.com, m.example.com" onChange={event => model.setLocalHosts(event.target.value)} /></label>
                    </>}
                    {environment && <div className="aitc-field"><span>시작 URL</span><div className="aitc-given">{model.startUrl || "설정에서 선택한 환경의 주소를 넣어 주세요"}</div></div>}
                    <div className="aitc-field"><span className="aitc-row-between">허용 도메인<small>{environment ? "엔드포인트 설정" : "직접 입력"}</small></span>
                      {model.allowedHosts.map(host => <div key={host} className="aitc-domain"><i />{host}</div>)}
                      {!model.allowedHosts.length && <div className="aitc-mute">없음</div>}
                    </div>
                    <div className="aitc-mute">테스트 환경 사용을 권장합니다. 운영 환경 여부는 자동으로 판별하지 않습니다.</div>
                  </div>
                )}
                {open && head.id === "ai" && (
                  <div className="aitc-set-body">
                    <div className="aitc-field"><span>제공자</span>
                      {model.tools === null ? <div className="aitc-mute">찾는 중…</div> : model.tools.length ? (
                        <div className="aitc-seg aitc-seg-fill">
                          {(["claude", "codex"] as const).map(tool => { const installed = model.tools?.find(entry => entry.tool === tool); return <Button key={tool} className={tool === model.tool ? "active" : ""} aria-pressed={tool === model.tool} disabled={!installed} title={installed?.version ?? "설치된 CLI를 찾지 못했습니다"} onClick={() => model.setTool(tool)}>{tool === "claude" ? "Claude CLI" : "Codex CLI"}</Button>; })}
                        </div>
                      ) : <div className="aitc-warn-line"><span className="msi" aria-hidden="true">warning</span>Claude Code나 Codex CLI를 설치하고 로그인하세요.</div>}
                      <small className="aitc-mute">이 PC의 CLI 로그인으로 실행합니다. 변경해도 이미 준비한 데이터는 유지됩니다. 보관·학습 정책과 비용은 제공자 설정을 확인하세요.</small>
                    </div>
                    <div className="aitc-send">
                      <Toggle label="화면 이미지 AI 전송" hint="시각적 판단이 필요할 때 사용 · 로컬 근거 캡처와 별도" on={model.imageToAi} onToggle={() => model.setImageToAi(!model.imageToAi)} />
                      <div className="aitc-send-head wait">외부 전송</div>
                      {sendOn.map(text => <div key={text} className="aitc-send-row on"><span className="msi" aria-hidden="true">north_east</span>{text}</div>)}
                      <div className="aitc-send-head">전송 안 함</div>
                      {sendOff.map(text => <div key={text} className="aitc-send-row"><span className="msi" aria-hidden="true">block</span>{text}</div>)}
                    </div>
                  </div>
                )}
                {open && head.id === "rec" && (
                  <div className="aitc-set-body">
                    <Toggle label="화면 캡처" hint="근거 · 로컬 저장" on={model.capture} onToggle={() => model.setCapture(!model.capture)} />
                    <Toggle label="영상 기록" hint="결과에서 다운로드 · 미저장 시 삭제" on={model.video} onToggle={() => model.setVideo(!model.video)} />
                    <div className="aitc-mute">캡처·영상에는 화면의 민감정보가 담길 수 있습니다. 로그인 대기 중에는 캡처하지 않습니다. 자동 삭제·암호화는 제공하지 않습니다.</div>
                  </div>
                )}
                {open && head.id === "lim" && (
                  <div className="aitc-set-body aitc-limits">
                    <div><small>동작 / TC</small><b>{AI_TC_RUN_LIMITS.actionsPerCase}<em>회</em></b></div>
                    <div><small>시간 / TC</small><b>{AI_TC_RUN_LIMITS.minutesPerCase}<em>분</em></b></div>
                    <div><small>모델 호출</small><b>{AI_TC_RUN_LIMITS.modelCalls}<em>회</em></b></div>
                    <label className="aitc-field"><span>실행 토큰 한도 (선택)</span><Input inputMode="numeric" value={model.tokenLimit} onChange={event => model.setTokenLimit(event.target.value)} placeholder="한도 없음" /><small>준비 단계 제외. 완료된 호출 기준으로 다음 호출을 중단하므로 진행 중인 호출은 한도를 초과할 수 있습니다.</small></label>
                    <label className="aitc-field"><span>TC별 토큰 한도 (선택)</span><Input inputMode="numeric" value={model.tokenLimitPerCase} onChange={event => model.setTokenLimitPerCase(event.target.value)} placeholder="한도 없음" /><small>80% 도달 시 경고하며 한도를 넘긴 TC의 다음 AI 호출을 중단합니다.</small></label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer className="aitc-pane-foot">
          {model.cantRun && <div className="aitc-run-hint">{model.cantRun}</div>}
          <Button variant="secondary" className="aitc-full" disabled={Boolean(model.cantRun) || model.starting || model.live} onClick={() => { if (window.confirm("저장된 동작을 현재 데이터로 다시 실행합니다. 등록·저장이 중복될 수 있습니다. 계속할까요?")) void model.start("saved"); }}>저장된 절차로 빠른 실행</Button>
          <Button variant="secondary" className="aitc-full" disabled={Boolean(model.cantRun) || model.starting || model.live} onClick={() => { if (window.confirm("저장된 동작을 현재 데이터로 실행합니다. 등록·저장이 중복될 수 있으며 미승인 결과는 AI로 판정합니다. 계속할까요?")) void model.start("assisted"); }}>저장된 절차로 AI 보조 실행</Button>
          <Button variant="primary" className="aitc-full" disabled={Boolean(model.cantRun) || model.starting || model.live} onClick={() => void model.start()}>
            <span className="msi" aria-hidden="true">play_arrow</span>{model.live ? "실행 중" : model.notReady ? `입력 필요 ${model.notReady}건` : `${model.readyCount}개 TC 실행`}
          </Button>
        </footer>
      </aside>
    </section>
  );
};
