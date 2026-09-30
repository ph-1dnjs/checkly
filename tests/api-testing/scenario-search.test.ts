import assert from "node:assert/strict";
import test from "node:test";
import { scenarioSearch, type SearchableScenario } from "../../src/renderer/entities/api-testing/lib/scenario-search";

const order: SearchableScenario = { name: "주문 생성 흐름", groupPath: ["주문"], description: "취소 포함", apis: ["POST /users/{userId}/orders", "GET /orders/{id}"] };
const login: SearchableScenario = { name: "관리자 로그인", groupPath: [], apis: ["POST /bos/login"] };
const find = (phrase: string, baseUrls: string[] = []) => [order, login].flatMap(item => { const reason = scenarioSearch(phrase, baseUrls)(item); return reason ? [[item.name, reason] as const] : []; });

test("every word must appear in the name, group, description or APIs", () => {
  assert.deepEqual(find("주문 흐름"), [["주문 생성 흐름", { apis: [] }]]);
  assert.deepEqual(find("주문 로그인"), []);
  assert.deepEqual(find("취소"), [["주문 생성 흐름", { description: true, apis: [] }]]);
  assert.deepEqual(find("login"), [["관리자 로그인", { apis: ["POST /bos/login"] }]]);
});

test("a pasted URL finds the scenarios calling that API", () => {
  assert.deepEqual(find("https://api.example.com/v1/orders/7?x=1", ["https://api.example.com/v1"]), [["주문 생성 흐름", { apis: ["GET /orders/{id}"] }]]);
  assert.deepEqual(find("POST /users/3/orders"), [["주문 생성 흐름", { apis: ["POST /users/{userId}/orders"] }]]);
});

test("an empty search keeps everything without reasons", () => {
  assert.equal(find(" ").length, 2);
});
