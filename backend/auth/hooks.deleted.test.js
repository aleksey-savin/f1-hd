require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const User = require("@/models/user");
const hooks = require("./hooks");
const original = { findById: User.findById, findOne: User.findOne };
afterEach(() => Object.assign(User, original));
const deletedQuery = () => ({ select: (fields) => ({ lean: async () => Object.fromEntries(Object.entries({ deletedAt: new Date(), banned: false, isEndUser: true }).filter(([key]) => fields.split(" ").includes(key))) }) });

test("session creation hook refuses a deleted account even with a cleared ban flag", async () => {
  User.findById = deletedQuery;
  assert.match(await hooks.sessionRefusal("deleted"), /отключена/);
});

test("raw auth email callbacks cannot send a code or password invitation to deleted accounts", async () => {
  User.findById = deletedQuery;
  User.findOne = deletedQuery;
  await hooks.sendEmailCode({ email: "gone@example.test", otp: "123456", type: "sign-in" });
  await hooks.sendResetPassword({ user: { id: "deleted", email: "gone@example.test" }, token: "token" });
});
