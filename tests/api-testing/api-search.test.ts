import assert from "node:assert/strict";
import test from "node:test";
import { explainApiSearch, matchesApiSearch, parseApiSearch, searchesVisibleList, type SearchableOperation } from "../../src/renderer/entities/api-testing/lib/api-search";

const base = "https://api.example.com/gateway";
const detail: SearchableOperation = { method: "get", path: "/users/{userId}/orders", tag: "주문", summary: "사용자 주문 목록", description: "취소된 주문도 포함", parameters: ["userId", "page"], bodyFields: [] };
const create: SearchableOperation = { method: "post", path: "/users/{userId}/orders", tag: "주문", summary: "주문 생성", parameters: ["userId"], bodyFields: ["productCode"] };
const find = (phrase: string) => [detail, create].filter(operation => matchesApiSearch(operation, parseApiSearch(phrase, base))).map(operation => operation.summary);

test("every word must match somewhere (not the hidden operationId)", () => {
  assert.deepEqual(find("createOrder"), []);
  assert.deepEqual(find("주문 생성"), ["주문 생성"]);
  assert.deepEqual(find("post orders"), ["주문 생성"]);
  assert.deepEqual(find("주문 없는단어"), []);
});

test("a pasted request URL matches its path template", () => {
  assert.deepEqual(find("https://api.example.com/gateway/users/7/orders?page=2#x"), ["사용자 주문 목록", "주문 생성"]);
  assert.deepEqual(find("POST /users/7/orders"), ["주문 생성"]);
  assert.deepEqual(find("/users/7/orders/"), ["사용자 주문 목록", "주문 생성"]);
  assert.deepEqual(find("/users/7"), []);
});

test("parameter and body field names are searchable", () => {
  assert.deepEqual(find("productcode"), ["주문 생성"]);
  assert.deepEqual(find("userId"), ["사용자 주문 목록", "주문 생성"]);
});

test("empty search keeps everything", () => {
  assert.deepEqual(find("   "), ["사용자 주문 목록", "주문 생성"]);
});

test("explains matches the list doesn't show", () => {
  assert.deepEqual(explainApiSearch(create, parseApiSearch("POST /users/7/orders", base)), { variables: [["userId", "7"]], parameters: [], bodyFields: [] });
  assert.deepEqual(explainApiSearch(create, parseApiSearch("code", base)), { variables: [], parameters: [], bodyFields: ["productCode"] });
  assert.deepEqual(explainApiSearch(detail, parseApiSearch("page", base)), { variables: [], parameters: ["page"], bodyFields: [] });
  assert.deepEqual(explainApiSearch(detail, parseApiSearch("취소", base)), { variables: [], description: true, parameters: [], bodyFields: [] });
  // The word is in the listed summary too: nothing to explain.
  assert.equal(explainApiSearch(detail, parseApiSearch("주문", base)), null);
  // userId is already visible in the path.
  assert.equal(explainApiSearch(detail, parseApiSearch("userid", base)), null);
});

test("short API lists (AI picker, API 바꾸기) search what they show", () => {
  const fits = searchesVisibleList("주문 post");
  assert.equal(fits(create, create.tag), true);
  assert.equal(fits(detail, detail.tag), false);
  assert.equal(searchesVisibleList("/users/9/orders")(detail, detail.tag), true);
  // Parameter and body field names aren't shown there, so they don't match.
  assert.equal(searchesVisibleList("productCode")(create, create.tag), false);
});
