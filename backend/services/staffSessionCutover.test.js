const test = require("node:test");
const assert = require("node:assert/strict");
const { BSON, ObjectId } = require("mongodb");
const { planStaffSessionCutover, runStaffSessionCutover } = require("./staffSessionCutover");

const CUTOVER = "2026-11-07-w5a";
const at = new Date("2026-11-07T01:02:03.000Z");
const oid = (n) => new ObjectId(n.toString(16).padStart(24, "0"));
const fixtures = () => ({
  users: [
    { _id: oid(1), isEndUser: false, isAdmin: false },
    { _id: String(oid(2)), isEndUser: false, role: "user" },
    { _id: oid(3), isEndUser: true, role: "client-admin", isAdmin: true },
    { _id: String(oid(4)), isEndUser: true, role: "client-manager" },
    { _id: oid(5), isEndUser: null, isAdmin: true },
    { _id: oid(6), role: "admin", isAdmin: true },
    { _id: oid(7), isEndUser: 0 },
  ],
  sessions: [
    { _id: oid(11), userId: String(oid(1)) },
    { _id: "staff-string", userId: oid(2) },
    { _id: oid(13), userId: oid(1), impersonatedBy: String(oid(2)) },
    { _id: oid(14), userId: oid(3), impersonatedBy: String(oid(1)) },
    { _id: "staff-to-client", userId: String(oid(4)), impersonatedBy: oid(2) },
    { _id: oid(16), userId: oid(3) },
    { _id: oid(17), userId: oid(4) },
    { _id: oid(18), userId: String(oid(5)) },
    { _id: oid(19), userId: String(oid(6)) },
    { _id: oid(20), userId: oid(7) },
    { _id: oid(21), userId: oid(3), impersonatedBy: String(oid(6)) },
    { _id: "orphan", userId: "unknown" },
  ],
  codes: [
    { _id: oid(31), adminId: String(oid(1)), targetId: String(oid(3)) },
    { _id: "staff-code", adminId: oid(2) },
    { _id: oid(33), impersonatedBy: oid(1) },
    { _id: oid(34), adminId: String(oid(3)), targetId: String(oid(1)) },
    { _id: oid(35), adminId: oid(5) },
    { _id: oid(36), adminId: oid(6) },
    { _id: oid(37), targetId: String(oid(1)) },
  ],
});
const counts = { staffSessions: 3, impersonationSessions: 2, preservedClientSessions: 6, impersonationCodes: 3 };

// Match native Mongo _ids by both value AND BSON type.
const sameId = (left, right) => typeof left === typeof right && String(left) === String(right);
const memoryDb = (input = fixtures()) => {
  const rows = { users: input.users, authSessions: input.sessions, impersonationCodes: input.codes, authCutovers: [] };
  const events = [], faults = {};
  const db = { collection(name, options) {
    assert.ok(Object.hasOwn(rows, name), `forbidden collection: ${name}`);
    if (name === "authCutovers") assert.deepEqual(options, { readConcern: { level: "majority" } });
    return {
      find(filter, options) {
        assert.deepEqual(filter, {});
        assert.ok(options.projection);
        events.push(["read", name]);
        return { toArray: async () => rows[name].map((row) => Object.fromEntries(
          Object.keys(options.projection).filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]),
        )) };
      },
      async findOne(filter) {
        assert.equal(name, "authCutovers");
        assert.deepEqual(filter, { _id: CUTOVER });
        return rows[name].find((row) => row._id === filter._id) || null;
      },
      async updateOne(filter, update, options) {
        assert.equal(name, "authCutovers");
        assert.deepEqual(filter, { _id: CUTOVER });
        assert.deepEqual(Object.keys(update), ["$setOnInsert"]);
        assert.deepEqual(options, { upsert: true, writeConcern: { w: "majority" } });
        if (faults.snapshot) throw new Error("snapshot unavailable");
        if (faults.unacknowledged) return { acknowledged: false };
        if (faults.winner) {
          rows[name].push(faults.winner);
          if (faults.duplicate) throw Object.assign(new Error("duplicate"), { code: 11000 });
        }
        if (!rows[name].length) rows[name].push(BSON.deserialize(BSON.serialize({ _id: CUTOVER, ...update.$setOnInsert })));
        events.push(["snapshot", name]);
        return { acknowledged: true };
      },
      async deleteMany(filter) {
        assert.ok(["authSessions", "impersonationCodes"].includes(name));
        assert.ok(rows.authCutovers.length, "durable snapshot must precede deletes");
        assert.deepEqual(Object.keys(filter), ["_id"]);
        assert.deepEqual(Object.keys(filter._id), ["$in"]);
        assert.ok(filter._id.$in.length, "never issue a blanket/empty delete");
        const snapshot = rows.authCutovers[0];
        assert.deepEqual(filter._id.$in, name === "authSessions" ? snapshot.sessionIds : snapshot.codeIds);
        if (faults[name]) throw new Error(`interrupted ${name}`);
        const before = rows[name].length;
        rows[name] = rows[name].filter((row) => !filter._id.$in.some((id) => sameId(row._id, id)));
        events.push(["delete", name]);
        return { deletedCount: before - rows[name].length };
      },
    };
  } };
  return { db, rows, events, faults };
};

