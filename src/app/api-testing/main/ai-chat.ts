import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiAiChat, ApiAiChatMessage, ApiAiImportResult, ApiAiTool } from "../shared/workspace";
import { problemReport } from "../shared/ai-problem-report";
import { describeAiTools, runAiTurn, type AiTurn } from "./ai-cli";
import { yamlBlocks } from "./ai-context";
import type { ApiWorkspace } from "./workspace";

/** How many times Checkly sends check problems back on its own before handing over to the user. */
export const maxAutoFixes = 2;

/** The project's one conversation and the private state needed to continue its CLI session. */
type StoredChat = Omit<ApiAiChat, "running"> & {
  /** Claude chooses a session ID up front; Codex supplies one during its first turn. */
  cliSessionId: string; started: boolean; cwd: string; readDirs: string[];
  /** Kept until a CLI session exists, so a failed first turn can be retried with the guide. */
  guide?: string;
};

type ProjectOperation = {
  chatId?: string;
  controller: AbortController;
  state?: NonNullable<ApiAiChat["running"]>;
  done: Promise<void>;
  resolve: () => void;
};

const startSchema = z.object({
  scope: z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict(),
}).strict();
const toolNames: Record<ApiAiTool, string> = { claude: "Claude", codex: "Codex" };
const newSessionId = (tool: ApiAiTool) => tool === "claude" ? randomUUID() : "";
const messageSchema = z.string().trim().min(1, "메시지를 입력하세요").max(20_000);
const busyMessage = "AI 대화를 처리하는 중입니다. 끝난 뒤 다시 시도하거나 응답을 중단하세요";
const openingPrompt = "이제 사용자와 대화를 시작합니다. 위 진행 순서 1번대로 먼저 질문하세요.";

/** One chat per project; clearing it lets the next start open a new Claude Code or Codex session. */
export class AiChatService {
  private chats = new Map<string, Promise<StoredChat | null>>();
  /** Reserved before the first await and held through the final disk write. */
  private operations = new Map<string, ProjectOperation>();
  private writes = new Map<string, Promise<void>>();

  constructor(
    private workspace: ApiWorkspace,
    private runTurn: (turn: AiTurn) => Promise<string> = runAiTurn,
    /** Installed AI CLIs, preferred first. */
    private installedTools: () => Promise<ApiAiTool[]> = async () => (await describeAiTools()).map(item => item.tool),
  ) {}

  /**
   * The conversation itself lives in memory (and in the CLI's own session); only what is needed
   * to continue that session is on disk. After a restart the chat resumes with a note instead of
   * the old messages. A session that never started has nothing to resume and is dropped.
   */
  private load(projectId: string): Promise<StoredChat | null> {
    let pending = this.chats.get(projectId);
    if (!pending) {
      const loading = this.workspace.readAiChat(projectId).then((value): StoredChat | null => {
        const saved = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<StoredChat> : null;
        if (!saved?.id || !saved.started || !saved.cliSessionId || !saved.cwd || !saved.environmentId) return null;
        const at = saved.updatedAt ?? new Date().toISOString();
        const tool = saved.tool ?? "claude";
        return {
          id: saved.id, title: saved.title ?? "AI 대화", environmentId: saved.environmentId, createdAt: saved.createdAt ?? at, updatedAt: at,
          tool, cliSessionId: saved.cliSessionId, started: true, cwd: saved.cwd, readDirs: saved.readDirs ?? [],
          messages: [{ id: randomUUID(), role: "checkly", at, text: `${toolNames[tool]}와의 이전 대화에 이어서 요청할 수 있습니다. 지난 메시지는 표시되지 않습니다.` }],
        };
      });
      loading.catch(() => { if (this.chats.get(projectId) === loading) this.chats.delete(projectId); });
      this.chats.set(projectId, pending = loading);
    }
    return pending;
  }

  /** Saves only the session pointer (no messages, results or guide). */
  private persist(projectId: string, chat: StoredChat): Promise<void> {
    const { messages: _messages, guide: _guide, ...pointer } = chat;
    // Freeze it now rather than letting a later queued write observe a newer state.
    const snapshot = structuredClone(pointer);
    const next = (this.writes.get(projectId) ?? Promise.resolve()).then(() => this.workspace.writeAiChat(projectId, snapshot));
    this.writes.set(projectId, next.catch(() => undefined));
    return next;
  }

  private reserve(projectId: string, chatId?: string, message = busyMessage): ProjectOperation {
    if (this.operations.has(projectId)) throw new Error(message);
    let resolve!: () => void;
    const done = new Promise<void>(finish => { resolve = finish; });
    const operation: ProjectOperation = { chatId, controller: new AbortController(), done, resolve };
    this.operations.set(projectId, operation);
    return operation;
  }

  private release(projectId: string, operation: ProjectOperation): void {
    if (this.operations.get(projectId) === operation) this.operations.delete(projectId);
    operation.resolve();
  }

