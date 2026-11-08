const test = require("node:test");
const assert = require("node:assert/strict");
const { Event } = require("../../models/proxmox");
const store = require("./operationStore");
test("operation journal indexes preserve durable idempotency and one active resource", () => {
  const indexes = Event.schema.indexes();
  assert(
    indexes.some(
      ([keys, options]) =>
        keys.resourceId === 1 &&
        options.unique &&
        options.partialFilterExpression["operationData.active"] === true,
    ),
  );
  assert(
    indexes.some(
      ([keys, options]) =>
        keys["operationData.createdBy"] === 1 &&
        keys["operationData.idempotencyKey"] === 1 &&
        options.unique,
    ),
  );
  assert(!indexes.some(([, options]) => options.expireAfterSeconds != null));
  assert.equal(require("../../models/proxmox").Task, undefined);
});
test("journal projection omits receipt/actor/internal fields", () => {
  const row = store.publicView({
    _id: "e1",
    resourceId: "vm",
    connectionId: "secret-id",
    operationData: {
      createdBy: "private-user",
      idempotencyKey: "private-key",
      operation: "reboot",
      state: "unknown",
      active: true,
    },
    futureSecret: "private",
  });
  assert.equal(row.id, "e1");
  assert.equal(row.operation, "reboot");
  for (const key of [
    "createdBy",
    "idempotencyKey",
    "connectionId",
    "operationData",
    "futureSecret",
  ])
    assert.equal(Object.hasOwn(row, key), false);
});
test("cursor history returns ten items, scopes resource and uses timestamp/id tie-break", async () => {
  const originals = { find: Event.find, count: Event.countDocuments };
  let query, sort, limit;
  const at = new Date("2026-11-01T00:00:00Z");
  const rows = Array.from({ length: 11 }, (_, i) => ({
    _id: String(30 - i).padStart(24, "0"),
    resourceId: "vm",
    createdAt: at,
    kind: "vmOperation",
    operationData: { operation: "start", state: "succeeded", active: false },
  }));
  Event.find = (filter) => {
    query = filter;
    return {
      sort: (value) => {
        sort = value;
        return {
          limit: (value) => {
            limit = value;
            return { lean: async () => rows };
          },
        };
      },
    };
  };
  Event.countDocuments = async () => 15;
  try {
    const first = await store.history("vm");
    assert.equal(first.items.length, 10);
    assert.equal(first.total, 15);
    assert(first.nextCursor);
    assert.equal(limit, 11);
    assert.deepEqual(sort, { createdAt: -1, _id: -1 });
    assert.deepEqual(query, { kind: "vmOperation", resourceId: "vm" });
    await store.history("vm", first.nextCursor);
    assert.equal(query.resourceId, "vm");
    assert.equal(query.$or[1]._id.$lt.toString(), rows[9]._id);
    await assert.rejects(store.history("vm", "bad"), /курсор/);
  } finally {
    Event.find = originals.find;
    Event.countDocuments = originals.count;
  }
});
test("worker store filters out manual unknown while preserving active lock", async () => {
  const original = Event.find;
  let filter, sort;
  Event.find = (value) => {
    filter = value;
    return {
      sort: (value) => {
        sort = value;
        return { limit: () => ({ lean: async () => [] }) };
      },
    };
  };
  try {
    await store.active();
    assert.equal(filter.kind, "vmOperation");
    assert.equal(filter["operationData.active"], true);
    assert.deepEqual(filter["operationData.state"].$in, [
      "queued",
      "dispatching",
      "running",
    ]);
    assert.equal(sort["operationData.lastCheckedAt"], 1);
  } finally {
    Event.find = original;
  }
});
test("queued operation revalidates archived guest and fails without dispatch", async () => {
  const { Resource } = require("../../models/proxmox");
  const Prefs = require("../../models/preferences");
  const operations = require("./operations");
  const originals = {
    active: store.active,
    update: store.updateOne,
    resource: Resource.findById,
    prefs: Prefs.findOne,
  };
  const changes = [];
  Prefs.findOne = () => ({
    lean: async () => ({ modules: { proxmox: { isActive: true } } }),
  });
  store.active = async () => [
    { _id: "receipt", resourceId: "vm", state: "queued", active: true },
  ];
  Resource.findById = async () => ({
    _id: "vm",
    kind: "guest",
    archived: true,
  });
  store.updateOne = async (filter, body) => {
    changes.push({ filter, body });
  };
  try {
    await operations.tick();
    assert.equal(changes[0].filter.state, "queued");
    assert.equal(changes[0].body.$set.active, false);
    assert.equal(changes[0].body.$set.state, "failed");
    assert(changes[0].body.$set.lastCheckedAt instanceof Date);
  } finally {
    store.active = originals.active;
    store.updateOne = originals.update;
    Resource.findById = originals.resource;
    Prefs.findOne = originals.prefs;
  }
});
test("concurrent equal idempotency receipt returns original, not a new operation", async () => {
  const operations = require("./operations");
  const originals = {
    ready: store.ready,
    find: store.findOne,
    create: store.create,
  };
  let finds = 0;
  const previous = {
    _id: "event",
    resourceId: "vm",
    operation: "start",
    state: "queued",
    active: true,
  };
  store.ready = async () => {};
  store.findOne = async () => (++finds === 1 ? null : previous);
  store.create = async () => {
    const e = new Error("duplicate");
    e.code = 11000;
    throw e;
  };
  try {
    assert.equal(
      await operations.enqueue(
        { _id: "vm", kind: "guest" },
        { operation: "start", idempotencyKey: "retry-key-123" },
        "user",
      ),
      previous,
    );
  } finally {
    store.ready = originals.ready;
    store.findOne = originals.find;
    store.create = originals.create;
  }
});

