const test = require("node:test");
const assert = require("node:assert/strict");
const { createResolveActor, publicRow, publicDetail } = require("./proxmoxSource");

test("Proxmox key requires active staff owner, scope, module and permission", async () => {
  let key = { scopes: ["proxmox"], createdBy: "owner" };
  let owner = { isEndUser: false, company: {} };
  let active = true;
  let permission = true;
  const resolve = createResolveActor({ getKey: async () => key, getOwner: async () => owner, enabled: async () => active, canFor: async () => () => permission });
  const authorize = async keyId => Boolean(await resolve(keyId, "proxmox"));
  assert.equal(await authorize("key"), true);
  permission = false;
  assert.equal(await authorize("key"), false);
  permission = true; active = false;
  assert.equal(await authorize("key"), false);
  active = true;
  for (const denied of [null, { isEndUser: true }, { isEndUser: false, banned: true }, { isEndUser: false, isServiceAccount: true }, { isEndUser: false, company: { isActive: false } }]) {
    owner = denied;
    assert.equal(await authorize("key"), false);
  }
  owner = { isEndUser: false };
  for (const revoked of [null, { scopes: [], createdBy: "owner" }, { scopes: ["proxmox"] }]) {
    key = revoked;
    assert.equal(await authorize("key"), false);
  }
});

test("MCP projection never includes credential/config/log fields or arbitrary future fields", () => {
  const row = publicRow({ id: "id", company: { id: "B" }, node: { name: "node-A" }, status: "unknown", tokenSecret: "secret", tokenId: "login", endpoints: [{ host: "hidden" }], config: { password: "secret" }, lastError: "secret", log: ["secret"], futureField: "secret", monitoringIssues: [{ companyId: "private" }], taskId: "old-task", incidentId: "old-incident", suppressedBy: "old-parent" });
  assert.deepEqual(row, { id: "id", company: { id: "B" }, node: { name: "node-A" }, status: "unknown" });
});

test("MCP detail projects grouped related resources from the REST view", () => {
  const result = publicDetail({ item: { id: "node" }, related: { guests: [{ id: "vm", companyId: "tenant", config: { secret: "hidden" } }], nodes: [], storages: [] } });
  assert.deepEqual(result, { item: { id: "node" }, related: { guests: [{ id: "vm", companyId: "tenant" }], nodes: [], storages: [] } });
});

test("guest lists expose only projected rows and pagination", () => {
  const { publicList } = require("./proxmoxSource");
  const page = { total: 1, page: 1, pageSize: 30 };
  assert.deepEqual(publicList({
    ...page, items: [{ id: "guest", operationData: {} }],
    nodeWarnings: [{ monitoringIssues: ["internal"] }], exposureEnabled: true,
  }), { ...page, items: [{ id: "guest" }] });
});

test("writes resolve an eligible actor only with write scope and both current Proxmox permissions", async () => {
  let scopes = ["proxmoxWrite"];
  let permissions = ["read", "manage"];
  let active = true;
  let user = { isEndUser: false };
  const resolve = createResolveActor({
    getKey: async () => ({ scopes, createdBy: "staff" }), getOwner: async () => user,
    enabled: async () => active, canFor: async () => query => query.proxmox.every(action => permissions.includes(action)),
  });
  const actor = await resolve("key", "proxmoxWrite");
  assert.equal(actor.userId, "staff");
  assert.equal(actor.mcpKeyId, "key");
  assert.equal(await resolve("key", "proxmox"), null);
  for (permissions of [["read"], ["manage"], ["power", "backup"]]) assert.equal(await resolve("key", "proxmoxWrite"), null);
  permissions = ["read", "manage"];
  scopes = ["proxmox"];
  assert.equal(await resolve("key", "proxmoxWrite"), null);
  scopes = ["proxmoxWrite"];
  active = false;
  assert.equal(await resolve("key", "proxmoxWrite"), null);
  active = true;
  for (user of [null, { isEndUser: true }, { isEndUser: false, deletedAt: new Date() }]) {
    assert.equal(await resolve("key", "proxmoxWrite"), null);
  }
});


test("management detail exposes dates and permitted node links with no raw maintenance text", () => {
  const result = { item: { kind: "node", monitoringEnabled: false, maintenance: { from: "start", until: "end", reason: "private" }, clientDeviceId: "card" } };
  assert.deepEqual(publicDetail(result).item, { kind: "node" });
  const management = { kind: "node", monitoringEnabled: false, maintenance: { from: "start", until: "end" } };
  assert.deepEqual(publicDetail(result, { management: true }).item, management);
  assert.deepEqual(publicDetail(result, { management: true, inventory: true }).item, { ...management, clientDeviceId: "card" });
});
