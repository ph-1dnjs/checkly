import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ApiAiTool } from "../shared/workspace";

/**
 * Finds the user's AI CLIs (Claude Code, Codex) for the in-app terminal and builds the environment to run
 * them in. Apps launched from Finder do not inherit the shell PATH, so the login shell PATH and common
 * install folders are searched. CHECKLY_AI_CLI_PATH / CHECKLY_CODEX_CLI_PATH replace the executables
 * (tests use fake CLIs).
 */
export type AiToolInfo = { tool: ApiAiTool; path: string; version: string };

const tools: ApiAiTool[] = ["claude", "codex"];
const overrides: Record<ApiAiTool, string> = { claude: "CHECKLY_AI_CLI_PATH", codex: "CHECKLY_CODEX_CLI_PATH" };
let searchPath: Promise<string> | undefined;
let found: AiToolInfo[] | undefined;

function loginShellPath(): Promise<string> {
  return new Promise(resolve => {
    const shell = process.env.SHELL || "/bin/zsh";
    execFile(shell, ["-lc", 'printf %s "$PATH"'], { timeout: 5_000 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
  });
}

export async function cliEnv(): Promise<NodeJS.ProcessEnv> {
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
