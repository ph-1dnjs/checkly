import { randomUUID } from "node:crypto";
import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ApiAiQuick, ApiAiQuickEvent, ApiAiTool } from "../shared/workspace";
import { problemReport } from "../shared/ai-problem-report";
import { cliEnv, describeAiTools } from "./ai-cli";
import { claudeFilePolicy } from "./ai-terminal";
import { scenarioRequest } from "./ai-context";
import type { ApiWorkspace } from "./workspace";

/**
 * 바로 만들기: for people who do not want a conversation. The user's Claude Code or Codex runs headless
 * (`claude -p` / `codex exec`) with the guide and one request, writes the result file without asking,
 * and Checkly checks it; problems go back to the same session on their own (twice at most).
 * The screen sees only the progress line, the AI's last answer and the checked result. Nothing is
 * kept on disk but the result file: after a restart it starts over.
 */

export type QuickSpawn = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;

type Session = Omit<ApiAiQuick, "check" | "saved"> & {
  check?: ApiAiQuick["check"];
  saved?: ApiAiQuick["saved"];
  /** Claude's session id (chosen here) or Codex's thread id (reported by the CLI). */
  sessionId?: string;
  /** Started from a saved scenario (AI에게 요청): a turn that saves nothing is an answer, not a failure. */
  about?: boolean;
  /** Whether the CLI recorded the session, so the next request resumes it. */
  started: boolean;
  child?: ChildProcessWithoutNullStreams;
};

/** Said when the AI ended without a usable result; the screen shows what to do next. */
export const notMade = "AI가 시나리오를 만들지 못했습니다";

/** How many times Checkly's problems are sent back on their own before the user sees them. */
export const maxAutoFixes = 2;
const requestSchema = z.string().trim().min(1, "만들 내용을 적어 주세요").max(4000, "요청은 4000자 이하로 적어 주세요");
const startSchema = z.object({
  scope: z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict(),
  request: z.string().trim().max(4000, "요청은 4000자 이하로 적어 주세요"),
  about: z.object({ scenarioId: z.string().min(1).max(1000), failures: z.array(z.string().max(500)).max(50).optional(), response: z.string().max(4000).optional() }).strict().optional(),
}).strict().refine(value => value.request || value.about?.failures?.length, { message: "요청할 내용을 적어 주세요", path: ["request"] });
const markerSchema = z.object({ modifiedAt: z.string().max(40), scenarioId: z.string().max(1000).optional() }).strict();

export const quickOpening = (guideFile: string, request: string) =>
  `Checkly 시나리오 작성 가이드 파일 ${guideFile} 을 읽고 그대로 따르세요.\n\n${request}`;
/** A new request: written straight away, without questions. */
export const quickCreate = (request: string) =>
  `질문하지 말고 바로 작성해 결과 파일에 저장한 뒤, 만든 내용과 직접 정한 점을 짧게 알려 주세요.\n\n요청:\n${request}`;

export const quickRevision = (request: string) =>
  `이어서 요청:\n${request}\n\n질문이면 결과 파일은 그대로 두고 답만 하세요. 고쳐야 하면 되묻지 말고 고친 전체 결과를 같은 결과 파일에 다시 저장한 뒤, 바꾼 점을 짧게 알려 주세요.`;

/** Claude Code without its screen: the prompt comes on stdin, events come as JSON lines. */
export function claudeQuickArgs(input: { sessionId: string; resume: boolean; backendFolders: string[] }): string[] {
  return ["-p", "--output-format", "stream-json", "--verbose", ...(input.resume ? ["--resume", input.sessionId] : ["--session-id", input.sessionId]), ...claudeFilePolicy(input.backendFolders)];
}

