import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { apiWebDev } from "../../src/app/api-testing/main/web-dev";

test("web development RPC rejects cross-origin/unknown operations and validates input", async () => {
  let handler: (req: unknown, res: unknown) => Promise<void>;
  const plugin = apiWebDev();
  const configure = plugin.configureServer as Function;
  configure({ middlewares: { use(_path: string, callback: typeof handler) { handler = callback; } } });
  const headers = { host: "127.0.0.1:5174", origin: "http://127.0.0.1:5174",
    "x-checkly-dev": "1", "content-type": "application/json" };
  async function call(method: string, overrides = {}, args: unknown[] = []) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ method, args }))]),
      { method: "POST", headers: { ...headers, ...overrides } });
    let status = 200;
    let body = "";
    const res = { setHeader() {}, writeHead(code: number) { status = code; return res; },
      end(value: string) { body = value; } };
    await handler(req, res);
    return { status, data: JSON.parse(body) };
  }
  assert.equal((await call("listProjects", { origin: "https://other.example" })).status, 403);
  assert.equal((await call("listProjects", { host: "other.example:5174" })).status, 403);
  assert.equal((await call("listProjects", { "x-checkly-dev": "" })).status, 403);
  assert.equal((await call("constructor")).status, 400);
  assert.equal((await call("read")).status, 400);
  const invalid = await call("saveProject", {}, [{ password: "TEST-SECRET" }]);
  assert.equal(invalid.status, 400);
  assert.ok(!JSON.stringify(invalid).includes("TEST-SECRET"));
});
