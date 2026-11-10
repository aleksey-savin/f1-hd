const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const filename = require("node:path").join(__dirname, "guest-agent.js");
const service = () => {
  assert.ok(fs.existsSync(filename), "guest agent service must exist");
  return require("./guest-agent");
};
const vm = { _id: "vm", kind: "guest", guestType: "qemu", guestIdentity: "uuid-a", status: "running", nodeName: "pve", vmid: 100 };
const settings = { enabled: true, trimClonedDisks: false, freezeFilesystem: true, type: "virtio" };
const connection = { monitoringEnabled: true };
test("agent config normalizes bare enable and both filesystem freeze aliases", () => {
  const { parseSettings, encodeSettings } = service();
  assert.deepEqual(parseSettings("1,freeze-fs=0,fstrim_cloned_disks=1,type=isa"), { enabled: true, trimClonedDisks: true, freezeFilesystem: false, type: "isa" });
  assert.deepEqual(parseSettings(undefined), { ...settings, enabled: false });
  assert.equal(parseSettings("enabled=1,freeze-fs-on-backup=0").freezeFilesystem, false);
  assert.equal(encodeSettings("1,future-option=keep,freeze-fs=0", settings), "future-option=keep,enabled=1,fstrim_cloned_disks=0,freeze-fs-on-backup=1,type=virtio");
});
test("settings validation rejects missing fields, coercions and unknown keys", () => {
  const { validateSettings } = service();
  assert.deepEqual(validateSettings(settings), settings);
  for (const body of [{}, { ...settings, enabled: "true" }, { ...settings, type: "pci" }, { ...settings, extra: true }]) assert.throws(() => validateSettings(body));
});
test("pending enable requires restart and never calls the inactive channel", async () => {
  const result = await service().inspect(vm, connection, { request: async (_c, path) => {
    if (path.endsWith("/config")) return { agent: "1", smbios1: "uuid=uuid-a" };
    if (path.endsWith("/config?current=1")) return { agent: "0", smbios1: "uuid=uuid-a" };
    assert.fail("pending agent channel must not be called");
  } });
  assert.equal(result.guestAgent.state, "restartRequired");
  assert.equal(result.guestAgent.requiresRestart, true);
  assert.equal(result.guestAgent.installed, null);
});
test("agent response proves installation and persists safe OS metadata", async () => {
  const result = await service().inspect(vm, connection, { request: async (_c, path) => {
    if (path.includes("/config")) return { agent: "1", smbios1: "uuid=uuid-a" };
    if (path.endsWith("/info")) return { result: { version: "9.2.1", "supported-commands": [] } };
    if (path.endsWith("/get-osinfo")) return { result: { id: "ubuntu", "pretty-name": "Ubuntu 24.04 LTS", "version-id": "24.04", "kernel-release": "6.8.0", machine: "x86_64", private: "omit" } };
    assert.fail(path);
  } });
  assert.equal(result.guestAgent.state, "responding");
  assert.equal(result.guestAgent.installed, true);
  assert.equal(result.guestAgent.version, "9.2.1");
  assert.deepEqual(result.guestOs, { id: "ubuntu", name: "Ubuntu 24.04 LTS", version: "24.04", kernel: "6.8.0", arch: "x86_64" });
});
test("silence never implies missing agent and previous installation evidence is scoped to UUID", async () => {
  for (const [identity, installed, state] of [["uuid-a", true, "notResponding"], ["uuid-b", null, "unknown"]]) {
    const result = await service().inspect({ ...vm, guestAgent: { installed: true, version: "9.0" }, guestOs: { id: "ubuntu" } }, connection, { request: async (_c, path) => {
      if (path.includes("/config")) return { agent: "1", smbios1: `uuid=${identity}` };
      throw new Error("QEMU guest agent is not running");
    } });
    assert.equal(result.guestAgent.state, state);
    assert.equal(result.guestAgent.installed, installed);
    if (installed === null) { assert.equal(result.guestOs, null); assert.equal(result.guestAgent.version, null); }
  }
});
test("disabled monitoring and LXC make no remote calls", async () => {
  for (const [resource, state] of [[{ ...vm, monitoringEnabled: false }, "unknown"], [{ ...vm, guestType: "lxc" }, "notApplicable"]]) {
    const result = await service().inspect(resource, connection, { request: async () => assert.fail("no API for excluded resource") });
    assert.equal(result.guestAgent.state, state);
  }
});
test("settings update sends one digest protected PUT preserving other agent options", async () => {
  const writes = [];
  const result = await service().updateSettings(vm, connection, settings, { request: async (_c, path, options) => {
    if (options?.method === "PUT") { writes.push({ path, options }); return null; }
    if (path.includes("/config")) return { digest: "config-revision", agent: "0,freeze-fs=0,custom=keep", smbios1: "uuid=uuid-a" };
    assert.fail(path);
  } });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].options.body, { digest: "config-revision", agent: "custom=keep,enabled=1,fstrim_cloned_disks=0,freeze-fs-on-backup=1,type=virtio" });
  assert.equal(result.guestAgent.state, "restartRequired");
});
test("agent settings reject LXC and stale guest identity before writes", async () => {
  await assert.rejects(service().updateSettings({ ...vm, guestType: "lxc" }, connection, settings, { request: async () => assert.fail("no LXC API") }));
  await assert.rejects(service().updateSettings(vm, connection, settings, { request: async (_c, path, options) => {
    assert.notEqual(options?.method, "PUT");
    return { digest: "config-revision", agent: "0", smbios1: "uuid=replaced-guest" };
  } }));
});