/** Codex without its screen: writes only in its working folder; `exec resume` takes the sandbox as a setting. */
export function codexQuickArgs(input: { threadId?: string }): string[] {
  return input.threadId
    ? ["exec", "resume", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', input.threadId, "-"]
    : ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"];
}

const short = (text: string, length = 60) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** What one JSON line from the CLI means for the screen. */
export type QuickEvent = { progress?: string; note?: string; sessionId?: string; error?: string };
export function readQuickEvent(tool: ApiAiTool, line: string): QuickEvent {
  let event: Record<string, any>;
  try { event = JSON.parse(line); } catch { return {}; }
  if (!event || typeof event !== "object") return {};
  if (tool === "claude") {
    if (event.type === "assistant") {
      const parts: Array<Record<string, any>> = Array.isArray(event.message?.content) ? event.message.content : [];
      const tool = [...parts].reverse().find(part => part.type === "tool_use");
      if (tool) {
        const input = tool.input ?? {};
        if (tool.name === "Read") return { progress: `읽는 중: ${path.basename(String(input.file_path ?? ""))}` };
        if (tool.name === "Grep" || tool.name === "Glob") return { progress: `찾는 중: ${short(String(input.pattern ?? ""))}` };
        if (tool.name === "Write" || tool.name === "Edit") return { progress: "결과 저장 중" };
        return { progress: `${tool.name} 사용 중` };
      }
      return parts.some(part => part.type === "text") ? { progress: "정리하는 중" } : {};
    }
    if (event.type === "result") {
      const text = typeof event.result === "string" ? event.result : "";
      return event.is_error ? { error: text || "AI가 작업을 마치지 못했습니다" } : { note: text };
    }
    return {};
  }
  if (event.type === "thread.started" && typeof event.thread_id === "string") return { sessionId: event.thread_id };
  const item = event.item ?? {};
  if (event.type === "item.started" && item.type === "command_execution") {
    // Codex wraps commands in the shell ("/bin/zsh -lc '…'"); show only the command.
    const command = String(item.command ?? "").replace(/^\S*sh -lc ['"]?/, "").replace(/['"]$/, "");
    return { progress: `확인 중: ${short(command)}` };
  }
  if (item.type === "file_change") return { progress: "결과 저장 중" };
  if (event.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") return { note: item.text };
  if (event.type === "item.started" && item.type === "reasoning") return { progress: "생각하는 중" };
  if (event.type === "turn.failed") return { error: String(event.error?.message ?? "AI가 작업을 마치지 못했습니다") };
  if (event.type === "error" && typeof event.message === "string") return { error: event.message };
  return {};
}

export class AiQuickService {
  private sessions = new Map<string, Session>();

  constructor(
    private workspace: ApiWorkspace,
    /** Every change of a project's 바로 만들기, for the screens. */
    private emit: (event: ApiAiQuickEvent) => void,
    private spawn: QuickSpawn = (file, args, options) => spawnChild(file, args, { ...options, stdio: "pipe" }),
    private tools: () => Promise<Array<{ tool: ApiAiTool; path: string }>> = describeAiTools,
    private environment: () => Promise<NodeJS.ProcessEnv> = cliEnv,
  ) {}

  private view(session: Session | undefined): ApiAiQuick | null {
    if (!session) return null;
    const { sessionId: _id, started: _started, child: _child, about: _about, ...rest } = session;
    return { ...rest, turns: rest.turns.map(turn => ({ ...turn })) };
  }

  private changed(projectId: string) { this.emit({ projectId, quick: this.view(this.sessions.get(projectId)) }); }

  async get(rawProjectId: unknown): Promise<ApiAiQuick | null> { return this.view(this.sessions.get(z.string().uuid().parse(rawProjectId))); }

  /** A new 바로 만들기 in the requested environment; the previous one (not running) is replaced. */
  async start(raw: unknown): Promise<ApiAiQuick> {
    const { scope, request, about } = startSchema.parse(raw);
    if (this.sessions.get(scope.projectId)?.status === "running") throw new Error("이미 만들고 있습니다. 끝나거나 중단한 뒤 다시 시도하세요");
    const settings = await this.workspace.getAiChatSettings(scope.projectId);
    const installed = await this.tools();
    const chosen = installed.find(item => item.tool === settings.tool) ?? installed[0];
    if (!chosen) throw new Error("이 PC에서 Claude Code나 Codex CLI를 찾지 못했습니다");
    const target = about ? await this.workspace.aiFixScenario(scope.projectId, about.scenarioId) : null;
    const setup = await this.workspace.aiTerminalSetup(scope, false, "quick");
    const prompt = quickOpening(setup.guideFile, target && about
      ? scenarioRequest({ ...target, ...(about.failures?.length ? { failures: about.failures } : {}), ...(about.response ? { response: this.workspace.aiMask(scope.projectId, about.response) } : {}), ...(request ? { message: request } : {}) })
      : quickCreate(request));
    const session: Session = {
      tool: chosen.tool, environmentId: scope.environmentId, status: "running", turns: [{ request: target ? `‘${target.name}’${about?.failures?.length ? " 고치기" : "에 대해"}${request ? ` · ${request}` : ""}` : request, note: "" }],
      ...(target ? { about: true } : {}), progress: "시작하는 중", fixes: 0, started: false,
      ...(chosen.tool === "claude" ? { sessionId: randomUUID() } : {}),
    };
    this.sessions.set(scope.projectId, session);
    void this.work(scope.projectId, session, chosen.path, setup.cwd, setup.backendFolders, prompt);
    return this.view(session)!;
  }

  /** 수정 요청: the same AI session gets the request and saves the whole result again. */
  async revise(rawProjectId: unknown, rawRequest: unknown): Promise<ApiAiQuick> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const request = requestSchema.parse(rawRequest);
    const session = this.sessions.get(projectId);
    if (!session) throw new Error("먼저 만들기를 하세요");
    if (session.status === "running") throw new Error("아직 만들고 있습니다");
    if (!session.started) throw new Error("이어서 고칠 AI 대화가 없습니다. 새로 만드세요");
    const tool = (await this.tools()).find(item => item.tool === session.tool);
    if (!tool) throw new Error(`${session.tool === "claude" ? "Claude Code" : "Codex"}를 찾지 못했습니다. 새로 만드세요`);
    const setup = await this.workspace.aiTerminalSetup({ projectId, environmentId: session.environmentId }, true, "quick");
    Object.assign(session, { status: "running", progress: "시작하는 중", fixes: 0, error: undefined });
    session.turns.push({ request, note: "" });
    this.changed(projectId);
    void this.work(projectId, session, tool.path, setup.cwd, setup.backendFolders, quickRevision(request));
    return this.view(session)!;
  }

  /** Stopped or replaced meanwhile (a function, so the status is read again after each await). */
  private left(projectId: string, session: Session): boolean { return this.sessions.get(projectId) !== session || session.status === "stopped"; }

  /** Runs the AI, checks its result and sends problems back on their own until clean or out of tries. */
  private async work(projectId: string, session: Session, file: string, cwd: string, backendFolders: string[], prompt: string) {
    let next = prompt;
    for (;;) {
      const outcome = await this.runOnce(projectId, session, file, cwd, backendFolders, next);
      if (this.left(projectId, session)) return;
      if (outcome.error) { this.finish(projectId, session, "failed", outcome.error); return; }
      let check: ApiAiQuick["check"] | null = null;
      try { check = await this.workspace.checkAiTerminalResult({ projectId, environmentId: session.environmentId }, "quick"); }
      // A result file without any scenario: the AI could not make one (it says why in its answer).
      catch { this.finish(projectId, session, "failed", notMade); return; }
      if (this.left(projectId, session)) return;
      if (!check) { if (session.about) this.finish(projectId, session, "done"); else this.finish(projectId, session, "failed", notMade); return; }
      session.check = check;
      const report = problemReport(check.result);
      if (!report || session.fixes >= maxAutoFixes) { this.finish(projectId, session, "done"); return; }
      session.fixes += 1;
      session.progress = `검사에서 나온 문제를 고치는 중 (${session.fixes}/${maxAutoFixes})`;
      this.changed(projectId);
      next = report;
    }
  }

  private finish(projectId: string, session: Session, status: "done" | "failed", error?: string) {
    session.status = status;
    session.progress = "";
    if (error) session.error = error; else delete session.error;
    this.changed(projectId);
  }

  /** One CLI run; resolves when it exits (never rejects). */
  private async runOnce(projectId: string, session: Session, file: string, cwd: string, backendFolders: string[], prompt: string): Promise<{ error?: string }> {
    const args = session.tool === "claude"
      ? claudeQuickArgs({ sessionId: session.sessionId!, resume: session.started, backendFolders })
      : codexQuickArgs(session.started && session.sessionId ? { threadId: session.sessionId } : {});
    let child: ChildProcessWithoutNullStreams;
    try {
      await mkdir(cwd, { recursive: true });
      const env = await this.environment();
      // 중단 may come before the CLI starts.
      if (this.left(projectId, session)) return {};
      child = this.spawn(file, args, { cwd, env });
    } catch (error) { return { error: `AI를 실행하지 못했습니다: ${(error as Error).message}` }; }
    session.child = child;
    return new Promise(resolve => {
      let pending = "";
      let stderr = "";
      let failure = "";
      const line = (text: string) => {
        if (!text.trim()) return;
        const event = readQuickEvent(session.tool, text);
        if (event.sessionId && session.tool === "codex") session.sessionId = event.sessionId;
        if (event.error) failure = event.error;
        if (event.note !== undefined) session.turns[session.turns.length - 1]!.note = event.note;
        if (event.progress && session.child === child) session.progress = event.progress;
        // Claude records the session as soon as it answers; Codex once it names the thread.
        if (session.tool === "claude" || session.sessionId) session.started = true;
        if (event.progress || event.note !== undefined) this.changed(projectId);
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(line);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
      let settled = false;
      const done = (result: { error?: string }) => {
        if (settled) return;
        settled = true;
        if (session.child === child) session.child = undefined;
        resolve(result);
      };
      child.on("error", error => done({ error: `AI를 실행하지 못했습니다: ${error.message}` }));
      child.on("close", code => {
        line(pending);
        if (failure) done({ error: failure });
        else if (code !== 0) done({ error: stderr.trim().split("\n").slice(-3).join("\n") || `AI가 종료 코드 ${code}로 끝났습니다` });
        else done({});
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);
    });
  }

  async markSaved(rawProjectId: unknown, rawSaved: unknown): Promise<void> {
    const session = this.sessions.get(z.string().uuid().parse(rawProjectId));
    if (session) session.saved = markerSchema.parse(rawSaved);
  }

  /** 중단: the AI stops; what it already saved stays checkable. */
  async stop(rawProjectId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const session = this.sessions.get(projectId);
    if (session?.status !== "running") return;
    this.kill(session);
    session.status = "stopped";
    session.progress = "";
    this.changed(projectId);
  }

  /** 새로 만들기: the AI stops and the last result goes away. Saved scenarios stay. */
  async clear(rawProjectId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    this.kill(this.sessions.get(projectId));
    this.sessions.delete(projectId);
    await this.workspace.removeAiTerminalResult(projectId, "quick");
    this.changed(projectId);
  }

  private kill(session: Session | undefined) {
    const child = session?.child;
    if (!session || !child) return;
    session.child = undefined;
    try { child.kill(); } catch { /* Already gone. */ }
  }

  /** Before deleting a project. */
  forget(rawProjectId: unknown): void {
    const projectId = z.string().uuid().parse(rawProjectId);
    this.kill(this.sessions.get(projectId));
    this.sessions.delete(projectId);
  }

  /** On quit: CLIs started here must not outlive the app. */
  stopAll(): void { for (const session of this.sessions.values()) this.kill(session); }
}
