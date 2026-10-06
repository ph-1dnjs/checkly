import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiAiChat, ApiAiChatMessage, ApiAiChatSummary, ApiAiImportResult } from "../shared/workspace";
import { problemReport } from "../shared/ai-problem-report";
import { runClaudeTurn, type AiTurn } from "./ai-cli";
import { yamlBlocks } from "./ai-context";
import type { ApiWorkspace } from "./workspace";

/** How many times Checkly sends check problems back on its own before handing over to the user. */
export const maxAutoFixes = 2;

/** A chat as stored: the shown conversation plus what is needed to continue the Claude session. */
type StoredChat = Omit<ApiAiChat, "running"> & {
  cliSessionId: string; started: boolean; cwd: string; readDirs: string[];
  /** The guide, kept until the Claude session exists so a failed first turn can be retried with it. */
  guide?: string;
};

const startSchema = z.object({
  scope: z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict(),
  operations: z.array(z.string().max(400)).max(2000).optional(),
  model: z.string().trim().regex(/^[A-Za-z0-9._:\/\[\]-]{1,100}$/, "모델 이름을 확인하세요").optional(),
}).strict();
const messageSchema = z.string().trim().min(1, "메시지를 입력하세요").max(20_000);


/**
 * In-app chats with Claude Code: each chat is one Claude session in the project's backend
 * folder. Answers that carry YAML are checked with Checkly's own validation; problems go back
 * to the AI automatically (up to maxAutoFixes times), then the result waits for the user to save.
 */
export class AiChatService {
  private chats = new Map<string, Promise<StoredChat[]>>();
  private running = new Map<string, { controller: AbortController; state: NonNullable<ApiAiChat["running"]> }>();
  private writes = new Map<string, Promise<void>>();

  constructor(private workspace: ApiWorkspace, private runTurn: (turn: AiTurn) => Promise<string> = runClaudeTurn) {}

  private load(projectId: string): Promise<StoredChat[]> {
    let pending = this.chats.get(projectId);
    if (!pending) {
      const loading = this.workspace.readAiChats(projectId).then(value => Array.isArray(value) ? value as StoredChat[] : []);
      // A failed read is not kept, so the next call reads again.
      loading.catch(() => { if (this.chats.get(projectId) === loading) this.chats.delete(projectId); });
      this.chats.set(projectId, pending = loading);
    }
    return pending;
  }

  /** Writes one project's chats after any earlier write of the same project. */
  private persist(projectId: string, chats: StoredChat[]): Promise<void> {
    const next = (this.writes.get(projectId) ?? Promise.resolve()).then(() => this.workspace.writeAiChats(projectId, chats));
    this.writes.set(projectId, next.catch(() => undefined));
    return next;
  }

  private async find(projectId: string, chatId: string): Promise<{ chats: StoredChat[]; chat: StoredChat }> {
    const chats = await this.load(projectId);
    const chat = chats.find(item => item.id === chatId);
    if (!chat) throw new Error("대화를 찾을 수 없습니다");
    return { chats, chat };
  }

  private view(projectId: string, chat: StoredChat): ApiAiChat {
    const { cliSessionId: _session, started: _started, cwd: _cwd, readDirs: _dirs, guide: _guide, ...shown } = chat;
    const running = this.running.get(`${projectId}:${chat.id}`)?.state;
    return { ...shown, ...(running ? { running: { ...running, tools: [...running.tools] } } : {}) };
  }

