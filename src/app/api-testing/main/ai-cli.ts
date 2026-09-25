import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { ApiAiCli } from "../shared/workspace";

/**
 * Runs Claude Code or Codex headless, read-only, with a JSON schema for the final
 * answer. Apps launched from Finder do not inherit the shell PATH, so the login
 * shell PATH and common install directories are searched as well.
 * CHECKLY_AI_CLI_PATH replaces the executable (tests use a fake CLI).
 */
export type AiCliRun = { cli: ApiAiCli; prompt: string; cwd: string; readDirs: string[]; schema: object; signal?: AbortSignal; timeoutMs?: number };

const maxOutputBytes = 10_000_000;
let searchPath: Promise<string> | undefined;

function loginShellPath(): Promise<string> {
  return new Promise(resolve => {
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(shell, ["-lc", 'printf %s "$PATH"'], { timeout: 5_000 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
  });
}

async function combinedPath(): Promise<string> {
  searchPath ??= loginShellPath().then(shellPath => {
    const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local/bin"), path.join(homedir(), ".claude/local"), path.join(homedir(), ".npm-global/bin")];
    return [...new Set([...(process.env.PATH ?? "").split(path.delimiter), ...shellPath.split(path.delimiter), ...extra].filter(Boolean))].join(path.delimiter);
  });
  return searchPath;
}

async function findExecutable(name: string): Promise<string | undefined> {
  for (const dir of (await combinedPath()).split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  return undefined;
}

export async function resolveAiCli(cli: ApiAiCli): Promise<string | undefined> {
  return process.env.CHECKLY_AI_CLI_PATH || findExecutable(cli);
}

export async function availableAiClis(): Promise<ApiAiCli[]> {
  const found = await Promise.all((["claude", "codex"] as const).map(async cli => (await resolveAiCli(cli)) ? cli : undefined));
  return found.filter((cli): cli is ApiAiCli => Boolean(cli));
}

function runProcess(command: string, args: string[], input: string, cwd: string, signal: AbortSignal | undefined, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", size = 0, settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) { stop(); reject(error); } else resolve(stdout);
    };
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 3_000).unref();
    };
    const onAbort = () => finish(new Error("AI 작성을 취소했습니다"));
    const timer = setTimeout(() => finish(new Error("AI 작성 시간이 초과되었습니다")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > maxOutputBytes) return finish(new Error("AI 응답이 너무 큽니다"));
      stdout += chunk;
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4_000); });
    child.on("error", error => finish(new Error(`AI CLI를 실행하지 못했습니다: ${error.message}`)));
    child.on("close", code => code === 0 ? finish() : finish(new Error(`AI CLI가 실패했습니다 (종료 코드 ${code}). ${stderr.trim().slice(-500)}`)));
    child.stdin.on("error", () => { /* The CLI may exit before reading all input; close/exit reports it. */ });
    child.stdin.end(input);
  });
}

/** Pulls the schema-shaped answer out of either CLI's output. */
export function parseCliAnswer(cli: ApiAiCli, text: string): unknown {
  const fromText = (value: string): unknown => {
    const trimmed = value.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
    return JSON.parse(fenced ? fenced[1] : trimmed);
  };
  if (cli === "codex") return fromText(text);
  const envelope = JSON.parse(text) as { is_error?: boolean; result?: unknown; structured_output?: unknown };
  if (envelope.is_error) throw new Error(`AI CLI 오류: ${String(envelope.result ?? "").slice(0, 500)}`);
  if (envelope.structured_output !== undefined) return envelope.structured_output;
  if (typeof envelope.result === "string") return fromText(envelope.result);
  throw new Error("AI 응답에서 결과를 찾지 못했습니다");
}

export async function runAiCli(run: AiCliRun): Promise<unknown> {
  const command = await resolveAiCli(run.cli);
  if (!command) throw new Error(`${run.cli === "claude" ? "Claude Code" : "Codex"} CLI를 찾을 수 없습니다. 설치 후 다시 시도하세요`);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await combinedPath() };
  delete env.ELECTRON_RUN_AS_NODE;
  const timeoutMs = run.timeoutMs ?? 600_000;
  if (run.cli === "claude") {
    const args = [
      "-p", "--output-format", "json", "--json-schema", JSON.stringify(run.schema),
      // Read-only: the backend project must never be modified or executed.
      "--allowedTools", "Read", "Grep", "Glob",
      "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch",
      ...run.readDirs.flatMap(dir => ["--add-dir", dir]),
    ];
    return parseCliAnswer("claude", await runProcess(command, args, run.prompt, run.cwd, run.signal, timeoutMs, env));
  }
  const work = await mkdtemp(path.join(tmpdir(), "checkly-codex-"));
  try {
    const schemaFile = path.join(work, "schema.json"), answerFile = path.join(work, "answer.json");
    await writeFile(schemaFile, JSON.stringify(run.schema));
    const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--cd", run.cwd, "--output-schema", schemaFile, "--output-last-message", answerFile, "-"];
    await runProcess(command, args, run.prompt, run.cwd, run.signal, timeoutMs, env);
    return parseCliAnswer("codex", await readFile(answerFile, "utf8"));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
