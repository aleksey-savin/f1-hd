const test = require("node:test");
const { beforeEach } = require("node:test");
beforeEach((t) => t.mock.method(require("./monitoring-view"), "enrich", async (items) => items));
const assert = require("node:assert/strict");
const { Duplex } = require("node:stream");
const tls = require("node:tls");
const { safeIp, rangesToAddresses } = require("./policy");
const { summarize, stateOf } = require("./availability");
const { requestEndpoint, normalizeEndpoint } = require("./transport");
test("private LAN allowed; equivalent reserved IPv6 forms rejected", () => {
  for (const address of ["10.0.0.1", "192.168.1.1", "172.16.0.1", "fc00::1"])
    assert.equal(safeIp(address), true, address);
  for (const address of [
    "127.0.0.1",
    "169.254.1.1",
    "0:0:0:0:0:0:0:1",
    "0:0:0:0:0:0:0:0",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "fe80::1",
    "ff02::1",
  ])
    assert.equal(safeIp(address), false, address);
});
test("discovery caps scope and deduplicates overlap", () => {
  assert.deepEqual(rangesToAddresses(["192.168.1.0/30", "192.168.1.1"]), [
    "192.168.1.1",
    "192.168.1.2",
  ]);
  assert.throws(() => rangesToAddresses(["10.0.0.0/16"]));
  assert.throws(() => rangesToAddresses(["169.254.0.0/30"]));
});
test("availability excludes maintenance; unobserved time reduces coverage only", () => {
  const result = summarize(
    [
      { from: 0, until: 1000, state: "up" },
      { from: 1000, until: 2000, state: "down" },
      { from: 2000, until: 3000, state: "maintenance" },
    ],
    new Date(0),
    new Date(4000),
  );
  assert.equal(result.availability, 50);
  assert.equal(result.coverage, 200 / 3);
  assert.equal(result.unknownMs, 1000);
  assert.equal(
    stateOf(
      { kind: "guest", expectedRunning: false, status: "stopped" },
      {},
      new Date(),
    ),
    "excluded",
  );
  assert.equal(
    stateOf(
      { kind: "node", status: "offline", failedPolls: 1 },
      {},
      new Date(),
    ),
    "unknown",
  );
});
test("HTTPS sends token on the exact verified socket; changed pin sends nothing", async () => {
  const original = tls.connect;
  let calls = 0,
    written = "";
  let tlsOptions;
  tls.connect = (options) => {
    tlsOptions = options;
    calls++;
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        written += chunk.toString();
        callback();
        if (written.includes("\r\n\r\n"))
          process.nextTick(() =>
            this.push(
              'HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{"data":{"x":1}}',
            ),
          );
      },
    });
    socket.setTimeout = () => socket;
    socket.setNoDelay = () => socket;
    socket.setKeepAlive = () => socket;
    socket.getPeerCertificate = () => ({ fingerprint256: "AA".repeat(32) });
    process.nextTick(() => socket.emit("secureConnect"));
    return socket;
  };
  try {
    const endpoint = {
      host: "192.168.1.2",
      port: 8006,
      transport: "direct",
      tlsMode: "fingerprint",
      fingerprint: "aa".repeat(32),
    };
    assert.deepEqual(
      await requestEndpoint(endpoint, "/api2/json/version", {
        tokenId: "a@pve!test",
        tokenSecret: "private",
      }),
      { x: 1 },
    );
    assert.equal(calls, 1);
    assert.match(written, /Authorization: PVEAPIToken=a@pve!test=private/i);
    written = "";
    await assert.rejects(
      requestEndpoint({ ...endpoint, fingerprint: "bb".repeat(32) }, "/", {
        tokenId: "a",
        tokenSecret: "private",
      }),
      /TLS/,
    );
    assert.equal(written, "");
    for (const mode of ["insecure", "system", "ca"]) {
      written = "";
      const configured = normalizeEndpoint({
        ...endpoint,
        tlsMode: mode,
        fingerprint: "",
        ...(mode === "ca" ? { caCert: "-----BEGIN CERTIFICATE-----" } : {}),
      });
      assert.deepEqual(
        await requestEndpoint(configured, "/api2/json/version"),
        { x: 1 },
      );
      assert.equal(tlsOptions.rejectUnauthorized, mode !== "insecure");
    }
    assert.equal(normalizeEndpoint({ host: endpoint.host }).tlsMode, "system");
  } finally {
    tls.connect = original;
  }
});
test("operation idempotency returns unknown task without resubmission and rejects payload changes", async () => {
  const Task = require("./operationStore");
  const { enqueue } = require("./operations");
  const ready = Task.ready;
  Task.ready = async () => {};
  const original = Task.findOne,
    create = Task.create;
  let writes = 0;
  const previous = {
    resourceId: "vm",
    operation: "backup",
    storage: "backup",
    state: "unknown",
    active: true,
  };
  Task.findOne = async () => previous;
  Task.create = async () => {
    writes++;
  };
  try {
    assert.equal(
      await enqueue(
        { _id: "vm", kind: "guest" },
        {
          operation: "backup",
          storage: "backup",
          idempotencyKey: "test-key-123",
        },
        "user",
      ),
      previous,
    );
    await assert.rejects(
      enqueue(
        { _id: "vm", kind: "guest" },
        {
          operation: "backup",
          storage: "different",
          idempotencyKey: "test-key-123",
        },
        "user",
      ),
      /Ключ/,
    );
    assert.equal(writes, 0);
  } finally {
    Task.ready = ready;
    Task.findOne = original;
    Task.create = create;
  }
});
test("DTO preserves tenant company independently of infrastructure and removes token", () => {
  const { view } = require("./view");
  const dto = view({
    _id: "vm",
    kind: "guest",
    companyId: { _id: "tenant", alias: "Tenant" },
    connectionId: { _id: "infra", name: "Infrastructure" },
    tokenSecret: "secret",
  });
  assert.equal(dto.company.id, "tenant");
  assert.equal(dto.connection.id, "infra");
  assert.equal(dto.tokenSecret, undefined);
});
test("monitoring counters snapshot tenant and infrastructure owner without a separate record", async () => {
  const { Resource, Connection } = require("../../models/proxmox");
  const { markProblem } = require("./monitor");
  const update = Resource.updateOne,
    find = Connection.findById,
    inserted = [];
  Resource.updateOne = async (filter, change) => {
    inserted.push({
      filter,
      issue: change.$set["monitoringIssues.availability"],
    });
  };
  Connection.findById = () => ({
    select: async () => ({ companyId: "owner" }),
  });
  try {
    await markProblem(
      { _id: "g1", kind: "guest", companyId: "tenant" },
      "availability",
      "Stopped",
      new Date(),
    );
    await markProblem(
      { _id: "g2", kind: "guest", connectionId: "c" },
      "availability",
      "Stopped",
      new Date(),
    );
    assert.equal(inserted[0].issue.companyId, "tenant");
    assert.equal(inserted[1].issue.companyId, "owner");
    assert.deepEqual(
      inserted[0].filter["monitoringIssues.availability.active"],
      { $ne: true },
    );
  } finally {
    Resource.updateOne = update;
    Connection.findById = find;
  }
});
test("interrupted dispatch is marked unknown and remains locked without sending again", async () => {
  const Task = require("./operationStore");
  const Prefs = require("../../models/preferences");
  const originals = {
    find: Task.active,
    update: Task.updateOne,
    prefs: Prefs.findOne,
  };
  const changes = [];
  Prefs.findOne = () => ({
    lean: async () => ({ modules: { proxmox: { isActive: true } } }),
  });
  Task.active = async () => [
    { _id: "task", state: "dispatching", active: true },
  ];
  Task.updateOne = async (filter, update) => {
    changes.push(update);
  };
  try {
    await require("./operations").tick();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].$set.state, "unknown");
    assert.equal(changes[0].$set.active, undefined);
  } finally {
    Task.active = originals.find;
    Task.updateOne = originals.update;
    Prefs.findOne = originals.prefs;
  }
});
test("editing a single endpoint cannot replace installation and inherit tenants", async () => {
  const transport = require("./transport");
  const original = transport.request;
  let rights = { "Sys.Audit": 0 };
  transport.request = async (connection, path) => {
    if (path === "/version") return { version: "8" };
    if (path === "/cluster/resources") return [{ type: "node", node: "pve" }];
    if (path.includes("/certificates/info"))
      return [{ filename: "pve-ssl.pem", fingerprint: "new-installation" }];
    if (path === "/access/permissions?path=%2F") return { "/": rights };
    if (path === "/cluster/status")
      return [
        { type: "node", name: "another-node", local: 0 },
        { type: "node", name: "connected-node", local: 1 },
      ];
    throw new Error("unexpected request");
  };
  const filename = require.resolve("./core");
  const cached = require.cache[filename];
  delete require.cache[filename];
  try {
    const { verify } = require("./core");
    await assert.rejects(
      verify({
        endpoints: [{ host: "10.0.0.1" }],
        clusterIdentity: "pve:old-installation",
      }),
      /другой установке/,
    );
    const data = { endpoints: [{ host: "10.0.0.1" }] };
    assert.equal((await verify(data)).nodeName, "connected-node");
    assert.equal((await verify(data)).permissions["/"]["Sys.Audit"], 0);
    rights = { "Sys.Audit": 1 };
    assert.equal((await verify(data)).permissions["/"]["Sys.Audit"], 1);
    rights = {};
    await assert.rejects(verify(data), /API-токену требуется Sys.Audit/);
  } finally {
    transport.request = original;
    require.cache[filename] = cached;
  }
});
test("task DTO exposes its populated target while keeping scalar resourceId", () => {
  const { view } = require("./view");
  const dto = view({
    _id: "task",
    resourceId: {
      _id: "vm",
      name: "customer-vm",
      kind: "guest",
      vmid: 101,
      nodeName: "pve-1",
    },
  });
  assert.equal(dto.resourceId, "vm");
  assert.deepEqual(dto.resource, {
    id: "vm",
    name: "customer-vm",
    kind: "guest",
    vmid: 101,
    nodeName: "pve-1",
  });
});
test("guest list joins owner in one batch and keeps tenant separate", async () => {
  const { Resource, Event } = require("../../models/proxmox");
  const { list } = require("./view");
  const original = Resource.find,
    count = Resource.countDocuments;
  const originalEvents = Event.find;
  const originalAggregate = Event.aggregate;
  let aggregateCalls = 0;
  Event.aggregate = async (pipeline) => {
    aggregateCalls++;
    assert.deepEqual(pipeline[0].$match, {
      kind: "vmOperation",
      resourceId: { $in: ["vm"] },
    });
    assert.deepEqual(pipeline[1].$sort, { createdAt: -1, _id: -1 });
    return [
      {
        _id: "vm",
        operation: {
          _id: "done",
          resourceId: "vm",
          operationData: {
            operation: "reboot",
            state: "succeeded",
            active: false,
          },
        },
      },
    ];
  };
  let eventCalls = 0;
  Event.find = (filter) => {
    eventCalls++;
    assert.deepEqual(filter, {
      kind: "vmOperation",
      resourceId: { $in: ["vm"] },
      "operationData.active": true,
    });
    return {
      lean: async () => [
        {
          _id: "op",
          resourceId: "vm",
          operationData: { operation: "stop", active: true, state: "running" },
        },
      ],
    };
  };
  let calls = 0;
  const query = (rows) => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      populate: () => chain,
      select: () => chain,
      lean: async () => rows,
    };
    return chain;
  };
  Resource.find = (filter) => {
    calls++;
    return query(
      filter.kind === "guest"
        ? [
            {
              _id: "vm",
              kind: "guest",
              nodeName: "pve-1",
              connectionId: { _id: "cluster", name: "Cluster" },
              companyId: { _id: "tenant", alias: "Customer" },
            },
          ]
        : [
            {
              _id: "node",
              kind: "node",
              nodeName: "pve-1",
              name: "pve-1",
              connectionId: "cluster",
              companyId: { _id: "owner", alias: "Provider" },
            },
          ],
    );
  };
  Resource.countDocuments = async () => 1;
  try {
    const data = await list("guests");
    assert.equal(calls, 3);
    assert.equal(eventCalls, 1);
    assert.equal(aggregateCalls, 1);
    assert.equal(data.items[0].latestOperation.state, "succeeded");
    assert.equal(data.items[0].currentOperation.operation, "stop");
    assert.equal(data.items[0].currentOperation.state, "running");
    assert.equal(data.items[0].company.id, "tenant");
    assert.equal(data.items[0].node.company.id, "owner");
    assert.equal(data.items[0].node.id, "node");
  } finally {
    Event.find = originalEvents;
    Event.aggregate = originalAggregate;
    Resource.find = original;
    Resource.countDocuments = count;
  }
});
