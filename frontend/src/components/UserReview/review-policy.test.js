import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewActions } from "./review-policy.js";

const proposal = {
  kind: "departure",
  status: "pending",
  evidence: [],
  user: { _id: "person", banned: false },
};
const operator = { canManage: true, canManageUsers: true };
test("a reviewer may resolve evidence without gaining account mutation access", () => {
  const actions = reviewActions(
    { canManage: true, canManageUsers: false },
    proposal,
    "2026-11-09",
  );
  assert.equal(actions.disable, false);
  assert.equal(actions.dismiss, true);
  assert.equal(actions.defer, true);
});
test("future departures and explicit preserved access never offer an immediate disable", () => {
  assert.equal(
    reviewActions(
      operator,
      { ...proposal, evidence: [{ effectiveDate: "2026-11-15" }] },
      "2026-11-09",
    ).disable,
    false,
  );
  assert.equal(
    reviewActions(
      operator,
      { ...proposal, evidence: [{ access: "preserve" }] },
      "2026-11-09",
    ).disable,
    false,
  );
  assert.equal(
    reviewActions(
      operator,
      { ...proposal, evidence: [{ employment: "return" }] },
      "2026-11-09",
    ).disable,
    false,
  );
});
test("unresolved identities must be matched before disabling", () => {
  const actions = reviewActions(
    operator,
    { ...proposal, kind: "unresolved" },
    "2026-11-09",
  );
  assert.equal(actions.disable, false);
  assert.equal(actions.match, true);
});
test("restore is offered for soft-deleted records without offering another delete", () => {
  const actions = reviewActions(
    operator,
    { ...proposal, status: "deleted" },
    "2026-11-09",
  );
  assert.equal(actions.restore, true);
  assert.equal(actions.delete, false);
});
test("a later departure replaces an older return when choosing current actions", () => {
  const actions = reviewActions(
    operator,
    {
      ...proposal,
      evidence: [
        {
          employment: "return",
          access: "preserve",
          sourceAt: "2026-01-01T00:00:00Z",
        },
        {
          employment: "departure",
          access: "closeAll",
          sourceAt: "2026-11-01T00:00:00Z",
        },
      ],
    },
    "2026-11-09",
  );
  assert.equal(actions.disable, true);
});

test("rule-based inactivity offers disable and soft-delete despite the model's default evidence flag", () => {
  const actions = reviewActions(
    operator,
    { ...proposal, kind: "inactivity", actionable: false, blocked: false },
    "2026-11-09",
  );
  assert.equal(actions.disable, true);
  assert.equal(actions.delete, true);
});

test("a disabled account offers deletion, while a deleted or unmatched account offers no new mutation", () => {
  const disabled = reviewActions(
    operator,
    {
      ...proposal,
      kind: "deletion",
      actionable: false,
      user: { _id: "person", banned: true },
    },
    "2026-11-09",
  );
  assert.equal(disabled.delete, true);
  assert.equal(disabled.disable, false);
  const deleted = reviewActions(
    operator,
    { ...proposal, user: { _id: "person", deletedAt: "2026-11-01" } },
    "2026-11-09",
  );
  assert.equal(deleted.delete, false);
  assert.equal(deleted.disable, false);
  const absent = reviewActions(
    operator,
    { ...proposal, user: null },
    "2026-11-09",
  );
  assert.equal(absent.delete, false);
  assert.equal(absent.disable, false);
});

test("text counterevidence blocks deletion as well as disabling, including retained evidence in a rule proposal", () => {
  const blocked = reviewActions(
    operator,
    {
      ...proposal,
      kind: "inactivity",
      evidence: [{ employment: "return", access: "preserve" }],
      actionable: false,
    },
    "2026-11-09",
  );
  assert.equal(blocked.delete, false);
  assert.equal(blocked.disable, false);
  const completed = reviewActions(
    operator,
    { ...proposal, status: "disabled", blocked: true },
    "2026-11-09",
  );
  assert.equal(completed.delete, false);
});

test("deferral keeps manual review actions available before its scheduled date", () => {
  const actions = reviewActions(
    operator,
    {
      ...proposal,
      kind: "inactivity",
      status: "deferred",
      deferredUntil: "2027-02-07",
      actionable: false,
    },
    "2026-11-09",
  );
  assert.equal(actions.disable, true);
  assert.equal(actions.delete, true);
  assert.equal(actions.dismiss, true);
  assert.equal(actions.defer, true);
});

test("deferral preserves permission and evidence restrictions on account actions", () => {
  const deferred = {
    ...proposal,
    kind: "inactivity",
    status: "deferred",
    actionable: false,
  };
  const readOnly = reviewActions(
    { canManage: true, canManageUsers: false },
    deferred,
    "2026-11-09",
  );
  assert.equal(readOnly.disable, false);
  assert.equal(readOnly.delete, false);
  assert.equal(readOnly.dismiss, true);
  const returned = reviewActions(
    operator,
    { ...deferred, evidence: [{ employment: "return", access: "preserve" }] },
    "2026-11-09",
  );
  assert.equal(returned.disable, false);
  assert.equal(returned.delete, false);
  for (const status of ["dismissed", "restored"]) {
    const closed = reviewActions(
      operator,
      { ...deferred, status },
      "2026-11-09",
    );
    assert.equal(closed.disable, false);
    assert.equal(closed.delete, false);
  }
});
