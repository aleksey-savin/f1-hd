const test = require("node:test");
const assert = require("node:assert/strict");
const { migrate } = require("./retireProxmoxRecords");
const valueAt = (row, path) =>
  path.split(".").reduce((value, key) => value?.[key], row);
const matches = (row, filter) =>
  Object.entries(filter).every(([key, wanted]) =>
    wanted && typeof wanted === "object" && "$exists" in wanted
      ? (valueAt(row, key) !== undefined) === wanted.$exists
      : valueAt(row, key) === wanted,
  );
function fixture() {
  const collections = new Map(
    Object.entries({
      tickets: [{ _id: "ticket", title: "Keep", proxmoxIncidentId: "legacy" }],
      proxmoxincidents: [
        {
          _id: "legacy",
          ticketId: "ticket",
          resourceId: "guest",
          connectionId: "conn",
          companyId: "tenant",
          key: "resource:guest:availability",
          type: "availability",
          title: "Unavailable",
          startedAt: new Date(1000),
          open: true,
        },
        { _id: "no-ticket", type: "cpu", open: true },
      ],
      proxmoxtasks: [{ _id: "old-task", active: false }],
      proxmoxresources: [{ _id: "guest", companyId: "new-tenant" }],
      proxmoxconnections: [{ _id: "conn", companyId: "owner" }],
      proxmoxevents: [
        {
          _id: "event",
          message: "History",
          taskId: "old-task",
          incidentId: "legacy",
        },
      ],
    }),
  );
  let writes = 0;
  const update = (row, change) => {
    for (const [path, value] of Object.entries(change.$set || {})) {
      const keys = path.split("."),
        last = keys.pop();
      let target = row;
      for (const key of keys) target = target[key] ??= {};
      target[last] = value;
    }
    for (const path of Object.keys(change.$unset || {})) {
      const keys = path.split("."),
        last = keys.pop();
      let target = row;
      for (const key of keys) target = target?.[key];
      if (target) delete target[last];
    }
  };
  const db = {
    listCollections: () => ({
      toArray: async () => [...collections.keys()].map((name) => ({ name })),
    }),
    collection: (name) => ({
      find: (filter) => ({
        toArray: async () =>
          (collections.get(name) || []).filter((row) => matches(row, filter)),
      }),
      findOne: async (filter) =>
        (collections.get(name) || []).find((row) => matches(row, filter)),
      countDocuments: async (filter) =>
        (collections.get(name) || []).filter((row) => matches(row, filter))
          .length,
      updateOne: async (filter, change, options = {}) => {
        writes++;
        const row = (collections.get(name) || []).find((row) =>
          matches(row, filter),
        );
        if (row) update(row, change);
        else if (options.upsert) {
          const inserted = { ...filter, ...change.$setOnInsert };
          collections.get(name).push(inserted);
        }
      },
      updateMany: async (filter, change) => {
        writes++;
        for (const row of collections.get(name) || [])
          if (matches(row, filter)) update(row, change);
      },
      indexes: async () => [
        { name: "proxmoxIncidentId_1", key: { proxmoxIncidentId: 1 } },
      ],
      dropIndex: async () => {
        writes++;
      },
      createIndex: async () => {
        writes++;
      },
      drop: async () => {
        writes++;
        collections.delete(name);
      },
    }),
  };
  return { db, collections, writes: () => writes };
}
test("cleanup dry-run writes nothing; apply retains tickets and dedup counters, removes obsolete collections idempotently", async () => {
  const f = fixture();
  const preview = await migrate(f.db);
  assert.equal(preview.retainedTickets, 1);
  assert.equal(f.writes(), 0);
  await migrate(f.db, true);
  assert.equal(f.collections.has("proxmoxincidents"), false);
  assert.equal(f.collections.has("proxmoxtasks"), false);
  const tickets = f.collections.get("tickets");
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].title, "Keep");
  assert.equal(tickets[0].proxmoxIncidentId, undefined);
  assert.equal(tickets[0].proxmoxSource.key, "legacy:legacy");
  const issue =
    f.collections.get("proxmoxresources")[0].monitoringIssues.availability;
  assert.equal(issue.companyId, "tenant");
  assert.equal(issue.ticketId, "ticket");
  assert.equal(f.collections.get("proxmoxevents")[0].message, "History");
  assert.equal(f.collections.get("proxmoxevents")[0].taskId, undefined);
  assert.equal(
    f.collections.get("proxmoxevents").find((row) => row._id === "old-task")
      .operationData.active,
    false,
  );
  await migrate(f.db, true);
  assert.equal(
    f.collections
      .get("proxmoxevents")
      .filter((row) => row.kind === "vmOperation").length,
    1,
  );
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].proxmoxSource.key, "legacy:legacy");
});
test("active legacy operation prevents cleanup before any mutation", async () => {
  const f = fixture();
  f.collections.get("proxmoxtasks")[0].active = true;
  await assert.rejects(migrate(f.db, true), /Active legacy/);
  assert.equal(f.writes(), 0);
  assert.equal(f.collections.has("proxmoxincidents"), true);
});
