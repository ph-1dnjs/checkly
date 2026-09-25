import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { ApiAiCli, ApiAiCliStatus } from "../shared/workspace";

/**
 * Runs Claude Code or Codex headless, read-only, with a JSON schema for the final
 * answer. Apps launched from Finder do not inherit the shell PATH, so the login
 * shell PATH and common install directories are searched as well.
 * CHECKLY_AI_CLI_PATH replaces the executable (tests use a fake CLI).
 */
export type AiCliRun = { cli: ApiAiCli; model?: string; prompt: string; cwd: string; readDirs: string[]; schema: object; signal?: AbortSignal; timeoutMs?: number };

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

/** Version line when the command runs (`--version` exit 0), otherwise undefined. */
function probeVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise(resolve => {
    // A non-executable file (ENOEXEC) throws synchronously instead of calling back.
    try { execFile(command, ["--version"], { timeout: 15_000, env }, (error, stdout) => resolve(error ? undefined : String(stdout).trim().split("\n")[0] || "버전 정보 없음")); }
    catch { resolve(undefined); }
  });
}

async function probeEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await combinedPath() };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

type Found = { path: string; version: string };
const working = new Map<ApiAiCli, Found>();
let customPaths: Partial<Record<ApiAiCli, string>> = {};

/** Paths chosen in the app; an empty entry means auto-detect. Clears cached lookups. */
export function setAiCliPaths(paths: Partial<Record<ApiAiCli, string>>): void {
  customPaths = Object.fromEntries(Object.entries(paths).filter(([, value]) => value?.trim())) as Partial<Record<ApiAiCli, string>>;
  working.clear();
}

export function resetAiCliCache(): void {
  working.clear();
}

/**
 * First install that actually runs: a PATH entry can be a broken install
 * (e.g. an npm global package whose native binary is missing), so each
 * candidate is probed with --version. Only successes are cached.
 */
async function findExecutable(cli: ApiAiCli): Promise<Found | undefined> {
  const cached = working.get(cli);
  if (cached) return cached;
  const env = await probeEnv();
  for (const dir of String(env.PATH).split(path.delimiter)) {
    const candidate = path.join(dir, cli);
    try { await access(candidate, constants.X_OK); } catch { continue; }
    const version = await probeVersion(candidate, env);
    if (version) { const found = { path: candidate, version }; working.set(cli, found); return found; }
  }
  return undefined;
}

/** Where each CLI would run from, or why it cannot. */
export async function describeAiCli(cli: ApiAiCli): Promise<ApiAiCliStatus> {
  // Test hook: a fake CLI that does not implement --version.
  if (process.env.CHECKLY_AI_CLI_PATH) return { cli, path: process.env.CHECKLY_AI_CLI_PATH, version: "test", custom: true };
  const custom = customPaths[cli];
  if (custom) {
    const cached = working.get(cli);
    if (cached?.path === custom) return { cli, ...cached, custom: true };
    const version = await probeVersion(custom, await probeEnv());
    if (!version) return { cli, path: custom, custom: true, error: "지정한 경로의 CLI가 실행되지 않습니다. 경로와 실행 권한을 확인하세요" };
    working.set(cli, { path: custom, version });
    return { cli, path: custom, version, custom: true };
  }
  const found = await findExecutable(cli);
  return found ? { cli, ...found, custom: false } : { cli, custom: false, error: "설치된 CLI를 찾을 수 없습니다" };
}

export async function describeAiClis(): Promise<ApiAiCliStatus[]> {
  return Promise.all((["claude", "codex"] as const).map(describeAiCli));
}

export async function resolveAiCli(cli: ApiAiCli): Promise<string | undefined> {
  const status = await describeAiCli(cli);
  return status.error ? undefined : status.path;
}

const loginHint: Record<ApiAiCli, string> = { claude: "터미널에서 claude를 실행한 뒤 /login으로 로그인하세요", codex: "터미널에서 codex login으로 로그인하세요" };
const upgradeHint: Record<ApiAiCli, string> = { claude: "다른 모델을 지정하거나 claude update로 CLI를 업데이트하세요", codex: "다른 모델을 지정하거나 CLI를 업그레이드하세요 (예: brew upgrade --cask codex)" };

/** Adds the fix for common failures (login, unsupported model) to a CLI error message. */
export function explainAiCliFailure(cli: ApiAiCli, message: string): string {
  if (/not logged in|please run \/login|log ?in required|unauthori[sz]ed|401|authentication/i.test(message)) return `${message}\n해결: ${loginHint[cli]}`;
  if (/model metadata .* not found|model .*not (supported|found|available)|unknown model|invalid model|does not exist or you do not have access/i.test(message)) return `${message}\n해결: ${upgradeHint[cli]}`;
  return message;
}

/** Claude Code reports failures (e.g. "Not logged in") as a JSON result on stdout. */
function cliErrorDetail(stdout: string, stderr: string): string {
  try {
    const envelope = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
    if (envelope.is_error && typeof envelope.result === "string") return envelope.result.slice(0, 500);
  } catch { /* not a JSON envelope */ }
  return (stderr.trim() || stdout.trim()).slice(-500);
}

function runProcess(command: string, args: string[], input: string, cwd: string, signal: AbortSignal | undefined, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try { child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { reject(new Error(`AI CLI를 실행하지 못했습니다: ${(error as Error).message}`)); return; }
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
    child.on("close", code => code === 0 ? finish() : finish(new Error(`AI CLI가 실패했습니다 (종료 코드 ${code}). ${cliErrorDetail(stdout, stderr)}`)));
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
  try { return await runResolvedAiCli(run); }
  catch (error) { throw new Error(explainAiCliFailure(run.cli, (error as Error).message)); }
}

async function runResolvedAiCli(run: AiCliRun): Promise<unknown> {
  const status = await describeAiCli(run.cli);
  if (status.error || !status.path) throw new Error(`${run.cli === "claude" ? "Claude Code" : "Codex"} CLI: ${status.error ?? "찾을 수 없습니다"}`);
  const command = status.path;
  const env = await probeEnv();
  const timeoutMs = run.timeoutMs ?? 600_000;
  if (run.cli === "claude") {
    const args = [
      "-p", "--output-format", "json", "--json-schema", JSON.stringify(run.schema),
      ...(run.model ? ["--model", run.model] : []),
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
    const args = ["exec", ...(run.model ? ["--model", run.model] : []), "--sandbox", "read-only", "--skip-git-repo-check", "--cd", run.cwd, "--output-schema", schemaFile, "--output-last-message", answerFile, "-"];
    await runProcess(command, args, run.prompt, run.cwd, run.signal, timeoutMs, env);
    return parseCliAnswer("codex", await readFile(answerFile, "utf8"));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