test("hard stop is persisted independently from graceful shutdown", async () => {
  const operations = require("./operations");
  const originals = {
    ready: store.ready,
    find: store.findOne,
    create: store.create,
  };
  store.ready = async () => {};
  store.findOne = async () => null;
  store.create = async (row) => row;
  try {
    const row = await operations.enqueue(
      { _id: "vm", kind: "guest" },
      { operation: "stop", idempotencyKey: "stop-request-123" },
      "user",
    );
    assert.equal(row.operation, "stop");
    assert.equal(row.state, "queued");
    assert.equal(row.active, true);
  } finally {
    store.ready = originals.ready;
    store.findOne = originals.find;
    store.create = originals.create;
  }
});
test("completed hard stop confirms stopped state for QEMU and LXC", async () => {
  const transport = require("./transport");
  const { Resource, Connection } = require("../../models/proxmox");
  const Prefs = require("../../models/preferences");
  const originals = {
    request: transport.request,
    active: store.active,
    update: store.updateOne,
    resource: Resource.findById,
    connection: Connection.findById,
    prefs: Prefs.findOne,
  };
  const writes = [];
  let guestType = "qemu";
  transport.request = async (c, path) => {
    if (path.endsWith("/status"))
      return { status: "stopped", exitstatus: "OK" };
    if (path.includes("/log?")) return [];
    if (path === "/cluster/resources")
      return [{ vmid: 101, type: guestType, node: "new-node" }];
    assert.equal(path, `/nodes/new-node/${guestType}/101/status/current`);
    return { status: "stopped" };
  };
  delete require.cache[require.resolve("./operations")];
  const operations = require("./operations");
  Prefs.findOne = () => ({
    lean: async () => ({ modules: { proxmox: { isActive: true } } }),
  });
  store.active = async () => [
    {
      _id: "op",
      resourceId: "vm",
      connectionId: "c",
      operation: "stop",
      state: "running",
      upid: "upid",
      nodeName: "old-node",
    },
  ];
  store.updateOne = async (filter, body) => writes.push({ filter, body });
  Resource.findById = async () => ({ _id: "vm", vmid: 101, guestType });
  Connection.findById = () => ({
    select: async () => ({ monitoringEnabled: true }),
  });
  try {
    for (guestType of ["qemu", "lxc"]) {
      await operations.tick();
      assert.equal(writes.at(-1).body.$set.state, "succeeded");
      assert.equal(writes.at(-1).body.$set.active, false);
    }
  } finally {
    transport.request = originals.request;
    store.active = originals.active;
    store.updateOne = originals.update;
    Resource.findById = originals.resource;
    Connection.findById = originals.connection;
    Prefs.findOne = originals.prefs;
    delete require.cache[require.resolve("./operations")];
  }
});

