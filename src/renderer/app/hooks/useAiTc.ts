import { useEffect, useMemo, useRef, useState } from "react";
import { prepareBatches } from "./prepareBatches";
import {
  aggregate, buildCases, cascadeDeselect, hostOf, orderCases, runnable,
  type AiTcCase, type AiTcColumnMap, type AiTcDecision, type AiTcField, type AiTcImportOptions,
  type AiTcPrepared, type AiTcRefDecision, type AiTcRunPlan, type AiTcRunState, type AiTcVerdict, type AiTcWorkbook,
} from "../../../app/ipc/ai-tc/model";

export type AiTcScreen = "import" | "prep" | "run" | "result";

/** 팀 모드에서 쓰는 웹 엔드포인트 × 환경. 로컬 모드(Supabase 설정 없음)에서는 null. */
export type AiTcEnvironment = {
  endpoints: Array<{ id: string; name: string }>;
  environments: Array<{ id: string; name: string }>;
  endpointId: string;
  environmentId: string;
  baseUrlFor: (endpointId?: string) => string;
  select: (next: { endpointId?: string; environmentId?: string }) => unknown;
  refresh: () => Promise<void>;
};

/** TC 한 건의 준비 상태. ok: 실행 가능 · todo: 입력 필요 · blocked: 선행 제외 · ex: 사용자가 제외 */
export type AiTcReadiness = { state: "ok" | "todo" | "blocked" | "ex"; todos: string[] };

const needKey = (caseKey: string, dataId: string) => `${caseKey}::${dataId}`;

