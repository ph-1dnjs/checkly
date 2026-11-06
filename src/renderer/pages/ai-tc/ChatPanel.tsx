import { useEffect, useRef } from "react";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import type { AiTcEnvironment, AiTcModel, AiTcScreen } from "../../app/hooks/useAiTc";
import { AI_TC_FIELDS, aggregate, runnable } from "../../../app/ipc/ai-tc/model";
import type { Control } from "./BrowserStage";
import { TONE_ICON, mmss, type Tone } from "./parts";

type Line = { tone: Tone | "tune"; text: string };
type Cta = { label: string; icon: string; go: () => void; locked?: boolean; title?: string };
type OptionGroup = { label: string; items: Array<{ label: string; on: boolean; go: () => void; disabled?: boolean; title?: string }> };
export type ChatMessage = { title: string; sub: string; lines: Line[]; cta?: Cta; fix?: { label: string; go: () => void }; xls?: { go: () => void; disabled: boolean }; options?: OptionGroup[] };

export const SCREENS: AiTcScreen[] = ["import", "prep", "run", "result"];
const REPLIES = ["확인했어요", "실행할게요", "결과 볼게요"];

export type ChatContext = {
  model: AiTcModel;
  environment: AiTcEnvironment | null;
  control: Control;
  settingsOpen: boolean;
  toggleSettings: () => void;
  takeover: () => void;
  giveBack: () => void;
  skip: () => void;
  now: number;
};

