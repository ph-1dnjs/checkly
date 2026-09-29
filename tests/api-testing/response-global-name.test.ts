import test from "node:test";
import assert from "node:assert/strict";
import { responseGlobalNameSuggestions } from "../../src/renderer/features/api-testing/edit-scenario/lib/response-global-name";

test("response global names can use the field or endpoint path", () => {
  assert.deepEqual(
    responseGlobalNameSuggestions({ path: "/bos/login" }, "/data/refreshToken").map(suggestion => suggestion.name),
    ["refresh_token", "bos_login_refresh_token"],
  );
});

test("response global names skip array indexes and stay valid", () => {
  assert.deepEqual(
    responseGlobalNameSuggestions({ path: "/users/{user-id}/roles" }, "/data/roles/0").map(suggestion => suggestion.name),
    ["roles", "users_roles_roles"],
  );
  assert.deepEqual(
    responseGlobalNameSuggestions({ path: "/" }, "").map(suggestion => suggestion.name),
    ["response"],
  );
});
