const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { main } = require("./cutoverStaffSessions");

const fakeConnection = () => {
  const events = [], output = [];
  let snapshot = null;
  const db = { collection(name) {
    assert.ok(["users", "authSessions", "impersonationCodes", "authCutovers"].includes(name));
    return {
      find: () => ({ toArray: async () => [] }),
      findOne: async () => snapshot,
      updateOne: async (filter, update) => {
        assert.equal(name, "authCutovers");
        events.push("snapshot");
        snapshot = { ...filter, ...update.$setOnInsert };
        return { acknowledged: true };
      },
      deleteMany: () => assert.fail("empty cutover must not delete"),
    };
  } };
  const mongoose = {
    connection: { db },
    connect: async () => { events.push("connect"); },
    disconnect: async () => { events.push("disconnect"); },
  };
  return { mongoose, events, output, log: (line) => output.push(JSON.parse(line)) };
};

test("script defaults to read-only counts and is safe to import", async () => {
  const fake = fakeConnection();
  await main({ ...fake, argv: [], env: {} });
  assert.deepEqual(fake.events, ["connect", "disconnect"]);
  assert.deepEqual(fake.output, [{ apply: false, counts: {
    staffSessions: 0, impersonationSessions: 0, preservedClientSessions: 0, impersonationCodes: 0,
  } }]);
});

test("script --apply invokes cutover and closes connection", async () => {
  const fake = fakeConnection();
  await main({ ...fake, argv: ["--apply"], env: {} });
  assert.deepEqual(fake.events, ["connect", "snapshot", "disconnect"]);
  assert.equal(fake.output[0].apply, true);
  assert.deepEqual(fake.output[0].deleted, { sessions: 0, codes: 0 });
});

test("script rejects unknown flags before connection and disconnects on cutover failure", async () => {
  const fake = fakeConnection();
  await assert.rejects(main({ ...fake, argv: ["--aply"], env: {} }), /usage/i);
  assert.deepEqual(fake.events, []);
  fake.mongoose.connection.db.collection = () => { throw new Error("fake persistence failure"); };
  await assert.rejects(main({ ...fake, argv: ["--apply"], env: {} }), /fake persistence failure/);
  assert.deepEqual(fake.events, ["connect", "disconnect"]);
  assert.deepEqual(fake.output, []);
});

test("CLI failure exits nonzero without logging persistence credentials", async () => {
  const fake = fakeConnection(), errors = [];
  fake.mongoose.connection.db.collection = () => { throw new Error("synthetic-sensitive-marker"); };
  const entry = { exports: {} };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const fakeProcess = { argv: ["node", "cutoverStaffSessions.js", "--apply"], env: {} };
  Object.defineProperty(fakeProcess, "exitCode", { set: finish });
  const dependencies = (name) => name === "mongoose" ? fake.mongoose : require(name);
  dependencies.main = entry;
  const filename = path.join(__dirname, "cutoverStaffSessions.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: entry, require: dependencies, process: fakeProcess,
    console: { log: fake.log, error: (line) => errors.push(line) },
  }, { filename });
  assert.equal(await done, 1);
  assert.deepEqual(fake.events, ["connect", "disconnect"]);
  assert.deepEqual(errors, ["Staff session cutover failed"]);
  assert.deepEqual(fake.output, []);
});

// Execute the real migration runner with process/persistence boundaries only
// replaced: no child process or network connection is ever created.
const migrationRun = async (command, applied = []) => {
  const output = [], spawned = [], recorded = [];
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const db = { collection(name) {
    if (name === "users") return { countDocuments: async () => 1 };
    assert.equal(name, "migrations");
    return {
      find: () => ({ toArray: async () => applied.map((_id) => ({ _id })) }),
      updateOne: async (filter, update) => recorded.push([filter._id, update.$setOnInsert.mode]),
    };
  } };
  const mongoose = { connection: { db }, connect: async () => {}, disconnect: async () => {} };
  const filename = path.join(__dirname, "migrate.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    __dirname,
    require: (name) => {
      if (name === "path") return path;
      if (name === "mongoose") return mongoose;
      if (name === "child_process") return { spawnSync: (...args) => { spawned.push(args); return { status: 0 }; } };
      assert.fail(`unexpected dependency ${name}`);
    },
    process: { argv: ["node", filename, command], env: {}, execPath: "node", exit: finish },
    console: { log: (line) => output.push(line), error: (line) => output.push(line) },
  }, { filename });
  return { output, spawned, recorded, exitCode: await done };
};

test("migration ledger dispatches cutover --apply exactly once when other migrations are recorded", async () => {
  const status = await migrationRun("status");
  assert.equal(status.exitCode, 0);
  const ids = status.output.filter((line) => /^ {2}· /.test(line)).map((line) => line.slice(4));
  assert.equal(ids.filter((id) => id === "2026-11-07-cutoverStaffSessions").length, 1);
  const up = await migrationRun("up", ids.filter((id) => id !== "2026-11-07-cutoverStaffSessions"));
  assert.equal(up.exitCode, 0);
  assert.equal(up.spawned.length, 1);
  assert.deepEqual(Array.from(up.spawned[0][1]), ["scripts/cutoverStaffSessions.js", "--apply"]);
  assert.deepEqual(up.recorded, [["2026-11-07-cutoverStaffSessions", "run"]]);
  const retry = await migrationRun("up", ids);
  assert.equal(retry.exitCode, 0);
  assert.deepEqual(retry.spawned, []);
  assert.deepEqual(retry.recorded, []);
});
