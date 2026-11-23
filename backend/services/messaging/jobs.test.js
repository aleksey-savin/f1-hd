// node --test services/messaging/jobs.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { applyAck } = require("./jobs");

const NOW = Date.parse("2026-09-24T10:00:00Z");

test("a successful ack finishes the job", () => {
  const patch = applyAck({ attempts: 0 }, { ok: true }, NOW);
  assert.equal(patch.state, "done");
  assert.equal(patch.attempts, 1);
  assert.equal(patch.finishedAt.getTime(), NOW);
});

test("a retryable failure backs off; the fifth one gives up", () => {
  const first = applyAck({ attempts: 0 }, { ok: false, error: "timeout" }, NOW);
  assert.equal(first.state, "pending");
  assert.equal(first.attempts, 1);
  assert.equal(first.notBefore.getTime(), NOW + 30_000);
  const last = applyAck({ attempts: 4 }, { ok: false, error: "timeout" }, NOW);
  assert.equal(last.state, "failed");
  assert.equal(last.attempts, 5);
});

test("a permanent failure gives up at once", () => {
  const patch = applyAck({ attempts: 0 }, { ok: false, retryable: false, error: "USER_IS_BLOCKED" }, NOW);
  assert.equal(patch.state, "failed");
  assert.equal(patch.lastError, "USER_IS_BLOCKED");
});

test("FLOOD_WAIT is a pause, not an attempt", () => {
  const patch = applyAck({ attempts: 2 }, { ok: false, retryAfterMs: 45_000, error: "FLOOD_WAIT_45" }, NOW);
  assert.equal(patch.state, "pending");
  assert.equal(patch.attempts, 2);
  assert.equal(patch.notBefore.getTime(), NOW + 45_000);
  // безумная пауза режется до 6 часов
  const capped = applyAck({ attempts: 0 }, { ok: false, retryAfterMs: 10 * 24 * 3600_000 }, NOW);
  assert.equal(capped.notBefore.getTime(), NOW + 6 * 3600_000);
});
