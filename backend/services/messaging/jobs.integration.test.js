require("module-alias/register");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { leaseJobs, ackJobs } = require("./jobs");
const { repairSendOutcomes } = require("./send-outcome");
const ChannelJob = require("@/models/channelJob");
const Message = require("@/models/message");
const Comment = require("@/models/comment");
const uri = process.env.HD_MESSAGING_TEST_MONGO;
const dbName = "hd_queue_test_" + randomUUID().replaceAll("-", "");
const objectId = () => new mongoose.Types.ObjectId();
const channelId = objectId();
const network = "telegram";
const insertJob = async (fields = {}) => {
  const job = { _id: objectId(), type: "send", channelId, network, state: "pending", attempts: 0, notBefore: new Date(0), createdAt: new Date(), ...fields };
  await ChannelJob.collection.insertOne(job);
  return job;
};
const integration = (name, run) => test(name, { skip: !uri }, run);

before(async () => {
  if (uri) await mongoose.connect(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 3000 });
});
after(async () => {
  if (!uri || mongoose.connection.readyState !== 1) return;
  try {
    assert.equal(mongoose.connection.name, dbName);
    await mongoose.connection.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

integration("a backed-off recipient with 80 followers cannot hide eligible conversations and commands", async () => {
  const blocked = { orderingKey: "phone:blocked" };
  await insertJob({ ...blocked, createdAt: new Date(1), notBefore: new Date(Date.now() + 60_000) });
  for (let i = 0; i < 80; i++) await insertJob({ ...blocked, createdAt: new Date(i + 2) });
  const conversationId = objectId();
  const head = await insertJob({ conversationId, createdAt: new Date(100) });
  await insertJob({ conversationId, createdAt: new Date(101) });
  const command = await insertJob({ type: "logout", createdAt: new Date(102) });
  const batch = await leaseJobs({ networks: [network], limit: 2 });
  assert.deepEqual(batch.jobs.map(job => String(job._id)), [head, command].map(job => String(job._id)));
  assert.equal((await leaseJobs({ networks: [network] })).jobs.length, 0);
});

integration("expired and duplicate acknowledgements preserve the current lease and multipart checkpoint", async () => {
  const job = await insertJob({ provider: "wazzup", leaseId: "old", leaseUntil: new Date(0),
    result: { nextPart: 1, externalIds: ["accepted"], delivery: { accepted: "read" } } });
  const acknowledge = (id, result = {}) => ackJobs(id, [{ id: job._id, ok: true, ...result }], { provider: "wazzup" });
  assert.deepEqual(await acknowledge("old"), { applied: 0, ignored: 1 });
  const batch = await leaseJobs({ networks: [network], provider: "wazzup" });
  assert.deepEqual(await acknowledge("old"), { applied: 0, ignored: 1 });
  const results = await Promise.all([acknowledge(batch.leaseId), acknowledge(batch.leaseId)]);
  assert.equal(results.reduce((n, x) => n + x.applied, 0), 1);
  const current = await ChannelJob.findById(job._id).lean();
  assert.equal(current.state, "done");
  assert.deepEqual(current.result, job.result);
});

integration("a lease replaced and a webhook received after the ack read survive the atomic commit", async t => {
  const job = await insertJob({
    provider: "wazzup", leaseId: "first", leaseUntil: new Date(Date.now() + 60_000),
    result: { nextPart: 1, externalIds: ["accepted"] },
  });
  const find = ChannelJob.findOne.bind(ChannelJob);
  const hook = t.mock.method(ChannelJob, "findOne", async filter => {
    const previous = await find(filter);
    await ChannelJob.collection.updateOne({ _id: job._id }, { $set: { leaseId: "second" } });
    return previous;
  });
  const result = { id: job._id, ok: true, result: { externalId: "accepted", delivery: {} } };
  assert.deepEqual(await ackJobs("first", [result], { provider: "wazzup" }), { applied: 0, ignored: 1 });
  hook.mock.mockImplementation(async filter => {
    const previous = await find(filter);
    await ChannelJob.collection.updateOne({ _id: job._id }, { $set: { "result.delivery.accepted": "read" } });
    return previous;
  });
  assert.deepEqual(await ackJobs("second", [result], { provider: "wazzup" }), { applied: 1, ignored: 0 });
  assert.deepEqual((await ChannelJob.findById(job._id)).result, { ...job.result, externalId: "accepted", delivery: { accepted: "read" } });
});

integration("ack before a comment write failure and a legacy terminal job both converge on repair", async t => {
  const messageId = objectId(), commentId = objectId();
  const job = await insertJob({ messageId, leaseId: "lease", leaseUntil: new Date(Date.now() + 60_000) });
  await Message.collection.insertOne({ _id: messageId, jobId: job._id, commentId, status: "queued" });
  await Comment.collection.insertOne({ _id: commentId, channel: { status: "preparing" } });
  const failComment = t.mock.method(Comment, "updateOne", async () => { throw new Error("interrupted comment projection"); });
  assert.deepEqual(await ackJobs("lease", [{ id: job._id, ok: false, retryable: false, error: "private error" }]), { applied: 1, ignored: 0 });
  failComment.mock.restore();
  assert.equal((await Message.findById(messageId)).status, "failed");
  assert.equal((await ChannelJob.findById(job._id)).outcomeApplied, false);
  const legacyMessage = objectId();
  const legacy = await insertJob({ messageId: legacyMessage, state: "done", result: { externalId: "accepted" } });
  await Message.collection.insertOne({ _id: legacyMessage, jobId: null, direction: "out", origin: "hd", status: "queued" });
  await repairSendOutcomes();
  const comment = await Comment.findById(commentId).lean();
  assert.equal(comment.channel.status, "failed"); assert.equal(comment.channel.error, "Не доставлено"); assert.ok(comment.channel.messageId.equals(messageId));
  assert.equal((await Message.findById(legacyMessage)).externalId, "accepted");
  assert.equal((await Message.findById(legacyMessage)).status, "sent");
  assert.equal((await ChannelJob.findById(job._id)).outcomeApplied, true);
  assert.equal((await ChannelJob.findById(legacy._id)).outcomeApplied, true);
});

integration("repair keeps newer delivery evidence and ignores jobs superseded by a retry", async () => {
  const messageId = objectId(), commentId = objectId();
  const job = await insertJob({ messageId, state: "failed", lastError: "obsolete" });
  await Comment.collection.insertOne({ _id: commentId, channel: { status: "queued" } });
  await Message.collection.insertOne({ _id: messageId, jobId: objectId(), commentId, status: "queued" });
  await repairSendOutcomes();
  assert.equal((await Message.findById(messageId)).status, "queued");
  assert.equal((await Comment.findById(commentId)).channel.status, "queued");
  await Message.updateOne({ _id: messageId }, { $set: { status: "read", jobId: job._id } });
  await ChannelJob.updateOne({ _id: job._id }, { $unset: { outcomeApplied: 1 } });
  await repairSendOutcomes();
  assert.equal((await Message.findById(messageId)).status, "read");
  assert.equal((await Comment.findById(commentId)).channel.status, "read");
});

integration("a replay repairs a comment after the provider recovered an already projected failure", async () => {
  const messageId = objectId(), commentId = objectId();
  const job = await insertJob({ messageId, state: "failed", finishedAt: new Date(), lastError: "old failure", outcomeApplied: false });
  await Message.collection.insertOne({ _id: messageId, jobId: job._id, projectedSendJobId: job._id, commentId, status: "sent" });
  await Comment.collection.insertOne({ _id: commentId, channel: { status: "failed", error: "Не доставлено" } });
  await repairSendOutcomes();
  assert.equal((await Message.findById(messageId)).status, "sent");
  const comment = await Comment.findById(commentId).lean();
  assert.equal(comment.channel.status, "sent");
  assert.equal(comment.channel.error, undefined);
});
