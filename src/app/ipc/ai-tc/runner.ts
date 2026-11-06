import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { buildPrompt, parseReply, type AiAction, type ModelCall, type ModelUsage } from "./ai";
import { recordStep, recordingKey, recordingSchema, type RecordedStep } from "./recording";
import {
  AI_TC_RUN_LIMITS, VERDICT_LABEL, aggregate, hostAllowed, hostOf,
  type AiTcActionLog, type AiTcActionOp, type AiTcCaseResult, type AiTcDecision, type AiTcExpectedResult,
  type AiTcRunPlan, type AiTcRunState, type AiTcVerdict, type AiTcWait,
} from "./model";

/**
 * AI TC 실행기. 한 실행은 하나의 Chromium 컨텍스트와 활성 페이지에서 TC를 순서대로 처리한다.
 * 관찰 → 모델에 동작 하나 요청 → 검증 → Playwright 수행 → 다시 관찰을 반복하고,
 * 로그인·도메인 이탈·팝업은 사용자 대기로 멈춘다. 실행 ID가 다른 늦은 응답은 버린다.
 */

export type RunnerDeps = {
  emit: (state: AiTcRunState) => void;
  preview: (runId: string, image: string) => void;
  /** 실행별 산출물(캡처·결과·영상)을 둘 폴더 */
  dataDir: string;
  ask: (input: { tool: "claude" | "codex"; file: string; cwd: string; prompt: string; screenshot?: string; onUsage?: (usage: ModelUsage | undefined) => void }) => ModelCall;
  /** 설치된 CLI 경로. 없으면 undefined */
  toolPath: (tool: "claude" | "codex") => Promise<string | undefined>;
  /** 사용자가 고른 업로드 파일의 실제 경로. 모델에는 이름만 보낸다. */
  resolveFile: (token: string) => string | undefined;
  headless?: boolean;
  executablePath?: string;
};

const planSchema = z.object({
  cases: z.array(z.object({
    key: z.string().max(2000), id: z.string().min(1).max(200), scenarioId: z.string().max(1000).optional(), title: z.string().max(4000), pre: z.string().max(10000),
    steps: z.array(z.string().max(10000)).max(100), expected: z.array(z.object({ id: z.string().regex(/^E\d{1,2}$/), text: z.string().max(10000) })).min(1).max(50),
    data: z.array(z.object({ label: z.string().max(200), value: z.string().max(4000) })).max(30),
    files: z.array(z.object({ label: z.string().max(200), token: z.string().uuid(), name: z.string().max(300) })).max(10),
    after: z.array(z.string().max(200)).max(20), readyRefs: z.array(z.string().max(200)).max(20),
  })).min(1).max(500),
  startUrl: z.string().url().refine(url => /^https?:/i.test(url), "http(s) 주소만 실행합니다"),
  allowedHosts: z.array(z.string().min(1).max(300)).min(1).max(30),
  capture: z.boolean(), video: z.boolean(), imageToAi: z.boolean().optional(), tool: z.enum(["claude", "codex"]), environmentLabel: z.string().max(200),
  tokenLimit: z.number().int().min(1).max(100_000_000).optional(),
  tokenLimitPerCase: z.number().int().min(1).max(100_000_000).optional(),
  preparationUsage: z.object({ claude: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), cached: z.number().nonnegative(), write: z.number().nonnegative(), unknown: z.number().int().nonnegative() }).strict(), codex: z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), cached: z.number().nonnegative(), write: z.number().nonnegative(), unknown: z.number().int().nonnegative() }).strict() }).strict().optional(),
});

class Cancelled extends Error {}
class ModelError extends Error {}
class BudgetError extends Error {}
class CaseBudgetError extends Error {}

type Active = {
  state: AiTcRunState;
  plan: AiTcRunPlan;
  replay?: RecordedStep[][];
  assisted?: boolean;
  dir: string;
  toolFile: string;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  cancelled: boolean;
  waiter?: (decision: AiTcDecision) => void;
  model?: ModelCall;
  captures: number;
  popups: Page[];
  downloads: string[];
  dialogs: string[];
  userReply?: string;
  waitMs: number;
  /** 취소되면 거부되는 약속. 응답이 오지 않는 모델 호출도 취소로 끝낸다. */
  aborted: Promise<never>;
  abort: () => void;
};

const now = () => new Date().toISOString();
const clock = () => new Date().toTimeString().slice(0, 8);
const open = (verdict: string) => verdict === "pending" || verdict === "running" || verdict === "waiting";
const describe = (target: { role?: string; name?: string; text?: string; label?: string; placeholder?: string; nth?: number } | undefined) =>
  !target ? "" : `${target.role ? `${target.role} ` : ""}${target.name ?? target.label ?? target.placeholder ?? target.text ?? ""}${target.nth !== undefined ? ` #${target.nth + 1}` : ""}`.trim();

/** 접근성 트리에서 비밀번호 칸의 값은 지운다. */
export const maskSnapshot = (snapshot: string) =>
  snapshot.split("\n").map(line => (/password|비밀번호|패스워드|\bpw\b|token|secret/i.test(line) ? line.replace(/(textbox[^:]*):.*$/i, "$1: [가림]") : line)).join("\n").slice(0, 14000);

/** 입력값만 바뀐 것은 허용하고, 주변 구조·안내 변경 시 묶음을 다시 판단한다. */
export const batchSnapshot = (snapshot: string) => snapshot.split("\n").map(line => line.replace(/(\b(?:textbox|searchbox)\b[^\n]*?): .+$/, "$1")).join("\n");