  private async find(projectId: string, chatId: string): Promise<StoredChat> {
    const chat = await this.load(projectId);
    if (!chat || chat.id !== chatId) throw new Error("대화를 찾을 수 없습니다");
    return chat;
  }

  private view(projectId: string, chat: StoredChat): ApiAiChat {
    const { cliSessionId: _session, started: _started, cwd: _cwd, readDirs: _dirs, guide: _guide, ...shown } = chat;
    const operation = this.operations.get(projectId);
    const running = operation?.chatId === chat.id ? operation.state : undefined;
    return { ...structuredClone(shown), ...(running ? { running: { ...running, tools: [...running.tools] } } : {}) };
  }

  async get(rawProjectId: unknown): Promise<ApiAiChat | null> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chat = await this.load(projectId);
    return chat ? this.view(projectId, chat) : null;
  }

  private async prepare(request: z.infer<typeof startSchema>): Promise<StoredChat> {
    const { projectId, environmentId } = request.scope;
    const settings = await this.workspace.getAiChatSettings(projectId);
    const installed = await this.installedTools();
    const tool = settings.tool && installed.includes(settings.tool) ? settings.tool : installed[0];
    if (!tool) throw new Error("이 PC에서 Claude Code나 Codex CLI를 찾지 못했습니다");
    const setup = await this.workspace.aiChatSetup({ scope: request.scope });
    const now = new Date().toISOString();
    return {
      id: randomUUID(), title: "새 대화", environmentId, createdAt: now, updatedAt: now, tool,
      messages: [{ id: randomUUID(), role: "checkly", at: now, text: `가이드를 ${toolNames[tool]}에 전달했습니다 · API ${setup.apiCount}개 · 백엔드 폴더 ${setup.folderCount}개` }],
      cliSessionId: newSessionId(tool), started: false, cwd: setup.cwd, readDirs: setup.readDirs, guide: setup.prompt,
    };
  }

  /** Starts only when the project has no chat; otherwise returns the conversation already saved. */
  async start(raw: unknown): Promise<ApiAiChat> {
    const request = startSchema.parse(raw);
    const projectId = request.scope.projectId;
    const operation = this.reserve(projectId);
    let began = false;
    try {
      const existing = await this.load(projectId);
      if (existing) return this.view(projectId, existing);
      const chat = await this.prepare(request);
      await this.persist(projectId, chat);
      this.chats.set(projectId, Promise.resolve(chat));
      this.begin(projectId, chat, openingPrompt, operation);
      began = true;
      return this.view(projectId, chat);
    } finally { if (!began) this.release(projectId, operation); }
  }

  /**
   * Ends the current conversation and goes back to before 대화 시작, so the AI can be chosen again.
   * Saved scenarios and suites stay; the old CLI session is simply no longer used.
   */
  async clear(rawProjectId: unknown, rawChatId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chatId = z.string().parse(rawChatId);
    const operation = this.reserve(projectId, chatId);
    try {
      await this.find(projectId, chatId);
      await this.writes.get(projectId);
      await this.workspace.removeAiChat(projectId);
      this.chats.set(projectId, Promise.resolve(null));
    } finally { this.release(projectId, operation); }
  }

  async send(rawProjectId: unknown, rawChatId: unknown, rawText: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chatId = z.string().parse(rawChatId);
    const text = messageSchema.parse(rawText);
    const operation = this.reserve(projectId, chatId);
    operation.state = { phase: "answering", text: "", tools: [] };
    let began = false;
    try {
      const chat = structuredClone(await this.find(projectId, chatId));
      if (!chat.messages.some(message => message.role === "user")) chat.title = text.replace(/\s+/g, " ").slice(0, 40);
      this.add(chat, { role: "user", text });
      await this.persist(projectId, chat);
      this.chats.set(projectId, Promise.resolve(chat));
      this.begin(projectId, chat, text, operation);
      began = true;
    } finally { if (!began) this.release(projectId, operation); }
  }

  async markResultSaved(rawProjectId: unknown, rawChatId: unknown, rawMessageId: unknown, rawScenarioId?: unknown): Promise<ApiAiChat> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chatId = z.string().parse(rawChatId);
    const messageId = z.string().parse(rawMessageId);
    const scenarioId = rawScenarioId === undefined ? undefined : z.string().min(1).max(1000).parse(rawScenarioId);
    const operation = this.reserve(projectId, chatId);
    try {
      const chat = structuredClone(await this.find(projectId, chatId));
      const message = chat.messages.find(item => item.id === messageId);
      if (!message?.result) throw new Error("검사 결과를 찾을 수 없습니다");
      // Messages live in memory only, so the marker needs no write.
      message.saved = scenarioId ? { scenarioId } : {};
      this.chats.set(projectId, Promise.resolve(chat));
      return this.view(projectId, chat);
    } finally { this.release(projectId, operation); }
  }

  async cancel(rawProjectId: unknown, rawChatId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chatId = z.string().parse(rawChatId);
    const operation = this.operations.get(projectId);
    if (operation?.chatId === chatId) operation.controller.abort();
  }

  cancelAll(): void {
    for (const operation of this.operations.values()) operation.controller.abort();
  }

  async deleteProject(rawProjectId: unknown, remove: (projectId: string) => Promise<void>): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const operation = this.reserve(projectId, undefined, "AI가 답하는 중에는 프로젝트를 삭제할 수 없습니다. 대화를 중단한 뒤 삭제하세요");
    try {
      await this.writes.get(projectId);
      await remove(projectId);
      this.chats.delete(projectId);
      this.writes.delete(projectId);
    } finally { this.release(projectId, operation); }
  }

  /** Waits through automatic fixes and the last write, so callers may safely close the workspace. */
  async idle(projectId: string, chatId: string): Promise<void> {
    const operation = this.operations.get(projectId);
    if (operation?.chatId === chatId) await operation.done;
  }

  private add(chat: StoredChat, message: Omit<ApiAiChatMessage, "id" | "at">): ApiAiChatMessage {
    const item = { id: randomUUID(), at: new Date().toISOString(), ...message };
    chat.messages.push(item);
    chat.updatedAt = item.at;
    return item;
  }

  private begin(projectId: string, chat: StoredChat, prompt: string, operation: ProjectOperation): void {
    operation.chatId = chat.id;
    operation.state = { phase: "answering", text: "", tools: [] };
    void (async () => {
      try { await this.loop(projectId, chat, prompt, operation); }
      catch (error) { this.add(chat, { role: "checkly", text: `대화를 처리하지 못했습니다: ${(error as Error).message}`, error: true }); }
      finally {
        try { await this.persist(projectId, chat); }
        catch (error) { this.add(chat, { role: "checkly", text: `대화를 저장하지 못했습니다: ${(error as Error).message}`, error: true }); }
        finally { this.release(projectId, operation); }
      }
    })();
  }

  /** One turn: refresh this chat's environment, ask the CLI, then check and repair YAML answers. */
  private async loop(projectId: string, chat: StoredChat, firstPrompt: string, operation: ProjectOperation): Promise<void> {
    const state = operation.state!;
    let prompt = firstPrompt;
    for (let fixes = 0; ; fixes++) {
      Object.assign(state, { phase: "answering", text: "", tools: [] });
      let answer: string;
      try {
        if (operation.controller.signal.aborted) throw new Error("AI 응답을 중단했습니다");
        await this.workspace.refreshAiChatFiles({ projectId, environmentId: chat.environmentId });
        if (operation.controller.signal.aborted) throw new Error("AI 응답을 중단했습니다");
        answer = await this.runTurn({
          tool: chat.tool, sessionId: chat.cliSessionId, resume: chat.started, cwd: chat.cwd, readDirs: chat.readDirs,
          prompt: chat.started || !chat.guide ? prompt : `${chat.guide}\n\n---\n${prompt}`,
          signal: operation.controller.signal,
          onEvent: event => {
            if (event.type === "session") chat.cliSessionId = event.sessionId;
            else if (event.type === "text") state.text += event.text;
            else state.tools.push(event.detail);
          },
        });
      } catch (error) {
        if (state.text || state.tools.length) { chat.started = true; delete chat.guide; }
        else if (!chat.started) chat.cliSessionId = newSessionId(chat.tool);
        this.add(chat, { role: "assistant", text: (error as Error).message, error: true });
        return;
      }
      chat.started = true;
      delete chat.guide;
      this.add(chat, { role: "assistant", text: answer, ...(state.tools.length ? { tools: [...state.tools] } : {}) });
      await this.persist(projectId, chat);
      if (!yamlBlocks(answer).length) return;
      Object.assign(state, { phase: "checking", text: "", tools: [] });
      let result: ApiAiImportResult;
      try { result = await this.workspace.checkAiScenarios({ projectId, environmentId: chat.environmentId }, answer); }
      catch (error) { this.add(chat, { role: "checkly", text: `검사하지 못했습니다: ${(error as Error).message}` }); return; }
      const report = problemReport(result, "chat");
      if (!report) { this.add(chat, { role: "checkly", text: "검사를 통과했습니다. 저장할 항목을 고르세요.", result }); return; }
      if (operation.controller.signal.aborted) {
        this.add(chat, { role: "checkly", text: "중단했습니다. 아래 검사 결과를 확인하고 AI에 직접 요청하거나, 그대로 저장하면 초안이 됩니다.", result });
        return;
      }
      if (fixes >= maxAutoFixes) {
        this.add(chat, { role: "checkly", text: `자동 수정 ${maxAutoFixes}번 뒤에도 문제가 남았습니다. 아래 결과를 확인하고 AI에 직접 요청하거나, 그대로 저장하면 초안이 됩니다.`, result });
        return;
      }
      this.add(chat, { role: "checkly", text: report, result });
      await this.persist(projectId, chat);
      prompt = report;
    }
  }
}
