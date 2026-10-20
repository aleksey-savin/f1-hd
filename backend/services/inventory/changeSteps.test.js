// node --test services/inventory/changeSteps.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { STATUS, STATUS_LABELS, TTL_MS, decide, isOpen, isFinal } = require("./changeSteps");

const NOW = new Date("2026-10-19T12:00:00Z");
const open = (extra = {}) => ({
  status: STATUS.awaitingRequester,
  requestedBy: "u1",
  expiresAt: new Date(NOW.getTime() + 1000),
  ...extra,
});

test("статусы: открытый один, финальные не открыты, подписи без пропусков", () => {
  assert.equal(isOpen(STATUS.awaitingRequester), true);
  for (const s of Object.values(STATUS)) {
    assert.ok(STATUS_LABELS[s], s);
    if (s !== STATUS.awaitingRequester) assert.equal(isOpen(s), false, s);
  }
  assert.equal(isFinal(STATUS.applying), false);
  assert.equal(isFinal(STATUS.awaitingRequester), false);
  for (const s of ["done", "partial", "failed", "rejected", "expired"]) assert.equal(isFinal(s), true, s);
  assert.equal(STATUS_LABELS.partial, "Применено частично");
  assert.equal(TTL_MS, 3 * 24 * 3600 * 1000);
});

test("decide: чужой решить не может", () => {
  assert.deepEqual(decide(open(), { userId: "u2", decision: "approve", now: NOW }), { ok: false, code: "not_yours" });
});

test("decide: закрытый запрос", () => {
  for (const status of [STATUS.applying, STATUS.done, STATUS.partial, STATUS.failed, STATUS.rejected]) {
    assert.deepEqual(decide(open({ status }), { userId: "u1", decision: "approve", now: NOW }), {
      ok: false,
      code: "closed",
    });
  }
});

test("decide: истёкший по статусу (sweep) — expired, не closed: решения не было", () => {
  for (const userId of ["u1", "u2"]) {
    assert.deepEqual(decide(open({ status: STATUS.expired }), { userId, decision: "approve", now: NOW }), {
      ok: false,
      code: "expired",
    });
  }
});

test("decide: срок вышел, нет срока или битая дата", () => {
  for (const expiresAt of [NOW, new Date(NOW.getTime() - 1), undefined, "oops"]) {
    assert.deepEqual(decide(open({ expiresAt }), { userId: "u1", decision: "approve", now: NOW }), {
      ok: false,
      code: "expired",
    });
  }
});

test("decide: утверждение ведёт в applying", () => {
  const r = decide(open(), { userId: "u1", decision: "approve", channel: "telegram", comment: "ок", now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.patch.status, STATUS.applying);
  assert.deepEqual(r.patch.decision, { user: "u1", decision: "approve", channel: "telegram", comment: "ок", at: NOW });
});

test("decide: отклонение ведёт в rejected, id сравниваются как строки", () => {
  const id = { toString: () => "u1" };
  const r = decide(open({ requestedBy: id }), { userId: "u1", decision: "reject", now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.patch.status, STATUS.rejected);
  assert.equal(r.patch.decision.decision, "reject");
  assert.equal("comment" in r.patch.decision, false);
});

test("decide: неизвестное решение — ошибка вызова", () => {
  assert.throws(() => decide(open(), { userId: "u1", decision: "maybe", now: NOW }), TypeError);
});
