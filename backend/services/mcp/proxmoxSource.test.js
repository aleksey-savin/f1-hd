const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthorize, publicRow, publicDetail } = require("./proxmoxSource");

test("Proxmox key requires active staff owner, scope, module and permission", async () => {
  let key = { scopes: ["proxmox"], createdBy: "owner" };
  let owner = { isEndUser: false, company: {} };
  let active = true;
  let permission = true;
  const authorize = createAuthorize({ getKey: async () => key, getOwner: async () => owner, enabled: async () => active, canFor: async () => () => permission });
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
