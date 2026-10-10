// node --test services/mikrotik/changeEvents.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { proposedEvent, refusedEvent, decisionEvent, statusEvent } = require("./changeEvents");

const change = (extra = {}) => ({ _id: "c1", number: 14, mikrotik: "r1", title: "WireGuard для Ивана Петрова", requestedBy: "u1", commands: [{}, {}, {}], status: "queued", ...extra });
const caller = { keyId: "k1", keyName: "OpenClaw" };

test("a proposal is attributed to the key on behalf of the requester, without the request number", () => {
  const event = proposedEvent(change(), caller);
  assert.deepEqual(event, {
    kind: "changeProposed",
    refs: { changeId: "c1" },
    data: { title: "WireGuard для Ивана Петрова", commands: 3 },
    actor: { type: "mcpKey", keyId: "k1", keyName: "OpenClaw", onBehalfOf: "u1" },
  });
  assert.ok(!JSON.stringify(event).includes("14"));
});

test("a refusal keeps the reason and the key", () => {
  assert.deepEqual(refusedEvent({ caller, title: "Новый админ", reason: "Меню /user агентам закрыто" }), {
    kind: "changeRefused",
    actor: { type: "mcpKey", keyId: "k1", keyName: "OpenClaw" },
    data: { title: "Новый админ", reason: "Меню /user агентам закрыто" },
  });
});

test("decisions: confirm, final approve and reject are different kinds", () => {
  const by = { userId: "u2", channel: "telegram" };
  assert.equal(decisionEvent(change(), { ...by, decision: "approve", final: false }).kind, "changeConfirmed");
  assert.equal(decisionEvent(change(), { ...by, decision: "approve", final: true }).kind, "changeApproved");
  const rejected = decisionEvent(change(), { ...by, decision: "reject", final: false, comment: "Сначала согласуем" });
  assert.equal(rejected.kind, "changeRejected");
  assert.deepEqual(rejected.actor, { type: "user", userId: "u2" });
  assert.deepEqual(rejected.data, { title: "WireGuard для Ивана Петрова", commands: 3, channel: "telegram", comment: "Сначала согласуем" });
});

test("statusEvent maps final statuses and carries the failure", () => {
  assert.equal(statusEvent(change({ status: "applied" })).kind, "changeApplied");
  assert.equal(statusEvent(change({ status: "expired" })).kind, "changeExpired");
  const rolled = statusEvent(change({ status: "rolled_back", failure: "Команда 2 не выполнилась" }));
  assert.equal(rolled.kind, "changeRolledBack");
  assert.equal(rolled.data.failure, "Команда 2 не выполнилась");
  assert.deepEqual(statusEvent(change({ status: "cancelled" }), { userId: "u1" }).actor, { type: "user", userId: "u1" });
});

test("statusEvent ignores statuses that are not an outcome", () => {
  assert.equal(statusEvent(change({ status: "queued" })), null);
  assert.equal(statusEvent(change({ status: "awaiting_requester" })), null);
  assert.equal(statusEvent(null), null);
});
