const test = require("node:test");
const assert = require("node:assert/strict");
const { Connection, Resource } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const core = require("./core");
const transport = require("./transport");
const monitor = require("./monitor");
const availability = require("./availability");
const { view } = require("./view");
function replace(object, key, value, restore) {
  const old = object[key];
  object[key] = value;
  restore.push(() => {
    object[key] = old;
  });
}
test("optional quorum 403 does not invalidate successful resource sync or open connection incident", async () => {
  const restore = [],
    writes = [];
  let synced = 0;
  replace(
    Preferences,
    "findOne",
    () => ({
      lean: async () => ({ modules: { proxmox: { isActive: true } } }),
    }),
    restore,
  );
  replace(
    Connection,
    "find",
    () => ({
      select: async () => [
        { _id: "c", endpoints: [], isCluster: true, clusterName: "Keep" },
      ],
    }),
    restore,
  );
  replace(
    core,
    "sync",
    async () => {
      synced++;
    },
    restore,
  );
  replace(
    transport,
    "request",
    async () => {
      throw Object.assign(new Error("API Proxmox: HTTP 403"), {
        statusCode: 403,
      });
    },
    restore,
  );
  replace(
    Connection,
    "findOneAndUpdate",
    () => ({ select: async () => null }),
    restore,
  );
  replace(
    Connection,
    "updateOne",
    async () => {
      writes.push("cluster metadata");
    },
    restore,
  );
  replace(
    Resource,
    "updateMany",
    async () => {
      writes.push("resources");
    },
    restore,
  );
  try {
    await monitor.poll();
    assert.equal(synced, 1);
    assert.deepEqual(writes, []);
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
test("primary failure retains last measurement timestamp while DTO marks it stale", async () => {
  const restore = [],
    writes = [];
  replace(
    Preferences,
    "findOne",
    () => ({
      lean: async () => ({ modules: { proxmox: { isActive: true } } }),
    }),
    restore,
  );
  replace(
    Connection,
    "find",
    () => ({ select: async () => [{ _id: "c", endpoints: [] }] }),
    restore,
  );
  replace(
    core,
    "sync",
    async () => {
      throw new Error("API timeout");
    },
    restore,
  );
  replace(
    Connection,
    "findOneAndUpdate",
    async () => ({ failedPolls: 1 }),
    restore,
  );
  replace(
    Resource,
    "updateMany",
    async (filter, update) => writes.push(update),
    restore,
  );
  try {
    await monitor.poll();
    assert.equal(Object.hasOwn(writes[0].$set, "lastCheckedAt"), false);
    const timestamp = new Date();
    const dto = view({
      kind: "node",
      lastCheckedAt: timestamp,
      lastError: writes[0].$set.lastError,
    });
    assert.equal(dto.freshness, "stale");
    assert.equal(dto.lastCheckedAt, timestamp);
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
test("permission-filtered inventory preserves node capacity and missing guest ownership", async () => {
  const restore = [],
    updates = [];
  const stamp = new Date(Date.now() - 60000);
  const node = {
    _id: "node",
    kind: "node",
    externalId: "pve",
    nodeName: "pve",
    lastCheckedAt: stamp,
    resources: { cpu: 16, memory: 64000, disk: 90000 },
  };
  const guest = {
    _id: "guest",
    kind: "guest",
    externalId: "101",
    companyId: "tenant",
    clientDeviceId: "device",
    lastCheckedAt: stamp,
  };
  replace(
    transport,
    "request",
    async () => [{ type: "node", node: "pve", status: "online" }],
    restore,
  );
  replace(Resource, "findOne", async () => node, restore);
  replace(
    Resource,
    "findOneAndUpdate",
    async (filter, update) => {
      updates.push({ filter, update });
      return { ...node, ...update.$set };
    },
    restore,
  );
  replace(Resource, "find", async () => [node, guest], restore);
  replace(
    Resource,
    "updateOne",
    async (filter, update) => updates.push({ filter, update }),
    restore,
  );
  replace(Connection, "updateOne", async () => {}, restore);
  replace(monitor, "observeResource", async () => {}, restore);
  replace(availability, "observe", async () => {}, restore);
  const filename = require.resolve("./core"),
    cached = require.cache[filename];
  delete require.cache[filename];
  try {
    await require("./core").sync({ _id: "c", lastConfigAt: new Date() });
    const observed = updates.find((item) => item.filter.kind === "node").update
      .$set;
    assert.deepEqual(observed.resources, node.resources);
    assert.equal(observed.lastCheckedAt, stamp);
    assert.match(observed.lastError, /без показателей/);
    const missing = updates.find((item) => item.filter._id === "guest").update;
    assert.deepEqual(Object.keys(missing.$set), ["lastError"]);
    assert.equal(missing.$unset, undefined);
    assert.equal(guest.companyId, "tenant");
  } finally {
    require.cache[filename] = cached;
    restore.reverse().forEach((fn) => fn());
  }
});
test("optional guest config 403 retains separate error without making fresh telemetry stale", async () => {
  const restore = [];
  let result;
  const guest = {
    _id: "g",
    kind: "guest",
    externalId: "101",
    nodeName: "pve",
    resources: { cpu: 4, memory: 8192, disk: 10000 },
  };
  replace(
    transport,
    "request",
    async (connection, path) => {
      if (path === "/cluster/resources")
        return [
          {
            type: "qemu",
            vmid: 101,
            node: "pve",
            name: "guest",
            status: "running",
            cpu: 0.25,
            mem: 2048,
            maxmem: 8192,
            maxcpu: 4,
            maxdisk: 10000,
            disk: 2000,
          },
        ];
      throw Object.assign(new Error("API Proxmox: HTTP 403"), {
        statusCode: 403,
      });
    },
    restore,
  );
  replace(Resource, "findOne", async () => guest, restore);
  replace(
    Resource,
    "findOneAndUpdate",
    async (filter, update) => {
      result = { ...guest, ...update.$set };
      return result;
    },
    restore,
  );
  replace(Resource, "find", async () => [guest], restore);
  replace(Connection, "updateOne", async () => {}, restore);
  replace(monitor, "observeResource", async () => {}, restore);
  replace(availability, "observe", async () => {}, restore);
  const filename = require.resolve("./core"),
    cached = require.cache[filename];
  delete require.cache[filename];
  try {
    await require("./core").sync({ _id: "c" });
    assert.equal(result.lastError, null);
    assert.match(result.configError, /токен или права/);
    assert.equal(result.resources.cpuUsage, 0.25);
    assert.equal(view(result).freshness, "fresh");
  } finally {
    require.cache[filename] = cached;
    restore.reverse().forEach((fn) => fn());
  }
});
test("node version comes from its own status and denied metadata preserves prior version", async () => {
  const restore = [];
  let result,
    deny = false;
  const node = {
    _id: "n",
    kind: "node",
    externalId: "pve",
    nodeName: "pve",
    version: "7.4-3",
    resources: { cpu: 4 },
  };
  replace(
    transport,
    "request",
    async (connection, path) => {
      if (path === "/cluster/resources")
        return [
          { type: "node", node: "pve", status: "online", cpu: 0.1, maxcpu: 4 },
        ];
      if (path === "/nodes/pve/status" && !deny)
        return { pveversion: "pve-manager/8.2.7/3e0176e6" };
      throw new Error("HTTP403");
    },
    restore,
  );
  replace(Resource, "findOne", async () => node, restore);
  replace(
    Resource,
    "findOneAndUpdate",
    async (filter, update) => {
      result = { ...node, ...update.$set };
      return result;
    },
    restore,
  );
  replace(Resource, "find", async () => [node], restore);
  replace(Connection, "updateOne", async () => {}, restore);
  replace(monitor, "observeResource", async () => {}, restore);
  replace(availability, "observe", async () => {}, restore);
  const filename = require.resolve("./core"),
    cached = require.cache[filename];
  delete require.cache[filename];
  try {
    const service = require("./core");
    await service.sync({ _id: "c", version: "9.0" });
    assert.equal(result.version, "8.2.7");
    assert.equal(view(result).freshness, "fresh");
    deny = true;
    await service.sync({ _id: "c", version: "9.0" });
    assert.equal(result.version, "7.4-3");
    assert.equal(result.lastError, null);
    assert.equal(service.nodeVersion("invalid"), null);
  } finally {
    require.cache[filename] = cached;
    restore.reverse().forEach((fn) => fn());
  }
});
test("connection detail avoids inventory queries; node guests and storages have independent limits and scope", async () => {
  const restore = [],
    queries = [];
  const chain = (value) => ({
    populate() {
      return this;
    },
    limit(n) {
      this.limitValue = n;
      return this;
    },
    lean: async () => value,
  });
  replace(
    Connection,
    "findOne",
    () => chain({ _id: "64aa00000000000000000001", name: "Connection" }),
    restore,
  );
  replace(
    Resource,
    "findOne",
    () =>
      chain({
        _id: "64aa00000000000000000002",
        kind: "node",
        name: "Friendly node",
        nodeName: "pve-real",
        connectionId: { _id: "64aa00000000000000000001", name: "Connection" },
      }),
    restore,
  );
  replace(
    Resource,
    "find",
    (filter) => {
      const q = chain(
        filter.kind === "guest"
          ? Array.from({ length: 100 }, (_, i) => ({
              _id: `guest${i}`,
              kind: "guest",
            }))
          : [{ _id: "storage", kind: "storage" }],
      );
      queries.push({ filter, q });
      return q;
    },
    restore,
  );
  try {
    const { detail } = require("./view");
    const c = await detail("connections", "64aa00000000000000000001");
    assert.deepEqual(c.related, { guests: [], nodes: [], storages: [] });
    assert.equal(queries.length, 0);
    const n = await detail("nodes", "64aa00000000000000000002");
    assert.equal(n.related.guests.length, 100);
    assert.equal(n.related.storages.length, 1);
    assert.equal(queries.length, 2);
    for (const { filter, q } of queries) {
      assert.equal(filter.nodeName, "pve-real");
      assert.equal(filter.connectionId, "64aa00000000000000000001");
      assert.equal(filter.archived, false);
      assert.equal(q.limitValue, 100);
    }
  } finally {
    restore.reverse().forEach((fn) => fn());
  }
});
