import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("CLI lookup skips an install that cannot run and uses the next working one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-cli-resolve-"));
  const previousPath = process.env.PATH, previousOverride = process.env.CHECKLY_AI_CLI_PATH;
  try {
    const broken = path.join(dir, "broken"), stub = path.join(dir, "stub"), good = path.join(dir, "good");
    await Promise.all([broken, stub, good].map(folder => mkdir(folder)));
    // Like an npm install whose native binary is missing: text without a shebang.
    await writeFile(path.join(broken, "claude"), 'echo "Error: claude native binary not installed." >&2\nexit 1\n');
    await writeFile(path.join(stub, "claude"), "#!/bin/sh\nexit 1\n");
    await writeFile(path.join(good, "claude"), "#!/bin/sh\necho 9.9.9\n");
    for (const folder of [broken, stub, good]) await chmod(path.join(folder, "claude"), 0o755);
    delete process.env.CHECKLY_AI_CLI_PATH;
    process.env.PATH = [broken, stub, good, previousPath].join(path.delimiter);
    // Imported after PATH is set: the module caches the search path on first use.
    const { resolveAiCli } = await import("../../src/app/api-testing/main/ai-cli");
    assert.equal(await resolveAiCli("claude"), path.join(good, "claude"));
  } finally {
    process.env.PATH = previousPath;
    if (previousOverride === undefined) delete process.env.CHECKLY_AI_CLI_PATH; else process.env.CHECKLY_AI_CLI_PATH = previousOverride;
    await rm(dir, { recursive: true, force: true });
  }
});
