import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ApiAiTool } from "../shared/workspace";

/**
 * Runs the user's AI CLI headless for the in-app chat, one turn per call:
 * - Claude Code: `claude -p` with --session-id / --resume, read-only (Read·Grep·Glob confined to the
 *   given folders) and isolated from the user's Claude settings, hooks and MCP servers.
 * - Codex: `codex exec` / `codex exec resume` in the read-only sandbox, without the user's config
 *   (MCP servers, rules). It reads with shell commands, so it can read outside the folders.
 * Apps launched from Finder do not inherit the shell PATH, so the login shell PATH and common
 * install folders are searched. CHECKLY_AI_CLI_PATH / CHECKLY_CODEX_CLI_PATH replace the
 * executables (tests use fake CLIs).
 */
export type AiToolInfo = { tool: ApiAiTool; path: string; version: string };
export type AiTurnEvent = { type: "text"; text: string } | { type: "tool"; detail: string } | { type: "session"; sessionId: string };
export type AiTurn = {
  tool: ApiAiTool;
  /** Claude: chosen up front. Codex: assigned by the CLI on the first turn (reported as a session event). */
  sessionId: string;
  /** false for the first turn of a session (creates it), true to continue it. */
  resume: boolean;
  prompt: string;
  cwd: string;
  /** Other folders the AI may read (backend folders, the API file folder). */
  readDirs: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: AiTurnEvent) => void;
};

const maxOutputBytes = 20_000_000;
const tools: ApiAiTool[] = ["claude", "codex"];
const overrides: Record<ApiAiTool, string> = { claude: "CHECKLY_AI_CLI_PATH", codex: "CHECKLY_CODEX_CLI_PATH" };
const names: Record<ApiAiTool, string> = { claude: "Claude Code", codex: "Codex" };
let searchPath: Promise<string> | undefined;
let found: AiToolInfo[] | undefined;

function loginShellPath(): Promise<string> {
  return new Promise(resolve => {
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(shell, ["-lc", 'printf %s "$PATH"'], { timeout: 5_000 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
  });
}

async function cliEnv(): Promise<NodeJS.ProcessEnv> {
  searchPath ??= loginShellPath().then(shellPath => {
    const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local/bin"), path.join(homedir(), ".claude/local"), path.join(homedir(), ".npm-global/bin")];
    return [...new Set([...(process.env.PATH ?? "").split(path.delimiter), ...shellPath.split(path.delimiter), ...extra].filter(Boolean))].join(path.delimiter);
  });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await searchPath };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Version line when the command runs (`--version` exit 0), otherwise undefined. */
function probeVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise(resolve => {
    // A non-executable file (ENOEXEC) throws synchronously instead of calling back.
    try { execFile(command, ["--version"], { timeout: 15_000, env }, (error, stdout) => resolve(error ? undefined : String(stdout).trim().split("\n")[0] || "버전 정보 없음")); }
    catch { resolve(undefined); }
  });
}

/** The first `<tool>` on the search path that actually runs (a PATH entry can be a broken install). */
async function findTool(tool: ApiAiTool, env: NodeJS.ProcessEnv): Promise<AiToolInfo | undefined> {
  const override = process.env[overrides[tool]];
  if (override) return { tool, path: override, version: "test" };
  // With a fake CLI set for tests, the other tool is only used when it is set too.
  if (tools.some(other => process.env[overrides[other]])) return undefined;
  for (const dir of String(env.PATH).split(path.delimiter)) {
    const candidate = path.join(dir, tool);
    try { await access(candidate, constants.X_OK); } catch { continue; }
    const version = await probeVersion(candidate, env);
    if (version) return { tool, path: candidate, version };
  }
  return undefined;
}

/** AI CLIs installed on this PC (Claude Code first). Cached until refresh. */
export async function describeAiTools(refresh = false): Promise<AiToolInfo[]> {
  // Fake CLIs (tests) are read every time so a test can switch them.
  if (found && !refresh && !tools.some(tool => process.env[overrides[tool]])) return found;
  const env = await cliEnv();
  found = (await Promise.all(tools.map(tool => findTool(tool, env)))).filter((item): item is AiToolInfo => Boolean(item));
  return found;
}

/** Adds the fix for common failures (login, unknown model) to a CLI error message. */
export function explainCliFailure(message: string, tool: ApiAiTool = "claude"): string {
  if (/not logged in|please run \/login|log ?in required|unauthori[sz]ed|\b401\b|authentication/i.test(message)) return `${message}\n해결: ${tool === "codex" ? "터미널에서 codex login으로 로그인하세요" : "터미널에서 claude를 실행한 뒤 /login으로 로그인하세요"}`;
  if (/model .*not (supported|found|available)|unknown model|invalid model|does not exist or you do not have access/i.test(message)) return `${message}\n해결: 터미널에서 ${tool === "codex" ? "codex" : "claude"} CLI를 업데이트하거나 CLI 기본 모델 설정을 확인하세요`;
  return message;
}

export function claudeArgs(turn: Pick<AiTurn, "sessionId" | "resume" | "readDirs">): string[] {
  return [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    ...(turn.resume ? ["--resume", turn.sessionId] : ["--session-id", turn.sessionId]),
    // No command-running tools, user/project settings, hooks or MCP servers; file tools stay inside the folders.
    "--restricted", "--strict-mcp-config", "--tools", "Read", "Grep", "Glob",
    ...turn.readDirs.flatMap(dir => ["--add-dir", dir]),
  ];
}

export function codexArgs(turn: Pick<AiTurn, "sessionId" | "resume">): string[] {
  // `exec resume` has no --sandbox flag; the config override applies to both.
  const common = ["--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-c", 'sandbox_mode="read-only"'];
  return turn.resume ? ["exec", "resume", turn.sessionId, ...common, "-"] : ["exec", "--sandbox", "read-only", ...common, "-"];
}

/** Short note for a tool call shown while the AI works, e.g. "Read UserController.java". */
function toolDetail(name: string, input: unknown): string {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const target = [value.file_path, value.pattern, value.path].find((item): item is string => typeof item === "string");
  return target ? `${name} ${target.length > 80 ? `…${target.slice(-80)}` : target}` : name;
}

/** What one CLI prints, line by line: the final answer, or why it failed. */
type OutputReader = { line(event: Record<string, unknown>): void; finish(code: number | null, stderr: string): string | Error };

function claudeReader(turn: AiTurn): OutputReader {
  let result: { text: string; error: boolean } | undefined;
  return {
    line(event) {
      if (event.type === "stream_event") {
        const inner = event.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) turn.onEvent?.({ type: "text", text: inner.delta.text });
      } else if (event.type === "assistant") {
        const content = (event.message as { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined)?.content ?? [];
        for (const block of content) if (block.type === "tool_use" && block.name) turn.onEvent?.({ type: "tool", detail: toolDetail(block.name, block.input) });
      } else if (event.type === "result") {
        result = { text: typeof event.result === "string" ? event.result : "", error: event.is_error === true };
      }
    },
    finish(code, stderr) {
      if (result?.error) return new Error(explainCliFailure(`AI 오류: ${result.text.slice(0, 500)}`, "claude"));
      if (code === 0 && result) return result.text;
      return new Error(explainCliFailure(`Claude Code가 실패했습니다 (종료 코드 ${code}). ${(stderr.trim() || result?.text || "").slice(-500)}`, "claude"));
    },
  };
}

/** The message inside a Codex error, which is often the API's JSON error body. */
function codexMessage(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  try { const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }; return parsed.error?.message ?? parsed.message ?? text; } catch { return text; }
}

