import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey } from "../../src/app/api-testing/shared/sensitive";

test("sensitive keys cover auth headers, tokens and passwords but not ordinary fields", () => {
  for (const key of ["Authorization", "set-cookie", "accessToken", "refresh_token", "password", "passwd", "clientSecret", "x-api-key", "apiKey", "otpCode", "sessionId", "credentials"]) assert.equal(isSensitiveKey(key), true, key);
  for (const key of ["id", "loginId", "email", "phone", "name", "status", "message", "content-type"]) assert.equal(isSensitiveKey(key), false, key);
});
