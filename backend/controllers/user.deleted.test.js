require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;
const User = require("@/models/user");
const controller = require("./user");
const original = { findById: User.findById, aggregate: User.aggregate };
afterEach(() => Object.assign(User, original));

const list = async (query, manage = true) => {
  const people = [{ _id: "active", banned: false }, { _id: "disabled", banned: true }, { _id: "deleted", deletedAt: new Date(), banned: true }];
  User.findById = () => ({ lean: async () => ({ _id: "actor", isEndUser: false }) });
  User.aggregate = async (pipeline) => {
    const match = pipeline.find((stage) => stage.$match).$match;
    const data = people.filter(sift(match));
    return [{ data, meta: [{ total: data.length }] }];
  };
  let sent;
  let failure;
  await controller.getAll({ query, auth: { userId: "actor", isEndUser: false, can: () => manage } }, { status() { return this; }, json(payload) { sent = payload; } }, (e) => { failure = e; });
  return { sent, failure };
};

test("ordinary user lists exclude deleted records even with activeOnly=false", async () => {
  const { sent, failure } = await list({ activeOnly: "false", service: "any" });
  assert.equal(failure, undefined);
  assert.deepEqual(sent.users.map((u) => u._id), ["active", "disabled"]);
});

test("deleted-only list requires user.manage and returns retained deleted identities", async () => {
  const allowed = await list({ deleted: "only", service: "any" });
  assert.deepEqual(allowed.sent.users.map((u) => u._id), ["deleted"]);
  const denied = await list({ deleted: "only" }, false);
  assert.equal(denied.failure?.statusCode, 403);
  assert.equal(denied.sent, undefined);
});
