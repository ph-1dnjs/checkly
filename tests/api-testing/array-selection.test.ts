import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { selectArray } from "../../src/app/api-testing/main/selection";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { parseScenario, stringifyScenario, describeCheck } from "../../src/app/api-testing/shared/scenario";

const content = [
  { id: 9, selectable: false }, { id: 8, selectable: false }, { id: 7, selectable: true },
  { id: 6, selectable: false }, { id: 5, selectable: true }, { id: 4, selectable: true },
  { id: 3, selectable: true }, { id: 2, selectable: true },
];
const select = { where: { pointer: "/selectable", equals: true }, limit: 4, minItems: 4, map: "/id" };

test("selection skips occupied products and retains response order and numeric IDs", () => {
  assert.deepEqual(selectArray(content, select), [7, 5, 4, 3]);
  assert.equal(selectArray(content, { ...select, index: 2 }), 4);
  assert.deepEqual(content.map(item => item.id), [9, 8, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(selectArray([{ selectable: "true" }, {}, null, ...content], select), [7, 5, 4, 3]);
  assert.deepEqual(selectArray([{ "a/b": { "~": true }, id: 1 }], { where: { pointer: "/a~1b/~0", equals: true }, map: "/id" }), [1]);
});

test("selection reports insufficient matches and rejects missing paths or invalid targets", () => {
  assert.throws(() => selectArray(content.slice(0, 4), select), /1個|1개.*최소 4개/);
  assert.throws(() => selectArray([], { minItems: 1 }), /최소 1개/);
  assert.throws(() => selectArray({}, select), /배열이 아닙니다/);
  assert.throws(() => selectArray([{ secret: "hidden-value" }], { map: "/missing" }), error => error instanceof Error && error.message.includes("/missing") && !error.message.includes("hidden-value"));
  assert.throws(() => selectArray([], { index: 0 }), /1번째 항목/);
});

const source = `name: 선택 가능한 상품 등록
server: api
steps:
  - api: GET /products
    extract:
      - pointer: /data/content
        target: vars.productIds
        select:
          where: {pointer: /selectable, equals: true}
          limit: 4
          minItems: 4
          map: /id
  - api: POST /promotions
    body:
      productIds: "{{vars.productIds}}"
    expect:
      - source: body
        pointer: /products
        select: {where: {pointer: /selectable, equals: true}, map: /id}
        operator: equals
        value: "{{vars.productIds}}"
`;

test("authoring select and local extraction survive YAML roundtrip and reject invalid configs", () => {
  const parsed = parseScenario(source);
  const roundtrip = parseScenario(stringifyScenario(parsed));
  assert.deepEqual(roundtrip.steps[0].extract, parsed.steps[0].extract);
  assert.deepEqual(roundtrip.steps[1].expect, parsed.steps[1].expect);
  assert.match(describeCheck(parsed.steps[1].expect![0]).target, /배열 선별/);
  assert.throws(() => parseScenario(source.replace("minItems: 4", "minItems: 5")), /minItems/);
  assert.throws(() => parseScenario(source.replace("limit: 4", "limit: -1")));
  assert.throws(() => parseScenario(source.replace("pointer: /data/content", "source: header\n        header: items")), /본문 배열/);
  assert.throws(() => parseScenario(source.replace("source: body\n        pointer: /products", "source: status")), /본문 배열/);
});

test("runner uses four free products and blocks writes when the response has too few", async () => {
  let products = content;
  const written: unknown[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") { res.end(JSON.stringify({ data: { content: products } })); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    written.push(body);
    res.end(JSON.stringify({ products: body.productIds.map((id: number) => ({ id, selectable: true })) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const runner = new ApiRunner();
    const options = { projectId: "selection", environment: "test", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } };
    const scenario = parseScenario(source);
    const passed = await runner.run(scenario, options);
    assert.equal(passed.status, "passed", JSON.stringify(passed));
    assert.deepEqual(written, [{ productIds: [7, 5, 4, 3] }]);
    assert.deepEqual(runner.globals.snapshot("selection"), {});
    products = content.slice(0, 4);
    const failed = await runner.run(scenario, options);
    assert.equal(failed.steps[0].failure?.kind, "extraction");
    assert.match(failed.steps[0].error!, /1개.*최소 4개/);
    assert.equal(failed.steps[1].status, "skipped");
    assert.equal(written.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
