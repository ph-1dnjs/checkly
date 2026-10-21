import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiEnvironmentScope } from "../../shared/workspace";

const settingsSchema = z.object({ projectId: z.string().uuid(), environmentId: z.string().uuid() }).strict();

/**
 * Remembers the connection the user turned on so the next app start reconnects it; turning it off forgets it.
 * Quitting the app or a login change closes the connection without forgetting. Never stores tokens.
 */
export class McpAutoStart {
  constructor(private file: string) {}
  async remember(scope: ApiEnvironmentScope): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ projectId: scope.projectId, environmentId: scope.environmentId }), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  async forget(): Promise<void> {
    await rm(this.file, { force: true });
  }
  async scope(): Promise<ApiEnvironmentScope | null> {
    try { return settingsSchema.parse(JSON.parse(await readFile(this.file, "utf8"))); }
    catch { return null; }
  }
}

