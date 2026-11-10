const test = require("node:test");
const assert = require("node:assert/strict");
const { advanceScan, publicView } = require("./guest-security");
const vm = {
  _id: "vm",
  kind: "guest",
  guestType: "qemu",
  status: "running",
  vmid: 100,
  nodeName: "pve",
  archived: false,
};
const connection = { monitoringEnabled: true, archived: false };
const os = {
  id: "ubuntu",
  "version-id": "22.04",
  "pretty-name": "Ubuntu 22.04 LTS",
};
test("disabled guest-agent never runs a collector", async () => {
  const calls = [],
    writes = [];
  await advanceScan({ status: "queued" }, vm, connection, {
    request: async (_c, path) => {
      calls.push(path);
      return { agent: "0" };
    },
    save: async (patch) => writes.push(patch),
  });
  assert.equal(calls.length, 1);
  assert.equal(writes.at(-1).status, "unavailable");
  assert.match(writes.at(-1).lastError, /опция Guest Agent отключена/i);
});
test("start persists dispatch state before POST and captures PID for later polling", async () => {
  const writes = [];
  await advanceScan({ status: "queued" }, vm, connection, {
    save: async (patch) => writes.push(patch),
    request: async (_c, path, options) => {
      if (path.includes("/config")) return { agent: "enabled=1" };
      if (path.endsWith("/get-osinfo")) return { result: os };
      assert.equal(writes.at(-1).status, "starting");
      assert.equal(options.method, "POST");
      assert.equal(options.json, true);
      assert.equal(options.body.command[0], "/bin/sh");
      return { pid: 321 };
    },
  });
  assert.equal(writes.at(-1).status, "collecting");
  assert.equal(writes.at(-1).job.pid, 321);
});
test("lost dispatch response cannot silently re-execute a root collector", async () => {
  const writes = [];
  await advanceScan({ status: "starting" }, vm, connection, {
    save: async (patch) => writes.push(patch),
    request: async () => assert.fail("must not retry POST"),
  });
  assert.equal(writes.at(-1).status, "error");
});
test("truncated output and API permission failures retain previous findings", async () => {
  for (const response of [
    { exited: 1, exitcode: 0, "out-truncated": true, "out-data": "partial" },
    new Error("API Proxmox отклонил токен (HTTP 403)"),
  ]) {
    const writes = [];
    const result = { findings: [{ id: "CVE-2025-12345" }] };
    await advanceScan(
      {
        status: "collecting",
        report: result,
        job: { os, pid: 123, nodeName: "pve", startedAt: new Date() },
      },
      vm,
      connection,
      {
        save: async (patch) => writes.push(patch),
        request: async () => {
          if (response instanceof Error) throw response;
          return response;
        },
      },
    );
    assert.equal(writes.at(-1).status, "error");
    assert.equal(Object.hasOwn(writes.at(-1), "report"), false);
    assert.equal(Object.hasOwn(writes.at(-1), "checkedAt"), false);
  }
});
test("collected inventory is checkpointed; checking retries do not execute guest commands", async () => {
  const writes = [];
  const inventory = {
    os: { id: "ubuntu", version: "22.04", name: "Ubuntu" },
    packages: [
      {
        name: "openssl",
        source: "openssl",
        version: "3.0.2-1",
        sourceVersion: "3.0.2-1",
      },
    ],
  };
  await advanceScan({ status: "checking", inventory }, vm, connection, {
    save: async (patch) => writes.push(patch),
    request: async () => assert.fail("no guest command during evaluation"),
    evaluate: async (input) => {
      assert.equal(input, inventory);
      return { status: "completed", findings: [], os: inventory.os };
    },
  });
  assert.equal(writes.at(-1).status, "completed");
  assert.equal(writes.at(-1).report.findings.length, 0);
  assert.ok(writes.at(-1).checkedAt);
});
test("scan DTO exposes report and freshness, never inventory, PID or worker lease", () => {
  const value = publicView({
    resourceId: "vm",
    status: "error",
    report: { findings: [{ id: "CVE-2025-12345" }], os: { name: "Ubuntu" } },
    checkedAt: new Date(0),
    inventory: ["private"],
    job: { pid: 123 },
    leaseToken: "secret",
  });
  assert.equal(value.findings.length, 1);
  for (const key of ["inventory", "job", "leaseToken"])
    assert.equal(Object.hasOwn(value, key), false);
});
test("pending agent enable waits for restart and never dispatches a collector", async () => {
  const writes = [], paths = [];
  await advanceScan({ status: "queued" }, vm, connection, {
    save: async (patch) => writes.push(patch),
    request: async (_c, path) => {
      paths.push(path);
      if (path.endsWith("/config")) return { agent: "1" };
      if (path.endsWith("/config?current=1")) return { agent: "0" };
      assert.fail("inactive agent channel must not be called");
    },
  });
  assert.equal(writes.at(-1).status, "unavailable");
  assert.match(writes.at(-1).lastError, /перезапуск/i);
  assert.equal(paths.length, 2);
});
test("CVE collection refuses a replaced guest UUID before agent commands", async () => {
  const writes = [];
  await advanceScan({ status: "queued" }, { ...vm, guestIdentity: "original" }, connection, {
    save: async (patch) => writes.push(patch),
    request: async (_c, path) => {
      if (path.endsWith("/config")) return { agent: "1", smbios1: "uuid=replaced" };
      assert.fail("replacement guest must not receive commands");
    },
  });
  assert.equal(writes.at(-1).status, "unavailable");
  assert.match(writes.at(-1).lastError, /UUID/i);
});
