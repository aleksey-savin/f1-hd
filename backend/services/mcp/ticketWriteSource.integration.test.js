require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");

test("ticket mutations preserve access, references, history and retry results on standalone Mongo", {
  skip: process.env.HD_MCP_WRITE_INTEGRATION !== "1",
}, async t => {
  const uri = process.env.HD_MCP_TEST_MONGO_URI;
  const env = uri ? {} : require("node:util").parseEnv(require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../../.env"), "utf8"));
  const dbName = "hd_mcp_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(uri || "mongodb://127.0.0.1:27017", {
    dbName, authSource: "admin", user: env.MONGODB_USERNAME, pass: env.MONGODB_PASSWORD,
    serverSelectionTimeoutMS: 5000,
  });
  t.after(async () => {
    assert.equal(mongoose.connection.name, dbName);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  process.env.BETTER_AUTH_SECRET ||= "local-test-secret-for-ticket-write-integration";
  process.env.APP_PUBLIC_URL ||= "http://localhost";
  await require("../../auth/bootstrap").initAuth();
  const { mutate } = require("./ticketWriteSource");
  const { Ticket } = require("../../models/ticket");
  const User = require("../../models/user");
  const McpKey = require("../../models/mcpKey");
  const Log = require("../../models/ticketLog");
  const Preferences = require("../../models/preferences");
  const Work = require("../../models/work");
  const Comment = require("../../models/comment");
  const oid = () => new mongoose.Types.ObjectId();
  const owner = oid(), ticketId = oid(), keyId = oid(), companyId = oid();
  await User.collection.insertOne({ _id: owner, isAdmin: true, isEndUser: false, company: { _id: companyId }, firstName: "Test", lastName: "Staff" });
  await require("../../models/company").collection.insertOne({ _id: companyId, alias: "Example" });
  await McpKey.collection.insertOne({ _id: keyId, createdBy: owner, scopes: ["ticketsWrite"] });
  await Preferences.collection.insertOne({ modules: { timeTracking: { isActive: true } } });
  await Ticket.collection.insertMany([1, 2].map(num => ({ _id: num === 1 ? ticketId : oid(), num, company: { _id: companyId }, comments: [] })));
  const call = (kind, action, args) => mutate({ keyId, kind, action, args: { num: 1, ...args } });
  for (const kind of ["comment", "work"]) {
    const data = kind === "comment" ? { content: "An internal update" }
      : { description: "Diagnostics", startedAt: "2026-11-01T10:00:00Z", finishedAt: "2026-11-01T10:30:00Z" };
    const add = { ...data, requestId: randomUUID() };
    const [first, repeat] = await Promise.all([call(kind, "add", add), call(kind, "add", add)]);
    assert.deepEqual(first, repeat);
    const model = kind === "comment" ? Comment : Work;
    assert.equal(await model.countDocuments(), 1);
    if (kind === "comment") {
      assert.equal((await Ticket.findById(ticketId)).comments[0].toString(), first.id);
      assert.equal((await Comment.findById(first.id)).notifications.pending, true);
    }
    const patch = kind === "comment" ? { content: "Corrected" } : { description: "Corrected" };
    await assert.rejects(call(kind, "add", { ...add, ...patch }), { statusCode: 409 });
    await assert.rejects(call(kind, "delete", { ...first, num: 2, requestId: randomUUID() }), { statusCode: 404 });
    const edit = { ...first, ...patch, requestId: randomUUID() };
    const changed = await call(kind, "update", edit);
    assert.deepEqual(await call(kind, "update", edit), changed);
    assert.equal((await model.findById(first.id))[Object.keys(patch)[0]], "Corrected");
    await assert.rejects(call(kind, "delete", { ...first, requestId: randomUUID() }), { statusCode: 409 });
    const remove = { ...changed, requestId: randomUUID() };
    assert.deepEqual(await call(kind, "delete", remove), { id: first.id, deleted: true });
    assert.deepEqual(await call(kind, "delete", remove), { id: first.id, deleted: true });
    assert.deepEqual(await call(kind, "add", add), first);
    assert.equal(await model.countDocuments(), 0);
  }
  assert.deepEqual((await Ticket.findById(ticketId)).comments, []);
  assert.equal(await Log.countDocuments({ ticketId, mcpKeyId: keyId, actorId: owner }), 6);
  const mail = await Comment.create({ source: "email", content: "Mail", ticketId, createdBy: owner, updatedBy: owner });
  await assert.rejects(call("comment", "delete", { id: mail.id, revision: mail.updatedAt.toISOString(), requestId: randomUUID() }), { statusCode: 409 });
  const legacyId = oid();
  await Comment.collection.insertOne({ _id: legacyId, content: "Legacy", createdBy: owner, updatedBy: owner });
  await Ticket.updateOne({ _id: ticketId }, { $push: { comments: legacyId } });
  const legacy = await call("comment", "update", { id: String(legacyId), revision: "legacy", content: "Revised", requestId: randomUUID() });
  const competing = await Promise.allSettled(["First", "Second"].map(content => call("comment", "update", {
    ...legacy, content, requestId: randomUUID(),
  })));
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(competing.find(result => result.status === "rejected").reason.statusCode, 409);

  // Interrupt after the mutation and ticket link but before its history row.
  const add = { content: "Recover", requestId: randomUUID() };
  const originalLog = Log.updateOne;
  Log.updateOne = () => { throw new Error("simulated interruption"); };
  try {
    await assert.rejects(call("comment", "add", add), /simulated interruption/);
  } finally {
    Log.updateOne = originalLog;
  }
  const recovered = await call("comment", "add", add);
  assert.equal(await Comment.countDocuments({ content: "Recover" }), 1);
  assert.equal((await Ticket.findById(ticketId)).comments.filter(id => String(id) === recovered.id).length, 1);

  await User.updateOne({ _id: owner }, { $set: { isAdmin: false } });
  await assert.rejects(call("comment", "add", add), { statusCode: 403 });
  await Ticket.updateOne({ _id: ticketId }, { $set: { createdBy: owner } });
  for (const action of ["update", "delete"]) {
    await assert.rejects(call("ticket", action, { expectedVersion: 0, title: "Denied", requestId: randomUUID() }), { statusCode: 403 });
  }
  await assert.rejects(call("ticket", "add", { applicantId: String(oid()), description: "Denied", requestId: randomUUID() }), { statusCode: 403 });
  const other = await Comment.create({ content: "Someone else's note", ticketId, createdBy: oid(), updatedBy: owner });
  await assert.rejects(call("comment", "delete", { id: other.id, revision: other.updatedAt.toISOString(), requestId: randomUUID() }), { statusCode: 403 });
  await assert.rejects(call("work", "add", { requestId: randomUUID() }), { statusCode: 403 });
  const db = mongoose.connection.db;
  const org = oid();
  await db.collection("organization").insertOne({ _id: org, slug: "hd" });
  await db.collection("member").insertOne({ userId: String(owner), organizationId: String(org), role: "test-worker" });
  await db.collection("organizationRole").insertOne({
    organizationId: String(org), role: "test-worker", permission: JSON.stringify({ work: ["read", "log"], ticket: ["manage", "delete"] }),
  });
  for (const action of ["update", "delete"]) {
    await assert.rejects(call("ticket", action, { num: 2, expectedVersion: 0, title: "Outside scope", requestId: randomUUID() }), { statusCode: 403 });
  }
  const shared = await Work.create({
    tickets: [ticketId, (await Ticket.findOne({ num: 2 }))._id], description: "Shared work",
    createdBy: { _id: owner }, updatedBy: { _id: owner }, company: companyId,
  });
  const sharedEdit = { id: shared.id, revision: shared.updatedAt.toISOString(), description: "Updated shared work", requestId: randomUUID() };
  await assert.rejects(call("work", "update", sharedEdit), { statusCode: 403 });
  await Ticket.updateOne({ num: 2 }, { $set: { createdBy: owner } });
  const sharedUpdate = await call("work", "update", sharedEdit);
  assert.equal(sharedUpdate.id, shared.id);
  assert.equal(await Log.countDocuments({ event: "обновлены работы", mcpKeyId: keyId }), 3);
  await User.updateOne({ _id: owner }, { $set: { banned: true } });
  await assert.rejects(call("work", "update", sharedEdit), { statusCode: 403 });
  await User.updateOne({ _id: owner }, { $unset: { banned: 1 } });
  await User.updateOne({ _id: owner }, { $set: { isAdmin: true } });
  // Exercise production authentication, tool registration, SDK validation,
  // the database mutation and the read-side revision through the HTTP mount.
  const { generateMcpKey, hashApiKey } = require("../../utils/apiKeyGenerator");
  const value = generateMcpKey();
  await McpKey.updateOne({ _id: keyId }, { $set: { scopes: ["tickets", "ticketsWrite"], keyHash: hashApiKey(value) } });
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/api/mcp", require("../../routes/mcp"));
  const http = app.listen(0, "127.0.0.1");
  await new Promise(resolve => http.once("listening", resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  const rpc = async (name, args) => {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + value },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    const event = JSON.parse(body.split("\n").find(line => line.startsWith("data:")).slice(5));
    assert.equal(event.result.isError, undefined, JSON.stringify(event.result.content));
    return event.result.content[0].text;
  };
  const created = JSON.parse(await rpc("add_ticket_comment", { num: 1, content: "From MCP", requestId: randomUUID() }));
  assert.ok((await rpc("get_ticket", { num: 1 })).includes(`[id ${created.id}, revision ${created.revision}]`));
  const removed = JSON.parse(await rpc("delete_ticket_comment", { num: 1, ...created, requestId: randomUUID() }));
  assert.equal(removed.deleted, true);

  await require("../../models/ticket").initializeCounter(100);
  const createTicket = { description: "Printer failure", requestId: randomUUID() };
  const ticketResult = JSON.parse(await rpc("add_ticket", createTicket));
  assert.deepEqual(JSON.parse(await rpc("add_ticket", createTicket)), ticketResult);
  const { num, version } = ticketResult;
  assert.equal(version, 0);
  assert.ok((await rpc("get_ticket", { num })).includes("ticket version: 0"));
  const patch = { num, expectedVersion: version, title: "Printer repaired", requestId: randomUUID() };
  const edited = JSON.parse(await rpc("update_ticket", patch));
  assert.deepEqual(edited, { num, version: 1 });
  assert.deepEqual(JSON.parse(await rpc("update_ticket", patch)), edited);
  assert.equal((await Ticket.findOne({ num })).title, patch.title);
  await assert.rejects(call("ticket", "delete", { num, expectedVersion: 0, requestId: randomUUID() }), { statusCode: 409 });
  const target = await Ticket.findOne({ num });
  const attachedWork = await Work.create({ tickets: [target._id, ticketId], description: "Shared", createdBy: { _id: owner }, updatedBy: { _id: owner }, company: companyId });
  const soloWork = await Work.create({ tickets: [target._id], description: "Single", createdBy: { _id: owner }, updatedBy: { _id: owner }, company: companyId });
  await Ticket.updateOne({ num }, { $push: { attachments: { name: "test-attachment" } } });
  const files = [];
  t.mock.method(require("../storage"), "deleteObject", async name => {
    files.push(name);
    if (files.length === 1) throw new Error("interrupted cleanup");
  });
  const deletion = { num, expectedVersion: edited.version, requestId: randomUUID() };
  await assert.rejects(call("ticket", "delete", deletion), /interrupted cleanup/);
  assert.equal(await Ticket.countDocuments({ num }), 0);
  assert.deepEqual(JSON.parse(await rpc("delete_ticket", deletion)), { num, deleted: true });
  assert.deepEqual(JSON.parse(await rpc("delete_ticket", deletion)), { num, deleted: true });
  assert.deepEqual(files, ["test-attachment", "test-attachment"]);
  assert.equal(await Ticket.countDocuments({ num }), 0);
  assert.deepEqual((await Work.findById(attachedWork._id)).tickets.map(String), [String(ticketId)]);
  assert.equal(await Work.countDocuments({ _id: soloWork._id }), 0);
  assert.equal(await Log.countDocuments({ ticketId: target._id, actorId: owner, mcpKeyId: keyId }), 3);

  await Preferences.updateOne({}, { $set: { "modules.timeTracking.isActive": false } });
  await assert.rejects(call("work", "add", { requestId: randomUUID() }), { statusCode: 403 });
  await McpKey.updateOne({ _id: keyId }, { $set: { scopes: ["tickets"] } });
  await assert.rejects(call("comment", "add", { content: "Denied", requestId: randomUUID() }), { statusCode: 403 });
});