test("verification deadline keeps uncertain commands locked without contacting PVE", async () => {
  const Prefs = require("../../models/preferences");
  const { Connection } = require("../../models/proxmox");
  const originals = {
    active: store.active,
    update: store.updateOne,
    prefs: Prefs.findOne,
    connection: Connection.findById,
  };
  const updates = [];
  const now = Date.now();
  Prefs.findOne = () => ({
    lean: async () => ({ modules: { proxmox: { isActive: true } } }),
  });
  store.active = async () => [
    {
      _id: "power",
      updatedAt: new Date(now - 1000),
      operation: "reboot",
      state: "running",
      dispatchedAt: new Date(now - 16 * 60000),
    },
    {
      _id: "backup",
      updatedAt: new Date(now - 1000),
      operation: "backup",
      state: "running",
      dispatchedAt: new Date(now - 25 * 3600000),
    },
  ];
  Connection.findById = () => {
    throw new Error("must not contact PVE after deadline");
  };
  store.updateOne = async (filter, body) => updates.push({ filter, body });
  try {
    await require("./operations").tick();
    assert.equal(updates.length, 2);
    for (const update of updates) {
      assert.equal(update.filter.state, "running");
      assert.equal(update.filter.updatedAt.getTime(), now - 1000);
      assert.equal(update.body.$set.state, "unknown");
      assert.equal(update.body.$set.active, true);
      assert.equal(update.body.$set.finishedAt, undefined);
    }
  } finally {
    store.active = originals.active;
    store.updateOne = originals.update;
    Prefs.findOne = originals.prefs;
    Connection.findById = originals.connection;
  }
});

test("override is stop-only boolean and part of idempotency", async () => {
  const operations = require("./operations");
  await assert.rejects(
    operations.enqueue(
      { kind: "guest" },
      { operation: "reboot", overruleShutdown: true },
      "u",
    ),
    /Shutdown/,
  );
  await assert.rejects(
    operations.enqueue(
      { kind: "guest" },
      { operation: "stop", overruleShutdown: "true" },
      "u",
    ),
    /boolean/,
  );
  const original = { ready: store.ready, find: store.findOne };
  store.ready = async () => {};
  store.findOne = async () => ({
    resourceId: "vm",
    operation: "stop",
    overruleShutdown: false,
  });
  try {
    await assert.rejects(
      operations.enqueue(
        { _id: "vm", kind: "guest" },
        {
          operation: "stop",
          overruleShutdown: true,
          idempotencyKey: "override-key",
        },
        "u",
      ),
      /Ключ/,
    );
  } finally {
    store.ready = original.ready;
    store.findOne = original.find;
  }
});

test("queued cancellation uses CAS and never dispatches remote command", async () => {
  const original = { update: store.updateOne, find: store.findOne };
  let write;
  store.updateOne = async (filter, body) => {
    write = { filter, body };
  };
  store.findOne = async () => ({ state: "cancelled", active: false });
  try {
    const result = await require("./operations").cancel(
      { _id: "op", state: "queued", active: true },
      "actor",
    );
    assert.deepEqual(write.filter, {
      _id: "op",
      state: "queued",
      active: true,
    });
    assert.equal(write.body.$set.active, false);
    assert.equal(result.state, "cancelled");
  } finally {
    store.updateOne = original.update;
    store.findOne = original.find;
  }
});

