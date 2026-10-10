// node --test services/mikrotik/eventView.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { clampLimit, parseGroup, encodeCursor, decodeCursor, olderThan, lookups, toView } = require("./eventView");

const ID = "66aa00000000000000000001";
const AT = new Date("2026-10-10T09:00:00Z");
const names = new Map([["u1", "Алексей Савин"], ["u2", "Олег Миронов"]]);

test("limit and group are clamped to what the journal knows", () => {
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit("500"), 100);
  assert.equal(clampLimit("0"), 1);
  assert.equal(parseGroup("agent"), "agent");
  assert.equal(parseGroup("$where"), null);
});

test("the cursor round-trips and rejects anything else", () => {
  const cursor = decodeCursor(encodeCursor({ at: AT, _id: ID }));
  assert.deepEqual(cursor, { at: AT, id: ID });
  assert.equal(decodeCursor("{$gt:1}"), null);
  assert.deepEqual(olderThan(null), {});
  assert.deepEqual(olderThan(cursor), { $or: [{ at: { $lt: AT } }, { at: AT, _id: { $lt: ID } }] });
});

test("lookups collect every person and ticket the events mention", () => {
  const found = lookups([
    { actor: { type: "user", userId: "u1" }, data: { responsible: { from: null, to: "u2" } } },
    { actor: { type: "mcpKey", keyId: "k1", onBehalfOf: "u1" }, refs: { ticketId: "t1" } },
  ]);
  assert.deepEqual(found, { users: ["u1", "u2"], tickets: ["t1"] });
});

test("people appear by name, ids of users and keys never leave", () => {
  const view = toView(
    { _id: ID, at: AT, kind: "changeProposed", group: "agent", severity: "info", actor: { type: "mcpKey", keyId: "k1", keyName: "OpenClaw", onBehalfOf: "u1" }, data: { title: "WireGuard" }, refs: { changeId: "c1" } },
    { names },
  );
  assert.deepEqual(view.actor, { type: "agent", name: "OpenClaw", onBehalfOf: "Алексей Савин" });
  assert.equal(view.changeId, "c1");
  assert.ok(!JSON.stringify(view).includes("k1"));
  assert.ok(!JSON.stringify(view).includes("u1"));
});

test("a responsible change shows names; a system event has no actor", () => {
  const view = toView({ _id: ID, at: AT, kind: "parametersChanged", group: "record", actor: { type: "user", userId: "u1" }, data: { fields: [], responsible: { from: null, to: "u2" } } }, { names });
  assert.deepEqual(view.data.responsible, { from: null, to: "Олег Миронов", cleared: false });
  assert.equal(toView({ _id: ID, at: AT, kind: "offline", group: "link", actor: { type: "system" } }).actor, null);
});

test("config diff lines are returned only with the right to configurations", () => {
  const event = { _id: ID, at: AT, kind: "configChanged", group: "config", data: { added: 1, removed: 0, sections: ["/ip pool"] }, diff: ["/ip pool", "+ add name=p1"] };
  const closed = toView(event);
  assert.equal(closed.hasDiff, true);
  assert.equal(closed.diff, undefined);
  assert.deepEqual(toView(event, { canSeeDiff: true }).diff, event.diff);
});

test("a ticket is linked by its number when the ticket still exists", () => {
  const event = { _id: ID, at: AT, kind: "recovered", group: "link", refs: { ticketId: "t1" } };
  assert.equal(toView(event, { ticketNums: new Map([["t1", 51802]]) }).ticketNum, 51802);
  assert.equal(toView(event).ticketNum, undefined);
});