export const useAiTc = ({ environment, showToast }: { environment: AiTcEnvironment | null; showToast: (message: string) => void }) => {
  const [screen, setScreen] = useState<AiTcScreen>("import");
  const [workbook, setWorkbook] = useState<AiTcWorkbook | null>(null);
  const [importing, setImporting] = useState(false);
  const [options, setOptions] = useState<AiTcImportOptions>({ hiddenSheets: false, hiddenRows: false });
  const [sheet, setSheet] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [cascade, setCascade] = useState<{ keys: string[]; prev: string[] } | null>(null);
  const [refDecision, setRefDecision] = useState<Record<string, AiTcRefDecision | undefined>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<Record<string, AiTcPrepared>>({});
  const [autoPrepare, setAutoPrepare] = useState(true);
  /** 자동 세팅 진행: 끝낸 TC 수 / 전체 */
  const [preparing, setPreparing] = useState<{ done: number; total: number; currentKey: string } | null>(null);
  const [prepareError, setPrepareError] = useState("");
  const [prepareErrors, setPrepareErrors] = useState<Record<string, string>>({});
  const [prepareUsage, setPrepareUsage] = useState<Record<"claude" | "codex", { input: number; output: number; cached: number; write: number; unknown: number }>>({ claude: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 }, codex: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 } });
  const [prepareCalls, setPrepareCalls] = useState<Array<{ tool: "claude" | "codex"; caseIds: string[]; promptChars: number; reason: "initial" | "missing" | "failure"; outcome: "complete" | "partial" | "error"; usage?: import("../../../app/ipc/ai-tc/ai").ModelUsage }>>([]);
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const preparationRequest = useRef(0);
  const forcePreparation = useRef(new Set<string>());
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, { token: string; name: string }>>({});
  const [skippedNeeds, setSkippedNeeds] = useState<string[]>([]);
  /** 잘못 나뉜 기대 결과를 사용자가 고친 값(한 줄에 하나). 원문은 expectedRaw로 남는다. */
  const [splitEdits, setSplitEdits] = useState<Record<string, string>>({});
  const [capture, setCapture] = useState(true);
  const [imageToAi, setImageToAi] = useState(false);
  const [tokenLimit, setTokenLimit] = useState("");
  const [tokenLimitPerCase, setTokenLimitPerCase] = useState("");
  const [video, setVideo] = useState(true);
  const [tools, setTools] = useState<Array<{ tool: "claude" | "codex"; version: string }> | null>(null);
  const [tool, setTool] = useState<"claude" | "codex">("claude");
  const [localUrl, setLocalUrl] = useState("");
  const [localHosts, setLocalHosts] = useState("");
  const [run, setRun] = useState<AiTcRunState | null>(null);
  const [preview, setPreview] = useState("");
  const [starting, setStarting] = useState(false);
  const runId = useRef("");
  const browserQueue = useRef<Promise<void>>(Promise.resolve());
  const api = window.electronAPI?.aiTc;

  useEffect(() => {
    if (!api) return;
    void api.current().then(state => { if (state) { runId.current = state.runId; setRun(state); } });
    void api.tools().then(list => { setTools(list); if (list[0] && !list.some(item => item.tool === tool)) setTool(list[0].tool); }).catch(() => setTools([]));
    const offState = api.onState(state => { if (state.runId === runId.current) setRun(state); });
    const offPreview = api.onPreview(item => { if (item.runId === runId.current) setPreview(item.image); });
    const offUsage = api.onPrepareUsage?.(({ tool: provider, usage, caseIds = [], promptChars = 0, reason = "initial", outcome = "complete" }) => { setPrepareCalls(current => [...current, { tool: provider, usage, caseIds, promptChars, reason, outcome }]); setPrepareUsage(current => {
      const total = current[provider];
      const complete = usage && (provider !== "claude" || (usage.cachedInput !== undefined && usage.cacheWrite !== undefined));
      return { ...current, [provider]: { input: total.input + (usage?.input ?? 0), output: total.output + (usage?.output ?? 0), cached: total.cached + (usage?.cachedInput ?? 0), write: total.write + (usage?.cacheWrite ?? 0), unknown: total.unknown + (complete ? 0 : 1) } };
    }); });
    return () => { offState(); offPreview(); offUsage?.(); };
  }, []);

  useEffect(() => { if (cascade) { const timer = window.setTimeout(() => setCascade(null), 6000); return () => window.clearTimeout(timer); } }, [cascade]);

  const cases = useMemo(() => (workbook ? buildCases(workbook, options) : []).map(item => {
    const edit = splitEdits[item.key];
    if (edit === undefined) return item;
    const expected = edit.split("\n").map(text => text.trim()).filter(Boolean).map((text, index) => ({ id: `E${index + 1}`, text }));
    const errors = item.errors.filter(error => error !== "기대 결과 없음");
    return { ...item, expected, errors: expected.length ? errors : [...errors, "기대 결과 없음"] };
  }), [workbook, options, splitEdits]);
  const byKey = useMemo(() => new Map(cases.map(item => [item.key, item])), [cases]);
  const byId = useMemo(() => new Map(cases.filter(runnable).map(item => [item.id.toUpperCase(), item])), [cases]);
  // 가져오기 옵션·매핑이 바뀌어 사라졌거나 오류가 된 TC는 선택에서 뺀다.
  const picked = useMemo(() => selected.filter(key => byKey.get(key) && runnable(byKey.get(key)!)), [selected, byKey]);
  const pickedCases = picked.map(key => byKey.get(key)!);

  /** 시나리오 시트(TC 머리글이 없는 시트)에서 같은 시나리오 ID가 적힌 행을 찾아 문맥으로 쓴다. */
  const scenarioContext = (item: AiTcCase) => {
    const scenarioId = item.scenarioId || item.id.replace(/-?TC\d+$/i, "");
    if (!workbook || !scenarioId) return "";
    const lines: string[] = [];
    for (const sheet of workbook.sheets) {
      if (sheet.headerRow) continue;
      for (const row of sheet.rows) {
        const cells = Object.values(row.cells);
        if (cells.some(cell => cell.trim() === scenarioId || cell.includes(`${scenarioId} `))) lines.push(`${sheet.name} ${row.row}행: ${cells.join(" | ")}`);
      }
    }
    return lines.join("\n").slice(0, 3000);
  };

  const preparationCase = (item: AiTcCase) => ({
    key: item.key, id: item.id, scenarioId: item.scenarioId, pre: item.pre, steps: item.steps, expected: item.expected,
    given: item.data.filter(need => need.kind === "given").map(need => need.value).join("\n"), scenario: scenarioContext(item),
  });

  const savePrepared = (key: string, next: AiTcPrepared) => {
    const item = byKey.get(key);
    if (!item || !api?.savePreparation) return;
    const input = preparationCase(item);
    saveQueue.current = saveQueue.current.then(() => api.savePreparation(input, next)).catch(() => { showToast("테스트 데이터 세팅을 저장하지 못했습니다."); });
  };
  const editPrepared = (key: string, change: (entry: AiTcPrepared) => AiTcPrepared) => {
    const entry = prepared[key];
    if (!entry) return;
    const next = change(entry);
    setPrepared(current => ({ ...current, [key]: next }));
    savePrepared(key, next);
  };

  // 최대 5개씩 준비하고 실패하거나 누락된 항목은 작은 묶음으로 재시도한다.
  useEffect(() => {
    if (screen !== "prep" || !api) return;
    const missing = pickedCases.filter(item => !prepared[item.key]);
    if (!missing.length) return;
    if (!autoPrepare) {
      setPrepared(current => ({ ...current, ...Object.fromEntries(missing.map(item => [item.key, { key: item.key, data: [], files: [], note: "직접 입력" }])) }));
      return;
    }
    if (!tools) return;
    const request = ++preparationRequest.current;
    setPrepareError("");
    setPrepareErrors({});
    setPreparing({ done: 0, total: missing.length, currentKey: missing[0]!.key });
    void (async () => {
      let failed = 0, done = 0;
      const active = () => preparationRequest.current === request;
      // 강제 재생성은 캐시를 쓰는 일반 요청과 분리한다.
      for (const force of [false, true]) {
        const group = missing.filter(item => forcePreparation.current.has(item.key) === force);
        for (let index = 0; index < group.length && active(); index += 5) {
          await prepareBatches(group.slice(index, index + 5), async (items, reason) => {
            setPreparing({ done, total: missing.length, currentKey: items[0]!.key });
            await saveQueue.current;
            if (!active()) return [];
            return api.prepare({ tool, cases: items.map(preparationCase), force, reason });
          }, result => {
            done++;
            forcePreparation.current.delete(result.key);
            setPrepared(current => current[result.key] ? current : { ...current, [result.key]: result });
          }, (item, error) => {
            done++; failed++;
            const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "테스트 데이터 준비에 실패했습니다.";
            setPrepareErrors(current => ({ ...current, [item.key]: message }));
          }, active);
        }
      }
      if (preparationRequest.current === request) { setPreparing(null); if (failed) setPrepareError(`${failed}개 TC의 자동 세팅에 실패했습니다. 해당 TC를 확인하고 다시 시도하세요.`); }
    })();
    return () => { preparationRequest.current++; setPreparing(null); };
  }, [screen, picked.join("|"), tool, tools, prepareAttempt, autoPrepare]);

  const importFile = async () => {
    if (!api) return showToast("데스크톱 앱에서만 엑셀을 가져올 수 있습니다.");
    setImporting(true);
    try {
      const result = await api.importWorkbook();
      if (!result) return;
      if (result.error || !result.workbook) return showToast(result.error ?? "파일을 읽지 못했습니다.");
      const next = result.workbook;
      setWorkbook(next);
      const first = next.sheets.find(item => item.headerRow && !item.hidden) ?? next.sheets.find(item => item.headerRow);
      setSheet(first?.name ?? "");
      const built = buildCases(next, options);
      setSelected(built.filter(runnable).filter(item => item.sheet === first?.name).map(item => item.key));
      preparationRequest.current++; forcePreparation.current.clear(); setPrepared({}); setRefDecision({}); setExcluded([]); setInputs({}); setFiles({}); setSkippedNeeds([]); setSplitEdits({}); setCascade(null);
    } catch (error) { showToast(error instanceof Error ? error.message : "파일을 읽지 못했습니다."); }
    finally { setImporting(false); }
  };

  const setMapping = (sheetName: string, field: AiTcField, col: number | undefined) => {
    if (!workbook) return;
    setWorkbook({
      ...workbook,
      sheets: workbook.sheets.map(item => {
        if (item.name !== sheetName) return item;
        const mapping: AiTcColumnMap = { ...item.mapping };
        // 같은 열을 두 필드에 매핑하지 않는다.
        for (const [key, value] of Object.entries(mapping)) if (col && value === col) delete mapping[key as AiTcField];
        if (col) mapping[field] = col; else delete mapping[field];
        return { ...item, mapping };
      }),
    });
  };

  const select = (keys: string[]) => setSelected(current => [...new Set([...current, ...keys.filter(key => byKey.get(key) && runnable(byKey.get(key)!))])]);
  const deselect = (keys: string[]) => {
    const next = cascadeDeselect(cases, picked, keys);
    setSelected(next.selected);
    setCascade(next.cascaded.length ? { keys: next.cascaded, prev: picked } : null);
  };
  const undoCascade = () => { if (cascade) setSelected(cascade.prev); setCascade(null); };

  /** 선행 확인: 사용자가 고른 값, 없으면 선행 TC가 모두 이번 실행에 있을 때 자동으로 연결한다. */
  const refOf = (item: AiTcCase): AiTcRefDecision | undefined => {
    const chosen = refDecision[item.key];
    if (chosen || !item.refs.length) return chosen;
    return item.refs.every(ref => { const parent = byId.get(ref); return parent && picked.includes(parent.key) && !excluded.includes(parent.key); }) ? "link" : undefined;
  };
  /** 확인이 필요한 선행(이번 실행에 없는 선행)을 모두 "이미 준비됨"으로 확인한다. */
  const confirmAllRefs = () => setRefDecision(current => {
    const next = { ...current };
    for (const item of pickedCases) if (item.refs.length && !refOf(item)) next[item.key] = "ready";
    return next;
  });
  /** 선행 후보 중 이번 실행에 선택된 TC */
  const selectedRefs = (item: AiTcCase) => item.refs.filter(ref => { const parent = byId.get(ref); return parent && picked.includes(parent.key) && !excluded.includes(parent.key); });

  const readiness = (item: AiTcCase): AiTcReadiness => {
    if (excluded.includes(item.key)) return { state: "ex", todos: [] };
    const decision = refOf(item);
    if (item.refs.length && decision === "link" && selectedRefs(item).length < item.refs.filter(ref => byId.has(ref)).length) return { state: "blocked", todos: ["선행 TC가 선택·실행 대상에서 빠짐"] };
    const todos: string[] = [];
    if (item.refs.length && !decision) todos.push(`선행 TC ${item.refs.join(", ")} 확인`);
    // 단계 문구로 추정한 데이터·파일은 실행을 막지 않는다(추정이 틀리기 쉬움). 부족하면 AI가 실행 중 묻는다.
    return { state: todos.length ? "todo" : "ok", todos };
  };

  const effectiveRefs = Object.fromEntries(pickedCases.map(item => [item.key, refOf(item)]));
  const ordered = useMemo(() => orderCases(pickedCases, effectiveRefs), [picked.join("|"), JSON.stringify(effectiveRefs), cases]);
  const readyList = (ordered ?? pickedCases).map(item => ({ item, ready: readiness(item) }));
  const notReady = readyList.filter(entry => entry.ready.state === "todo" || entry.ready.state === "blocked").length;
  const readyCount = readyList.filter(entry => entry.ready.state === "ok").length;

  // 허용 도메인: 팀 모드는 선택한 환경의 모든 웹 엔드포인트 주소, 로컬 모드는 시작 URL과 직접 적은 도메인.
  const startUrl = environment ? environment.baseUrlFor() : localUrl.trim();
  const allowedHosts = environment
    ? [...new Set(environment.endpoints.map(item => hostOf(environment.baseUrlFor(item.id))).filter(Boolean))]
    : [...new Set([hostOf(localUrl.trim()), ...localHosts.split(/[\s,]+/).map(host => host.trim()).filter(Boolean)].filter(Boolean))];
  const endpointName = environment?.endpoints.find(item => item.id === environment.endpointId)?.name ?? "";
  const environmentName = environment?.environments.find(item => item.id === environment.environmentId)?.name ?? "로컬";
  const startProblem = !startUrl ? (environment ? (environment.endpoints.length ? "설정에서 선택한 환경의 웹 주소를 넣어 주세요." : "설정에서 웹 엔드포인트를 추가해 주세요.") : "시작 URL을 입력해 주세요.")
    : !hostOf(startUrl) ? "시작 URL 형식을 확인해 주세요." : "";
  // 자동 세팅이 실패해도 실행은 막지 않는다. 값이 부족하면 AI가 실행 중 사용자에게 넘긴다.
  const limitProblem = [tokenLimit, tokenLimitPerCase].some(value => value && (!/^[1-9]\d*$/.test(value) || Number(value) > 100_000_000)) ? "토큰 한도는 1부터 100,000,000까지 입력하세요." : "";
  const cantRun = preparing ? `테스트 데이터 자동 세팅 중 ${preparing.done}/${preparing.total}` : limitProblem || (!ordered ? "선행 TC가 서로를 참조합니다. 선행 확인을 바꿔 주세요." : notReady ? `입력 필요 ${notReady}건` : !readyCount ? "실행할 TC가 없습니다." : startProblem);

  const live = run && ["running", "waiting", "error"].includes(run.status);

  const makePlan = (): AiTcRunPlan => {
    const runCases = readyList.filter(entry => entry.ready.state === "ok").map(({ item }) => {
      const decision = refOf(item);
      const inFile = item.refs.filter(ref => byId.has(ref));
      return {
        key: item.key, id: item.id, scenarioId: item.scenarioId, title: item.title, pre: item.pre, steps: item.steps, expected: item.expected,
        data: [
          ...item.data.filter(need => need.kind === "given").map(need => ({ label: `엑셀 ${need.label}`, value: need.value })),
          ...(prepared[item.key]?.data ?? []).filter(entry => entry.label.trim() && entry.value.trim()).slice(0, 25),
        ],
        files: (prepared[item.key]?.files ?? []).map(({ label, token, name }) => ({ label, token, name })),
        after: decision === "link" ? inFile : [],
        readyRefs: decision === "ready" ? item.refs : [],
      };
    });
    return {
      cases: runCases, startUrl, allowedHosts, capture, video, imageToAi, tool,
      environmentLabel: environment ? `${endpointName} · ${environmentName}` : `로컬 · ${hostOf(startUrl)}`,
      ...(tokenLimit ? { tokenLimit: Number(tokenLimit) } : {}),
      ...(tokenLimitPerCase ? { tokenLimitPerCase: Number(tokenLimitPerCase) } : {}),
      preparationUsage: prepareUsage,
    };
  };

  const loadSavedNeeds = async () => {
    if (!api || cantRun || live || !ordered) { if (cantRun) showToast(cantRun); return; }
    try {
      const needs = await api.savedNeeds(makePlan());
      setPrepared(current => {
        const next = { ...current };
        for (const need of needs) {
          const entry = next[need.key] ?? { key: need.key, data: [], files: [], note: "직접 입력" };
          const given = byKey.get(need.key)?.data.filter(item => item.kind === "given").map(item => `엑셀 ${item.label}`) ?? [];
          next[need.key] = { ...entry, data: [...entry.data, ...need.labels.filter(label => !given.includes(label) && !entry.data.some(item => item.label === label)).map(label => ({ label, value: "" }))] };
        }
        return next;
      });
      showToast("저장된 절차의 데이터 항목을 불러왔습니다.");
    } catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "저장된 항목을 불러오지 못했습니다."); }
  };

  const start = async (mode: "ai" | "saved" | "assisted" = "ai") => {
    if (!api || cantRun || live || !ordered) { if (cantRun) showToast(cantRun); return; }
    if (mode !== "saved" && !tools?.some(item => item.tool === tool)) { showToast("선택한 AI CLI를 찾지 못했습니다."); return; }
    const plan = makePlan();
    setStarting(true);
    try {
      setPreview("");
      const state = mode === "ai" ? await api.start(plan) : await api.replaySaved(plan, mode === "assisted");
      runId.current = state.runId;
      setRun(state);
      setScreen("run");
    } catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "실행을 시작하지 못했습니다."); }
    finally { setStarting(false); }
  };

  const decide = (decision: AiTcDecision, reply?: string) => { if (run && api) void browserQueue.current.then(() => api.decide(run.runId, decision, reply)).catch(error => showToast(error instanceof Error ? error.message : "실행을 재개하지 못했습니다.")); };
  const browserEvent: NonNullable<typeof api>["browserEvent"] extends (id: string, event: infer E) => unknown ? (event: E) => void : never = event => { if (run && api) browserQueue.current = browserQueue.current.then(() => api.browserEvent(run.runId, event)).catch(error => showToast(error instanceof Error ? error.message : "브라우저 조작에 실패했습니다.")); };
  const cancel = () => { if (run) void api?.cancel(run.runId); };
  const replay = async (assisted = false) => {
    if (!run || !api || live || starting) return;
    setStarting(true);
    try {
      const state = await api.replay(run.runId, assisted);
      runId.current = state.runId; setRun(state); setPreview(""); setScreen("run");
    } catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "빠른 재실행을 시작하지 못했습니다."); }
    finally { setStarting(false); }
  };
  const review = async (caseKey: string, expectedId: string, verdict: AiTcVerdict | null, note: string) => {
    if (!run || !api) return;
    const next = await api.review({ runId: run.runId, caseKey, expectedId, verdict, note });
    if (next) setRun(next);
  };
  const approveAssertion = async (caseKey: string, expectedId: string, approved: boolean) => {
    if (!run || !api) return;
    const next = await api.approveAssertion({ runId: run.runId, caseKey, expectedId, approved });
    if (next) setRun(next);
  };
  const applyRepair = async (caseKey: string) => {
    if (!run || !api) return;
    try { const next = await api.applyRepair({ runId: run.runId, caseKey }); if (next) setRun(next); }
    catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "후보를 적용하지 못했습니다."); }
  };
  const exportResult = async () => {
    if (!run || !api) return;
    try { const name = await api.exportResult(run.runId); if (name) showToast(`${name} 저장됨`); }
    catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "결과를 저장하지 못했습니다."); }
  };
  const downloadVideo = async () => {
    if (!run || !api) return;
    try { const name = await api.downloadVideo(run.runId); if (name) showToast(`${name} 저장됨`); }
    catch (error) { showToast(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "영상을 저장하지 못했습니다."); }
  };
  const openFolder = () => { if (run) void api?.openFolder(run.runId); };
  const loadCapture = (captureId: string) => (run && api ? api.capture(run.runId, captureId) : Promise.resolve(null));

  const pickFile = async (caseKey: string, dataId: string) => {
    const picked = await api?.pickUpload();
    if (picked) setFiles(current => ({ ...current, [needKey(caseKey, dataId)]: picked }));
  };

  const progress = useMemo(() => {
    if (!run) return { done: 0, total: 0, percent: 0 };
    const all = run.cases.flatMap(item => item.expected);
    const done = all.filter(item => !["pending", "running", "waiting"].includes(item.verdict)).length;
    return { done, total: all.length, percent: run.status === "done" || run.status === "cancelled" ? 100 : all.length ? Math.round((done / all.length) * 100) : 0 };
  }, [run]);

  /** 하단 큰 버튼: 준비 → 실행 → 취소 → 결과 → 다시 실행 */
  const dock = (() => {
    if (live && screen === "run") return { icon: "stop_circle", label: "취소", danger: true, disabled: false, run: cancel };
    if (screen === "import") return { icon: "arrow_forward", label: "준비", danger: false, disabled: !picked.length, run: () => setScreen("prep") };
    if (screen === "prep") return { icon: "play_arrow", label: "실행", danger: false, disabled: Boolean(cantRun) || starting || Boolean(live), run: () => void start() };
    if (screen === "run" && run && !live) return { icon: "fact_check", label: "결과", danger: false, disabled: false, run: () => setScreen("result") };
    if (screen === "result") return { icon: "replay", label: "다시 실행", danger: false, disabled: Boolean(live), run: () => setScreen("prep") };
    return { icon: "play_arrow", label: "실행", danger: false, disabled: true, run: () => undefined };
  })();

  const tcVerdict = (index: number) => (run ? aggregate(run.cases[index]!.expected.map(item => item.verdict)) : "pending");

  return {
    api: Boolean(api), screen, setScreen, workbook, importing, importFile, options, setOptions, sheet, setSheet, setMapping,
    cases, byKey, picked, pickedCases, select, deselect, clearSelection: () => { setSelected([]); setCascade(null); }, cascade, undoCascade, setCascade,
    refOf, confirmAllRefs, exportResult, downloadVideo, openFolder,
    refDecision, setRef: (key: string, decision: AiTcRefDecision | undefined) => setRefDecision(current => ({ ...current, [key]: decision })),
    selectedRefs, excluded, toggleExcluded: (key: string) => setExcluded(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key])),
    prepared, preparing, prepareError, prepareErrors, prepareUsage, prepareCalls, autoPrepare, setAutoPrepare, retryPreparation: () => setPrepareAttempt(value => value + 1),
    resetPrepareUsage: () => { setPrepareCalls([]); setPrepareUsage({ claude: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 }, codex: { input: 0, output: 0, cached: 0, write: 0, unknown: 0 } }); },
    /** 선택한 TC의 자동 세팅을 버리고 처음부터 다시 만든다. */
    regeneratePreparation: () => { forcePreparation.current = new Set(picked); setPrepared(current => Object.fromEntries(Object.entries(current).filter(([key]) => !picked.includes(key)))); setPrepareAttempt(value => value + 1); },
    editPrepared,
    replacePreparedFile: async (key: string, index: number) => {
      const chosen = await api?.pickUpload();
      if (chosen) editPrepared(key, entry => ({ ...entry, files: entry.files.map((file, at) => at === index ? { ...file, ...chosen, spec: "직접 고른 파일" } : file) }));
    },
    addPreparedFile: async (key: string) => {
      const chosen = await api?.pickUpload();
      if (chosen) editPrepared(key, entry => ({ ...entry, files: [...entry.files, { label: "업로드 파일", ...chosen, spec: "직접 고른 파일" }] }));
    },
    inputs, setInput: (caseKey: string, dataId: string, value: string) => setInputs(current => ({ ...current, [needKey(caseKey, dataId)]: value })),
    files, pickFile, skippedNeeds, toggleNeed: (caseKey: string, dataId: string) => { const key = needKey(caseKey, dataId); setSkippedNeeds(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key])); },
    splitEdits, setSplit: (key: string, value: string | undefined) => setSplitEdits(current => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; }),
    needKey, readiness, ordered, readyList, notReady, readyCount, cantRun,
    capture, setCapture, imageToAi, setImageToAi, video, setVideo, tools, tool, setTool, tokenLimit, setTokenLimit, tokenLimitPerCase, setTokenLimitPerCase,
    localUrl, setLocalUrl, localHosts, setLocalHosts, startUrl, allowedHosts, endpointName, environmentName,
    run, live: Boolean(live), preview, starting, start, loadSavedNeeds, replay, decide, browserEvent, cancel, review, approveAssertion, applyRepair, loadCapture, progress, dock, tcVerdict,
  };
};

export type AiTcModel = ReturnType<typeof useAiTc>;