/** 단계별 AI 메시지. 현재 단계 메시지에만 CTA가 붙는다. */
export const stepMessage = (step: number, ctx: ChatContext): ChatMessage[] => {
  const { model, environment } = ctx;
  if (step === 0) {
    const workbook = model.workbook;
    if (!workbook) return [{
      title: "TC 엑셀을 가져오세요", sub: ".xlsx · 원본 파일은 바꾸지 않아요",
      lines: [{ tone: "wait", text: "TC ID·테스트 단계·기대 결과 열을 읽어 실행할 TC를 만듭니다" }],
      cta: { label: model.importing ? "읽는 중…" : "엑셀 파일 선택", icon: "table_view", go: () => void model.importFile(), locked: model.importing },
    }];
    const sheets = workbook.sheets.filter(sheet => sheet.headerRow && (model.options.hiddenSheets || !sheet.hidden));
    const required = AI_TC_FIELDS.filter(field => field.required);
    const unmapped = sheets.filter(sheet => required.some(field => !sheet.mapping[field.field]));
    const ex = model.cases.filter(item => !runnable(item));
    const kinds = new Map<string, number>();
    for (const item of ex) for (const error of item.errors) kinds.set(error, (kinds.get(error) ?? 0) + 1);
    return [{
      title: "엑셀 파일 확인", sub: workbook.fileName,
      lines: [
        sheets.length ? { tone: "ok", text: `TC 시트 ${sheets.length}개 인식 · ${sheets.map(sheet => sheet.name).join(", ")}` } : { tone: "warn", text: "TC 머리글이 있는 시트를 찾지 못했어요" },
        unmapped.length ? { tone: "warn", text: `열 매핑 확인 필요 · ${unmapped.map(sheet => sheet.name).join(", ")}` } : { tone: "ok", text: `열 매핑 완료 · 필수 ${required.length}/${required.length}` },
        ex.length ? { tone: "warn", text: `${ex.length}개 행 제외 · ${[...kinds.entries()].map(([kind, n]) => `${kind} ${n}`).join(", ")}` } : { tone: "ok", text: "제외한 행 없음" },
      ],
      cta: { label: `준비로 이동 · ${model.picked.length}개`, icon: "arrow_forward", go: () => model.setScreen("prep"), locked: !model.picked.length },
      // 디자인 미반영: "시트·매핑 수정"(fix) — 시트 선택·열 매핑 수정 UI 없음
    }];
  }
  if (step === 1) {
    const toolName = model.tool === "claude" ? "Claude CLI" : "Codex CLI";
    const runnableCount = model.cases.filter(runnable).length;
    const lines: Line[] = [
      model.picked.length ? { tone: "ok", text: `선택한 TC ${model.picked.length} / ${runnableCount}개 · 선행 TC 기준 정렬` } : { tone: "warn", text: "실행할 TC를 선택하세요" },
    ];
    if (!model.ordered) lines.push({ tone: "fail", text: "선행 TC가 서로를 참조해 순서를 정할 수 없어요" });
    if (model.notReady) lines.push({ tone: "warn", text: `선행 확인 필요 ${model.notReady}건 · 테스트 데이터를 펼쳐 확인하세요` });
    if (model.preparing) lines.push({ tone: "run", text: `테스트 데이터 자동 세팅 중 ${model.preparing.done}/${model.preparing.total} · ${model.byKey.get(model.preparing.currentKey)?.id ?? "TC"} 준비 중` });
    else if (model.prepareError) lines.push({ tone: "warn", text: `자동 세팅 실패 · ${model.prepareError}` });
    lines.push(model.startUrl ? { tone: "ok", text: `시작 URL · ${model.startUrl.replace(/^https?:\/\//, "")}` } : { tone: "warn", text: environment ? "설정에서 선택한 환경의 웹 주소를 넣어 주세요" : "시작 URL을 입력하세요 · 헤더의 로컬 메뉴" });
    if (model.tools !== null && !model.tools.some(item => item.tool === model.tool)) lines.push({ tone: "warn", text: "선택한 AI CLI를 찾지 못했어요 · Claude Code나 Codex CLI를 설치하고 로그인하세요" });
    lines.push({ tone: "tune", text: `${toolName} · ${model.environmentName}` });
    const cliItems = (["claude", "codex"] as const).map(tool => {
      const installed = model.tools?.find(item => item.tool === tool);
      return { label: tool === "claude" ? "Claude CLI" : "Codex CLI", on: model.tool === tool, go: () => model.setTool(tool), disabled: !installed, title: installed?.version ?? "설치된 CLI를 찾지 못했습니다" };
    });
    const options: OptionGroup[] = [{ label: "AI CLI", items: cliItems }];
    if (environment?.environments.length) options.push({ label: "환경", items: environment.environments.map(item => ({ label: item.name, on: item.id === environment.environmentId, go: () => void environment.select({ environmentId: item.id }) })) });
    // 디자인만 있음: "실패 시 계속 진행/중단" 옵션 — 실행기는 실패해도 다음 TC를 계속 실행한다.
    // 디자인 미반영: AI 전송 범위·화면 이미지 AI 전송, 화면 캡처·영상 기록, 실행 한도·토큰 한도, 저장된 절차로 빠른 실행·AI 보조 실행
    return [{
      title: "실행 준비 확인", sub: environment ? `${model.endpointName || "엔드포인트 없음"} · ${model.environmentName}` : `로컬 · ${model.startUrl || "시작 URL 없음"}`,
      lines, options: ctx.settingsOpen ? options : undefined,
      cta: { label: `실행 시작 · ${model.readyCount}개`, icon: "play_arrow", go: () => void model.start(), locked: Boolean(model.cantRun) || model.starting || model.live, title: model.cantRun },
      fix: { label: ctx.settingsOpen ? "설정 완료" : "설정 변경", go: ctx.toggleSettings },
    }];
  }
  const run = model.run;
  if (step === 2) {
    if (!run) return [{ title: "실행 기록이 없습니다", sub: "준비 단계에서 실행을 시작하세요", lines: [], cta: { label: "준비로 이동", icon: "arrow_back", go: () => model.setScreen("prep") } }];
    const verdicts = run.cases.map(item => aggregate(item.expected.map(expected => expected.verdict)));
    const count = (...keys: string[]) => verdicts.filter(verdict => keys.includes(verdict)).length;
    const elapsed = Math.round(((run.endedAt ? Date.parse(run.endedAt) : ctx.now) - Date.parse(run.startedAt)) / 1000);
    const tally: Line[] = [{ tone: "ok", text: `통과 ${count("pass")}` }];
    if (count("fail")) tally.push({ tone: "fail", text: `실패 ${count("fail")}` });
    if (count("blocked", "check")) tally.push({ tone: "warn", text: `확인 필요 ${count("blocked", "check")}` });
    const current = run.cases[run.current];
    const toResult: Cta = { label: "결과 보기", icon: "arrow_forward", go: () => model.setScreen("result") };
    if (run.status === "done") return [{ title: "실행 완료", sub: `${run.cases.length}개 모두 실행 · ${mmss(elapsed)}`, lines: tally, cta: toResult }];
    if (run.status === "cancelled") return [{ title: "실행 취소됨", sub: mmss(elapsed), lines: [{ tone: "wait", text: "완료된 결과는 보존하고 나머지는 미실행으로 기록했어요" }, ...tally], cta: toResult }];
    if (run.status === "error") {
      const retry = run.error?.retryable;
      return [{
        title: "실행을 멈췄어요", sub: current ? `${current.id} ${current.title}` : "",
        lines: [{ tone: "fail", text: run.error?.message ?? "알 수 없는 오류" }, { tone: "wait", text: "테스트 Fail로 기록하지 않아요. 확인된 결과는 보존돼요" }],
        cta: retry ? { label: "다시 시도", icon: "refresh", go: () => model.decide("resume") } : { label: "여기서 종료", icon: "stop", go: () => model.decide("stop") },
        fix: retry ? { label: "여기서 종료", go: () => model.decide("stop") } : undefined,
      }];
    }
    const progress: ChatMessage = {
      title: "실행 중", sub: `${model.progress.percent}% · 경과 ${mmss(elapsed)}`,
      lines: [{ tone: "run", text: `${run.current + 1} / ${run.cases.length} · ${current ? `${current.id} ${current.title}` : ""}` }, ...tally],
      cta: { label: "실행 중…", icon: "hourglass_top", go: () => undefined, locked: true }, fix: { label: "중단", go: model.cancel },
    };
    const wait = run.status === "waiting" ? run.wait : undefined;
    if (!wait) return [progress];
    const base = { ...progress, cta: undefined, fix: undefined };
    const helpLines: Line[] = [
      { tone: "run", text: `시나리오 ${current?.scenarioId || "미지정"} · ${current?.id ?? ""} · ${current?.title ?? ""}` },
      ...(wait.context ? [{ tone: "wait" as const, text: `시도한 동작: ${wait.context.attempted}` }] : []),
      { tone: "warn", text: `중단 사유: ${wait.body || wait.title}` },
      { tone: "run", text: `요청: ${wait.context?.request || "위 사유를 확인해 직접 처리하거나 필요한 정보를 답장해 주세요. 답장을 보내면 현재 화면을 다시 확인해 진행합니다."}` },
    ];
    if (wait.kind === "confirm") return [base, {
      title: "위험 동작 확인이 필요해요", sub: wait.confirm?.target ?? wait.title,
      lines: [{ tone: "warn", text: wait.confirm ? `${wait.confirm.impact} · ${wait.confirm.url}` : wait.body }, { tone: "wait", text: "직접 처리하려면 브라우저 화면의 \"직접 처리\"를 누르세요" }],
      cta: { label: "이번만 허용", icon: "check", go: () => model.decide("allow") }, fix: { label: "Blocked로 기록", go: () => model.decide("block") },
    }];
    if (ctx.control === "user") return [base, {
      title: "직접 제어 중이에요", sub: "AI는 대기 중",
      lines: [...helpLines, { tone: "wait", text: "마치면 AI에게 돌려주세요 · 아래에 남긴 답장도 함께 전달돼요" }],
      cta: { label: "AI에게 돌려주기", icon: "smart_toy", go: ctx.giveBack },
    }];
    return [base, {
      title: wait.context?.source === "app" ? "앱 검사로 진행이 보류됐어요" : "진행을 위해 확인이 필요해요", sub: wait.title,
      lines: helpLines,
      cta: { label: "직접 제어하기", icon: "pan_tool", go: ctx.takeover }, fix: { label: "건너뛰기", go: ctx.skip },
    }];
  }
  if (!run) return [{ title: "결과가 없습니다", sub: "", lines: [] }];
  const verdicts = run.cases.map(item => ({ item, verdict: aggregate(item.expected.map(expected => expected.verdict)) }));
  const fails = verdicts.filter(entry => entry.verdict === "fail");
  const checks = verdicts.filter(entry => !["pass", "na", "fail"].includes(entry.verdict)).length;
  const seconds = run.endedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : 0;
  const lines: Line[] = [];
  if (fails.length) lines.push({ tone: "fail", text: `실패 ${fails.length} · ${fails.slice(0, 2).map(entry => entry.item.id).join(", ")}${fails.length > 2 ? ` 외 ${fails.length - 2}건` : ""}` });
  if (checks) lines.push({ tone: "warn", text: `확인 필요 ${checks}` });
  lines.push({ tone: "ok", text: `통과 ${verdicts.filter(entry => entry.verdict === "pass").length}` });
  if (run.saveError) lines.push({ tone: "fail", text: `결과 파일 저장 실패 · ${run.saveError}` });
  return [{
    title: "결과", sub: `${run.allowedHosts[0] ?? ""} · ${run.cases.length} TC${seconds ? ` · ${mmss(seconds)}` : ""}`, lines,
    // 디자인만 있음: "팀 공유 저장" — 결과·캡처는 이 PC에만 저장되며 팀 공유 저장은 아직 제공하지 않는다. 대신 "다시 실행"을 둔다.
    cta: { label: "다시 실행", icon: "replay", go: () => model.setScreen("prep"), locked: model.live },
    fix: { label: "처음부터 다시", go: () => model.setScreen("import") },
    xls: { go: () => void model.exportResult(), disabled: model.live },
  }];
};

