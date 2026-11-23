require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const express = require("express");

test("Proxmox resource writes through authenticated MCP share HD state and audit", {
  skip: process.env.HD_MCP_WRITE_INTEGRATION !== "1",
}, async t => {
  const uri = process.env.HD_MCP_TEST_MONGO_URI;
  const env = uri ? {} : require("node:util").parseEnv(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../../.env"), "utf8"));
  const dbName = "hd_proxmox_mcp_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(uri || "mongodb://127.0.0.1:27017", {
    dbName, authSource: "admin", user: env.MONGODB_USERNAME, pass: env.MONGODB_PASSWORD, serverSelectionTimeoutMS: 5000,
  });
  t.after(async () => {
    assert.equal(mongoose.connection.name, dbName);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  process.env.BETTER_AUTH_SECRET ||= "local-test-secret-for-proxmox-write-integration";
  process.env.APP_PUBLIC_URL ||= "http://localhost";
  await require("../../auth/bootstrap").initAuth();

  const keys = require("../../controllers/mcpKey");
  const User = require("../../models/user");
  const Company = require("../../models/company");
  const Preferences = require("../../models/preferences");
  const Card = require("../../models/inventory/clientDevice");
  const { Resource, Event } = require("../../models/proxmox");
  const oid = () => new mongoose.Types.ObjectId();
  const owner = oid(), company = oid(), card = oid(), foreignCard = oid(), org = oid();
  await Company.collection.insertOne({ _id: company, alias: "Test", isActive: true });
  await User.collection.insertOne({ _id: owner, isEndUser: false, firstName: "Staff", company: { _id: company, isActive: true } });
  await mongoose.connection.db.collection("organization").insertOne({ _id: org, slug: "hd" });
  const member = mongoose.connection.db.collection("member");
  await member.insertOne({ organizationId: String(org), userId: String(owner), role: "manager" });
  await mongoose.connection.db.collection("organizationRole").insertMany([
    { role: "manager", permission: JSON.stringify({ proxmox: ["read", "manage"], device: ["manage"] }) },
    { role: "proxmox-only", permission: JSON.stringify({ proxmox: ["read", "manage"] }) },
    { role: "reader", permission: JSON.stringify({ proxmox: ["read"] }) },
  ].map(role => ({ ...role, organizationId: String(org) })));
  async function changeKey(action, body) {
    let response;
    await keys[action]({ auth: { userId: owner }, body }, {
      status() { return this; }, json(result) { response = result; },
    }, error => { throw error; });
    return response;
  }
  const { key } = await changeKey("create", { name: "Test key", scopes: ["proxmoxWrite"] });
  const { _id: keyId, value } = key;
  assert.deepEqual(key.scopes, ["proxmoxWrite"]);
  await Preferences.collection.insertOne({ modules: { proxmox: { isActive: true }, inventory: { isActive: true } } });
  await Card.collection.insertMany([{ _id: card, companyId: company }, { _id: foreignCard, companyId: oid() }]);
  const node = await Resource.create({ kind: "node", externalId: "node/test", companyId: company, connectionId: oid() });
  const guest = await Resource.create({ kind: "guest", externalId: "qemu/1", connectionId: node.connectionId });
  const app = express();
  app.use(express.json());
  app.use("/api/mcp", require("../../routes/mcp"));
  const http = app.listen(0, "127.0.0.1");
  await new Promise(resolve => http.once("listening", resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  async function call(name, args, expectedError = false) {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + value },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    const message = JSON.parse(body.split("\n").find(line => line.startsWith("data:")).slice(5));
    const result = message.result;
    assert.equal(Boolean(message.error || result?.isError), expectedError, JSON.stringify(message));
    if (!expectedError) return JSON.parse(result.content[0].text);
  }
  await call("set_proxmox_company", { id: guest.id, kind: "guest", companyId: String(company) });
  assert.equal(String((await Resource.findById(guest.id)).companyId), String(company));
  await call("set_proxmox_monitoring", { id: guest.id, monitoringEnabled: false });
  assert.equal((await Resource.findById(guest.id)).monitoringEnabled, false);
  const until = new Date(Date.now() + 86400000).toISOString();
  await call("set_proxmox_maintenance", { id: guest.id, window: { until, reason: "Planned service" } });
  assert.equal((await Resource.findById(guest.id)).maintenance.until.toISOString(), until);
  await call("set_proxmox_maintenance", { id: guest.id, window: {} }, true);
  assert.equal((await Resource.findById(guest.id)).maintenance.reason, "Planned service");
  await call("set_proxmox_maintenance", { id: guest.id, window: null });
  assert.ok(!(await Resource.findById(guest.id)).maintenance?.until);
  await call("set_proxmox_inventory_link", { id: node.id, clientDeviceId: String(foreignCard) }, true);
  await call("set_proxmox_inventory_link", { id: guest.id, clientDeviceId: String(card) }, true);
  await call("set_proxmox_inventory_link", { id: node.id, clientDeviceId: String(card) });
  assert.equal(String((await Resource.findById(node.id)).clientDeviceId), String(card));
  await changeKey("update", { _id: keyId, scopes: ["proxmox", "proxmoxWrite"] });
  const visible = await call("get_proxmox_resource", { id: node.id });
  assert.equal(visible.item.clientDeviceId, String(card));
  assert.equal((await call("get_proxmox_resource", { id: guest.id })).item.monitoringEnabled, false);
  await member.updateOne({ userId: String(owner) }, { $set: { role: "proxmox-only" } });
  assert.equal((await call("get_proxmox_resource", { id: node.id })).item.clientDeviceId, undefined);
  await call("set_proxmox_inventory_link", { id: node.id, clientDeviceId: null }, true);
  await member.updateOne({ userId: String(owner) }, { $set: { role: "manager" } });
  await call("set_proxmox_inventory_link", { id: node.id, clientDeviceId: null });
  assert.ok(!(await Resource.findById(node.id)).clientDeviceId);
  await member.updateOne({ userId: String(owner) }, { $set: { role: "reader" } });
  await call("set_proxmox_monitoring", { id: guest.id, monitoringEnabled: true }, true);
  assert.equal((await Resource.findById(guest.id)).monitoringEnabled, false);
  assert.equal(await Event.countDocuments({ actorId: owner, mcpKeyId: keyId }), 6);
  const access = await changeKey("update", { _id: keyId, scopes: ["proxmox"] });
  assert.deepEqual(access.key.scopes, ["proxmox"]);
  await call("set_proxmox_monitoring", { id: guest.id, monitoringEnabled: true }, true);
  await changeKey("remove", { _id: keyId });
  const revoked = await fetch(`http://127.0.0.1:${http.address().port}/api/mcp`, {
    method: "POST", headers: { Authorization: "Bearer " + value },
  });
  assert.equal(revoked.status, 401);
});
