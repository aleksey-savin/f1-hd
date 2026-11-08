const test = require("node:test");
const assert = require("node:assert/strict");
const { Connection, Resource } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const monitor = require("./monitor");
function stubModule(path, exports, restore) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  restore.push(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}
function replace(object, key, value, restore) {
  const previous = object[key];
  object[key] = value;
  restore.push(() => {
    object[key] = previous;
  });
}
test("direct monitoring tickets honor delay, tenant snapshot, parent suppression and duplicate attachment", async () => {
  const restore = [],
    created = [];
  let autoTickets = false;
  const issue = {
    key: "episode",
    activeKey: "resource:g:availability",
    active: true,
    title: "VM stopped",
    startedAt: new Date(Date.now() - 600000),
    companyId: "old-tenant",
  };
  const connection = {
    _id: "c",
    companyId: "owner",
    monitoringEnabled: true,
    monitoringIssues: {},
  };
  const guest = {
    _id: "g",
    kind: "guest",
    connectionId: "c",
    companyId: "new-tenant",
    clientDeviceId: "new-device",
    nodeName: "n",
    monitoringIssues: { availability: issue },
  };
  const ticketApi = {
    init: async () => {},
    find: () => ({ select: () => ({ limit: async () => [] }) }),
    findOne: async () => null,
    create: async (data) => {
      created.push(data);
      return { _id: "ticket" };
    },
    updateOne: async () => ({ matchedCount: 1 }),
  };
  stubModule("../../models/ticket", { Ticket: ticketApi }, restore);
  stubModule(
    "../../models/user",
    { findOne: async () => ({ _id: "bot" }) },
    restore,
  );
  stubModule(
    "../../models/company",
    { findOne: async (filter) => ({ _id: filter._id, alias: "Customer" }) },
    restore,
  );
  replace(
    Preferences,
    "findOne",
    () => ({
      lean: async () => ({
        modules: { proxmox: { isActive: true } },
        proxmox: { autoTickets, applicantId: "bot", thresholdMinutes: 5 },
      }),
    }),
    restore,
  );
  replace(
    Connection,
    "find",
    () => ({ select: async () => [connection] }),
    restore,
  );
  replace(Resource, "find", () => ({ select: async () => [guest] }), restore);
  replace(Resource, "findOneAndUpdate", async () => guest, restore);
  replace(
    Resource,
    "updateOne",
    async () => {
      issue.ticketId = "ticket";
      return { matchedCount: 1 };
    },
    restore,
  );
  try {
    await monitor.alerts();
    assert.equal(
      created.length,
      0,
      "global autoTickets=false never creates tickets",
    );
    autoTickets = true;
    issue.startedAt = new Date();
    await monitor.alerts();
    assert.equal(created.length, 0);
    issue.startedAt = new Date(Date.now() - 600000);
    connection.monitoringIssues.connection = { active: true };
    await monitor.alerts();
    assert.equal(created.length, 0);
    connection.monitoringIssues = {};
    await monitor.alerts();
    assert.equal(created.length, 1);
    assert.equal(created[0].company._id, "old-tenant");
    assert.equal(created[0].relatedClientDeviceId, undefined);
    assert.equal(created[0].proxmoxSource.key, "episode");
    assert.equal(created[0].proxmoxIncidentId, undefined);
    await monitor.alerts();
    assert.equal(created.length, 1);
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
test("recovery updates ordinary ticket metadata and no separate incident collection", async () => {
  const restore = [],
    changes = [];
  const previous = {
    kind: "guest",
    monitoringIssues: {
      availability: { key: "episode", activeKey: "resource:g:availability" },
    },
  };
  replace(
    Resource,
    "findOneAndUpdate",
    () => ({ select: async () => previous }),
    restore,
  );
  stubModule(
    "../../models/ticket",
    {
      Ticket: {
        updateOne: async (filter, update) => changes.push({ filter, update }),
      },
    },
    restore,
  );
  const { Event } = require("../../models/proxmox");
  replace(Event, "create", async () => {}, restore);
  try {
    await monitor.recover(
      { _id: "g", kind: "guest", connectionId: "c" },
      "availability",
    );
    assert.equal(changes.length, 1);
    assert.equal(
      changes[0].filter["proxmoxSource.activeKey"],
      "resource:g:availability",
    );
    assert.ok(changes[0].update.$set["proxmoxSource.recoveredAt"]);
    assert.ok(
      Object.hasOwn(changes[0].update.$unset, "proxmoxSource.activeKey"),
    );
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
test("shared transit recovery waits for the other affected connections", async () => {
  const restore = [];
  let writes = 0;
  replace(
    Connection,
    "findOneAndUpdate",
    () => ({
      select: async () => ({
        monitoringIssues: {
          connection: { key: "episode", activeKey: "transit:router" },
        },
      }),
    }),
    restore,
  );
  replace(Connection, "exists", async () => true, restore);
  stubModule(
    "../../models/ticket",
    {
      Ticket: {
        updateOne: async () => {
          writes++;
        },
      },
    },
    restore,
  );
  try {
    await monitor.recover({ _id: "conn" }, "connection");
    assert.equal(writes, 0);
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