function codexReader(turn: AiTurn): OutputReader {
  let answer: string | undefined, failure: string | undefined, completed = false;
  return {
    line(event) {
      const item = event.item as { type?: string; text?: string; command?: string } | undefined;
      if (event.type === "thread.started" && typeof event.thread_id === "string") turn.onEvent?.({ type: "session", sessionId: event.thread_id });
      else if (event.type === "item.started" && item?.type === "command_execution" && item.command) {
        const command = item.command.replace(/^\/bin\/(?:ba|z)?sh -lc '?|'$/g, "");
        turn.onEvent?.({ type: "tool", detail: command.length > 100 ? `${command.slice(0, 100)}…` : command });
      } else if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
        // Codex sends whole messages; earlier ones are progress notes, the last one is the answer.
        turn.onEvent?.({ type: "text", text: `${answer === undefined ? "" : "\n\n"}${item.text}` });
        answer = item.text;
      } else if (event.type === "turn.failed") failure = codexMessage((event.error as { message?: unknown } | undefined)?.message);
      else if (event.type === "error") failure ??= codexMessage(event.message);
      else if (event.type === "turn.completed") completed = true;
    },
    finish(code, stderr) {
      if (completed && code === 0) return answer ?? "";
      if (failure) return new Error(explainCliFailure(`AI 오류: ${failure.slice(0, 500)}`, "codex"));
      return new Error(explainCliFailure(`Codex가 실패했습니다 (종료 코드 ${code}). ${stderr.trim().slice(-500)}`, "codex"));
    },
  };
}

/**
 * One chat turn. Streams text, tool calls and (Codex) the session id through onEvent and resolves
 * with the final answer text. Rejects with a readable message (login hint included) on failure.
 */
export async function runAiTurn(turn: AiTurn): Promise<string> {
  const info = (await describeAiTools()).find(item => item.tool === turn.tool);
  if (!info) throw new Error(`${names[turn.tool]}가 이 PC에 설치되어 있지 않습니다. 설치한 뒤 다시 시도하세요`);
  const env = await cliEnv();
  const reader = turn.tool === "codex" ? codexReader(turn) : claudeReader(turn);
  const args = turn.tool === "codex" ? codexArgs(turn) : claudeArgs(turn);
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(info.path, args, { cwd: turn.cwd, env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { reject(new Error(`${names[turn.tool]}를 실행하지 못했습니다: ${(error as Error).message}`)); return; }
    let buffer = "", stderr = "", size = 0, settled = false;
    const finish = (outcome: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      turn.signal?.removeEventListener("abort", onAbort);
      if (outcome instanceof Error) { stop(); reject(outcome); } else resolve(outcome);
    };
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 3_000).unref();
    };
    const onAbort = () => finish(new Error("AI 응답을 중단했습니다"));
    const timer = setTimeout(() => finish(new Error("AI 응답 시간이 초과되었습니다")), turn.timeoutMs ?? 15 * 60_000);
    turn.signal?.addEventListener("abort", onAbort, { once: true });
    if (turn.signal?.aborted) return onAbort();
    const handle = (line: string) => {
      try { reader.line(JSON.parse(line) as Record<string, unknown>); } catch { /* not a JSON event */ }
    };
    // Decode as a stream: a Korean character split across two chunks must not turn into U+FFFD.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > maxOutputBytes) return finish(new Error("AI 응답이 너무 큽니다"));
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { handle(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
    child.on("error", error => finish(new Error(`${names[turn.tool]}를 실행하지 못했습니다: ${error.message}`)));
    child.on("close", code => {
      if (buffer.trim()) handle(buffer);
      finish(reader.finish(code, stderr));
    });
    child.stdin.on("error", () => { /* The CLI may exit before reading all input; close reports it. */ });
    child.stdin.end(turn.prompt);
  });
}
