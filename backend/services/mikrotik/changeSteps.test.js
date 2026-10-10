// node --test services/mikrotik/changeSteps.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { STATUS, STATUS_LABELS, planSteps, currentStep, decide, isOpen, isFinal } = require("./changeSteps");

const Q = "u-requester";
const R = "u-responsible";

test("steps follow the responsible/requester table", () => {
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: R, requesterCanApprove: false, responsibleCanApprove: true }).steps.map((s) => s.role), ["requester", "responsible"]);
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: Q, requesterCanApprove: true, responsibleCanApprove: true }).steps.map((s) => s.role), ["responsible"]);
  assert.deepEqual(planSteps({ requesterId: Q, responsibleId: null, requesterCanApprove: true }).steps.map((s) => s.role), ["requester"]);
  assert.equal(planSteps({ requesterId: Q, responsibleId: null, requesterCanApprove: false }).ok, false);
  assert.equal(planSteps({ requesterId: Q, responsibleId: R, requesterCanApprove: true, responsibleCanApprove: false }).ok, false);
});

const change = (over = {}) => ({
  status: STATUS.awaitingRequester,
  expiresAt: new Date(2_000),
  steps: [{ role: "requester", user: Q, decision: null }, { role: "responsible", user: R, decision: null }],
  ...over,
});
const at = new Date(1_000);

test("the requester confirms without the right, then the responsible approves with it", () => {
  const first = decide(change(), { userId: Q, decision: "approve", channel: "telegram", canApprove: false, now: at });
  assert.equal(first.ok, true);
  assert.equal(first.patch.status, STATUS.awaitingResponsible);
  const second = change({ status: STATUS.awaitingResponsible, steps: [{ role: "requester", user: Q, decision: "approve" }, { role: "responsible", user: R, decision: null }] });
  assert.equal(decide(second, { userId: R, decision: "approve", channel: "portal", canApprove: false, now: at }).code, "no_right");
  assert.equal(decide(second, { userId: R, decision: "approve", channel: "portal", canApprove: true, now: at }).patch.status, STATUS.queued);
});

test("a sole requester step needs the right", () => {
  const solo = change({ steps: [{ role: "requester", user: Q, decision: null }] });
  assert.equal(decide(solo, { userId: Q, decision: "approve", channel: "portal", canApprove: false, now: at }).code, "no_right");
  assert.equal(decide(solo, { userId: Q, decision: "approve", channel: "portal", canApprove: true, now: at }).patch.status, STATUS.queued);
});

