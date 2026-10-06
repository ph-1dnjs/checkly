import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Runs Claude Code headless for the in-app chat: one turn per call, continued with
 * --resume, read-only (Read·Grep·Glob confined to the given folders) and isolated from
 * the user's own Claude settings, hooks and MCP servers. Apps launched from Finder do not
 * inherit the shell PATH, so the login shell PATH and common install folders are searched.
 * CHECKLY_AI_CLI_PATH replaces the executable (tests use a fake CLI).
 */
export type AiCliStatus = { available: true; path: string; version: string } | { available: false; error: string };
export type AiTurnEvent = { type: "text"; text: string } | { type: "tool"; detail: string };
export type AiTurn = {
  sessionId: string;
  /** false for the first turn of a session (creates it), true to continue it. */
  resume: boolean;
  prompt: string;
  cwd: string;
  /** Other folders the AI may read (backend folders, the API file folder). */
  readDirs: string[];
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: AiTurnEvent) => void;
};

const maxOutputBytes = 20_000_000;
let searchPath: Promise<string> | undefined;
let found: { path: string; version: string } | undefined;

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

/** The first `claude` on the search path that actually runs (a PATH entry can be a broken install). */
export async function describeClaude(refresh = false): Promise<AiCliStatus> {
  if (process.env.CHECKLY_AI_CLI_PATH) return { available: true, path: process.env.CHECKLY_AI_CLI_PATH, version: "test" };
  if (found && !refresh) return { available: true, ...found };
  found = undefined;
  const env = await cliEnv();
  for (const dir of String(env.PATH).split(path.delimiter)) {
    const candidate = path.join(dir, "claude");
    try { await access(candidate, constants.X_OK); } catch { continue; }
    const version = await probeVersion(candidate, env);
    if (version) { found = { path: candidate, version }; return { available: true, ...found }; }
  }
  return { available: false, error: "Claude Code가 설치되어 있지 않습니다. 설치한 뒤 다시 확인하세요" };
}

/** Adds the fix for common failures (login, unknown model) to a CLI error message. */
export function explainCliFailure(message: string): string {
  if (/not logged in|please run \/login|log ?in required|unauthori[sz]ed|401|authentication/i.test(message)) return `${message}\n해결: 터미널에서 claude를 실행한 뒤 /login으로 로그인하세요`;
  if (/model .*not (supported|found|available)|unknown model|invalid model|does not exist or you do not have access/i.test(message)) return `${message}\n해결: 다른 모델을 지정하거나 claude update로 CLI를 업데이트하세요`;
  return message;
}

export function claudeArgs(turn: Pick<AiTurn, "sessionId" | "resume" | "readDirs" | "model">): string[] {
  return [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    ...(turn.resume ? ["--resume", turn.sessionId] : ["--session-id", turn.sessionId]),
    // No command-running tools, user/project settings, hooks or MCP servers; file tools stay inside the folders.
    "--restricted", "--strict-mcp-config", "--tools", "Read", "Grep", "Glob",
    ...turn.readDirs.flatMap(dir => ["--add-dir", dir]),
    ...(turn.model ? ["--model", turn.model] : []),
  ];
}

/** Short note for a tool call shown while the AI works, e.g. "Read UserController.java". */
function toolDetail(name: string, input: unknown): string {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const target = [value.file_path, value.pattern, value.path].find((item): item is string => typeof item === "string");
  return target ? `${name} ${target.length > 80 ? `…${target.slice(-80)}` : target}` : name;
}

/**
 * One chat turn. Streams text deltas and tool calls through onEvent and resolves with the
 * final answer text. Rejects with a readable message (login hint included) on failure.
 */
export async function runClaudeTurn(turn: AiTurn): Promise<string> {
  const status = await describeClaude();
  if (!status.available) throw new Error(status.error);
  const env = await cliEnv();
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(status.path, claudeArgs(turn), { cwd: turn.cwd, env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { reject(new Error(`Claude Code를 실행하지 못했습니다: ${(error as Error).message}`)); return; }
    let buffer = "", stderr = "", size = 0, settled = false;
    let result: { text: string; error: boolean } | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      turn.signal?.removeEventListener("abort", onAbort);
      if (error) { stop(); reject(error); } else resolve(result!.text);
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
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }
      if (event.type === "stream_event") {
        const inner = event.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) turn.onEvent?.({ type: "text", text: inner.delta.text });
      } else if (event.type === "assistant") {
        const content = (event.message as { content?: Array<{ type?: string; name?: string; input?: unknown }> } | undefined)?.content ?? [];
        for (const block of content) if (block.type === "tool_use" && block.name) turn.onEvent?.({ type: "tool", detail: toolDetail(block.name, block.input) });
      } else if (event.type === "result") {
        result = { text: typeof event.result === "string" ? event.result : "", error: event.is_error === true };
      }
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
    child.on("error", error => finish(new Error(`Claude Code를 실행하지 못했습니다: ${error.message}`)));
    child.on("close", code => {
      if (buffer.trim()) handle(buffer);
      if (result?.error) return finish(new Error(explainCliFailure(`AI 오류: ${result.text.slice(0, 500)}`)));
      if (code === 0 && result) return finish();
      finish(new Error(explainCliFailure(`Claude Code가 실패했습니다 (종료 코드 ${code}). ${(stderr.trim() || result?.text || "").slice(-500)}`)));
    });
    child.stdin.on("error", () => { /* The CLI may exit before reading all input; close reports it. */ });
    child.stdin.end(turn.prompt);
  });
}
