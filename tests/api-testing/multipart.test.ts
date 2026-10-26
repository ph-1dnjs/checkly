import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateUpload, maxUploadBytes, multipartSchema } from "../../src/app/api-testing/shared/multipart";
import { buildMultipart } from "../../src/app/api-testing/main/multipart";
import { parseScenario, stringifyScenario, scenarioSchema } from "../../src/app/api-testing/shared/scenario";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { readOpenApi } from "../../src/app/api-testing/main/openapi";

const parts = [{ kind: "text" as const, name: "title", value: "example" }, { kind: "file" as const, name: "file", file: { name: "sample.json", type: "application/json", source: { kind: "generated" as const, format: "json" as const, size: 100 } } }];
const scenario = () => scenarioSchema.parse({ version: 1, id: "upload", name: "파일 업로드", steps: [{ id: "upload", server: "api", api: { method: "POST", path: "/upload" }, request: { multipart: parts } }] });

test("generated fixtures have exact byte counts and valid JSON at boundaries", () => {
  for (const size of [1, 2, 100, maxUploadBytes]) for (const format of ["txt", "csv", "json"] as const) {
    const result = generateUpload(format, size);
    assert.equal(Buffer.byteLength(result), size);
    if (format === "json") assert.equal(JSON.parse(result), 0);
  }
  for (const size of [0, -1, 1.5, maxUploadBytes + 1]) assert.throws(() => generateUpload("txt", size));
  assert.equal(multipartSchema.safeParse([{ kind: "text", name: "", value: "a" }]).success, false);
  assert.equal(multipartSchema.safeParse(Array(21).fill(parts[0])).success, false);
  assert.throws(() => buildMultipart([{ kind: "file", name: "f", file: { name: "a", type: "text/plain", source: { kind: "inline", base64: "!" } } }]));
});

test("multipart survives scenario YAML round trips and excludes simultaneous JSON", () => {
  assert.deepEqual(parseScenario(stringifyScenario(scenario())).steps[0].request.multipart, parts);
  const invalid = scenario(); invalid.steps[0].request.body = {};
  assert.equal(scenarioSchema.safeParse(invalid).success, false);
});

test("multipart OpenAPI request bodies are recognized", () => {
  const catalog = readOpenApi(JSON.stringify({ openapi: "3.0.3", info: { title: "upload", version: "1" }, paths: { "/upload": { post: { requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } }, responses: {} } } } }));
  assert.equal(catalog.operations[0].bodyMediaType, "multipart/form-data");
  assert.deepEqual(catalog.operations[0].warnings, []);
});

test("runner sends file bytes, text and an automatic multipart boundary without logging file contents", async () => {
  let contentType = "", payload = "";
  const server = createServer(async (req, res) => {
    contentType = req.headers["content-type"] ?? "";
    for await (const chunk of req) payload += chunk;
    res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const input = scenario();
    input.steps[0].request.headers = { "Content-Type": "application/json" };
    input.steps[0].request.multipart!.push({ kind: "file", name: "attachment", file: { name: "hello.txt", type: "text/plain", source: { kind: "inline", base64: Buffer.from("unique-file-bytes").toString("base64") } } });
    const options = { projectId: "upload", environment: "dev", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } };
    const traces: unknown[] = [];
    const result = await new ApiRunner().run(input, { ...options, onRequest: trace => traces.push(trace) });
    assert.equal(result.status, "passed");
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    assert.match(payload, /filename="sample.json"/);
    assert.match(payload, /name="title"\r\n\r\nexample/);
    assert.match(payload, /unique-file-bytes/);
    assert.equal(JSON.stringify(traces).includes("unique-file-bytes"), false);
    assert.equal(JSON.stringify(traces).includes("base64"), false);
    input.steps[0].api = { method: "GET", path: "/upload" };
    assert.notEqual((await new ApiRunner().run(input, options)).status, "passed");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
