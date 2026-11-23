const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const DownloadCode = require("../../models/mikrotikDownloadCode");
const { issueCode, verifyCode } = require("./downloadCodes");

const user = "000000000000000000000001";
const artifact = "000000000000000000000002";
const hash = (code) => crypto.createHash("sha256").update(code).digest("hex");

test("issuance replaces the value for a single indexed user/artifact key and resets the budget", async (t) => {
  const writes = [];
  t.mock.method(DownloadCode, "updateOne", async (filter, update, options) => {
    writes.push({ filter, values: update.$set, options });
  });
  const codes = await Promise.all([issueCode(user, artifact), issueCode(user, artifact)]);
  assert.deepEqual(writes[0].filter, writes[1].filter);
  assert.deepEqual(Object.keys(writes[0].filter), ["_id"]);
  assert.equal(DownloadCode.schema.path("_id").instance, "String");
  for (const [index, write] of writes.entries()) {
    assert.equal(write.options.upsert, true);
    assert.deepEqual([write.values.user, write.values.artifact], [user, artifact]);
    assert.equal(write.values.codeHash, hash(codes[index]));
    assert.equal(write.values.attempts, 0);
    assert.ok(write.values.expiresAt > new Date());
  }
});

test("verification accepts only the caller which atomically removes a matching eligible document", async (t) => {
  const consume = t.mock.method(DownloadCode, "findOneAndDelete", async (filter) => {
    assert.equal(filter._id, `${user}:${artifact}`);
    assert.equal(filter.codeHash, hash("123456"));
    assert.equal(filter.attempts.$lt, 5);
    assert.ok(filter.expiresAt.$gt instanceof Date);
    return consume.mock.callCount() === 0 ? {} : null;
  });
  t.mock.method(DownloadCode, "updateOne", async () => ({ modifiedCount: 0 }));
  t.mock.method(DownloadCode, "exists", async () => null);
  assert.deepEqual(await Promise.all([verifyCode(user, artifact, "123456"), verifyCode(user, artifact, "123456")]), ["verified", "expired"]);
});

test("incorrect codes charge one bounded increment, and an exhausted budget stays locked", async (t) => {
  t.mock.method(DownloadCode, "findOneAndDelete", async () => null);
  let remaining = 1;
  t.mock.method(DownloadCode, "updateOne", async (filter, update) => {
    assert.equal(filter._id, `${user}:${artifact}`);
    assert.equal(filter.codeHash.$ne, hash("123456"));
    assert.equal(filter.attempts.$lt, 5);
    assert.ok(filter.expiresAt.$gt instanceof Date);
    assert.deepEqual(update, { $inc: { attempts: 1 } });
    return { modifiedCount: remaining-- > 0 ? 1 : 0 };
  });
  t.mock.method(DownloadCode, "exists", async (filter) => {
    assert.equal(filter.attempts.$gte, 5);
    return {};
  });
  assert.deepEqual(await Promise.all([verifyCode(user, artifact, "123456"), verifyCode(user, artifact, "123456")]), ["incorrect", "locked"]);
});