export const ChatPanel = ({ ctx, step, notes, draft, setDraft, canReply, onSend, onClose }: {
  ctx: ChatContext; step: number; notes: string[]; draft: string; setDraft: (value: string) => void;
  canReply: boolean; onSend: () => void; onClose: () => void;
}) => {
  const scroll = useRef<HTMLDivElement>(null);
  const groups = Array.from({ length: step + 1 }, (_, k) => ({ k, msgs: stepMessage(k, ctx) }));
  const signature = groups.map(group => group.msgs.map(msg => msg.title).join("/")).join("|") + notes.length;
  const prepUsage = ctx.model.prepareUsage;
  const run = ctx.model.run;
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }, [signature]);

  return (
    <div className="aitcx-chat">
      <div className="aitcx-pane-head"><strong>AI 대화</strong>
        <Button variant="ghost" iconOnly className="aitcx-push" aria-label="대화 패널 닫기" onClick={onClose}><span className="msi" aria-hidden="true">left_panel_close</span></Button>
      </div>
      <div className="aitcx-chat-scroll" ref={scroll}>
        {groups.map(({ k, msgs }) => msgs.map((msg, index) => {
          const isCur = k === step && index === msgs.length - 1;
          return (
            <div key={`${k}-${index}`} className="aitcx-msg-wrap">
              <div className="aitcx-msg">
                <span className="aitcx-avatar"><span className="msi" aria-hidden="true">smart_toy</span></span>
                <div className="aitcx-bubble">
                  <div className="aitcx-bubble-head"><strong>{msg.title}</strong>{msg.sub && <small>{msg.sub}</small>}</div>
                  {msg.lines.length > 0 && (
                    <div className="aitcx-lines">
                      {msg.lines.map((line, at) => (
                        <div key={at} className="aitcx-line"><span className={`msi t-${line.tone}`} aria-hidden="true">{line.tone === "tune" ? "tune" : TONE_ICON[line.tone]}</span><span>{line.text}</span></div>
                      ))}
                    </div>
                  )}
                  {isCur && msg.options && (
                    <div className="aitcx-options">
                      {msg.options.map(group => (
                        <div key={group.label} className="aitcx-option-group" role="radiogroup" aria-label={group.label}>
                          <small>{group.label}</small>
                          <div>{group.items.map(item => <Button key={item.label} role="radio" aria-checked={item.on} disabled={item.disabled} title={item.title} className={`aitcx-radio${item.on ? " on" : ""}`} onClick={item.go}>{item.label}</Button>)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {isCur && msg.cta && (
                    <div className="aitcx-cta-row">
                      <Button variant="primary" className="aitcx-cta" disabled={msg.cta.locked} title={msg.cta.title} onClick={msg.cta.go}><span>{msg.cta.label}</span><span className="msi" aria-hidden="true">{msg.cta.icon}</span></Button>
                      {msg.fix && <Button variant="ghost" className="aitcx-fix" onClick={msg.fix.go}>{msg.fix.label}</Button>}
                      {msg.xls && <><span className="aitcx-sep" aria-hidden="true" /><Button variant="ghost" iconOnly className="aitcx-xls" aria-label="엑셀 다운로드" title="엑셀 다운로드" disabled={msg.xls.disabled} onClick={msg.xls.go}><span className="msi" aria-hidden="true">download</span></Button></>}
                    </div>
                  )}
                </div>
              </div>
              {k < step && index === msgs.length - 1 && <div className="aitcx-me"><span>{REPLIES[k]}</span></div>}
            </div>
          );
        }))}
        {notes.map((note, index) => <div key={index} className="aitcx-me"><span className="note">{note}</span></div>)}
        {canReply && (
          <div className="aitcx-me"><span className="typing" aria-label="입력 중">
            {draft ? <>{draft}<i className="caret" /></> : <><i className="dot" /><i className="dot" /><i className="dot" /></>}
          </span></div>
        )}
      </div>
      <div className="aitcx-chat-usage" aria-label="토큰 사용량" aria-live="polite">
        <strong>토큰 사용량</strong>
        {(["claude", "codex"] as const).map(provider => {
          const usage = prepUsage[provider];
          if (!usage.input && !usage.output && !usage.cached && !usage.write && !usage.unknown) return null;
          return <div key={provider}>준비 {provider} · 입력 {usage.input.toLocaleString()} · 출력 {usage.output.toLocaleString()} · 캐시 읽기 {usage.cached.toLocaleString()} · 생성 {usage.write.toLocaleString()}{usage.unknown ? ` · 미확인 ${usage.unknown}회` : ""} <small>({provider === "claude" ? "캐시 별도" : "캐시 읽기 입력에 포함"})</small></div>;
        })}
        {run?.usage && <div>실행 {run.provider} · 입력 {run.usage.input.toLocaleString()} · 출력 {run.usage.output.toLocaleString()} · 캐시 읽기 {run.usage.cachedInput.toLocaleString()} · 생성 {run.usage.cacheWrite.toLocaleString()}{run.usage.unknown ? ` · 진행 중 또는 미확인 ${run.usage.unknown}회` : ""} <small>({run.provider === "Claude CLI" ? "캐시 별도" : "캐시 읽기 입력에 포함"})</small></div>}
        {!run?.usage && !Object.values(prepUsage).some(usage => usage.input || usage.output || usage.cached || usage.write || usage.unknown) && <div>완료된 AI 호출이 없습니다.</div>}
        <small>준비는 현재 화면 세션 누계이며 실행 사용량과 별도입니다.</small>
      </div>
      <div className="aitcx-chat-input">
        {/* 디자인만 있음: AI와 자유 대화 — 실행 중 사용자 대기일 때만 답장을 보내 AI에 전달한다. */}
        <Input aria-label="메시지 입력" maxLength={2000} disabled={!canReply} value={draft} placeholder={canReply ? "답장 입력… 보내면 AI가 이어서 진행해요" : "AI가 답장을 기다릴 때 입력할 수 있어요"}
          onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) onSend(); }} />
        <Button variant="primary" iconOnly className="aitcx-send" aria-label="보내기" disabled={!canReply || !draft.trim()} onClick={onSend}><span className="msi" aria-hidden="true">arrow_upward</span></Button>
      </div>
    </div>
  );
};
