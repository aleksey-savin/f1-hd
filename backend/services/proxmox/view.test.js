const test = require("node:test");
const assert = require("node:assert/strict");
const { list, detail, view } = require("./view");
test("disabled resource metrics do not contact its connection or Proxmox", async (t) => {
  const { Resource, Connection } = require("../../models/proxmox");
  t.mock.method(Resource, "findById", async () => ({ monitoringEnabled: false }));
  t.mock.method(Connection, "findById", () => assert.fail("disabled metrics must not read connection credentials"));
  await assert.rejects(require("./view").metrics("64aa00000000000000000001"), /Мониторинг ресурса выключен/);
});

test("removed task and incident views reject before querying storage", async () => {
  for (const kind of ["tasks", "incidents"]) {
    await assert.rejects(list(kind), /Неизвестный раздел/);
    await assert.rejects(detail(kind, "64aa00000000000000000001"), /Неизвестный раздел/);
  }
});

test("resource DTO hides internal monitoring state and removed references", () => {
  const row = view({ _id: "resource", kind: "guest", monitoringIssues: [{ ticketId: "internal" }], operationData: { idempotencyKey: "private" }, taskId: "old-task", incidentId: "old-incident" });
  for (const key of ["monitoringIssues", "operationData", "taskId", "incidentId"])
    assert.equal(Object.hasOwn(row, key), false);
});
