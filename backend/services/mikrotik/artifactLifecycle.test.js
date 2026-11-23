require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Mikrotik = require("../../models/mikrotik");
const Artifact = require("../../models/mikrotikArtifact");
const DownloadCode = require("../../models/mikrotikDownloadCode");
const storage = require("../storage");
const { findOwnedArtifact, pruneArtifacts, purgeArtifacts, removeArtifact, storeExport } = require("./artifactLifecycle");

function watchDeletion(t) {
  const calls = [];
  t.mock.method(storage, "deleteArtifact", async (...args) => calls.push(["file", ...args]));
  t.mock.method(DownloadCode, "deleteMany", async (filter) => calls.push(["codes", filter.artifact]));
  t.mock.method(Artifact, "deleteOne", async (filter) => calls.push(["row", filter._id]));
  return calls;
}

test("orphan and deleting records cannot serve artifacts, and pending writes stay private", async (t) => {
  let active = false;
  t.mock.method(Mikrotik, "exists", async (filter) => {
    assert.deepEqual(filter, { _id: "record", deleting: { $ne: true } });
    return active;
  });
  const find = t.mock.method(Artifact, "findOne", async (filter) => {
    assert.deepEqual(filter, { _id: "file", mikrotik: "record", writeState: null });
    return "file";
  });
  assert.equal(await findOwnedArtifact("record", "file"), null);
  assert.equal(find.mock.callCount(), 0);
  active = true;
  assert.equal(await findOwnedArtifact("record", "file"), "file");
});

test("objects are removed before metadata and outstanding codes; storage failure retains the retry pointer", async (t) => {
  const calls = watchDeletion(t);
  const artifact = { _id: "doc", storage: "s3", storageKey: "key" };
  storage.deleteArtifact.mock.mockImplementationOnce(async () => { throw Error("unavailable"); });
  await assert.rejects(removeArtifact(artifact), /unavailable/);
  assert.deepEqual(calls, []);
  await removeArtifact(artifact);
  assert.deepEqual(calls, [["file", "key", "s3"], ["row", "doc"], ["codes", "doc"]]);
});

test("record removal waits for active uploads, and recovers abandoned reservations", async (t) => {
  const calls = watchDeletion(t);
  const pending = { writeState: "uploading", createdAt: new Date(), _id: "doc", storageKey: "key", storage: "local" };
  t.mock.method(Artifact, "find", (filter) => {
    assert.deepEqual(filter, { mikrotik: "record" });
    return { select: () => ({ lean: () => ({ cursor: () => [pending] }) }) };
  });
  await assert.rejects(purgeArtifacts("record"), { statusCode: 409 });
  assert.deepEqual(calls, []);
  pending.createdAt = new Date(0);
  await purgeArtifacts("record");
  assert.deepEqual(calls, [["file", "key", "local"], ["row", "doc"], ["codes", "doc"]]);
});

test("a deletion during upload removes the bytes and reservation without publishing", async (t) => {
  const calls = watchDeletion(t);
  let active = true;
  let row;
  t.mock.method(Mikrotik, "exists", async () => active);
  t.mock.method(storage, "isS3Configured", () => true);
  t.mock.method(Artifact, "create", async (fields) => {
    row = { ...fields, _id: "doc", createdAt: new Date() };
    return row;
  });
  t.mock.method(storage, "putArtifact", async (key, _buf, _type, signal) => {
    assert.equal(row.writeState, "uploading");
    assert.equal(row.storageKey, key);
    assert.ok(signal instanceof AbortSignal);
    active = false;
  });
  await assert.rejects(storeExport({ mikrotik: "record", storageKey: "key" }, Buffer.from("encrypted")), /удаляется/);
  assert.deepEqual(calls, [["file", "key", "s3"], ["row", "doc"], ["codes", "doc"]]);
});

test("an abandoned-upload repair cannot remove an export published after the scan", async (t) => {
  const { discardAbandonedUpload, abandonedBefore } = require("./artifactLifecycle");
  const calls = watchDeletion(t);
  const cutoff = abandonedBefore();
  const claim = t.mock.method(Artifact, "findOneAndUpdate", async (filter, update) => {
    assert.deepEqual(filter, { _id: "doc", writeState: { $in: ["uploading", "discarding"] }, createdAt: { $lte: cutoff } });
    assert.deepEqual(update, { $set: { writeState: "discarding" } });
    return null;
  });
  await discardAbandonedUpload("doc", cutoff);
  assert.deepEqual(calls, []);
  claim.mock.mockImplementationOnce(async () => ({ _id: "doc", storageKey: "key", storage: "local" }));
  await discardAbandonedUpload("doc", cutoff);
  assert.deepEqual(calls, [["file", "key", "local"], ["row", "doc"], ["codes", "doc"]]);
});

test("a complete upload becomes visible through the same reservation that recorded the storage key", async (t) => {
  let uploaded = false;
  const published = { _id: "doc" };
  t.mock.method(Mikrotik, "exists", async () => ({ _id: "record" }));
  t.mock.method(storage, "isS3Configured", () => false);
  t.mock.method(Artifact, "create", async (fields) => {
    assert.deepEqual(fields, { mikrotik: "record", storageKey: "key", storage: "local", writeState: "uploading" });
    return { ...fields, _id: "doc", createdAt: new Date() };
  });
  t.mock.method(storage, "putArtifact", async () => { uploaded = true; });
  t.mock.method(Artifact, "findOneAndUpdate", async (filter, update, options) => {
    assert.equal(uploaded, true);
    assert.deepEqual(filter, { _id: "doc", writeState: "uploading" });
    assert.deepEqual(update, { $unset: { writeState: 1 } });
    assert.equal(options.new, true);
    return published;
  });
  assert.equal(await storeExport({ mikrotik: "record", storageKey: "key" }, Buffer.from("encrypted")), published);
});

test("retention uses the policy saved during the export", async (t) => {
  t.mock.method(Mikrotik, "findById", () => ({
    select: () => ({ lean: async () => ({ schedules: { export: { keepLast: 40 } } }) }),
  }));
  let retained;
  t.mock.method(Artifact, "find", () => ({
    sort() { return this; },
    skip(limit) { retained = limit; return this; },
    select: async () => [],
  }));
  await pruneArtifacts({ _id: "record", schedules: { export: { keepLast: 1 } } }, "export");
  assert.equal(retained, 40);
});
