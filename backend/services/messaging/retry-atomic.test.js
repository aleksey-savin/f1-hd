require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const stub = (path, exports) => { const id = require.resolve(path), entry = new Module(id); Object.assign(entry, { filename: id, loaded: true, exports }); require.cache[id] = entry; };
const query = value => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const ID = "64f600000000000000000001", CHAT = "64f600000000000000000002", CHANNEL = "64f600000000000000000003", OLD = "64f600000000000000000004";
let message, jobs, attempts, failCreate, failClear;
const doc = value => ({ ...value, toObject() { return { ...this }; }, save: async () => assert.fail("stale document must never overwrite retry claim") });
stub("@/models/message", {
  create: async data => { message = { ...data, createdAt: new Date(0), updatedAt: new Date(0) }; return doc(message); },
  findById: async () => doc(message),
  find: filter => query(filter.retryIntent ? (message.retryIntent ? [doc(message)] : []) : []),
  updateOne: async (filter, update) => {
    if (filter.status && message.status !== filter.status) return { modifiedCount: 0 };
    if (filter.jobId && String(message.jobId) !== String(filter.jobId)) return { modifiedCount: 0 };
    if (update.$unset?.retryIntent && failClear) { failClear = false; throw new Error("crash after enqueue"); }
    Object.assign(message, update.$set || {}); for (const key of Object.keys(update.$unset || {})) delete message[key];
    return { modifiedCount: 1 };
  },
});
stub("@/models/conversation", { findById: () => query({ _id: CHAT, channelId: CHANNEL }) });
stub("@/models/channel", { exists: async () => true, findById: () => query({ _id: CHANNEL, type: "telegram", provider: "wazzup", isActive: true }) });
stub("@/models/preferences", { findOne: () => query({ modules: { messaging: { isActive: true } } }) });
stub("@/models/ticket", { Ticket: {} });
stub("@/models/comment", { find: () => query([]) });
stub("@/models/channelJob", {
  findById: id => query(jobs.get(String(id))), findOne: () => query([...jobs.values()].at(-1)),
  create: async fields => {
    attempts++;
    if (failCreate) { failCreate = false; throw new Error("crash before enqueue"); }
    const key = String(fields._id || `job-${attempts}`);
    if (jobs.has(key)) { const error = new Error("duplicate id"); error.code = 11000; throw error; }
    const job = { ...fields, _id: key }; jobs.set(key, job); return job;
  },
});
stub("@/services/pulse", { bus: { bump() {} } });
const { retryMessage, repairOutbound, queueOutbound } = require("./outbound");
const auth = { userId: "staff", isAdmin: true, can: () => true };
beforeEach(() => {
  message = { _id: ID, conversationId: CHAT, channelId: CHANNEL, authorUserId: "staff", direction: "out", origin: "hd", status: "failed", jobId: OLD, text: "Original", attachments: [], recipientPhone: "79145550142", createdAt: new Date(0), updatedAt: new Date(0) };
  jobs = new Map([[OLD, { _id: OLD, payload: { recipient: { phone: "79145550142" }, text: "Original\n\n- Alex, HD", attachments: [] }, result: { nextPart: 1, externalIds: ["accepted-part"], chatId: "remote-peer", inFlightPart: 1 }, orderingKey: `phone:${CHANNEL}:79145550142` }]]);
  attempts = 0; failCreate = false; failClear = false;
});
test("concurrent retries claim one delivery attempt and return its same reserved job", async () => {
  const results = await Promise.all([retryMessage({ messageId: ID, auth }), retryMessage({ messageId: ID, auth })]);
  assert.equal(attempts, 1); assert.equal(results[0].status, "queued"); assert.equal(String(results[0].jobId), String(results[1].jobId));
});
test("crash after claim before enqueue repairs exact signature and accepted multipart progress", async () => {
  failCreate = true;
  await assert.rejects(retryMessage({ messageId: ID, auth }), /crash before/);
  assert.equal(message.status, "queued"); assert.ok(message.retryIntent);
  const reserved = String(message.jobId);
  await repairOutbound();
  assert.equal(String(message.jobId), reserved); assert.equal(message.retryIntent, undefined);
  const job = jobs.get(reserved);
  assert.equal(job.payload.text, "Original\n\n- Alex, HD"); assert.equal(job.result.nextPart, 1); assert.deepEqual(job.result.externalIds, ["accepted-part"]); assert.equal(job.result.inFlightPart, null);
});
test("crash after enqueue before clearing intent reuses the accepted job id", async () => {
  failClear = true;
  await assert.rejects(retryMessage({ messageId: ID, auth }), /crash after/);
  const reserved = String(message.jobId);
  await repairOutbound();
  assert.equal(String(message.jobId), reserved); assert.equal(jobs.size, 2); assert.equal(message.retryIntent, undefined);
});

