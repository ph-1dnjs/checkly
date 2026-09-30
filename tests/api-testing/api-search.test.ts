import assert from "node:assert/strict";
import test from "node:test";
import { matchesApiSearch, parseApiSearch, type SearchableOperation } from "../../src/renderer/pages/api-testing/lib/api-search";

const base = "https://api.example.com/gateway";
const detail: SearchableOperation = { method: "get", path: "/users/{userId}/orders", tag: "주문", texts: ["listOrders", "사용자 주문 목록"], fields: ["userId", "page"] };
const create: SearchableOperation = { method: "post", path: "/users/{userId}/orders", tag: "주문", texts: ["createOrder", "주문 생성"], fields: ["userId", "productCode"] };
const find = (phrase: string) => [detail, create].filter(operation => matchesApiSearch(operation, parseApiSearch(phrase, base), base)).map(operation => operation.texts[0]);

test("every word must match somewhere", () => {
  assert.deepEqual(find("주문 생성"), ["createOrder"]);
  assert.deepEqual(find("post orders"), ["createOrder"]);
  assert.deepEqual(find("주문 없는단어"), []);
});

test("a pasted request URL matches its path template", () => {
  assert.deepEqual(find("https://api.example.com/gateway/users/7/orders?page=2#x"), ["listOrders", "createOrder"]);
  assert.deepEqual(find("POST /users/7/orders"), ["createOrder"]);
  assert.deepEqual(find("/users/7/orders/"), ["listOrders", "createOrder"]);
  assert.deepEqual(find("/users/7"), []);
});

test("parameter and body field names are searchable", () => {
  assert.deepEqual(find("productcode"), ["createOrder"]);
  assert.deepEqual(find("userId"), ["listOrders", "createOrder"]);
});

test("empty search keeps everything", () => {
  assert.deepEqual(find("   "), ["listOrders", "createOrder"]);
});
