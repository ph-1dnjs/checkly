import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readdir, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { ApiAiTerminal, ApiAiTerminalEvent, ApiAiTool } from "../shared/workspace";
import { cliEnv, describeAiTools } from "./ai-cli";
import type { ApiWorkspace } from "./workspace";

/**
 * The in-app AI terminal: the user's own Claude Code or Codex runs interactively in a pseudo terminal
 * (node-pty), so the CLI shows its own conversation, history and prompts. Checkly only
 * - starts it in the project's AI folder (the one place it may write) with the backend folders to read,
 *   telling it to read the guide file;
 * - watches the result file it writes and lets the screen check and save it;
 * - remembers which session to resume after a restart (never the conversation itself).
 */

/** The part of a node-pty process this service uses (a fake in tests). */
export type TerminalProcess = {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};
export type SpawnTerminal = (file: string, args: string[], options: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }) => TerminalProcess;

/**
 * What is kept on disk to resume after a restart. `saved` marks the result the user already saved from,
 * so a restart does not offer it again (saving twice would add another suite).
 */
type SavedSession = { tool: ApiAiTool; environmentId: string; sessionId?: string; startedAt: string; saved?: { modifiedAt: string; scenarioId?: string } };
type Session = SavedSession & {
  process?: TerminalProcess;
  /** Recent output, replayed when the screen opens the terminal again. */
  buffer: string;
  watcher?: FSWatcher;
  resultTimer?: NodeJS.Timeout;
};

const maxBuffer = 400_000;
const sizeSchema = z.object({ cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(300) }).strict();
const startSchema = z.object({
  scope: z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict(),
  size: sizeSchema,
}).strict();
const markerSchema = z.object({ modifiedAt: z.string().max(40), scenarioId: z.string().max(1000).optional() }).strict();
const savedSchema = z.object({ tool: z.enum(["claude", "codex"]), environmentId: z.string().uuid(), sessionId: z.string().uuid().optional(), startedAt: z.string(), saved: markerSchema.optional() });

/** The first prompt: the guide is long, so the CLI is pointed at its file. */
export const openingPrompt = (guideFile: string) => `Checkly 시나리오 작성 가이드 파일 ${guideFile} 을 읽고 그대로 따르세요. 먼저 무엇을 테스트할지 저에게 물어보세요.`;

/**
 * Claude Code: files only (no commands, user settings, hooks or MCP), writing allowed in the AI folder
 * without asking, and the backend folders readable but never editable.
 */
export function claudeTerminalArgs(input: { sessionId: string; resume: boolean; backendFolders: string[]; prompt?: string }): string[] {
  return [
    ...(input.resume ? ["--resume", input.sessionId] : ["--session-id", input.sessionId]),
    "--restricted", "--strict-mcp-config", "--tools", "Read", "Grep", "Glob", "Write", "Edit",
    ...input.backendFolders.flatMap(folder => ["--add-dir", folder]),
    // Permission paths starting with // are absolute; Edit rules cover every file-editing tool (Write included).
    "--disallowedTools", ...input.backendFolders.map(folder => `Edit(/${folder}/**)`),
    // A single-value option last, so the prompt is not taken as another folder or tool.
    "--permission-mode", "acceptEdits",
    ...(input.prompt ? [input.prompt] : []),
  ];
}

/**
 * Codex: the workspace-write sandbox writes only in its working folder (the AI folder) and reads
 * everywhere, so the backend folders are named in the guide but never added as writable.
 * Each project has its own working folder, so `resume --last` finds that project's session.
 */
export function codexTerminalArgs(input: { resume: boolean; prompt?: string }): string[] {
  const policy = ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"];
  return input.resume ? ["resume", "--last", ...policy] : [...policy, ...(input.prompt ? [input.prompt] : [])];
}

/**
 * Whether Claude Code recorded the session (it does once the conversation really starts). A session that
 * ended at the folder trust question has nothing to resume, so 이어서 열기 starts it again with the guide.
 */
export async function claudeSessionExists(sessionId: string, root = path.join(homedir(), ".claude", "projects")): Promise<boolean> {
  const folders = await readdir(root).catch(() => [] as string[]);
  for (const folder of folders) {
    if (await access(path.join(root, folder, `${sessionId}.jsonl`)).then(() => true, () => false)) return true;
  }
  return false;
}

let helperChecked = false;
/** node-pty's macOS spawn-helper must be executable; installs that skip package scripts leave it without the bit. */
async function ensureSpawnHelper(): Promise<void> {
  if (helperChecked || process.platform !== "darwin") return;
  helperChecked = true;
  const root = path.dirname(require.resolve("node-pty/package.json")).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  for (const dir of [path.join(root, "prebuilds", `${process.platform}-${process.arch}`), path.join(root, "build", "Release")]) {
    const helper = path.join(dir, "spawn-helper");
    const info = await stat(helper).catch(() => null);
    if (info && !(info.mode & 0o111)) await chmod(helper, 0o755).catch(() => undefined);
  }
}

