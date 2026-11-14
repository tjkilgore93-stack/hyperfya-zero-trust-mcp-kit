import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBearerToken, hashToken, safeEqual } from "../dist/auth.js";

test("extractBearerToken accepts normal header", () => {
  assert.equal(extractBearerToken("Bearer hyf_abc123"), "hyf_abc123");
});

test("extractBearerToken is case-insensitive on scheme", () => {
  assert.equal(extractBearerToken("bearer hyf_abc123"), "hyf_abc123");
});

test("extractBearerToken rejects missing header", () => {
  assert.equal(extractBearerToken(undefined), null);
});

test("extractBearerToken rejects wrong scheme", () => {
  assert.equal(extractBearerToken("Basic hyf_abc123"), null);
  assert.equal(extractBearerToken("hyf_abc123"), null);
});

test("hashToken is sha-256 hex and stable", () => {
  const h = hashToken("hyf_abc123");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken("hyf_abc123"));
});

test("hashToken differs per token (no collisions across prefixes)", () => {
  assert.notEqual(hashToken("hyf_a"), hashToken("hyf_b"));
});

test("safeEqual compares without early exit", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "sane"), false);
  assert.equal(safeEqual("short", "shorter"), false);
});