test("selector uses exact false audience and native IDs, preserving all independent clients", () => {
  const input = fixtures(), before = JSON.stringify(input);
  assert.deepEqual(planStaffSessionCutover(input), {
    sessionIds: [oid(11), "staff-string", oid(13), oid(14), "staff-to-client"],
    codeIds: [oid(31), "staff-code", oid(33)], counts,
  });
  assert.equal(JSON.stringify(input), before, "selector must not mutate records");
});

test("relationship matching normalizes ObjectId hex but preserves native record ID types", () => {
  const id = new ObjectId("abcdefabcdefabcdefabcdef");
  const plan = planStaffSessionCutover({
    users: [{ _id: String(id).toUpperCase(), isEndUser: false }],
    sessions: [{ _id: oid(1), userId: id }, { _id: String(oid(1)), impersonatedBy: id }],
    codes: [{ _id: "code", adminId: id }],
  });
  assert.deepEqual(plan.sessionIds, [oid(1), String(oid(1))]);
  assert.deepEqual(plan.codeIds, ["code"]);
});

test("dry run returns counts only and performs no writes", async () => {
  const fake = memoryDb();
  assert.deepEqual(await runStaffSessionCutover({ db: fake.db, now: at }), { apply: false, counts });
  assert.equal(fake.rows.authCutovers.length, 0);
  assert.equal(fake.rows.authSessions.length, 12);
  assert.ok(fake.events.every(([event]) => event === "read"));
});

test("apply snapshots IDs/time before exact deletes without writes to users or other collections", async () => {
  const fake = memoryDb(), usersBefore = JSON.stringify(fake.rows.users);
  assert.deepEqual(await runStaffSessionCutover({ db: fake.db, apply: true, now: at }),
    { apply: true, counts, deleted: { sessions: 5, codes: 3 } });
  assert.deepEqual(fake.rows.authCutovers, [{
    _id: CUTOVER, capturedAt: at,
    sessionIds: [oid(11), "staff-string", oid(13), oid(14), "staff-to-client"],
    codeIds: [oid(31), "staff-code", oid(33)], counts,
  }]);
  assert.deepEqual(fake.rows.authSessions.map((row) => row._id),
    [oid(16), oid(17), oid(18), oid(19), oid(20), oid(21), "orphan"]);
  assert.deepEqual(fake.rows.impersonationCodes.map((row) => row._id), [oid(34), oid(35), oid(36), oid(37)]);
  assert.equal(JSON.stringify(fake.rows.users), usersBefore);
  assert.deepEqual(fake.events.filter(([event]) => event !== "read"),
    [["snapshot", "authCutovers"], ["delete", "authSessions"], ["delete", "impersonationCodes"]]);
});

test("interrupted retry uses original snapshot and preserves newly authenticated staff sessions/codes", async () => {
  const fake = memoryDb();
  fake.faults.impersonationCodes = true;
  await assert.rejects(runStaffSessionCutover({ db: fake.db, apply: true, now: at }), /interrupted/);
  const saved = JSON.stringify(fake.rows.authCutovers);
  fake.rows.authSessions.push({ _id: oid(99), userId: oid(1) });
  fake.rows.impersonationCodes.push({ _id: oid(98), adminId: oid(1) });
  fake.faults.impersonationCodes = false;
  const reads = fake.events.length;
  assert.deepEqual(await runStaffSessionCutover({ db: fake.db, now: new Date() }), { apply: false, counts });
  assert.equal(fake.events.length, reads, "snapshot preview must not rescan/write");
  assert.deepEqual((await runStaffSessionCutover({ db: fake.db, apply: true, now: new Date() })).deleted,
    { sessions: 0, codes: 3 });
  assert.ok(fake.rows.authSessions.some((row) => sameId(row._id, oid(99))));
  assert.ok(fake.rows.impersonationCodes.some((row) => sameId(row._id, oid(98))));
  assert.equal(JSON.stringify(fake.rows.authCutovers), saved);
  assert.deepEqual((await runStaffSessionCutover({ db: fake.db, apply: true })).deleted, { sessions: 0, codes: 0 });
});

