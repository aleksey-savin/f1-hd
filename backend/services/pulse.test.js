// node --test services/pulse.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createBus } = require("./pulse");

test("one global sequence: a topic remembers the revision of its last bump", () => {
  const bus = createBus();
  assert.equal(bus.rev(), 0);
  bus.bump({ topics: ["tickets"] });
  bus.bump({ topics: ["presence"] });
  bus.bump({ topics: ["tickets", "approval"] });
  assert.equal(bus.rev(), 3);
  assert.deepEqual(
    { tickets: bus.topics().tickets, presence: bus.topics().presence, approval: bus.topics().approval },
    { tickets: 3, presence: 2, approval: 3 },
  );
  assert.equal(bus.topics().mikrotik, 0);
});

test("an empty or unknown bump does not move the sequence", () => {
  const bus = createBus();
  bus.bump({});
  bus.bump({ topics: ["nope"] });
  bus.bump();
  assert.equal(bus.rev(), 0);
});

test("a ticket reports the revision of its own last change", () => {
  const bus = createBus();
  bus.bump({ topics: ["tickets"], ticketIds: ["a"] });
  bus.bump({ topics: ["tickets"], ticketIds: ["b"] });
  assert.equal(bus.ticketRev("a"), 1);
  assert.equal(bus.ticketRev("b"), 2);
  assert.equal(bus.ticketRev("never"), 0);
});

test("a change with an unknown ticket counts for every ticket", () => {
  const bus = createBus();
  bus.bump({ topics: ["tickets"], ticketIds: ["a"] });
  bus.bump({ topics: ["tickets"], anyTicket: true });
  assert.equal(bus.ticketRev("a"), 2);
  assert.equal(bus.ticketRev("never"), 2);
});

test("eviction: a forgotten ticket reports the newest evicted revision, never less", () => {
  const bus = createBus({ ticketCapacity: 3 });
  for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
    bus.bump({ topics: ["tickets"], ticketIds: [id] });
  }
  // t1 (rev 1) and t2 (rev 2) evicted → floor 2
  assert.equal(bus.ticketRev("t1"), 2);
  assert.equal(bus.ticketRev("t2"), 2);
  assert.equal(bus.ticketRev("never"), 2);
  assert.equal(bus.ticketRev("t5"), 5);
});

test("re-bumping a ticket keeps it from being evicted first", () => {
  const bus = createBus({ ticketCapacity: 2 });
  bus.bump({ ticketIds: ["a"] }); // 1
  bus.bump({ ticketIds: ["b"] }); // 2
  bus.bump({ ticketIds: ["a"] }); // 3 — a is now the newest
  bus.bump({ ticketIds: ["c"] }); // 4 — evicts b
  assert.equal(bus.ticketRev("a"), 3);
  assert.equal(bus.ticketRev("b"), 2);
  assert.equal(bus.ticketRev("c"), 4);
});

test("inbox revisions are per person", () => {
  const bus = createBus();
  bus.bump({ userIds: ["u1"] });
  bus.bump({ userIds: ["u2"] });
  assert.equal(bus.userRev("u1"), 1);
  assert.equal(bus.userRev("u2"), 2);
  assert.equal(bus.userRev("u3"), 0);
  bus.bump({ anyUser: true });
  assert.equal(bus.userRev("u3"), 3);
});

test("cursor: only this process's epoch is honoured", () => {
  const bus = createBus();
  const other = createBus();
  bus.bump({ topics: ["tickets"] });
  assert.notEqual(bus.epoch, other.epoch);
  assert.equal(bus.parseCursor(bus.cursor()), 1);
  assert.equal(bus.parseCursor(other.cursor()), null);
  assert.equal(bus.parseCursor(`${bus.epoch}:x`), null);
  assert.equal(bus.parseCursor(undefined), null);
  assert.equal(bus.parseCursor(""), null);
});

test("bump never throws on garbage", () => {
  const bus = createBus();
  assert.doesNotThrow(() => bus.bump({ topics: null }));
  assert.doesNotThrow(() => bus.bump({ ticketIds: [null, undefined, {}] }));
});