const defaultSpawn: SpawnTerminal = (file, args, options) => {
  // Loaded on first use: a native module, only needed when the terminal opens.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pty = require("node-pty") as typeof import("node-pty");
  return pty.spawn(file, args, { name: "xterm-256color", ...options });
};

export class AiTerminalService {
  private sessions = new Map<string, Session>();
  private loaded = new Map<string, Promise<void>>();

  constructor(
    private workspace: ApiWorkspace,
    /** Delivers terminal output, exits and result changes to the screens. */
    private emit: (event: ApiAiTerminalEvent) => void,
    private spawn: SpawnTerminal = defaultSpawn,
    private tools: () => Promise<Array<{ tool: ApiAiTool; path: string }>> = describeAiTools,
    private environment: () => Promise<NodeJS.ProcessEnv> = cliEnv,
    private hasClaudeSession: (sessionId: string) => Promise<boolean> = sessionId => claudeSessionExists(sessionId),
  ) {}

  /** The saved session of a project (after a restart it has no process yet). */
  private async load(projectId: string): Promise<Session | undefined> {
    let pending = this.loaded.get(projectId);
    if (!pending) {
      pending = this.workspace.readAiTerminal(projectId).then(value => {
        const saved = savedSchema.safeParse(value);
        if (saved.success && !this.sessions.has(projectId)) this.sessions.set(projectId, { ...saved.data, buffer: "" });
      }).catch(() => undefined);
      this.loaded.set(projectId, pending);
    }
    await pending;
    return this.sessions.get(projectId);
  }

  private pointer(session: Session): SavedSession {
    return { tool: session.tool, environmentId: session.environmentId, startedAt: session.startedAt, ...(session.sessionId ? { sessionId: session.sessionId } : {}), ...(session.saved ? { saved: session.saved } : {}) };
  }

  private view(session: Session | undefined): ApiAiTerminal | null {
    if (!session) return null;
    return { tool: session.tool, environmentId: session.environmentId, running: Boolean(session.process), buffer: session.buffer, ...(session.saved ? { saved: { ...session.saved } } : {}) };
  }

  async get(rawProjectId: unknown): Promise<ApiAiTerminal | null> {
    return this.view(await this.load(z.string().uuid().parse(rawProjectId)));
  }

  /** Opens a new session with the project's settings in the requested environment. */
  async start(raw: unknown): Promise<ApiAiTerminal> {
    const { scope, size } = startSchema.parse(raw);
    const existing = await this.load(scope.projectId);
    if (existing) throw new Error("이미 대화가 있습니다. 새로 시작하려면 대화를 초기화하세요");
    const settings = await this.workspace.getAiChatSettings(scope.projectId);
    const installed = await this.tools();
    const chosen = installed.find(item => item.tool === settings.tool) ?? installed[0];
    if (!chosen) throw new Error("이 PC에서 Claude Code나 Codex CLI를 찾지 못했습니다");
    const setup = await this.workspace.aiTerminalSetup(scope);
    const session: Session = { tool: chosen.tool, environmentId: scope.environmentId, startedAt: new Date().toISOString(), buffer: "", ...(chosen.tool === "claude" ? { sessionId: randomUUID() } : {}) };
    const prompt = openingPrompt(setup.guideFile);
    const args = session.tool === "claude"
      ? claudeTerminalArgs({ sessionId: session.sessionId!, resume: false, backendFolders: setup.backendFolders, prompt })
      : codexTerminalArgs({ resume: false, prompt });
    await this.workspace.writeAiTerminal(scope.projectId, this.pointer(session));
    this.sessions.set(scope.projectId, session);
    try { await this.run(scope.projectId, session, chosen.path, args, setup.cwd, size); }
    catch (error) {
      // Nothing started: leave no session behind.
      this.sessions.delete(scope.projectId);
      await this.workspace.removeAiTerminal(scope.projectId).catch(() => undefined);
      throw new Error(`AI 터미널을 열지 못했습니다: ${(error as Error).message}`);
    }
    return this.view(session)!;
  }