  async list(rawProjectId: unknown): Promise<ApiAiChatSummary[]> {
    const projectId = z.string().uuid().parse(rawProjectId);
    return (await this.load(projectId)).map(chat => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, running: this.running.has(`${projectId}:${chat.id}`) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(rawProjectId: unknown, rawChatId: unknown): Promise<ApiAiChat | null> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chat = (await this.load(projectId)).find(item => item.id === z.string().parse(rawChatId));
    return chat ? this.view(projectId, chat) : null;
  }

  /** Creates a chat, sends the guide and lets the AI ask its first question in the background. */
  async start(raw: unknown): Promise<ApiAiChat> {
    const request = startSchema.parse(raw);
    const { projectId, environmentId } = request.scope;
    const setup = await this.workspace.aiChatSetup({ scope: request.scope, ...(request.operations?.length ? { operations: request.operations } : {}) });
    const now = new Date().toISOString();
    const chat: StoredChat = {
      id: randomUUID(), title: `새 대화 ${new Date().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      environmentId, createdAt: now, updatedAt: now, ...(request.model ? { model: request.model } : {}),
      messages: [{ id: randomUUID(), role: "checkly", at: now, text: `가이드를 AI에 전달했습니다 · API ${setup.apiCount}개 · 백엔드 폴더 ${setup.folderCount ? `${setup.folderCount}개` : "없음 (API 명세만 사용)"}` }],
      cliSessionId: randomUUID(), started: false, cwd: setup.cwd, readDirs: setup.readDirs, guide: setup.prompt,
    };
    const chats = await this.load(projectId);
    chats.push(chat);
    await this.persist(projectId, chats);
    this.begin(projectId, chats, chat, "이제 사용자와 대화를 시작합니다. 위 진행 순서 1번대로 먼저 질문하세요.");
    return this.view(projectId, chat);
  }

  async send(rawProjectId: unknown, rawChatId: unknown, rawText: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const text = messageSchema.parse(rawText);
    const { chats, chat } = await this.find(projectId, z.string().parse(rawChatId));
    if (this.running.has(`${projectId}:${chat.id}`)) throw new Error("AI가 답하는 중입니다. 끝난 뒤 보내거나 중단하세요");
    if (!chat.messages.some(message => message.role === "user")) chat.title = text.replace(/\s+/g, " ").slice(0, 40);
    this.add(chat, { role: "user", text });
    await this.persist(projectId, chats);
    this.begin(projectId, chats, chat, text);
  }

  async cancel(rawProjectId: unknown, rawChatId: unknown): Promise<void> {
    this.running.get(`${z.string().uuid().parse(rawProjectId)}:${z.string().parse(rawChatId)}`)?.controller.abort();
  }

  async remove(rawProjectId: unknown, rawChatId: unknown): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    const chatId = z.string().parse(rawChatId);
    if (this.running.has(`${projectId}:${chatId}`)) throw new Error("AI가 답하는 중에는 삭제할 수 없습니다. 먼저 중단하세요");
    const chats = await this.load(projectId);
    const index = chats.findIndex(item => item.id === chatId);
    if (index >= 0) { chats.splice(index, 1); await this.persist(projectId, chats); }
  }

  /** Stops every running turn (app quit). */
  cancelAll(): void {
    for (const { controller } of this.running.values()) controller.abort();
  }

  /**
   * Deletes a project unless one of its chats is answering (like runs and spec syncs, which
   * also block deletion), then forgets its chats. Nothing is running, so nothing writes them again.
   */
  async deleteProject(rawProjectId: unknown, remove: (projectId: string) => Promise<void>): Promise<void> {
    const projectId = z.string().uuid().parse(rawProjectId);
    if ([...this.running.keys()].some(key => key.startsWith(`${projectId}:`))) throw new Error("AI가 답하는 중에는 프로젝트를 삭제할 수 없습니다. 대화를 중단한 뒤 삭제하세요");
    await this.writes.get(projectId);
    await remove(projectId);
    this.chats.delete(projectId);
  }

  /** Resolves when the chat's current turn (with any automatic fixes) has finished; for tests. */
  async idle(projectId: string, chatId: string): Promise<void> {
    while (this.running.has(`${projectId}:${chatId}`)) await new Promise(resolve => setTimeout(resolve, 10));
  }

  private add(chat: StoredChat, message: Omit<ApiAiChatMessage, "id" | "at">): ApiAiChatMessage {
    const item = { id: randomUUID(), at: new Date().toISOString(), ...message };
    chat.messages.push(item);
    chat.updatedAt = item.at;
    return item;
  }

  private begin(projectId: string, chats: StoredChat[], chat: StoredChat, prompt: string) {
    const key = `${projectId}:${chat.id}`;
    const entry = { controller: new AbortController(), state: { phase: "answering" as const, text: "", tools: [] as string[] } };
    this.running.set(key, entry);
    void this.loop(projectId, chats, chat, prompt, entry).finally(() => { this.running.delete(key); void this.persist(projectId, chats).catch(() => undefined); });
  }

  /** One user turn: the AI answers; YAML answers are checked and problems are sent back automatically. */
  private async loop(projectId: string, chats: StoredChat[], chat: StoredChat, firstPrompt: string, entry: { controller: AbortController; state: NonNullable<ApiAiChat["running"]> }) {
    let prompt = firstPrompt;
    for (let fixes = 0; ; fixes++) {
      Object.assign(entry.state, { phase: "answering", text: "", tools: [] });
      let answer: string;
      // The guide points at this file; keep it current so the AI reads what is saved now.
      await this.workspace.writeAiState(projectId).catch(() => undefined);
      if (entry.controller.signal.aborted) { this.add(chat, { role: "assistant", text: "AI 응답을 중단했습니다", error: true }); return; }
      try {
        answer = await this.runTurn({
          sessionId: chat.cliSessionId, resume: chat.started, cwd: chat.cwd, readDirs: chat.readDirs,
          // Until the session exists every turn opens with the guide.
          prompt: chat.started || !chat.guide ? prompt : `${chat.guide}\n\n---\n${prompt}`,
          ...(chat.model ? { model: chat.model } : {}), signal: entry.controller.signal,
          onEvent: event => { if (event.type === "text") entry.state.text += event.text; else entry.state.tools.push(event.detail); },
        });
      } catch (error) {
        // Claude created the session if it produced anything; otherwise retry later in a fresh one.
        if (entry.state.text || entry.state.tools.length) { chat.started = true; delete chat.guide; }
        else if (!chat.started) chat.cliSessionId = randomUUID();
        this.add(chat, { role: "assistant", text: (error as Error).message, error: true });
        return;
      }
      chat.started = true;
      delete chat.guide;
      this.add(chat, { role: "assistant", text: answer, ...(entry.state.tools.length ? { tools: [...entry.state.tools] } : {}) });
      await this.persist(projectId, chats);
      if (!yamlBlocks(answer).length) return;
      Object.assign(entry.state, { phase: "checking", text: "", tools: [] });
      let result: ApiAiImportResult;
      try { result = await this.workspace.checkAiScenarios({ projectId, environmentId: chat.environmentId }, answer); }
      catch (error) { this.add(chat, { role: "checkly", text: `검사하지 못했습니다: ${(error as Error).message}` }); return; }
      const report = problemReport(result, "chat");
      if (!report) { this.add(chat, { role: "checkly", text: "검사를 통과했습니다. 저장할 항목을 고르세요.", result }); return; }
      if (entry.controller.signal.aborted) {
        this.add(chat, { role: "checkly", text: "중단했습니다. 아래 검사 결과를 확인하고 AI에 직접 요청하거나, 그대로 저장하면 초안이 됩니다.", result });
        return;
      }
      if (fixes >= maxAutoFixes) {
        this.add(chat, { role: "checkly", text: `자동 수정 ${maxAutoFixes}번 뒤에도 문제가 남았습니다. 아래 결과를 확인하고 AI에 직접 요청하거나, 그대로 저장하면 초안이 됩니다.`, result });
        return;
      }
      this.add(chat, { role: "checkly", text: report, result });
      await this.persist(projectId, chats);
      prompt = report;
    }
  }
}
