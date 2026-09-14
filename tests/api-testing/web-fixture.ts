import { createServer } from "node:http";

// Local-only API for manual browser testing; no real credentials or business data.
const spec = { openapi: "3.0.3", info: { title: "웹 검증용 상품 API", version: "1.0" },
  tags: [{ name: "상품", description: "목록과 상세 조회" }, { name: "상태", description: "서버 상태" }],
  paths: {
    "/health": { get: { tags: ["상태"], summary: "상태 확인", responses: { "200": { description: "정상" } } } },
    "/items": { get: { tags: ["상품"], summary: "상품 목록", responses: { "200": { description: "목록 조회 성공" } } } },
    "/items/{id}": { get: { tags: ["상품"], summary: "상품 상세", description: "앞 단계에서 받은 상품 ID로 상세를 조회합니다.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "상세 조회 성공" } } } },
  },
};
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/openapi.json") {
    if (req.headers.authorization !== `Basic ${Buffer.from("demo:demo").toString("base64")}`) { res.writeHead(401).end("{}"); return; }
    res.end(JSON.stringify(spec)); return;
  }
  if (req.url === "/health") { res.end(JSON.stringify({ ok: true })); return; }
  if (req.headers.authorization !== "Bearer demo-token") { res.writeHead(401).end(JSON.stringify({ message: "토큰 필요" })); return; }
  if (req.url === "/items") { res.end(JSON.stringify({ items: [{ id: 7, name: "테스트 상품" }] })); return; }
  if (req.url === "/items/7") { res.end(JSON.stringify({ id: 7, name: "테스트 상품", price: 12000 })); return; }
  res.writeHead(404).end("{}");
});
server.listen(5175, "127.0.0.1", () => console.log("Fixture: http://127.0.0.1:5175/openapi.json (Basic demo/demo, API Bearer demo-token)"));