test("remote cancellation scopes UPID and keeps lock until confirmed, including DELETE timeout", async () => {
  const transport = require("./transport");
  const { Resource, Connection } = require("../../models/proxmox");
  const original = {
    request: transport.request,
    resource: Resource.findById,
    connection: Connection.findById,
    claim: store.findOneAndUpdate,
    find: store.findOne,
  };
  let receipt = {
    _id: "op",
    active: true,
    state: "unknown",
    operation: "shutdown",
    nodeName: "pve",
    upid: "UPID:pve:1:2:3:qmshutdown:101:user@pve:",
    resourceId: "vm",
  };
  let deletes = 0;
  Resource.findById = async () => ({ vmid: 101 });
  Connection.findById = () => ({ select: async () => ({}) });
  store.findOneAndUpdate = async (filter, body) => {
    assert.equal(filter.active, true);
    receipt = { ...receipt, ...body.$set };
    return receipt;
  };
  store.findOne = async () => receipt;
  transport.request = async (c, path, opts) => {
    if (opts?.method === "DELETE") {
      deletes++;
      throw new Error("timeout");
    }
    return { status: "running" };
  };
  delete require.cache[require.resolve("./operations")];
  try {
    const operations = require("./operations");
    await assert.rejects(
      operations.cancel(
        { ...receipt, upid: receipt.upid.replace(":101:", ":102:") },
        "actor",
      ),
      /не соответствует/,
    );
    assert.equal(deletes, 0);
    await assert.rejects(operations.cancel(receipt, "actor"), /timeout/);
    assert.equal(deletes, 1);
    assert.equal(receipt.cancelRequested, true);
    assert.equal(receipt.active, true);
    assert.equal(receipt.state, "running");
    assert(receipt.cancelRequestedAt instanceof Date);
  } finally {
    transport.request = original.request;
    Resource.findById = original.resource;
    Connection.findById = original.connection;
    store.findOneAndUpdate = original.claim;
    store.findOne = original.find;
    delete require.cache[require.resolve("./operations")];
  }
});

test("fresh cancellation grace polls old operation; natural failures remain failures", async () => {
  const transport = require("./transport");
  const { Resource, Connection } = require("../../models/proxmox");
  const Prefs = require("../../models/preferences");
  const original = {
    request: transport.request,
    resource: Resource.findById,
    connection: Connection.findById,
    prefs: Prefs.findOne,
    active: store.active,
    update: store.updateOne,
  };
  let exitstatus = "storage unavailable";
  let cancellation = true;
  let write;
  transport.request = async (c, path) =>
    path.includes("/log?") ? [] : { status: "stopped", exitstatus };
  delete require.cache[require.resolve("./operations")];
  Prefs.findOne = () => ({
    lean: async () => ({ modules: { proxmox: { isActive: true } } }),
  });
  Resource.findById = async () => null;
  Connection.findById = () => ({
    select: async () => ({ monitoringEnabled: true }),
  });
  store.active = async () => [
    {
      _id: "op",
      operation: "shutdown",
      state: "running",
      upid: "upid",
      dispatchedAt: new Date(Date.now() - 3600000),
      cancelRequestedAt: new Date(),
      cancelRequested: cancellation,
    },
  ];
  store.updateOne = async (filter, body) => {
    write = { filter, body };
  };
  try {
    const operations = require("./operations");
    await operations.tick();
    assert.equal(write.body.$set.state, "failed");
    assert.equal(write.body.$set.error, "storage unavailable");
    assert.equal(write.filter.cancelRequested, true);
    exitstatus = "interrupted by signal";
    await operations.tick();
    assert.equal(write.body.$set.state, "cancelled");
    assert.equal(write.body.$set.error, exitstatus);
    exitstatus = "OK";
    await operations.tick();
    assert.equal(write.body.$set.state, "succeeded");
    cancellation = false;
    exitstatus = "interrupted by signal";
    await operations.tick();
    assert.deepEqual(write.filter.cancelRequested, { $ne: true });
    assert.equal(write.body.$set.state, "failed");
  } finally {
    transport.request = original.request;
    Resource.findById = original.resource;
    Connection.findById = original.connection;
    Prefs.findOne = original.prefs;
    store.active = original.active;
    store.updateOne = original.update;
    delete require.cache[require.resolve("./operations")];
  }
});