test("completed cutover also preserves a later staff login on rerun", async () => {
  const fake = memoryDb();
  await runStaffSessionCutover({ db: fake.db, apply: true });
  fake.rows.authSessions.push({ _id: oid(99), userId: oid(1) });
  assert.deepEqual((await runStaffSessionCutover({ db: fake.db, apply: true })).deleted, { sessions: 0, codes: 0 });
  assert.ok(fake.rows.authSessions.some((row) => sameId(row._id, oid(99))));
});

for (const fault of ["snapshot", "unacknowledged"]) {
  test(`${fault} failure blocks every delete`, async () => {
    const fake = memoryDb();
    fake.faults[fault] = true;
    await assert.rejects(runStaffSessionCutover({ db: fake.db, apply: true }), /snapshot/i);
    assert.equal(fake.rows.authSessions.length, 12);
    assert.ok(!fake.events.some(([event]) => event === "delete"));
  });
}

for (const duplicate of [false, true]) {
  test(`concurrent insert-once winner is authoritative (duplicate error: ${duplicate})`, async () => {
    const fake = memoryDb();
    fake.faults.duplicate = duplicate;
    fake.faults.winner = {
      _id: CUTOVER, capturedAt: at, sessionIds: [oid(11)], codeIds: [],
      counts: { staffSessions: 1, impersonationSessions: 0, preservedClientSessions: 6, impersonationCodes: 0 },
    };
    await runStaffSessionCutover({ db: fake.db, apply: true });
    assert.equal(fake.rows.authSessions.length, 11);
    assert.equal(fake.rows.impersonationCodes.length, 7);
    assert.ok(fake.rows.authSessions.some((row) => row._id === "staff-string"));
  });
}

test("invalid snapshot or selected record IDs fail closed before deletion", async () => {
  const fake = memoryDb();
  fake.rows.authCutovers.push({ _id: CUTOVER, capturedAt: at, sessionIds: [null], codeIds: [], counts });
  await assert.rejects(runStaffSessionCutover({ db: fake.db, apply: true }), /snapshot/i);
  assert.ok(!fake.events.some(([event]) => event === "delete"));
  assert.throws(() => planStaffSessionCutover({
    users: [{ _id: oid(1), isEndUser: false }], sessions: [{ userId: oid(1) }], codes: [],
  }), /id/i);
});

test("empty cutover captures once without any delete", async () => {
  const fake = memoryDb({ users: [], sessions: [], codes: [] });
  await runStaffSessionCutover({ db: fake.db, apply: true, now: at });
  assert.equal(fake.rows.authCutovers.length, 1);
  assert.ok(!fake.events.some(([event]) => event === "delete"));
});

test("conflicting string/ObjectId audience classification blocks cutover", async () => {
  const fake = memoryDb();
  fake.rows.users.push({ _id: String(oid(1)), isEndUser: true });
  await assert.rejects(runStaffSessionCutover({ db: fake.db, apply: true }), /audience/i);
  assert.equal(fake.rows.authCutovers.length, 0);
  assert.ok(!fake.events.some(([event]) => event === "delete"));
});

test("record IDs remain case-sensitive strings while relationships normalize ObjectIds", () => {
  const lower = "abcdefabcdefabcdefabcdef", upper = lower.toUpperCase();
  assert.deepEqual(planStaffSessionCutover({
    users: [{ _id: oid(1), isEndUser: false }],
    sessions: [{ _id: lower, userId: oid(1) }, { _id: upper, userId: String(oid(1)) }],
    codes: [],
  }).sessionIds, [lower, upper]);
});

test("native ObjectId deletion preserves a client string _id with identical hex", async () => {
  const fake = memoryDb();
  fake.rows.authSessions.push({ _id: String(oid(11)), userId: oid(3) });
  await runStaffSessionCutover({ db: fake.db, apply: true });
  assert.ok(fake.rows.authSessions.some((row) => row._id === String(oid(11))));
  assert.ok(!fake.rows.authSessions.some((row) => sameId(row._id, oid(11))));
});

test("duplicate selected IDs and inconsistent persisted counts fail closed", async () => {
  const input = fixtures();
  input.sessions.push({ ...input.sessions[0] });
  assert.throws(() => planStaffSessionCutover(input), /duplicate.*id/i);
  const fake = memoryDb();
  fake.rows.authCutovers.push({
    _id: CUTOVER, capturedAt: at, sessionIds: [oid(11)], codeIds: [], counts,
  });
  await assert.rejects(runStaffSessionCutover({ db: fake.db, apply: true }), /snapshot/i);
  assert.ok(!fake.events.some(([event]) => event === "delete"));
});
