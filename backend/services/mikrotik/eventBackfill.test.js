// node --test services/mikrotik/eventBackfill.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { fromOutage, fromUpgradeItem, fromChange, fromArtifacts, inWindow } = require("./eventBackfill");
const { KINDS } = require("./eventKinds");

const d = (text) => new Date(text);

test("an outage becomes offline and recovered; an open one only offline", () => {
  const closed = fromOutage({ _id: "o1", mikrotik: "r1", startedAt: d("2026-10-02T13:58:00Z"), endedAt: d("2026-10-02T14:06:00Z"), ticketId: "t1", lastError: "timeout" });
  assert.deepEqual(closed.map((e) => [e.kind, e.mikrotik, e.dedupeKey]), [
    ["offline", "r1", "outage:o1:offline"],
    ["recovered", "r1", "outage:o1:recovered"],
  ]);
  assert.equal(closed[1].data.downSeconds, 480);
  assert.deepEqual(closed[1].refs, { ticketId: "t1" });
  assert.equal(fromOutage({ _id: "o2", mikrotik: "r1", startedAt: d("2026-10-02T13:58:00Z") }).length, 1);
});

test("an upgrade item becomes start, reboot and its outcome", () => {
  const job = { _id: "j1", createdBy: "u1" };
  const item = { _id: "i1", mikrotik: "r1", channel: "stable", state: "done", from: { os: "7.20.1" }, to: { os: "7.23.7" }, startedAt: d("2026-10-08T02:08:00Z"), rebootRequestedAt: d("2026-10-08T02:16:00Z"), finishedAt: d("2026-10-08T02:19:00Z") };
  assert.deepEqual(fromUpgradeItem(job, item).map((e) => e.kind), ["upgradeStarted", "reboot", "upgradeFinished"]);
  const failed = fromUpgradeItem(job, { ...item, state: "failed", error: "нет места", rebootRequestedAt: undefined });
  assert.deepEqual(failed.map((e) => e.kind), ["upgradeStarted", "upgradeFailed"]);
  assert.equal(failed[1].data.error, "нет места");
  assert.deepEqual(fromUpgradeItem(job, { _id: "i2", mikrotik: "r1", state: "skipped" }), []);
});

test("a change request becomes the proposal, each decision and the outcome", () => {
  const events = fromChange({
    _id: "c1",
    mikrotik: "r1",
    title: "WireGuard",
    requestedBy: "u1",
    requestedVia: { keyId: "k1", keyName: "OpenClaw" },
    commands: [{}, {}],
    status: "applied",
    createdAt: d("2026-10-10T09:38:00Z"),
    steps: [
      { user: "u1", decision: "approve", channel: "telegram", decidedAt: d("2026-10-10T09:41:00Z") },
      { user: "u2", decision: "approve", channel: "portal", decidedAt: d("2026-10-10T09:51:00Z") },
    ],
    timeline: [{ at: d("2026-10-10T09:38:00Z") }, { at: d("2026-10-10T09:52:00Z") }],
  });
  assert.deepEqual(events.map((e) => [e.kind, e.at.toISOString().slice(11, 16)]), [
    ["changeProposed", "09:38"],
    ["changeConfirmed", "09:41"],
    ["changeApproved", "09:51"],
    ["changeApplied", "09:52"],
  ]);
  assert.deepEqual(events[0].actor, { type: "mcpKey", keyId: "k1", keyName: "OpenClaw", onBehalfOf: "u1" });
  assert.equal(new Set(events.map((e) => e.dedupeKey)).size, 4);
});

test("an open request has no outcome; a withdrawn one names the requester", () => {
  const open = fromChange({ _id: "c2", mikrotik: "r1", requestedBy: "u1", status: "awaiting_requester", createdAt: d("2026-10-10T09:38:00Z"), steps: [{ user: "u1", decision: null }] });
  assert.deepEqual(open.map((e) => e.kind), ["changeProposed"]);
  const withdrawn = fromChange({ _id: "c3", mikrotik: "r1", requestedBy: "u1", status: "cancelled", createdAt: d("2026-10-10T09:38:00Z"), updatedAt: d("2026-10-10T10:00:00Z") });
  assert.deepEqual(withdrawn.at(-1).actor, { type: "user", userId: "u1" });
});

test("stored exports become copies, and a different hash a change without detail", () => {
  const events = fromArtifacts([
    { _id: "a1", mikrotik: "r1", createdAt: d("2026-10-08T00:00:00Z"), trigger: "scheduled", contentHash: "h1" },
    { _id: "a2", mikrotik: "r1", createdAt: d("2026-10-09T00:00:00Z"), trigger: "scheduled", contentHash: "h1" },
    { _id: "a3", mikrotik: "r1", createdAt: d("2026-10-10T00:00:00Z"), trigger: "manual", contentHash: "h2", createdBy: "u1" },
  ]);
  assert.deepEqual(events.map((e) => e.kind), ["exportCreated", "exportCreated", "exportCreated", "configChanged"]);
  assert.deepEqual(events.at(-1).data, { unknown: true });
  assert.deepEqual(events[2].actor, { type: "user", userId: "u1" });
});

test("every backfilled kind is in the catalogue", () => {
  const all = [
    ...fromOutage({ _id: "o", mikrotik: "r", startedAt: d("2026-10-01T00:00:00Z"), endedAt: d("2026-10-01T01:00:00Z") }),
    ...fromArtifacts([{ _id: "a", mikrotik: "r", createdAt: d("2026-10-01T00:00:00Z") }]),
  ];
  for (const event of all) assert.ok(KINDS[event.kind], event.kind);
});

test("inWindow keeps what is inside retention and before the live journal began", () => {
  const events = [{ at: d("2025-01-01T00:00:00Z") }, { at: d("2026-10-01T00:00:00Z") }, { at: d("2026-10-11T00:00:00Z") }, {}];
  assert.deepEqual(inWindow(events, { from: d("2025-10-11T00:00:00Z"), before: d("2026-10-10T12:00:00Z") }), [{ at: d("2026-10-01T00:00:00Z") }]);
});