test("initial queue crash preserves exact signed payload and reserved job for one recovery", async () => {
  jobs.clear(); failCreate = true;
  await assert.rejects(queueOutbound({ channel: { _id: CHANNEL, type: "telegram", provider: "wazzup", settings: { signReplies: true } }, text: "Hello", attachments: [{ name: "attachment", originalName: "акт.pdf", mimetype: "application/pdf", size: 100 }], author: { _id: "staff", firstName: "Alex" }, prefs: { contacts: { title: "HD" } }, recipient: { phone: "79145550142", name: "Клиент" }, clientRequestId: "2dd2b92e-94f4-4d2c-9e1d-6711b1b61d55" }), /crash before/);
  assert.equal(message.status, "queued"); assert.ok(message.retryIntent);
  const reserved = String(message.jobId);
  await repairOutbound(); await repairOutbound();
  assert.equal(jobs.size, 1); assert.equal(String(message.jobId), reserved);
  const job = jobs.get(reserved);
  assert.equal(job.payload.text, "Hello\n\n- Alex, HD"); assert.equal(job.payload.recipient.phone, "79145550142"); assert.equal(job.payload.attachments[0].name, "attachment");
});
test("ticket queue decorates only provider text with a digits-only number before optional signature", async () => {
  for (const signReplies of [false, true]) {
    jobs.clear();
    const comment = { _id: "comment", content: "Hello" };
    await queueOutbound({ channel: { _id: CHANNEL, type: "telegram", provider: "wazzup", settings: { signReplies } }, text: comment.content, attachments: [], author: { _id: "staff", firstName: "Alex" }, prefs: { contacts: { title: "HD" } }, recipient: { phone: "79145550142" }, ticket: { _id: "ticket", num: 58956 }, comment });
    const job = jobs.get(String(message.jobId));
    assert.equal(job.payload.text, `Hello\n\n58956${signReplies ? "\n\n- Alex, HD" : ""}`);
    assert.equal(message.text, "Hello"); assert.equal(comment.content, "Hello");
  }
});
test("attachment-only ticket reply still has one digits-only ticket text part", async () => {
  jobs.clear();
  await queueOutbound({ channel: { _id: CHANNEL, type: "telegram", provider: "wazzup", settings: { signReplies: false } }, text: "", attachments: [{ name: "attachment", mimetype: "application/pdf" }], author: { _id: "staff", firstName: "Alex" }, recipient: { phone: "79145550142" }, ticket: { _id: "ticket", num: 58956 } });
  const job = jobs.get(String(message.jobId));
  assert.equal(job.payload.text, "58956"); assert.equal(message.text, ""); assert.equal(job.payload.attachments.length, 1);
  const parts = require("../wazzup/events").sendParts(job.payload, { providerTransport: "tgapi" });
  assert.equal(parts.length, 2); assert.equal(parts[0].text, "58956");
});
test("ticket retry reuses final numbered payload once and preserves old accepted parts", async () => {
  const old = jobs.get(OLD); old.payload.text = "Hello\n\n58956\n\n- Alex, HD"; message.ticketId = "ticket"; message.ticketNum = 58956;
  await retryMessage({ messageId: ID, auth });
  const retry = jobs.get(String(message.jobId));
  assert.equal(retry.payload.text, old.payload.text); assert.equal(retry.payload.text.split("58956").length, 2);
  assert.deepEqual(retry.result.externalIds, ["accepted-part"]);
});