test("configured OS provides a fallback while a stopped guest cannot answer", async () => {
  const result = await service().inspect({ ...vm, status: "stopped" }, connection, { request: async () => ({ agent: "1", ostype: "win11", smbios1: "uuid=uuid-a" }) });
  assert.equal(result.guestOs.name, "Windows 11 / Server 2022+");
  const retained = await service().inspect({ ...vm, status: "stopped", guestOs: { id: "mswindows", name: "Windows Server 2025", version: "10.0" } }, connection, { request: async () => ({ agent: "1", ostype: "win11", smbios1: "uuid=uuid-a" }) });
  assert.equal(retained.guestOs.name, "Windows Server 2025");
});
test("settings remain visible with monitoring disabled without polling guest commands", async () => {
  const result = await service().updateSettings({ ...vm, monitoringEnabled: false }, connection, settings, { request: async (_c, path, options) => {
    assert.ok(!path.includes("/agent/"));
    if (options?.method === "PUT") return null;
    return { digest: "rev", agent: "1", smbios1: "uuid=uuid-a" };
  } });
  assert.deepEqual(result.guestAgent.settings, settings);
  assert.equal(result.guestAgent.responding, null);
});
test("one worker tick selects at most six stale monitored guests and guards late persistence", async (t) => {
  const { Resource, Connection } = require("../../models/proxmox");
  const core = require("./core"), transport = require("./transport"), sift = require("sift").default;
  const calls = [], writes = [];
  const now = Date.now();
  const resources = Array.from({ length: 8 }, (_, index) => ({ ...vm, _id: `vm${index}`, connectionId: "c", archived: false, monitoringEnabled: true, guestAgent: { checkedAt: new Date(now - 180000) } })).concat([
    { ...vm, _id: "disabled", connectionId: "c", archived: false, monitoringEnabled: false },
    { ...vm, _id: "fresh", connectionId: "c", archived: false, guestAgent: { checkedAt: new Date(now) } },
  ]);
  t.mock.method(core, "enabled", async () => true);
  t.mock.method(core, "bump", () => {});
  t.mock.method(Connection, "find", () => ({ select() { return this; }, lean: async () => [{ _id: "c", archived: false, monitoringEnabled: true }] }));
  t.mock.method(Resource, "find", (query) => {
    let selected = resources.filter(sift(query));
    return { sort() { return this; }, limit(n) { selected = selected.slice(0, n); return this; }, lean: async () => selected };
  });
  t.mock.method(Resource, "updateOne", async (query, update) => writes.push({ query, update }));
  t.mock.method(transport, "request", async (_c, path) => { calls.push(path); return { agent: "0", smbios1: "uuid=uuid-a" }; });
  const cached = require.cache[filename];
  delete require.cache[filename];
  try {
    const worker = require("./guest-agent");
    await Promise.all([worker.tick(), worker.tick()]);
  } finally { require.cache[filename] = cached; }
  assert.equal(writes.length, 6);
  assert.equal(calls.length, 12);
  for (const write of writes) {
    assert.notEqual(write.query._id, "disabled");
    assert.notEqual(write.query._id, "fresh");
    assert.deepEqual(write.query.monitoringEnabled, { $ne: false });
    assert.equal(write.query.guestIdentity, "uuid-a");
    assert.equal(write.update.$set.guestAgent.state, "disabled");
  }
});
test("agent silence without installation evidence persists unknown for list filtering", async () => {
  const result = await service().inspect(vm, connection, { request: async (_c, path) => {
    if (path.includes("/config")) return { agent: "1", smbios1: "uuid=uuid-a" };
    throw new Error("QEMU guest agent is not running");
  } });
  assert.equal(result.guestAgent.installed, null);
  assert.equal(result.guestAgent.responding, false);
  assert.equal(result.guestAgent.state, "unknown");
});
test("desired agent disable takes priority over pending running configuration", async () => {
  const result = await service().inspect(vm, connection, { request: async (_c, path) => {
    if (path.endsWith("/config")) return { agent: "0", smbios1: "uuid=uuid-a" };
    if (path.endsWith("/config?current=1")) return { agent: "1", smbios1: "uuid=uuid-a" };
    assert.fail("disabled desired agent must not run runtime checks");
  } });
  assert.equal(result.guestAgent.enabled, false);
  assert.equal(result.guestAgent.state, "disabled");
  assert.equal(result.guestAgent.requiresRestart, true);
  assert.equal(result.guestAgent.responding, null);
});
