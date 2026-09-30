import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveKey, sensitiveSegments } from "../../src/app/api-testing/shared/sensitive";

const masked = (text: string, known: string[] = []) => sensitiveSegments(text, known).filter(segment => segment.sensitive).map(segment => segment.text);

test("sensitive keys cover auth headers, tokens and passwords but not ordinary fields", () => {
  for (const key of ["Authorization", "set-cookie", "accessToken", "refresh_token", "password", "passwd", "clientSecret", "x-api-key", "apiKey", "otpCode", "sessionId", "credentials"]) assert.equal(isSensitiveKey(key), true, key);
  for (const key of ["id", "loginId", "email", "phone", "name", "status", "message", "content-type"]) assert.equal(isSensitiveKey(key), false, key);
});

test("known secret values are masked wherever they appear", () => {
  assert.deepEqual(masked("Bearer abc.def.ghi", ["abc.def.ghi"]), ["abc.def.ghi"]);
  assert.deepEqual(masked("x-abc.def.ghi-y-abc.def.ghi", ["abc.def.ghi"]), ["abc.def.ghi", "abc.def.ghi"]);
  assert.deepEqual(sensitiveSegments("plain text", ["secret-value"]), [{ text: "plain text", sensitive: false }]);
  // Too-short known values would mask unrelated text.
  assert.deepEqual(masked("id 123", ["123"]), []);
});

test("overlapping known values merge into one masked range", () => {
  assert.deepEqual(masked("prefix-tokenvalue-suffix", ["tokenvalue", "valuesuf", "value-suffix"]), ["tokenvalue-suffix"]);
});

test("only sensitive query parameter values in URLs are masked", () => {
  assert.deepEqual(sensitiveSegments("https://api.test/items?id=7&access_token=abc123&page=2", []), [
    { text: "https://api.test/items?id=7&access_token=", sensitive: false },
    { text: "abc123", sensitive: true },
    { text: "&page=2", sensitive: false },
  ]);
  assert.deepEqual(masked("https://api.test/items?id=7&page=2"), []);
  assert.deepEqual(masked("https://api.test/items?api%5Fkey=zzz"), ["zzz"]);
  assert.deepEqual(masked("not a url?token=abc"), []);
});
