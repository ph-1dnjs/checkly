import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ApiMcpSetup } from "../../shared/workspace";

/** Install beside discovery data, outside app.asar, so a normal Node process can run it. */
export async function prepareMcpSetup(directory: string, sourceFile: string, platform: NodeJS.Platform = process.platform, discoveryFile = path.join(directory, "connection.json")): Promise<ApiMcpSetup> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const helper = path.join(directory, "checkly-mcp.cjs");
  const temporary = `${helper}.${randomUUID()}.tmp`;
  await writeFile(temporary, await readFile(sourceFile), { mode: 0o600 });
  await rename(temporary, helper);
  const args = [helper, "--connection", discoveryFile];
  // POSIX shells and PowerShell both support single-quoted literal arguments, with different escapes.
  const quote = (value: string) => platform === "win32" ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'"'"'`)}'`;
  return {
    command: "node", args,
    codexCommand: `codex mcp add checkly -- node ${args.map(quote).join(" ")}`,
    // User scope so the server is available from every folder, not only where the command ran.
    claudeCommand: `claude mcp add --scope user checkly -- node ${args.map(quote).join(" ")}`,
    configJson: JSON.stringify({ mcpServers: { checkly: { command: "node", args } } }, null, 2),
  };
}