/** 세션 타이머만 바뀐 경우에도 다른 화면 변경과 타이머를 검증하는 TC는 그대로 감지한다. */
export const stableSessionTimer = (snapshot: string, caseText: string, actionText = "") => {
  if (/남은\s*시간|remaining\s+(?:session\s+)?time/i.test(caseText) || /남은\s*시간|remaining\s+(?:session\s+)?time/i.test(actionText)) return snapshot;
  let timerIndent = -1;
  const maskTime = (line: string) => line.replace(/(남은 시간\s+)(\d{1,3}):(\d{2})/g, (match, prefix: string, minutes: string, seconds: string) =>
    Number(minutes) === 0 && Number(seconds) === 0 ? match : `${prefix}[시간]`);
  return snapshot.split("\n").map(line => {
    const indent = line.length - line.trimStart().length;
    if (indent <= timerIndent) timerIndent = -1;
    if (/^\s*- button ["'](?:clock(?:-circle)?\s*)?남은 시간\s+\d{1,3}:\d{2}["']/.test(line)) { timerIndent = indent; return maskTime(line); }
    return timerIndent >= 0 && /^\s*- text: ["']?남은 시간\s+\d{1,3}:\d{2}["']?\s*$/.test(line) ? maskTime(line) : line;
  }).join("\n");
};

export class AiTcRunner {
  private active?: Active;
  private starting = false;
  private recordingWrites: Promise<void> = Promise.resolve();
  private resultWrites = new Map<string, Promise<void>>();

  constructor(private deps: RunnerDeps) {}

  current(): AiTcRunState | null { return this.active ? structuredClone(this.active.state) : null; }

  async startReplay(runId: unknown, assisted = false): Promise<AiTcRunState> {
    const previous = this.active;
    if (!previous || previous.state.runId !== runId || previous.state.status !== "done") throw new Error("완료된 실행만 빠르게 재실행할 수 있습니다.");
    const usage = previous.state.usage;
    const previousRun = previous.state.endedAt && usage ? { elapsedMs: Date.parse(previous.state.endedAt) - Date.parse(previous.state.startedAt), userWaitMs: previous.state.userWaitMs, modelCalls: previous.state.budget.modelCalls, input: usage.input, output: usage.output, cachedInput: usage.cachedInput, cacheWrite: usage.cacheWrite, unknown: usage.unknown } : undefined;
    return this.startRecorded(previous.plan, previous.state.cases.map(item => item.recording ?? []), assisted, previousRun);
  }

  async startSavedReplay(raw: unknown, assisted = false): Promise<AiTcRunState> {
    const plan = planSchema.parse(raw) as AiTcRunPlan;
    const recordings = await this.loadRecordings(plan);
    return this.startRecorded(plan, recordings, assisted);
  }

  async savedNeeds(raw: unknown): Promise<Array<{ key: string; labels: string[] }>> {
    const plan = planSchema.parse(raw) as AiTcRunPlan;
    const recordings = await this.loadRecordings(plan);
    return plan.cases.map((item, index) => ({ key: item.key, labels: [...new Set(recordings[index]!.flatMap(step => step.type === "fill" || step.type === "select" ? [step.dataLabel] : []))] }));
  }

  private async loadRecordings(plan: AiTcRunPlan): Promise<RecordedStep[][]> {
    let recordings: RecordedStep[][];
    try {
      recordings = [];
      for (const item of plan.cases) {
        const file = path.join(this.deps.dataDir, "recordings", `${recordingKey({ ...plan, cases: [item] })}.json`);
        const saved = recordingSchema.parse(JSON.parse(await readFile(file, "utf8"))) as RecordedStep[][];
        if (saved.length !== 1) throw new Error("절차 개수 오류");
        recordings.push(saved[0]!);
      }
    }
    catch { throw new Error("일치하는 저장된 실행 절차가 없거나 읽을 수 없습니다."); }
    return recordings;
  }

  private async startRecorded(plan: AiTcRunPlan, recordings: RecordedStep[][], assisted: boolean, previousRun?: AiTcRunState["previousRun"]): Promise<AiTcRunState> {
    if (recordings.length !== plan.cases.length) throw new Error("저장된 실행 절차와 TC가 일치하지 않습니다.");
    for (const [index, steps] of recordings.entries()) {
      const expected = plan.cases[index]!.expected;
      if (!steps.length || steps.some(step => step.type === "manual" || (!assisted && step.type === "verify" && (!step.approved || !step.candidate))) || expected.some(item => !steps.some(step => step.type === "verify" && step.expected === item.id && (assisted || (step.approved && step.candidate))))) throw new Error(`${plan.cases[index]!.id}: 수동 동작 또는 승인되지 않은 검증 조건이 있어 재실행할 수 없습니다.`);
      for (const step of steps) if (step.type === "fill" || step.type === "select") {
        const matches = plan.cases[index]!.data.filter(item => item.label === step.dataLabel && item.value.trim());
        if (matches.length !== 1) throw new Error(`${plan.cases[index]!.id}: 데이터 항목 "${step.dataLabel}"에 값을 하나 입력하세요.`);
      }
    }
    return this.start(plan, structuredClone(recordings), assisted, previousRun);
  }

  async start(raw: unknown, replay?: RecordedStep[][], assisted = false, previousRun?: AiTcRunState["previousRun"]): Promise<AiTcRunState> {
    if (this.starting) throw new Error("실행을 시작하는 중입니다.");
    this.starting = true;
    try {
    const plan = planSchema.parse(raw) as AiTcRunPlan;
    if (this.active && ["running", "waiting", "error"].includes(this.active.state.status)) throw new Error("이미 실행 중입니다. 끝나거나 취소한 뒤 다시 실행하세요.");
    if (!hostAllowed(plan.startUrl, plan.allowedHosts)) throw new Error("시작 URL이 허용 도메인에 없습니다.");
    const toolFile = replay && !assisted ? "" : await this.deps.toolPath(plan.tool);
    if (!toolFile && (!replay || assisted)) throw new Error(`이 PC에서 ${plan.tool === "claude" ? "Claude Code" : "Codex"} CLI를 찾지 못했습니다.`);
    if (this.active) await this.discardVideo(this.active.state.runId);
    const runId = randomUUID();
    const dir = path.join(this.deps.dataDir, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${runId.slice(0, 8)}`);
    await mkdir(dir, { recursive: true });
    const state: AiTcRunState = {
      runId, status: "running", current: 0, url: plan.startUrl, outOfDomain: false, capturePaused: false,
      cases: plan.cases.map(item => ({
        key: item.key, id: item.id, scenarioId: item.scenarioId, pre: item.pre, steps: item.steps, title: item.title, sheet: item.key.split(":").slice(-2, -1)[0] ?? "", row: Number(item.key.split(":").pop()) || 0, actions: [], recording: [], timing: { observationMs: 0, modelMs: 0, browserMs: 0 }, usage: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0, measured: 0, unknown: 0 },
        expected: item.expected.map(expected => ({ ...expected, verdict: "pending", observation: "", basis: [], by: "system" })),
      })),
      budget: { actions: 0, modelCalls: 0, maxActions: AI_TC_RUN_LIMITS.actionsPerCase, maxModelCalls: AI_TC_RUN_LIMITS.modelCalls, maxMinutes: AI_TC_RUN_LIMITS.minutesPerCase },
      usage: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0, measured: 0, unknown: 0 },
      preparationUsage: plan.preparationUsage,
      previousRun,
      userWaitMs: 0,
      provider: plan.tool === "claude" ? "Claude CLI" : "Codex CLI", allowedHosts: plan.allowedHosts,
      viewport: { width: 1440, height: 900 }, capture: plan.capture, video: plan.video, startedAt: now(),
    };
    let abort = () => undefined as void;
    const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new Cancelled()); });
    aborted.catch(() => undefined);
    const run: Active = { state, plan, replay, assisted, dir, toolFile: toolFile ?? "", cancelled: false, captures: 0, waitMs: 0, popups: [], downloads: [], dialogs: [], aborted, abort };
    this.active = run;
    this.emit(run);
    void this.execute(run);
    return structuredClone(state);
    } finally { this.starting = false; }
  }

  /** 사용자 대기·오류에서 고른 조치. 다른 실행 ID나 대기 중이 아니면 무시한다. */
  decide(runId: unknown, decision: unknown, reply?: unknown): void {
    const run = this.active;
    const parsed = z.enum(["resume", "allow", "handoff", "block", "stop"]).parse(decision);
    if (!run || run.state.runId !== runId || !run.waiter) return;
    run.userReply = run.state.wait?.kind === "handoff" && parsed === "resume" ? z.string().max(2000).parse(reply ?? "").trim() : "";
    const waiter = run.waiter;
    run.waiter = undefined;
    waiter(parsed);
  }

  async browserEvent(runId: unknown, raw: unknown): Promise<void> {
    const event = z.discriminatedUnion("type", [
      z.object({ type: z.literal("click"), x: z.number().min(0).max(1440), y: z.number().min(0).max(900) }),
      z.object({ type: z.literal("wheel"), deltaY: z.number().min(-3000).max(3000) }),
      z.object({ type: z.literal("text"), text: z.string().max(10000) }),
      z.object({ type: z.literal("key"), key: z.string().max(100) }),
      z.object({ type: z.enum(["back", "forward", "reload"]) }),
    ]).parse(raw);
    const run = this.active;
    if (!run || run.state.runId !== runId || run.state.status !== "waiting" || !run.page || run.state.wait?.kind === "confirm") return;
    const page = run.page;
    if (event.type === "click") await page.mouse.click(event.x, event.y);
    else if (event.type === "wheel") await page.mouse.wheel(0, event.deltaY);
    else if (event.type === "text") await page.keyboard.insertText(event.text);
    else if (event.type === "key") await page.keyboard.press(event.key);
    else if (event.type === "back") await page.goBack({ waitUntil: "domcontentloaded" });
    else if (event.type === "forward") await page.goForward({ waitUntil: "domcontentloaded" });
    else await page.reload({ waitUntil: "domcontentloaded" });
  }

  /** 취소는 여러 번 불러도 안전하다. */
  async cancel(runId?: unknown): Promise<void> {
    const run = this.active;
    if (!run || (runId && run.state.runId !== runId) || run.cancelled || ["done", "cancelled"].includes(run.state.status)) return;
    run.cancelled = true;
    run.abort();
    run.model?.cancel();
    const waiter = run.waiter;
    run.waiter = undefined;
    waiter?.("stop");
    await this.closeBrowser(run);
  }

  /** 결과 화면에서 사용자가 바꾼 판정과 이유. 원래 판정은 original에 남긴다. */
  async review(raw: unknown): Promise<AiTcRunState | null> {
    const input = z.object({ runId: z.string(), caseKey: z.string(), expectedId: z.string(), verdict: z.enum(["pass", "fail", "blocked", "check", "pending", "na"]).nullable(), note: z.string().max(500) }).parse(raw);
    const run = this.active;
    if (!run || run.state.runId !== input.runId) return null;
    const expected = run.state.cases.find(item => item.key === input.caseKey)?.expected.find(item => item.id === input.expectedId);
    if (!expected || open(expected.verdict)) return this.current();
    if (input.verdict === null || input.verdict === expected.original) {
      if (expected.original) { expected.verdict = expected.original; expected.by = expected.originalBy ?? (expected.basis.length ? "ai" : "system"); delete expected.original; delete expected.originalBy; }
    } else {
      expected.original ??= expected.verdict as AiTcVerdict;
      if (expected.by !== "user") expected.originalBy = expected.by;
      expected.verdict = input.verdict;
      expected.by = "user";
    }
    expected.note = input.note || undefined;
    await this.save(run);
    this.emit(run);
    return this.current();
  }

  async approveAssertion(raw: unknown): Promise<AiTcRunState | null> {
    const input = z.object({ runId: z.string(), caseKey: z.string(), expectedId: z.string(), approved: z.boolean() }).strict().parse(raw);
    const run = this.active;
    if (!run || run.state.runId !== input.runId || !["done", "cancelled"].includes(run.state.status)) return null;
    const item = run.state.cases.find(entry => entry.key === input.caseKey);
    const steps = item?.recording?.filter(step => step.type === "verify" && step.expected === input.expectedId && step.candidate) ?? [];
    if (steps.length !== 1 || steps[0]!.type !== "verify") return null;
    steps[0].approved = input.approved;
    await this.save(run);
    await this.saveRecording(run);
    this.emit(run);
    return this.current();
  }

  /** 검토한 후보의 대상만 임시 적용한다. 재실행에 성공하기 전에는 저장하지 않는다. */
  async applyRepair(raw: unknown): Promise<AiTcRunState | null> {
    const input = z.object({ runId: z.string(), caseKey: z.string() }).strict().parse(raw);
    const run = this.active;
    if (!run || run.state.runId !== input.runId || run.state.status !== "done") return null;
    const item = run.state.cases.find(entry => entry.key === input.caseKey);
    const suggestion = item?.repairSuggestion;
    const current = suggestion && item?.recording?.[suggestion.index];
    const candidate = suggestion?.step;
    if (!item || !suggestion || !current || !candidate || !["click", "fill", "select"].includes(current.type) || current.type !== candidate.type || !("target" in current) || !("target" in candidate) || !candidate.target) throw new Error("같은 종류의 대상 변경 후보만 적용할 수 있습니다.");
    item.recording![suggestion.index] = { ...current, target: candidate.target } as RecordedStep;
    delete item.repairSuggestion;
    await this.save(run);
    this.emit(run);
    return this.current();
  }

  /** 결과 다운로드용: 상태·환경 이름·산출물 폴더. 실행 중이 아니어야 한다. */
  exportable(runId: unknown): { state: AiTcRunState; environment: string; dir: string } | null {
    const run = this.active;
    if (!run || run.state.runId !== runId || !["done", "cancelled"].includes(run.state.status)) return null;
    return { state: structuredClone(run.state), environment: run.plan.environmentLabel, dir: run.dir };
  }

  async capture(runId: unknown, captureId: unknown): Promise<string | null> {
    const run = this.active;
    const id = z.string().regex(/^cap-\d{1,4}$/).parse(captureId);
    if (!run || run.state.runId !== runId) return null;
    try { return `data:image/jpeg;base64,${(await readFile(path.join(run.dir, `${id}.jpg`))).toString("base64")}`; } catch { return null; }
  }

  async videoPath(runId: unknown): Promise<string | null> {
    const run = this.active;
    if (!run || run.state.runId !== runId || !["done", "cancelled"].includes(run.state.status)) return null;
    return run.page?.video()?.path().catch(() => null) ?? null;
  }

  async discardVideo(runId: unknown): Promise<void> {
    const run = this.active;
    if (run && run.state.runId === runId && ["done", "cancelled"].includes(run.state.status)) {
      await rm(path.join(run.dir, "video"), { recursive: true, force: true });
    }
  }

  async shutdown(): Promise<void> {
    const run = this.active;
    await this.cancel();
    if (run) await rm(path.join(run.dir, "video"), { recursive: true, force: true });
  }

  // ─── 실행 ───

  private emit(run: Active) { if (this.active === run) this.deps.emit(structuredClone(run.state)); }

  private alive(run: Active) { if (run.cancelled || this.active !== run) throw new Cancelled(); }

  private async execute(run: Active) {
    let finalReason = "";
    try {
      await this.launch(run);
      for (;;) {
        try { await this.loop(run); break; }
        catch (error) {
          if (error instanceof Cancelled || run.cancelled) throw new Cancelled();
          if (error instanceof BudgetError) { finalReason = error.message; break; }
          const retryable = error instanceof ModelError;
          run.state.status = "error";
          run.state.error = { message: (error as Error).message || "알 수 없는 오류", retryable };
          this.emit(run);
          const errorWaitStarted = Date.now();
          const decision = await new Promise<AiTcDecision>(resolve => { run.waiter = resolve; });
          run.state.userWaitMs! += Date.now() - errorWaitStarted;
          this.alive(run);
          if (decision === "resume" && retryable) { run.state.status = "running"; delete run.state.error; this.emit(run); continue; }
          finalReason = `실행 오류로 중단: ${run.state.error.message}`;
          break;
        }
      }
      this.finish(run, "done", finalReason || "실행이 끝나 검증하지 않음");
    } catch (error) {
      if (error instanceof Cancelled || run.cancelled) this.finish(run, "cancelled", "취소로 미실행");
      else { run.state.error = { message: (error as Error).message, retryable: false }; this.finish(run, "done", `실행 오류로 중단: ${(error as Error).message}`); }
    } finally {
      await this.closeBrowser(run);
      await this.save(run);
      if (run.state.status === "done") await this.saveRecording(run);
      this.emit(run);
    }
  }

  private finish(run: Active, status: "done" | "cancelled", reason: string) {
    for (const item of run.state.cases) {
      for (const expected of item.expected) if (open(expected.verdict)) Object.assign(expected, { verdict: "pending", observation: reason, by: "system" });
      if (!item.reason && item.expected.some(expected => expected.observation === reason)) item.reason = reason;
    }
    run.state.status = status;
    run.state.endedAt = now();
    delete run.state.wait;
    delete run.state.highlight;
  }

  private async launch(run: Active) {
    const browser = await chromium.launch({ headless: this.deps.headless ?? true, ...(this.deps.executablePath ? { executablePath: this.deps.executablePath } : {}) });
    run.browser = browser;
    this.alive(run);
    const context = await browser.newContext({
      viewport: run.state.viewport, acceptDownloads: false,
      ...(run.plan.video ? { recordVideo: { dir: path.join(run.dir, "video"), size: { width: 1280, height: 800 } } } : {}),
    });
    run.context = context;
    await context.addInitScript(`(() => {
      const messages = [];
      Object.assign(window, { __checklyAlerts: messages });
      const collect = (element) => {
        for (const node of [element, ...element.querySelectorAll('[role="alert"], [role="status"], [aria-live]')]) {
          if (!node.matches('[role="alert"], [role="status"], [aria-live]')) continue;
          const style = getComputedStyle(node);
          const text = node.innerText?.trim().replace(/\\s+/g, " ");
          if (text && text.length <= 300 && style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length && !messages.includes(text)) {
            messages.push(text);
            if (messages.length > 20) messages.shift();
          }
        }
      };
      new MutationObserver(records => {
        for (const record of records) {
          const element = record.target instanceof Element ? record.target : record.target.parentElement;
          const container = element?.closest('[role="alert"], [role="status"], [aria-live]');
          if (container) collect(container);
          for (const node of record.addedNodes) if (node instanceof Element) collect(node);
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    })()`);
    const page = await context.newPage();
    run.page = page;
    // 첫 페이지를 만든 뒤에 구독해야 그 페이지를 새 탭으로 세지 않는다.
    context.on("page", popup => { if (popup !== run.page) run.popups.push(popup); });
    page.on("download", download => { run.downloads.push(download.suggestedFilename()); void download.cancel().catch(() => undefined); });
    page.on("dialog", dialog => {
      run.dialogs.push(`${dialog.type()} "${dialog.message().slice(0, 200)}"`);
      // 확인 창은 닫아서(취소) 의도하지 않은 확정을 막는다. 알림은 확인한다.
      void (dialog.type() === "alert" ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    await page.goto(run.plan.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  private async closeBrowser(run: Active) {
    const browser = run.browser;
    run.browser = undefined;
    try { await run.context?.close(); } catch { /* 이미 닫힘 */ }
    try { await browser?.close(); } catch { /* 이미 닫힘 */ }
  }

  private async save(run: Active) {
    const previous = this.resultWrites.get(run.state.runId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const file = path.join(run.dir, "result.json");
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ ...run.state, environment: run.plan.environmentLabel }, null, 2));
        await rename(temp, file);
        delete run.state.saveError;
      } finally { await rm(temp, { force: true }); }
    }).catch(error => { run.state.saveError = `결과를 로컬에 저장하지 못했습니다: ${(error as Error).message}`; });
    this.resultWrites.set(run.state.runId, next);
    await next;
    if (this.resultWrites.get(run.state.runId) === next) this.resultWrites.delete(run.state.runId);
  }

  private async saveRecording(run: Active) {
    this.recordingWrites = this.recordingWrites.then(async () => {
      if (run.state.status !== "done") return;
      const dir = path.join(this.deps.dataDir, "recordings");
      await mkdir(dir, { recursive: true });
      for (const [index, item] of run.state.cases.entries()) {
        if (aggregate(item.expected.map(expected => expected.verdict)) !== "pass" || item.expected.some(expected => expected.by === "user" || expected.original !== undefined)) continue;
        const recordings = recordingSchema.parse([item.recording ?? []]);
        const file = path.join(dir, `${recordingKey({ ...run.plan, cases: [run.plan.cases[index]!] })}.json`);
        const temp = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temp, JSON.stringify(recordings, null, 2)); await rename(temp, file); }
        finally { await rm(temp, { force: true }); }
      }
    }).catch(error => { run.state.saveError = `실행 절차를 로컬에 저장하지 못했습니다: ${(error as Error).message}`; });
    await this.recordingWrites;
  }

  private async loop(run: Active) {
    for (let index = run.state.current; index < run.plan.cases.length; index++) {
      this.alive(run);
      run.state.current = index;
      const totalUsage = run.state.usage!;
      const totalTokens = totalUsage.input + totalUsage.output + (run.plan.tool === "claude" ? totalUsage.cachedInput + totalUsage.cacheWrite : 0);
      run.state.budget.tokenWarning = run.plan.tokenLimit && totalTokens >= run.plan.tokenLimit * 0.8 ? "전체 토큰 한도의 80% 이상 사용" : undefined;
      const result = run.state.cases[index]!;
      if (!result.expected.some(expected => open(expected.verdict))) continue;
      const blocker = this.blocker(run, index);
      if (blocker) {
        for (const expected of result.expected) if (open(expected.verdict)) Object.assign(expected, { verdict: "blocked", observation: blocker, by: "system", at: clock() });
        result.reason = blocker;
        this.emit(run);
        continue;
      }
      try { if (run.replay) await this.replayCase(run, index); else await this.runCase(run, index); }
      catch (error) {
        if (!(error instanceof CaseBudgetError)) throw error;
        this.close(result, "check", error.message);
        result.endedAt = now();
        this.emit(run);
      }
      await this.save(run);
    }
  }

  private async replayCase(run: Active, index: number) {
    const result = run.state.cases[index]!;
    const plan = run.plan.cases[index]!;
    result.startedAt = now();
    const startedAt = Date.now();
    run.waitMs = 0;
    run.state.budget.actions = 0;
    run.state.budget.caseStartedAt = result.startedAt;
    result.recording = structuredClone(run.replay![index]!);
    let assistedCalls = 0;
    for (const [stepIndex, step] of run.replay![index]!.entries()) {
      this.alive(run);
      if (run.state.budget.actions >= AI_TC_RUN_LIMITS.actionsPerCase) { this.close(result, "check", "재실행 동작 한도 초과"); break; }
      if (Date.now() - startedAt - run.waitMs > AI_TC_RUN_LIMITS.minutesPerCase * 60_000) { this.close(result, "check", "재실행 시간 한도 초과"); break; }
      let guarded = await this.guard(run, result);
      while (guarded === "again") guarded = await this.guard(run, result);
      if (guarded === "blocked") break;
      if (step.type === "manual") { this.close(result, "check", step.reason); break; }
      if (step.type === "verify") {
        const expected = result.expected.find(item => item.id === step.expected);
        if (!expected) { this.close(result, "check", "검증할 기대 결과가 없습니다"); break; }
        const dataDependent = step.candidate && plan.data.some(item => item.value.trim() && step.candidate!.text.includes(item.value));
        if (!step.approved || !step.candidate || dataDependent) {
          if (!run.assisted) { this.close(result, "check", dataDependent ? "검증 문구가 현재 입력값을 포함해 고정 조건으로 안전하게 판정할 수 없습니다" : "검증 조건이 승인되지 않았습니다"); break; }
          if (assistedCalls >= 3) { this.close(result, "check", "AI 보조 판정 한도 초과"); break; }
          const callsBefore = run.state.budget.modelCalls;
          const observation = await this.observe(run);
          const reply = await this.ask(run, plan, result, { ...observation, history: [], feedback: `재실행 중 ${step.expected}만 현재 화면으로 판정하라. 다른 동작은 수행하지 않는다.`, sharedContext: index > 0 }, 3 - assistedCalls);
          assistedCalls += run.state.budget.modelCalls - callsBefore;
          this.alive(run);
          const afterAi = await this.guard(run, result);
          if (afterAi !== "ok") { if (afterAi === "again") this.close(result, "check", "AI 판정 중 화면이 바뀌어 검증을 중단했습니다"); break; }
          if (run.page!.url() !== observation.url) { this.close(result, "check", "AI 판정 중 주소가 바뀌어 검증을 중단했습니다"); break; }
          const latest = await this.observe(run);
          this.alive(run);
          if (!latest.snapshot || latest.snapshot !== observation.snapshot) { this.close(result, "check", "AI 판정 중 화면 내용이 바뀌어 검증을 중단했습니다"); break; }
          if (reply.action.type !== "judge" || reply.action.expected !== step.expected) { this.close(result, "check", "AI가 현재 기대 결과를 판정하지 못했습니다"); break; }
          await this.perform(run, plan, result, reply.action);
          if (reply.action.verdict !== "pass") { this.close(result, "check", "앞선 검증 미통과로 재실행 중단"); break; }
          run.state.budget.actions++;
          this.emit(run);
          continue;
        }
        const observedUrl = run.page!.url();
        const locator = run.page!.getByText(step.candidate.text, { exact: true }).filter({ visible: true });
        let visible = true;
        try { await locator.first().waitFor({ state: "visible", timeout: 5000 }); }
        catch (error) { if (error instanceof errors.TimeoutError) visible = false; else throw error; }
        this.alive(run);
        const afterObservation = await this.guard(run, result);
        if (afterObservation !== "ok") { if (afterObservation === "again") this.close(result, "check", "화면이 바뀌어 검증을 중단했습니다"); break; }
        if (run.page!.url() !== observedUrl) { this.close(result, "check", "검증 중 주소가 바뀌어 결과를 판정하지 않았습니다"); break; }
        if (visible && await locator.count() !== 1) { this.close(result, "check", "같은 문구가 여러 곳에 표시되어 검증 대상을 확정할 수 없습니다"); break; }
        const captureId = await this.saveCapture(run);
        const observation = `문구 ${JSON.stringify(step.candidate.text)} ${visible ? "표시됨" : "표시되지 않음"}`;
        Object.assign(expected, { verdict: visible ? "pass" : "fail", observation, basis: [{ k: "텍스트", v: step.candidate.text }, { k: "URL", v: run.page!.url() }], by: "automation", at: clock(), ...(captureId ? { captureId } : {}) });
        this.log(run, result, { op: "판정", target: observation, result: `${step.expected} ${visible ? "Pass" : "Fail"}`, expected: step.expected, ...(captureId ? { captureId } : {}) });
        if (!visible) { this.close(result, "check", "앞선 검증 실패로 재실행 중단"); break; }
      } else {
        let action: AiAction;
        if (step.type === "fill" || step.type === "select") {
          const data = plan.data.find(item => item.label === step.dataLabel);
          if (!data) { this.close(result, "check", "재실행에 필요한 데이터가 없습니다"); break; }
          action = { type: step.type, target: step.target, value: data.value, expected: step.expected };
        } else action = step;
        const outcome = await this.perform(run, plan, result, action);
        this.alive(run);
        if (outcome.failed || outcome.stop) {
          if (run.assisted && outcome.failed && !(action.type === "click" && outcome.attempted) && assistedCalls < 3 && await this.guard(run, result) === "ok") {
            const callsBefore = run.state.budget.modelCalls;
            try {
              const observation = await this.observe(run);
              const reply = await this.ask(run, plan, result, { ...observation, history: [], feedback: `저장된 동작이 실패했다: ${outcome.text}. 현재 화면에서 수정할 동작 후보 하나를 제안하라. 후보는 실행되지 않는다.`, sharedContext: index > 0 }, 3 - assistedCalls, "repair");
              this.alive(run);
              const latest = await this.observe(run);
              this.alive(run);
              if (latest.url !== observation.url || !latest.snapshot || latest.snapshot !== observation.snapshot) throw new Error("AI 응답 중 화면이 바뀌어 수정 후보를 버렸습니다");
              const candidate = recordStep(reply.action, plan.data);
              result.repairSuggestion = { reason: outcome.text, index: stepIndex, step: candidate };
              this.log(run, result, { op: "요청", target: "AI 수정 후보 생성", result: "실행하지 않음 · 결과에서 확인", tone: "wait" });
            } catch (error) {
              this.alive(run);
              if (error instanceof BudgetError || error instanceof CaseBudgetError) throw error;
              this.log(run, result, { op: "요청", target: "AI 수정 후보 생성", result: (error as Error).message.slice(0, 200), tone: "wait" });
            } finally { assistedCalls += run.state.budget.modelCalls - callsBefore; }
          }
          this.close(result, "check", `재실행 중단: ${outcome.text}`); break;
        }
      }
      run.state.budget.actions++;
      this.emit(run);
    }
    result.endedAt = now();
    this.emit(run);
  }

  /** 선행으로 연결한 TC가 Pass가 아니면 Blocked 사유. 사용자가 이미 준비됨으로 확인한 선행은 건너뛴다. */
  private blocker(run: Active, index: number): string {
    const plan = run.plan.cases[index]!;
    for (const ref of plan.after) {
      if (plan.readyRefs.includes(ref)) continue;
      const parent = run.state.cases.find(item => item.id.toUpperCase() === ref.toUpperCase());
      if (!parent) continue;
      const verdict = aggregate(parent.expected.map(expected => expected.verdict));
      if (verdict !== "pass") return `선행 TC ${parent.id} ${VERDICT_LABEL[verdict]}`;
    }
    return "";
  }

  private log(run: Active, result: AiTcCaseResult, entry: Omit<AiTcActionLog, "seq" | "at">) {
    result.actions.push({ seq: result.actions.length + 1, at: clock(), ...entry });
  }

  private async runCase(run: Active, index: number) {
    const plan = run.plan.cases[index]!;
    const result = run.state.cases[index]!;
    const history: string[] = [];
    const caseText = [plan.title, plan.pre, ...plan.steps, ...plan.expected.map(item => item.text), ...plan.data.map(item => `${item.label} ${item.value}`)].join("\n");
    let feedback = "";
    let strikes = 0;
    let staleObservations = 0;
    let pendingFills: Array<Extract<AiAction, { type: "fill" }>> = [];
    let batchUrl = "";
    let batchState = "";
    const startedAt = Date.now();
    run.waitMs = 0;
    result.startedAt ??= now();
    run.state.budget.actions = 0;
    run.state.budget.caseStartedAt = new Date(startedAt).toISOString();
    this.log(run, result, { op: "관찰", target: `${run.page!.url()} · TC 시작`, result: "" });
    for (;;) {
      this.alive(run);
      const pending = result.expected.filter(expected => open(expected.verdict));
      if (!pending.length) break;
      for (const expected of result.expected) if (open(expected.verdict)) expected.verdict = expected === pending[0] ? "running" : "pending";
      if (run.state.budget.actions >= AI_TC_RUN_LIMITS.actionsPerCase) { this.close(result, "check", "동작 한도 초과로 판정하지 못함"); break; }
      if (Date.now() - startedAt - run.waitMs > AI_TC_RUN_LIMITS.minutesPerCase * 60_000) { this.close(result, "check", "시간 한도 초과로 판정하지 못함"); break; }
      if (run.state.budget.modelCalls >= AI_TC_RUN_LIMITS.modelCalls) { this.close(result, "check", "모델 호출 예산 초과"); throw new BudgetError("모델 호출 예산 초과로 실행을 멈춤"); }
      this.emit(run);
      const guard = await this.guard(run, result);
      if (guard === "blocked") break;
      if (guard === "again") { pendingFills = []; result.recording?.push({ type: "manual", reason: "사용자가 브라우저 상태를 직접 변경했습니다" }); continue; }
      let phaseStarted = Date.now();
      const observation = await this.observe(run);
      result.timing!.observationMs += Date.now() - phaseStarted;
      phaseStarted = Date.now();
      let reply: Awaited<ReturnType<AiTcRunner["ask"]>>;
      if (pendingFills.length && observation.url === batchUrl && stableSessionTimer(batchSnapshot(observation.snapshot), caseText, JSON.stringify(pendingFills[0])) === batchState) reply = { action: pendingFills.shift()! };
      else {
        pendingFills = [];
        try { reply = await this.ask(run, plan, result, { ...observation, history, feedback, sharedContext: index > 0 }); }
        finally { result.timing!.modelMs += Date.now() - phaseStarted; }
        feedback = "";
        this.alive(run);
        const afterAi = await this.guard(run, result);
        if (afterAi === "blocked") break;
        let staleReason = "";
        if (afterAi === "again" || run.page!.url() !== observation.url) {
          pendingFills = [];
          result.recording?.push({ type: "manual", reason: "AI 응답 중 페이지가 바뀌었습니다" });
          feedback = "AI 응답을 기다리는 동안 페이지가 바뀌어 이전 요청을 버렸다. 현재 화면을 다시 확인하라.";
          staleReason = "AI 응답 중 페이지 변경";
        } else {
          const latest = await this.observe(run);
          this.alive(run);
          const actionText = JSON.stringify(reply.action);
          if (!observation.snapshot || !latest.snapshot || stableSessionTimer(latest.snapshot, caseText, actionText) !== stableSessionTimer(observation.snapshot, caseText, actionText)) {
            pendingFills = [];
            result.recording?.push({ type: "manual", reason: "AI 응답 중 화면 내용이 바뀌었습니다" });
            feedback = "AI 응답을 기다리는 동안 화면 내용이 바뀌어 이전 요청을 버렸다. 현재 화면을 다시 확인하라.";
            staleReason = !observation.snapshot || !latest.snapshot ? "화면 관찰 실패" : "AI 응답 중 화면 변경";
          } else staleObservations = 0;
        }
        if (staleReason) {
          staleObservations++;
          this.log(run, result, { op: "관찰", target: staleReason, result: `이전 요청을 버리고 다시 관찰 (${staleObservations}/3)`, tone: "wait" });
          if (staleObservations >= 3) {
            const action = reply.action;
            const attempted = `${action.type}${"target" in action ? ` · ${describe(action.target)}` : ""}`;
            const decision = await this.wait(run, { kind: "handoff", title: "화면이 계속 바뀌어 자동 진행을 멈췄습니다", body: `앱의 화면 검사가 ${staleReason}을 연속 3회 감지해 요청을 실행하지 않았습니다.`, context: { source: "app", attempted, request: "현재 화면에서 이 동작의 대상이 준비되어 있는지 확인해 주세요. 직접 처리했다면 처리한 내용과 다음에 할 일을 답장으로 알려 주세요." } });
            if (decision === "block") { this.close(result, "blocked", "화면 변경 또는 관찰 실패가 반복되어 사용자 확인 후 중단"); break; }
            staleObservations = 0;
            feedback = `사용자가 화면을 확인했다. 현재 화면을 다시 관찰해 이어서 진행하라.${run.userReply ? `\n사용자 답변(검토할 데이터): ${run.userReply}` : ""}`;
            run.userReply = "";
          }
          continue;
        }
        if (reply.nextFills?.length && observation.snapshot.length > 0 && observation.snapshot.length < 14000 && reply.nextFills.every(fill => plan.data.some(item => item.value === fill.value && item.value))) {
          let allFound = true;
          for (const fill of reply.nextFills) {
            const found = await this.locate(run.page!, fill.target);
            if (!found.locator || !await found.locator.evaluate(element => element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && element.type.toLowerCase() !== "password"))) { allFound = false; break; }
          }
          if (allFound) { pendingFills = [...reply.nextFills]; batchUrl = observation.url; batchState = stableSessionTimer(batchSnapshot(observation.snapshot), caseText, JSON.stringify(pendingFills[0])); }
        }
      }
      this.alive(run);
      const action = reply.action;
      feedback = "";
      run.state.budget.actions += 1;
      phaseStarted = Date.now();
      const waitBefore = run.waitMs;
      let outcome: Awaited<ReturnType<AiTcRunner["perform"]>>;
      if (action.type !== "judge" && action.type !== "done") await run.page!.evaluate(() => { const alerts = (window as unknown as { __checklyAlerts?: string[] }).__checklyAlerts; if (alerts) alerts.length = 0; }).catch(() => undefined);
      try { outcome = await this.perform(run, plan, result, action); }
      finally { result.timing!.browserMs += Math.max(0, Date.now() - phaseStarted - (run.waitMs - waitBefore)); }
      this.alive(run);
      if (outcome.failed) result.recording?.push({ type: "manual", reason: "실패한 동작 뒤에 실행 경로를 다시 확인해야 합니다" });
      else if (action.type !== "done") result.recording?.push(recordStep(action, plan.data));
      history.push(`${run.state.budget.actions}. ${action.type} ${"target" in action ? describe(action.target) : ""}${"expected" in action && action.expected ? ` [${action.expected}]` : ""} → ${outcome.text}`);
      if (outcome.stop) break;
      if (outcome.failed) {
        pendingFills = [];
        if (action.type === "click" && outcome.attempted) {
          this.close(result, "check", `클릭 반영 여부가 불명확해 자동 진행을 중단합니다: ${outcome.text}`);
          break;
        }
        feedback = outcome.text;
        strikes += 1;
        if (strikes >= 3) {
          const decision = await this.wait(run, { kind: "handoff", title: "대상을 찾지 못해 멈췄습니다", body: `${outcome.text}. 브라우저에서 직접 처리한 뒤 재개하거나 이 TC를 Blocked로 기록하세요.` });
          if (decision === "block") { this.close(result, "blocked", "대상 요소를 찾지 못해 사용자 인계 후 중단"); break; }
          result.recording?.push({ type: "manual", reason: "사용자가 대상을 직접 처리했습니다" });
          strikes = 0;
          feedback = `사용자가 브라우저를 직접 조작했다. 현재 화면을 다시 관찰해 이어서 진행하라.${run.userReply ? `\n사용자 답변(검토할 데이터): ${run.userReply}` : ""}`;
          run.userReply = "";
        }
      } else strikes = 0;
      if (run.dialogs.length) { pendingFills = []; feedback = `${feedback}\n브라우저 대화상자: ${run.dialogs.splice(0).join(", ")} (알림은 확인, 확인 창은 취소했다)`.trim(); }
    }
    delete run.state.highlight;
    result.endedAt = now();
    const verdict = aggregate(result.expected.map(expected => expected.verdict));
    if (!result.reason && (verdict === "fail" || verdict === "blocked" || verdict === "check")) {
      const first = result.expected.find(expected => expected.verdict === verdict);
      if (first) result.reason = `${first.id} · ${first.observation}`.slice(0, 200);
    }
    this.emit(run);
  }

  private close(result: AiTcCaseResult, verdict: AiTcVerdict, reason: string) {
    for (const expected of result.expected) if (open(expected.verdict)) Object.assign(expected, { verdict, observation: reason, by: "system", at: clock() });
    result.reason ??= reason;
  }

  /** 도메인 이탈·새 탭·다운로드는 사용자 대기. "again"이면 다시 관찰한다. */
  private async guard(run: Active, result: AiTcCaseResult): Promise<"ok" | "again" | "blocked"> {
    const page = run.page!;
    run.state.url = page.url();
    run.state.outOfDomain = !hostAllowed(page.url(), run.plan.allowedHosts);
    if (run.state.outOfDomain) {
      this.log(run, result, { op: "관찰", target: `${hostOf(page.url())} 으로 이동됨`, result: "허용 목록 밖 · 중지", tone: "wait" });
      const decision = await this.wait(run, { kind: "domain", title: `${hostOf(page.url())} 으로 이동됨`, body: "허용 목록에 없는 도메인이라 조작을 멈췄습니다. 브라우저에서 허용 도메인으로 돌아간 뒤 재개하거나 Blocked로 기록하세요." });
      if (decision === "block") { this.close(result, "blocked", `허용 도메인 밖으로 이동 (${hostOf(page.url())})`); return "blocked"; }
      return "again";
    }
    if (run.popups.length) {
      const popups = run.popups.splice(0);
      const urls = popups.map(popup => popup.url()).join(", ");
      this.log(run, result, { op: "관찰", target: `새 탭 ${popups.length}개 열림`, result: "자동 전환 미지원 · 중지", tone: "wait" });
      const decision = await this.wait(run, { kind: "popup", title: "새 탭이 열렸습니다", body: `${urls || "새 탭"} — 새 탭으로는 자동 전환하지 않습니다. 필요한 확인을 직접 하고 원래 탭에서 재개하거나 Blocked로 기록하세요.` });
      if (decision === "block") { this.close(result, "blocked", "새 탭에서 진행이 필요해 중단"); return "blocked"; }
      return "again";
    }
    if (run.downloads.length) {
      const names = run.downloads.splice(0).join(", ");
      const decision = await this.wait(run, { kind: "download", title: "다운로드 요청을 막았습니다", body: `${names} — 다운로드는 저장하지 않습니다. 재개하거나 Blocked로 기록하세요.` });
      if (decision === "block") { this.close(result, "blocked", "다운로드 확인이 필요해 중단"); return "blocked"; }
      return "again";
    }
    return "ok";
  }

  private async observe(run: Active) {
    const page = run.page!;
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
    const alerts = await page.evaluate(() => (window as unknown as { __checklyAlerts?: string[] }).__checklyAlerts ?? []).catch(() => [] as string[]);
    const title = await page.title().catch(() => "");
    let screenshot: string | undefined;
    if (!run.state.capturePaused) {
      const image = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => undefined);
      if (image) {
        this.deps.preview(run.state.runId, `data:image/jpeg;base64,${image.toString("base64")}`);
        if (run.plan.imageToAi ?? run.plan.capture) {
          await writeFile(path.join(run.dir, "screen.jpg"), image);
          screenshot = "screen.jpg";
        }
      }
    }
    run.state.url = page.url();
    return { url: page.url(), title, snapshot: maskSnapshot(snapshot), screenshot, alerts };
  }

  private async ask(run: Active, plan: AiTcRunPlan["cases"][number], result: AiTcCaseResult, observed: { url: string; title: string; snapshot: string; screenshot?: string; alerts?: string[]; history: string[]; feedback: string; sharedContext: boolean }, maxAttempts = 3, phaseHint?: "repair") {
    let feedback = observed.feedback;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (run.state.budget.modelCalls >= AI_TC_RUN_LIMITS.modelCalls) throw new BudgetError("모델 호출 예산 초과로 실행을 멈춤");
      if (run.plan.tokenLimit) {
        const usage = run.state.usage!;
        if (usage.unknown) throw new BudgetError("토큰 사용량을 확인할 수 없어 예산 적용을 중단합니다");
        const total = usage.input + usage.output + (run.plan.tool === "claude" ? usage.cachedInput + usage.cacheWrite : 0);
        if (total >= run.plan.tokenLimit) throw new BudgetError("토큰 예산에 도달해 다음 모델 호출을 중단합니다");
      }
      if (run.plan.tokenLimitPerCase) {
        const usage = result.usage!;
        if (usage.unknown) throw new CaseBudgetError("이 TC의 토큰 사용량을 확인할 수 없어 중단합니다");
        const total = usage.input + usage.output + (run.plan.tool === "claude" ? usage.cachedInput + usage.cacheWrite : 0);
        if (total >= run.plan.tokenLimitPerCase) throw new CaseBudgetError("이 TC의 토큰 예산에 도달해 중단합니다");
      }
      const prompt = buildPrompt({
        tc: { id: plan.id, pre: plan.pre, steps: plan.steps, data: plan.data, files: plan.files.map(file => file.name), expected: result.expected.map(item => ({ id: item.id, text: item.text, verdict: open(item.verdict) ? undefined : VERDICT_LABEL[item.verdict] })) },
        url: observed.url, title: observed.title, snapshot: observed.snapshot, alerts: observed.alerts, history: observed.history, feedback, screenshot: observed.screenshot, sharedContext: observed.sharedContext,
      });
      run.state.budget.modelCalls += 1;
      // 응답 없이 취소되거나 프로세스가 강제 종료되어도 미확인 호출로 남긴다.
      run.state.usage!.unknown++;
      result.usage!.unknown++;
      this.emit(run);
      let callUsage: ModelUsage | undefined;
      let settled = false;
      const call = this.deps.ask({ tool: run.plan.tool, file: run.toolFile, cwd: run.dir, prompt, ...(observed.screenshot ? { screenshot: path.join(run.dir, observed.screenshot) } : {}), onUsage: usage => {
        if (settled || this.active !== run || run.cancelled || !["running", "waiting"].includes(run.state.status)) return;
        callUsage = usage;
        for (const total of [run.state.usage!, result.usage!]) {
          if (usage) { if (run.plan.tool !== "claude" || (usage.cachedInput !== undefined && usage.cacheWrite !== undefined)) total.unknown--; total.input += usage.input; total.output += usage.output; total.cachedInput += usage.cachedInput ?? 0; total.cacheWrite += usage.cacheWrite ?? 0; total.measured++; }
        }
        const count = (value: NonNullable<AiTcRunState["usage"]>) => value.input + value.output + (run.plan.tool === "claude" ? value.cachedInput + value.cacheWrite : 0);
        const warnings: string[] = [];
        if (run.plan.tokenLimit && count(run.state.usage!) >= run.plan.tokenLimit * 0.8) warnings.push("전체 토큰 한도의 80% 이상 사용");
        if (run.plan.tokenLimitPerCase && count(result.usage!) >= run.plan.tokenLimitPerCase * 0.8) warnings.push("현재 TC 토큰 한도의 80% 이상 사용");
        run.state.budget.tokenWarning = warnings.join(" · ") || undefined;
        this.emit(run);
      } });
      run.model = call;
      const recordPhase = (phase: "explore" | "judge" | "retry" | "repair") => {
        settled = true;
        const phases = run.state.usageByPhase ??= {};
        const total = phases[phase] ??= { input: 0, output: 0, cachedInput: 0, cacheWrite: 0, measured: 0, unknown: 0 };
        if (!callUsage || (run.plan.tool === "claude" && (callUsage.cachedInput === undefined || callUsage.cacheWrite === undefined))) total.unknown++;
        if (callUsage) { total.input += callUsage.input; total.output += callUsage.output; total.cachedInput += callUsage.cachedInput ?? 0; total.cacheWrite += callUsage.cacheWrite ?? 0; total.measured++; }
      };
      let text: string;
      try { text = await Promise.race([call.promise, run.aborted]); }
      catch (error) { recordPhase(phaseHint ?? "retry"); this.alive(run); throw new ModelError((error as Error).message); }
      finally { if (run.model === call) run.model = undefined; }
      const parsed = parseReply(text);
      recordPhase(phaseHint ?? (parsed.reply ? (parsed.reply.action.type === "judge" ? "judge" : "explore") : "retry"));
      this.alive(run);
      if (parsed.reply) return parsed.reply;
      feedback = `직전 응답이 형식에 맞지 않았다(${parsed.error}). 규칙의 JSON 하나로만 다시 답하라.`;
    }
    throw new ModelError("AI 응답 형식 오류가 반복되었습니다");
  }

  private async wait(run: Active, wait: AiTcWait): Promise<AiTcDecision> {
    this.alive(run);
    run.state.status = "waiting";
    run.state.wait = wait;
    if (wait.kind === "login") run.state.capturePaused = true;
    for (const item of run.state.cases[run.state.current]!.expected) if (item.verdict === "running") item.verdict = "waiting";
    const decisionPromise = new Promise<AiTcDecision>(resolve => { run.waiter = resolve; });
    this.emit(run);
    const waitStarted = Date.now();
    let capturing = false;
    const preview = async () => {
      if (capturing || !run.page || run.page.isClosed()) return;
      capturing = true;
      try {
        const image = await run.page.screenshot({ type: "jpeg", quality: 60 });
        this.deps.preview(run.state.runId, `data:image/jpeg;base64,${image.toString("base64")}`);
        run.state.url = run.page.url();
        this.emit(run);
      } catch { /* 페이지 전환·종료 중 */ } finally { capturing = false; }
    };
    void preview();
    const timer = setInterval(() => void preview(), 500);
    let decision: AiTcDecision;
    try { decision = await decisionPromise; }
    finally { clearInterval(timer); const elapsed = Date.now() - waitStarted; run.waitMs += elapsed; run.state.userWaitMs! += elapsed; }
    this.alive(run);
    if (decision === "stop") { await this.cancel(run.state.runId); throw new Cancelled(); }
    run.state.status = "running";
    run.state.capturePaused = false;
    delete run.state.wait;
    for (const item of run.state.cases[run.state.current]!.expected) if (item.verdict === "waiting") item.verdict = "running";
    this.emit(run);
    return decision;
  }

  /** 대상 하나를 찾는다. 여러 개면 nth가 없을 때 고르지 않고 이유를 돌려준다. */
  private async locate(page: Page, target: NonNullable<Extract<AiAction, { type: "click" }>["target"]>, wait = false): Promise<{ locator?: Locator; error?: string }> {
    const base = target.role
      ? page.getByRole(target.role as Parameters<Page["getByRole"]>[0], target.name ? { name: target.name } : {})
      : target.label ? page.getByLabel(target.label) : target.placeholder ? page.getByPlaceholder(target.placeholder) : page.getByText(target.text!);
    let locator = base.filter({ visible: true });
    if (wait) {
      try { await locator.first().waitFor({ state: "visible", timeout: 5000 }); }
      catch (error) { if (!(error instanceof errors.TimeoutError)) throw error; }
    }
    let count = await locator.count();
    if (count > 1 && target.nth === undefined && target.role && target.name) {
      const exact = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name, exact: true }).filter({ visible: true });
      if ((await exact.count()) === 1) { locator = exact; count = 1; }
    }
    if (!count) return { error: `"${describe(target)}" 대상을 찾지 못함` };
    if (count > 1 && target.nth === undefined) return { error: `"${describe(target)}" 대상이 ${count}개 일치함. nth로 지정하거나 범위를 좁혀라` };
    if (target.nth !== undefined && target.nth >= count) return { error: `"${describe(target)}" 대상은 ${count}개뿐임` };
    return { locator: locator.nth(target.nth ?? 0) };
  }

  private async highlight(run: Active, locator: Locator, label: string) {
    const box = await locator.boundingBox().catch(() => null);
    const { width, height } = run.state.viewport;
    run.state.highlight = box ? { x: (box.x / width) * 100, y: (box.y / height) * 100, w: (box.width / width) * 100, h: (box.height / height) * 100, label } : undefined;
    this.emit(run);
  }

  private async settle(page: Page) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  private async perform(run: Active, plan: AiTcRunPlan["cases"][number], result: AiTcCaseResult, action: AiAction): Promise<{ text: string; failed?: boolean; stop?: boolean; attempted?: boolean }> {
    const page = run.page!;
    const expectedId = "expected" in action ? action.expected : undefined;
    const record = (op: AiTcActionOp, target: string, text: string, tone?: AiTcActionLog["tone"], captureId?: string) =>
      this.log(run, result, { op, target, result: text, ...(tone ? { tone } : {}), ...(expectedId ? { expected: expectedId } : {}), ...(captureId ? { captureId } : {}) });
    switch (action.type) {
      case "judge": {
        const expected = result.expected.find(item => item.id === action.expected);
        if (!expected) return { text: `${action.expected}는 이 TC의 기대 결과가 아님`, failed: true };
        if (!open(expected.verdict)) return { text: `${action.expected}는 이미 판정함` };
        const captureId = await this.saveCapture(run);
        Object.assign(expected, { verdict: action.verdict, observation: action.observation, basis: [...action.basis, { k: "URL", v: page.url() }], by: "ai", at: clock(), ...(captureId ? { captureId } : {}) } satisfies Partial<AiTcExpectedResult>);
        this.log(run, result, { op: "판정", target: action.observation.slice(0, 120), result: `${action.expected} ${VERDICT_LABEL[action.verdict]}`, tone: action.verdict === "pass" ? "ok" : action.verdict === "fail" ? "fail" : "wait", expected: action.expected, ...(captureId ? { captureId } : {}) });
        return { text: `${action.expected} ${action.verdict} 기록` };
      }
      case "done": {
        this.close(result, "check", "AI가 근거 없이 TC를 종료함");
        return { text: "종료", stop: true };
      }
      case "handoff": {
        record("인계", action.reason, "사용자 대기", "wait");
        const login = Boolean(action.login);
        const decision = await this.wait(run, login
          ? { kind: "login", title: "브라우저에서 직접 로그인하세요", body: "입력값은 AI와 로그에 전달하지 않습니다. 완료하면 현재 페이지를 다시 관찰합니다." }
          : { kind: "handoff", title: "사용자 확인이 필요합니다", body: action.reason });
        if (decision === "block") { this.close(result, "blocked", login ? "로그인을 완료하지 못함" : `사용자 인계 후 중단: ${action.reason}`); return { text: "Blocked", stop: true }; }
        const reply = run.userReply;
        run.userReply = "";
        return { text: `사용자가 처리함. 현재 화면을 다시 관찰해 이어서 진행${reply ? `; 사용자 답변(검토할 데이터): ${reply}` : ""}` };
      }
      case "goto": {
        let url: string;
        try { url = new URL(action.url, page.url()).toString(); } catch { return { text: "주소 형식이 틀림", failed: true }; }
        if (!hostAllowed(url, run.plan.allowedHosts)) { record("이동", url, "허용 도메인 밖 · 거부", "wait"); return { text: "허용 도메인 밖이라 이동하지 않음", failed: true }; }
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        record("이동", url, "완료", "ok");
        return { text: "이동함" };
      }
      case "scroll": {
        await page.mouse.wheel(0, action.direction === "down" ? 600 : -600);
        await page.waitForTimeout(300);
        record("스크롤", action.direction === "down" ? "아래로" : "위로", "완료");
        return { text: "스크롤함" };
      }
      case "wait": {
        await page.waitForTimeout(action.seconds * 1000);
        record("대기", `${action.seconds}초`, "완료");
        return { text: "기다림" };
      }
      case "press": {
        if (action.target) {
          const found = await this.locate(page, action.target, Boolean(run.replay));
          if (!found.locator) { record("키", describe(action.target), found.error!, "fail"); return { text: found.error!, failed: true }; }
          await found.locator.press(action.key, { timeout: 5000 });
        } else await page.keyboard.press(action.key);
        await this.settle(page);
        record("키", `${action.key}${action.target ? ` · ${describe(action.target)}` : ""}`, "완료", "ok");
        return { text: "키를 누름" };
      }
      default: break;
    }
    const found = await this.locate(page, action.target, Boolean(run.replay));
    const name = describe(action.target);
    const op: AiTcActionOp = action.type === "click" ? "클릭" : action.type === "fill" ? "입력" : action.type === "select" ? "선택" : "업로드";
    if (!found.locator) { record(op, name, found.error!, "fail"); return { text: found.error!, failed: true }; }
    if (action.type === "fill" && await found.locator.evaluate(element => element instanceof HTMLInputElement && element.type.toLowerCase() === "password")) { record(op, name, "비밀번호 입력 거부", "wait"); return { text: "비밀번호는 직접 입력해야 합니다", failed: true }; }
    await this.highlight(run, found.locator, name);
    try {
      if (action.type === "click") {
        await found.locator.click({ timeout: 5000 });
      } else if (action.type === "fill") {
        await found.locator.fill(action.value, { timeout: 5000 });
      } else if (action.type === "select") {
        const tag = await found.locator.evaluate(element => element.tagName).catch(() => "");
        if (tag === "SELECT") await found.locator.selectOption({ label: action.value }, { timeout: 5000 }).catch(() => found.locator!.selectOption(action.value, { timeout: 5000 }));
        else { await found.locator.click({ timeout: 5000 }); await page.getByRole("option", { name: action.value }).or(page.getByText(action.value, { exact: true })).first().click({ timeout: 5000 }); }
      } else {
        const file = plan.files.find(item => item.name === action.file || item.label === action.file);
        const filePath = file && this.deps.resolveFile(file.token);
        if (!filePath) { record(op, name, "사용자가 고른 파일이 아님 · 거부", "fail"); return { text: `업로드할 수 있는 파일이 아님: ${action.file}`, failed: true }; }
        const tag = await found.locator.evaluate(element => element.tagName).catch(() => "");
        if (tag === "INPUT") await found.locator.setInputFiles(filePath, { timeout: 5000 });
        else {
          const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), found.locator.click({ timeout: 5000 })]);
          await chooser.setFiles(filePath);
        }
      }
    } catch (error) {
      this.alive(run);
      const message = (error as Error).message.split("\n")[0]!.slice(0, 200);
      record(op, name, "실패", "fail");
      return { text: `${op} 실패: ${message}${action.type === "click" ? " · 반영 여부를 직접 확인하세요" : ""}`, failed: true, attempted: action.type === "click" };
    }
    // 재실행의 다음 대상·검증은 조건이 충족될 때까지 기다린다. AI 탐색은 관찰 전에 기존 안정화 대기를 유지한다.
    if (!(run.replay && action.type === "fill")) await this.settle(page);
    record(op, action.type === "fill" ? `${name} ← "${action.value.slice(0, 60)}"` : action.type === "upload" ? `${name} ← ${action.file}` : name, "완료", "ok");
    return { text: "완료" };
  }

  private async saveCapture(run: Active): Promise<string | undefined> {
    if (!run.plan.capture || run.state.capturePaused || !run.page) return undefined;
    const image = await run.page.screenshot({ type: "jpeg", quality: 70 }).catch(() => undefined);
    if (!image) return undefined;
    run.captures += 1;
    const id = `cap-${String(run.captures).padStart(2, "0")}`;
    await writeFile(path.join(run.dir, `${id}.jpg`), image).catch(() => undefined);
    return id;
  }
}
