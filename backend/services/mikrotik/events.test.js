// node --test services/mikrotik/events.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createEventLog, keyActor, userActor, ACCESS_WINDOW_MS, MAX_DIFF_LINES } = require("./events");
const { KINDS, GROUPS, SEVERITIES } = require("./eventKinds");

const NOW = new Date("2026-10-10T09:00:00Z");

// Хранилище в памяти с теми же обещаниями, что mongoStore
function fakeStore() {
  const docs = [];
  return {
    docs,
    async insert(doc) { docs.push({ count: 1, ...doc }); return docs.at(-1); },
    async upsert(doc) {
      const found = docs.find((d) => d.dedupeKey === doc.dedupeKey);
      if (found) return found;
      docs.push({ count: 1, ...doc });
      return docs.at(-1);
    },
    async bumpAccess({ recordId, keyId, since, at, tool, target }) {
      const open = docs.find((d) => d.mikrotik === recordId && d.kind === "agentAccess" && d.actor.keyId === keyId && d.at >= since);
      if (!open) return null;
      open.count += 1;
      open.at = at;
      if (tool && !open.data.tools.includes(tool)) open.data.tools.push(tool);
      if (target && !open.data.targets.includes(target)) open.data.targets.push(target);
      return open;
    },
    async removeFor(recordId) {
      for (let i = docs.length - 1; i >= 0; i -= 1) if (docs[i].mikrotik === recordId) docs.splice(i, 1);
    },
  };
}

test("catalogue: every kind has a known group and severity", () => {
  for (const [name, entry] of Object.entries(KINDS)) {
    assert.ok(GROUPS.includes(entry.group), name);
    assert.ok(SEVERITIES.includes(entry.severity), name);
  }
});

test("record fills group and severity from the catalogue", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  await events.record("r1", "offline", { data: { error: "timeout" } });
  assert.deepEqual(store.docs[0], {
    count: 1,
    mikrotik: "r1",
    at: NOW,
    kind: "offline",
    group: "link",
    severity: "danger",
    actor: { type: "system" },
    data: { error: "timeout" },
  });
});

test("record keeps an explicit severity, time and actor", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  const at = new Date("2026-10-09T01:00:00Z");
  await events.record("r1", "reboot", { at, severity: "warning", actor: userActor("u1") });
  assert.equal(store.docs[0].severity, "warning");
  assert.equal(store.docs[0].at, at);
  assert.deepEqual(store.docs[0].actor, { type: "user", userId: "u1" });
});

test("record with a dedupeKey is written once", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  await events.record("r1", "exportCreated", { dedupeKey: "artifact:a1" });
  await events.record("r1", "exportCreated", { dedupeKey: "artifact:a1" });
  assert.equal(store.docs.length, 1);
});

test("record never throws: unknown kind and a failing store are logged", async () => {
  const warnings = [];
  const log = { log: (level, message) => warnings.push(message) };
  const events = createEventLog({ store: { insert: async () => { throw new Error("db down"); } }, now: () => NOW, log });
  assert.equal(await events.record("r1", "nope"), null);
  assert.equal(await events.record("r1", "offline"), null);
  assert.equal(await events.record(null, "offline"), null);
  assert.equal(warnings.length, 2);
});

test("diff is capped", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  await events.record("r1", "configChanged", { diff: Array.from({ length: 200 }, (_, i) => `+ line ${i}`) });
  assert.equal(store.docs[0].diff.length, MAX_DIFF_LINES);
});

test("agent access inside the window collapses into one row", async () => {
  const store = fakeStore();
  let clock = NOW;
  const events = createEventLog({ store, now: () => clock });
  const caller = { keyId: "k1", keyName: "OpenClaw" };
  await events.recordAccess("r1", { caller, tool: "config" });
  clock = new Date(NOW.getTime() + 60_000);
  await events.recordAccess("r1", { caller, tool: "state" });
  clock = new Date(NOW.getTime() + 120_000);
  await events.recordAccess("r1", { caller, tool: "ping", target: "10.0.55.1" });
  assert.equal(store.docs.length, 1);
  const [row] = store.docs;
  assert.equal(row.count, 3);
  assert.equal(row.at, clock);
  assert.deepEqual(row.data, { since: NOW, tools: ["config", "state", "ping"], targets: ["10.0.55.1"] });
  assert.deepEqual(row.actor, keyActor(caller));
});

test("agent access after the window, from another key or on another device starts a new row", async () => {
  const store = fakeStore();
  let clock = NOW;
  const events = createEventLog({ store, now: () => clock });
  await events.recordAccess("r1", { caller: { keyId: "k1", keyName: "A" }, tool: "config" });
  await events.recordAccess("r1", { caller: { keyId: "k2", keyName: "B" }, tool: "config" });
  await events.recordAccess("r2", { caller: { keyId: "k1", keyName: "A" }, tool: "config" });
  clock = new Date(NOW.getTime() + ACCESS_WINDOW_MS + 1000);
  await events.recordAccess("r1", { caller: { keyId: "k1", keyName: "A" }, tool: "config" });
  assert.equal(store.docs.length, 4);
});

test("agent access without a key is not written", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  assert.equal(await events.recordAccess("r1", { caller: {}, tool: "config" }), null);
  assert.equal(store.docs.length, 0);
});

test("removeFor drops only that device's events", async () => {
  const store = fakeStore();
  const events = createEventLog({ store, now: () => NOW });
  await events.record("r1", "offline");
  await events.record("r2", "offline");
  await events.removeFor("r1");
  assert.deepEqual(store.docs.map((d) => d.mikrotik), ["r2"]);
});