test("someone else, a second tap, a closed or expired request change nothing", () => {
  assert.equal(decide(change(), { userId: R, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "not_yours");
  assert.equal(decide(change({ status: STATUS.queued }), { userId: R, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "closed");
  assert.equal(decide(change({ status: STATUS.rejected }), { userId: Q, decision: "approve", channel: "telegram", canApprove: true, now: at }).code, "closed");
  assert.equal(decide(change(), { userId: Q, decision: "approve", channel: "telegram", canApprove: true, now: new Date(3_000) }).code, "expired");
});

test("either person rejects on their own step and that is final", () => {
  assert.equal(decide(change(), { userId: Q, decision: "reject", channel: "telegram", canApprove: false, now: at }).patch.status, STATUS.rejected);
  assert.equal(currentStep(change()).user, Q);
  assert.equal(currentStep(change({ status: STATUS.applied })), null);
});

test("isOpen and isFinal cover every status", () => {
  const open = [STATUS.awaitingRequester, STATUS.awaitingResponsible];
  const final = [STATUS.applied, STATUS.rolledBack, STATUS.notApplied, STATUS.rejected, STATUS.expired, STATUS.cancelled, STATUS.needsAttention];
  for (const s of Object.values(STATUS)) {
    assert.equal(isOpen(s), open.includes(s), `isOpen ${s}`);
    assert.equal(isFinal(s), final.includes(s), `isFinal ${s}`);
    assert.ok(STATUS_LABELS[s], `label ${s}`);
  }
  assert.equal(STATUS_LABELS[STATUS.queued], "Применяется");
  assert.equal(STATUS_LABELS[STATUS.cancelled], "Отозван");
  assert.equal(STATUS.needsAttention, "needs_attention");
  assert.equal(STATUS_LABELS[STATUS.needsAttention], "Требует проверки");
});

test("an unknown decision throws instead of being decided", () => {
  assert.throws(() => decide(change(), { userId: Q, decision: "maybe", channel: "portal", canApprove: true, now: at }), TypeError);
  assert.throws(() => decide(change(), { userId: Q, channel: "portal", canApprove: true, now: at }), TypeError);
});

test("the patch step points at the decided step and carries the record", () => {
  const first = decide(change(), { userId: Q, decision: "approve", channel: "telegram", canApprove: false, now: at });
  assert.deepEqual(first.patch.step, { index: 0, decision: "approve", channel: "telegram", decidedAt: at });
  const second = change({ status: STATUS.awaitingResponsible, steps: [{ role: "requester", user: Q, decision: "approve" }, { role: "responsible", user: R, decision: null }] });
  assert.equal(decide(second, { userId: R, decision: "approve", channel: "portal", canApprove: true, now: at }).patch.step.index, 1);
});

test("a reject records the comment and needs no right", () => {
  const r = decide(change(), { userId: Q, decision: "reject", channel: "portal", comment: "not me", canApprove: false, now: at });
  assert.equal(r.patch.step.decision, "reject");
  assert.equal(r.patch.step.comment, "not me");
  assert.equal(r.patch.step.index, 0);
});

test("expiry exactly at expiresAt counts as expired", () => {
  assert.equal(decide(change(), { userId: Q, decision: "approve", channel: "portal", canApprove: true, now: new Date(2_000) }).code, "expired");
  assert.equal(decide(change(), { userId: Q, decision: "approve", channel: "portal", canApprove: true, now: new Date(1_999) }).ok, true);
});

test("ids compare as strings and not-yours wins over no_right", () => {
  const oid = (s) => ({ toString: () => s });
  const c = change({ steps: [{ role: "requester", user: oid(Q), decision: null }, { role: "responsible", user: oid(R), decision: null }] });
  assert.equal(decide(c, { userId: Q, decision: "approve", channel: "portal", canApprove: false, now: at }).ok, true);
  assert.equal(decide(c, { userId: oid(R), decision: "approve", channel: "portal", canApprove: false, now: at }).code, "not_yours");
});

test("planSteps reasons are English sentences", () => {
  assert.match(planSteps({ requesterId: Q, responsibleId: null, requesterCanApprove: false }).reason, /^[A-Z].*\.$/);
  assert.match(planSteps({ requesterId: Q, responsibleId: R, requesterCanApprove: true, responsibleCanApprove: false }).reason, /^[A-Z].*\.$/);
});

test("minors: the right is tied to the last step, a broken expiry is expired, no requester is refused", () => {
  const at = new Date(1_000);
  // руками собранные шаги, заканчивающиеся шагом заявителя: право всё равно нужно
  const odd = {
    status: STATUS.awaitingRequester,
    expiresAt: new Date(2_000),
    steps: [{ role: "responsible", user: "r", decision: "approve" }, { role: "requester", user: "q", decision: null }],
  };
  assert.equal(decide(odd, { userId: "q", decision: "approve", channel: "portal", canApprove: false, now: at }).code, "no_right");
  const solo = { status: STATUS.awaitingRequester, steps: [{ role: "requester", user: "q", decision: null }] };
  assert.equal(decide({ ...solo, expiresAt: undefined }, { userId: "q", decision: "approve", channel: "portal", canApprove: true, now: at }).code, "expired");
  assert.equal(decide({ ...solo, expiresAt: "not a date" }, { userId: "q", decision: "approve", channel: "portal", canApprove: true, now: at }).code, "expired");
  const ok = decide({ ...solo, expiresAt: new Date(2_000) }, { userId: "q", decision: "approve", channel: "portal", canApprove: true, now: at });
  assert.equal("comment" in ok.patch.step, false);
  assert.equal(planSteps({ requesterId: null, responsibleId: "r", requesterCanApprove: true, responsibleCanApprove: true }).ok, false);
});