  /** Reopens the saved session (after a restart or after the CLI exited); the CLI shows the old conversation. */
  async resume(raw: unknown): Promise<ApiAiTerminal> {
    const { scope, size } = startSchema.parse(raw);
    const session = await this.load(scope.projectId);
    if (!session) throw new Error("이어갈 대화가 없습니다. 대화를 시작하세요");
    if (session.process) return this.view(session)!;
    const tool = (await this.tools()).find(item => item.tool === session.tool);
    if (!tool) throw new Error(`이 대화를 시작한 ${session.tool === "claude" ? "Claude Code" : "Codex"}를 찾지 못했습니다. 대화를 초기화하세요`);
    const setup = await this.workspace.aiTerminalSetup({ projectId: scope.projectId, environmentId: session.environmentId }, true);
    // Claude keeps nothing for a session that ended before its first message: start it again instead.
    const resumable = session.tool !== "claude" || await this.hasClaudeSession(session.sessionId!);
    const args = session.tool === "claude"
      ? claudeTerminalArgs({ sessionId: session.sessionId!, resume: resumable, backendFolders: setup.backendFolders, ...(resumable ? {} : { prompt: openingPrompt(setup.guideFile) }) })
      : codexTerminalArgs({ resume: true });
    await this.run(scope.projectId, session, tool.path, args, setup.cwd, size);
    return this.view(session)!;
  }

  private async run(projectId: string, session: Session, file: string, args: string[], cwd: string, size: { cols: number; rows: number }) {
    await mkdir(cwd, { recursive: true });
    await ensureSpawnHelper();
    // cliEnv already drops ELECTRON_RUN_AS_NODE and adds the login shell PATH.
    const env: NodeJS.ProcessEnv = { ...await this.environment(), TERM: "xterm-256color", COLORTERM: "truecolor" };
    const child = this.spawn(file, args, { cwd, cols: size.cols, rows: size.rows, env });
    session.process = child;
    child.onData(data => {
      session.buffer = (session.buffer + data).slice(-maxBuffer);
      this.emit({ type: "data", projectId, data });
    });
    child.onExit(({ exitCode }) => {
      if (session.process !== child) return;
      session.process = undefined;
      // Said in the terminal too, so the last screen is not mistaken for a frozen CLI.
      const note = `\r\n\x1b[90m— ${session.tool === "claude" ? "Claude" : "Codex"}가 종료되었습니다. 이어서 열기로 다시 열거나 대화를 초기화하세요 —\x1b[0m\r\n`;
      session.buffer = (session.buffer + note).slice(-maxBuffer);
      this.emit({ type: "data", projectId, data: note });
      this.emit({ type: "exit", projectId, exitCode });
    });
    this.watchResult(projectId, session);
  }

  /** Every save of the result file is announced (debounced) so the screen checks it. */
  private watchResult(projectId: string, session: Session) {
    session.watcher?.close();
    const file = this.workspace.aiTerminalResultFile(projectId);
    try {
      session.watcher = watch(path.dirname(file), (_event, name) => {
        if (name && name.toString() !== path.basename(file)) return;
        clearTimeout(session.resultTimer);
        session.resultTimer = setTimeout(() => this.emit({ type: "result", projectId }), 300);
      });
    } catch { /* The screen can still check on demand. */ }
  }

  async markSaved(rawProjectId: unknown, rawSaved: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const saved = markerSchema.parse(rawSaved);
    const session = await this.load(projectId);
    if (!session) return;
    session.saved = saved;
    await this.workspace.writeAiTerminal(projectId, this.pointer(session));
  }

  write(rawProjectId: unknown, rawData: unknown): void {
    const session = this.sessions.get(z.string().uuid().parse(rawProjectId));
    session?.process?.write(z.string().max(100_000).parse(rawData));
  }

  resize(rawProjectId: unknown, rawSize: unknown): void {
    const { cols, rows } = sizeSchema.parse(rawSize);
    const session = this.sessions.get(z.string().uuid().parse(rawProjectId));
    try { session?.process?.resize(cols, rows); } catch { /* Exited meanwhile. */ }
  }

  /** Ends the session: the CLI stops, the resume pointer and the last result go away. Saved scenarios stay. */
  async clear(rawProjectId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const session = await this.load(projectId);
    this.stop(session);
    this.sessions.delete(projectId);
    await this.workspace.removeAiTerminal(projectId);
    await this.workspace.removeAiTerminalResult(projectId);
  }

  private stop(session: Session | undefined) {
    if (!session) return;
    const child = session.process;
    session.process = undefined;
    session.watcher?.close();
    clearTimeout(session.resultTimer);
    try { child?.kill(); } catch { /* Already gone. */ }
  }

  /** Before deleting a project. */
  async forget(rawProjectId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    this.stop(this.sessions.get(projectId));
    this.sessions.delete(projectId);
    this.loaded.delete(projectId);
  }

  /** On quit: CLIs started here must not outlive the app. */
  stopAll(): void {
    for (const session of this.sessions.values()) this.stop(session);
  }
}
