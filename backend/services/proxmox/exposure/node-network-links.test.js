const test = require("node:test");
const assert = require("node:assert/strict");
const {
  prepareNodeLinks,
  requireNetworkAccess,
} = require("./node-network-links");
const { linksVersion } = require("./network-links");
const node = { connectionId: "64aa00000000000000000001", nodeName: "pve" };
const link = {
  _id: "64aa00000000000000000002",
  ...node,
  routerId: "64aa00000000000000000003",
  bridge: "vmbr0",
  vlan: null,
  cidr: "10.0.50.0/24",
  lanInterface: "bridge",
  wan: { kind: "list", name: "WAN" },
};
const access = {
  can: (rights) => !rights.settings,
  lookups: { linkExists: async () => true },
};
const inputLink = ({ connectionId: _connection, nodeName: _node, ...row }) =>
  row;
test("node network edit needs Proxmox and MikroTik rights, never global settings rights", () => {
  assert.doesNotThrow(() => requireNetworkAccess(access));
  for (const denied of ["proxmox", "mikrotik"])
    assert.throws(
      () => requireNetworkAccess({ can: (rights) => !rights[denied] }),
      /прав/,
    );
  assert.throws(
    () => requireNetworkAccess({ ...access, isEndUser: true }),
    /прав/,
  );
});
test("node edits preserve other nodes and routers, assign scope server-side", async () => {
  const other = { ...link, _id: "64aa00000000000000000004", nodeName: "other" };
  const added = {
    ...inputLink(link),
    _id: undefined,
    routerId: "64aa00000000000000000005",
    vlan: 60,
    cidr: "10.0.60.3/24",
  };
  const current = [link, other];
  const result = await prepareNodeLinks(
    node,
    { revision: linksVersion(current), links: [inputLink(link), added] },
    current,
    access,
  );
  assert.deepEqual(result[0], other);
  assert.equal(result[1]._id, link._id);
  assert.equal(result[2].nodeName, "pve");
  assert.equal(result[2].cidr, "10.0.60.0/24");
  assert.equal(result[2].vlan, 60);
});
test("deleting an unavailable node link does not validate other nodes or surviving unchanged links", async () => {
  const current = [
    link,
    { ...link, _id: "64aa00000000000000000004", nodeName: "other" },
  ];
  const result = await prepareNodeLinks(
    node,
    { revision: linksVersion(current), links: [] },
    current,
    {
      ...access,
      lookups: { linkExists: () => assert.fail("no live read needed") },
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].nodeName, "other");
});
test("stale revision and forged ownership are rejected", async () => {
  const current = [link];
  await assert.rejects(
    prepareNodeLinks(node, { revision: "stale", links: [] }, current, access),
    (e) => e.status === 409 || e.statusCode === 409,
  );
  await assert.rejects(
    prepareNodeLinks(
      node,
      {
        revision: linksVersion(current),
        links: [{ ...inputLink(link), nodeName: "other" }],
      },
      current,
      access,
    ),
    /поля/,
  );
  await assert.rejects(
    prepareNodeLinks(
      node,
      {
        revision: linksVersion(current),
        links: [{ ...inputLink(link), _id: "64aa00000000000000000009" }],
      },
      current,
      access,
    ),
    /принадлежит/,
  );
});
test("unchanged mappings survive Mongo property order and inaccessible routers when another link is deleted", async () => {
  const stored = {
    connectionId: link.connectionId,
    nodeName: link.nodeName,
    bridge: link.bridge,
    vlan: link.vlan,
    cidr: link.cidr,
    routerId: link.routerId,
    lanInterface: link.lanInterface,
    wan: link.wan,
    _id: link._id,
  };
  const current = [
    stored,
    { ...link, _id: "64aa00000000000000000008", vlan: 80 },
  ];
  const result = await prepareNodeLinks(
    node,
    { revision: linksVersion(current), links: [inputLink(stored)] },
    current,
    {
      ...access,
      lookups: {
        linkExists: () =>
          assert.fail("unchanged mapping must not require device"),
      },
    },
  );
  assert.equal(result.length, 1);
});
test("atomic save detects concurrent edits after validation and emits no invalidation or event", async (t) => {
  const { Resource } = require("../../../models/proxmox");
  const Preferences = require("../../../models/preferences");
  const store = require("./store");
  const core = require("../core");
  const current = [link];
  t.mock.method(Resource, "findOne", () => ({
    lean: async () => ({
      ...node,
      _id: "64aa00000000000000000006",
      kind: "node",
    }),
  }));
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      _id: "64aa00000000000000000007",
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
      proxmox: { networkLinks: current },
    }),
  }));
  t.mock.method(Preferences, "updateOne", async (filter) => {
    assert.deepEqual(filter["proxmox.networkLinks"], current);
    return { matchedCount: 0 };
  });
  t.mock.method(store, "invalidateResources", () =>
    assert.fail("no invalidation"),
  );
  t.mock.method(core, "event", () => assert.fail("no audit for failed update"));
  await assert.rejects(
    require("./node-network-links").saveNodeLinks(
      "64aa00000000000000000006",
      { revision: linksVersion(current), links: [] },
      access,
    ),
    (e) => e.status === 409 || e.statusCode === 409,
  );
});
test("node form keeps unavailable linked devices accessible for removal", async (t) => {
  const { Resource } = require("../../../models/proxmox");
  const Preferences = require("../../../models/preferences");
  const Router = require("../../../models/mikrotik");
  const discovery = require("./node-network-discovery");
  t.mock.method(Resource, "findOne", () => ({
    lean: async () => ({
      ...node,
      _id: "64aa00000000000000000006",
      kind: "node",
    }),
  }));
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
      proxmox: { networkLinks: [link] },
    }),
  }));
  t.mock.method(discovery, "getNodeNetworkOptions", async () => {
    throw new Error("offline");
  });
  t.mock.method(Router, "find", () => ({
    select() {
      return this;
    },
    lean: async () => [
      {
        _id: link.routerId,
        name: "Offline router",
        credentials: { host: "10.0.0.1" },
      },
    ],
  }));
  const result = await require("./node-network-links").readNodeLinks(
    "64aa00000000000000000006",
    access,
  );
  assert.deepEqual(result.links, [link]);
  assert.equal(result.routers[0].id, link.routerId);
  assert.equal(result.routers[0].name, "Offline router");
  assert.equal(result.networks.length, 0);
  assert.equal(result.warnings.length, 1);
});
test("successful node save touches only network fields and invalidates that node", async (t) => {
  const { Resource } = require("../../../models/proxmox");
  const Preferences = require("../../../models/preferences");
  const store = require("./store");
  const core = require("../core");
  const current = [link];
  let scope, event;
  t.mock.method(Resource, "findOne", () => ({
    lean: async () => ({
      ...node,
      _id: "64aa00000000000000000006",
      kind: "node",
    }),
  }));
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      _id: "64aa00000000000000000007",
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
      proxmox: { networkLinks: current, cpuThreshold: 70 },
    }),
  }));
  t.mock.method(Preferences, "updateOne", async (filter, patch) => {
    assert.deepEqual(Object.keys(patch.$set).sort(), [
      "proxmox.networkLinks",
      "proxmox.networkLinksVersion",
    ]);
    assert.deepEqual(patch.$set["proxmox.networkLinks"], []);
    return { matchedCount: 1 };
  });
  t.mock.method(store, "invalidateResources", async (value) => {
    scope = value;
  });
  t.mock.method(core, "event", async (...args) => {
    event = args;
  });
  assert.deepEqual(
    await require("./node-network-links").saveNodeLinks(
      "64aa00000000000000000006",
      { revision: linksVersion(current), links: [] },
      { ...access, userId: "actor" },
    ),
    { ok: true },
  );
  assert.deepEqual(scope, node);
  assert.equal(event[3], "actor");
});
