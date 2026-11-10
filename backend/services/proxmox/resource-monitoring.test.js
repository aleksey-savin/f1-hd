const test = require("node:test");
const assert = require("node:assert/strict");
const { Resource, Connection } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const { stateOf } = require("./availability");
const { advanceScan, enqueue } = require("./guest-security");
const monitor = require("./monitor");
const controller = require("../../controllers/proxmox");
const core = require("./core");
const availability = require("./availability");
const vm = { _id: "64aa00000000000000000001", connectionId: "connection", kind: "guest", guestType: "qemu", monitoringEnabled: false, status: "running", expectedRunning: true, lastError: "stale data" };
test("disabled resources are excluded before maintenance and stale telemetry", () => {
  assert.equal(stateOf(vm, {}, new Date()), "excluded");
  assert.equal(stateOf({ ...vm, kind: "node", maintenance: { until: new Date(Date.now() + 60000) } }, {}, new Date()), "excluded");
});
test("disabled monitoring prevents every CVE stage and manual enqueue", async () => {
  for (const status of ["queued", "collecting", "checking"]) {
    const writes = [];
    await advanceScan({ status }, vm, { monitoringEnabled: true }, {
      save: async (patch) => writes.push(patch),
      request: async () => assert.fail("disabled monitoring must not contact VM"),
      evaluate: async () => assert.fail("disabled monitoring must not evaluate inventory"),
    });
    assert.equal(writes.at(-1).status, "unavailable");
  }
  await assert.rejects(enqueue(vm), /мониторинг/i);
});
test("disabled resource observation does not advance thresholds or create issues", async (t) => {
  t.mock.method(Preferences, "findOne", () => { assert.fail("no thresholds for disabled resource"); });
  await monitor.observeResource({ ...vm, status: "stopped", failedPolls: 10 }, {}, new Date());
});
test("resource monitoring validates scope and recovers incidents on disabling without changing expectedRunning", async (t) => {
  const resource = { ...vm, monitoringEnabled: true, expectedRunning: true, failedPolls: 3, failureAt: new Date(), thresholdSince: { cpu: new Date() }, async save() {} };
  const recovered = [], events = [], observations = [];
  t.mock.method(Resource, "findById", async () => resource);
  t.mock.method(Connection, "findById", async () => ({ _id: "connection" }));
  assert.equal(typeof monitor.recoverResource, "function", "incident recovery helper must exist");
  t.mock.method(monitor, "recoverResource", async (item) => recovered.push(item._id));
  t.mock.method(core, "event", async (...args) => events.push(args));
  t.mock.method(availability, "observe", async (...args) => observations.push(args));
  const req = { params: { id: vm._id }, body: { monitoringEnabled: false }, auth: { userId: "actor", can: () => true } };
  let response;
  await controller.resourceMonitoring(req, { json: (value) => { response = value; } });
  assert.equal(resource.monitoringEnabled, false);
  assert.equal(resource.expectedRunning, true);
  assert.equal(resource.failedPolls, 0);
  assert.equal(resource.failureAt, undefined);
  assert.deepEqual(resource.thresholdSince, {});
  assert.deepEqual(recovered, [vm._id]);
  assert.equal(observations.length, 1);
  assert.equal(events[0][1], "monitoringChanged");
  assert.ok(response.item);
  await assert.rejects(controller.resourceMonitoring({ ...req, body: { monitoringEnabled: "false" } }, {}));
  resource.kind = "storage";
  await assert.rejects(controller.resourceMonitoring(req, {}));
});
test("disabling recovers every active resource issue and releases its ticket source", async (t) => {
  const issues = {
    availability: { active: true, key: "availability-key", activeKey: "resource:vm:availability" },
    cpu: { active: true, key: "cpu-key", activeKey: "resource:vm:cpu" },
    memory: { active: false, key: "memory-key", activeKey: "resource:vm:memory" },
  };
  const current = { ...vm, monitoringIssues: issues }, tickets = [];
  t.mock.method(Resource, "findById", () => ({ select: async () => current }));
  t.mock.method(Resource, "findOneAndUpdate", (filter, update) => {
    const path = Object.keys(update.$set)[0], type = path.split(".")[1];
    const previous = { ...current, monitoringIssues: { [type]: { ...issues[type] } } };
    issues[type].active = false;
    assert.equal(filter["monitoringIssues." + type + ".active"], true);
    return { select: async () => previous };
  });
  const ticketPath = require.resolve("../../models/ticket"), cachedTicket = require.cache[ticketPath];
  require.cache[ticketPath] = { id: ticketPath, filename: ticketPath, loaded: true, exports: { Ticket: { updateOne: async (filter, update) => tickets.push({ filter, update }) } } };
  t.after(() => { if (cachedTicket) require.cache[ticketPath] = cachedTicket; else delete require.cache[ticketPath]; });
  t.mock.method(require("../../models/proxmox").Event, "create", async () => {});
  await monitor.recoverResource(vm);
  assert.equal(tickets.length, 2);
  assert.deepEqual(tickets.map((item) => item.filter["proxmoxSource.key"]), ["availability-key", "cpu-key"]);
  for (const item of tickets) {
    assert.ok(item.update.$set["proxmoxSource.recoveredAt"] instanceof Date);
    assert.equal(item.update.$unset["proxmoxSource.activeKey"], "");
  }
});
test("agent and monitoring writes require both staff read and manage rights", async (t) => {
  t.mock.method(Resource, "findById", () => assert.fail("unauthorized request must not read or change resources"));
  for (const handler of [controller.guestAgent, controller.resourceMonitoring]) {
    for (const allowed of ["read", "manage", "end-user"]) {
      await assert.rejects(handler({ auth: { isEndUser: allowed === "end-user", can: (permission) => permission.proxmox[0] === allowed }, params: { id: vm._id }, body: {} }, {}), (error) => error.statusCode === 403);
    }
  }
});
