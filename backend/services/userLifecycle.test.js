require("module-alias/register");
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sift = require("sift").default;
const User = require("@/models/user");
const { staffAccessStatements } = require("@/auth/access");
const { isDeniedAccount } = require("./accountDenial");

const actorId = "66aa00000000000000000001";
const targetId = "66aa00000000000000000002";
const originalDb = mongoose.connection.db;
const originalFind = User.findById;
const originalUpdate = User.updateMany;
let rows;
let target;
let saves;
const req = (can = true) => ({ auth: { userId: actorId, user: { _id: actorId }, isAdmin: true, can: () => can } });
const execute = (...args) => require("./userLifecycle").executeUserLifecycle(...args);

beforeEach(() => {
  saves = 0;
  target = { _id: targetId, email: "person@example.test", banned: false, isEndUser: false,
    company: { _id: "company" }, subdivision: "division", categories: [{ _id: "category" }],
    telegramBot: { isActive: true, chatId: "123" },
    async save() { saves++; return this; } };
  rows = {
    organization: [{ _id: "org", slug: "hd" }],
    organizationRole: [{ organizationId: "org", role: "admin", audience: "staff", permission: JSON.stringify(staffAccessStatements()) }],
    member: [actorId, targetId].map((userId) => ({ organizationId: "org", userId, role: "admin" })),
    users: [{ _id: new mongoose.Types.ObjectId(actorId), isEndUser: false }, { _id: new mongoose.Types.ObjectId(targetId), isEndUser: false }],
    authSessions: [{ userId: targetId }, { userId: actorId, impersonatedBy: targetId }, { userId: actorId }],
    impersonationCodes: [{ targetId }, { adminId: targetId }, { adminId: actorId }],
    authAccounts: [{ userId: targetId, password: "hash" }], authTwoFactors: [{ userId: targetId, secret: "secret" }],
  };
  User.findById = async () => target;
  mongoose.connection.db = { collection(name) {
    assert.ok(Object.hasOwn(rows, name), `Unexpected collection ${name}`);
    return {
      findOne: async (query) => rows[name].find(sift(query)) || null,
      find: (query) => ({ toArray: async () => rows[name].filter(sift(query)) }),
      deleteMany: async (query) => {
        const before = rows[name].length;
        rows[name] = rows[name].filter((row) => !sift(query)(row));
        return { deletedCount: before - rows[name].length };
      },
    };
  } };
});
afterEach(() => { User.findById = originalFind; User.updateMany = originalUpdate; mongoose.connection.db = originalDb; });

test("soft deletion retains historical identity, credentials and memberships while retiring access", async () => {
  rows.authSessions.push({ userId: new mongoose.Types.ObjectId(targetId) }, { userId: actorId, impersonatedBy: new mongoose.Types.ObjectId(targetId) });
  rows.impersonationCodes.push({ targetId: new mongoose.Types.ObjectId(targetId) }, { adminId: new mongoose.Types.ObjectId(targetId) });
  const result = await execute(req(), targetId, { intent: "delete" });
  assert.equal(result.user, target);
  assert.ok(target.deletedAt instanceof Date);
  assert.equal(String(target.deletedBy), actorId);
  assert.equal(target.banned, true);
  assert.ok(target.disabledAt instanceof Date);
  assert.equal(target.company._id, "company");
  assert.equal(target.subdivision, "division");
  assert.deepEqual(target.categories, [{ _id: "category" }]);
  assert.deepEqual(target.telegramBot, { isActive: true, chatId: "123" });
  assert.equal(rows.authAccounts[0].password, "hash");
  assert.equal(rows.authTwoFactors[0].secret, "secret");
  assert.equal(rows.member.length, 2);
  assert.deepEqual(rows.authSessions, [{ userId: actorId }]);
  assert.deepEqual(rows.impersonationCodes, [{ adminId: actorId }]);
  assert.equal(isDeniedAccount(target), true);
});

test("repeat deletion keeps original dates and repeats revocation after a partially failed request", async () => {
  await execute(req(), targetId, { intent: "delete" });
  const deletedAt = target.deletedAt;
  rows.authSessions.push({ userId: targetId });
  await execute(req(), targetId, { intent: "delete" });
  assert.equal(target.deletedAt, deletedAt);
  assert.deepEqual(rows.authSessions, [{ userId: actorId }]);
});

test("restore clears deletion only and leaves the account disabled without an expiry", async () => {
  const disabledAt = new Date("2020-01-01");
  Object.assign(target, { banned: true, disabledAt, deletedAt: new Date(), deletedBy: actorId, banExpires: new Date("2000-01-01") });
  await execute(req(), targetId, { intent: "restore" });
  assert.equal(target.deletedAt, undefined);
  assert.equal(target.deletedBy, undefined);
  assert.equal(target.banned, true);
  assert.equal(target.banExpires, undefined);
  assert.equal(target.disabledAt, disabledAt);
  assert.equal(isDeniedAccount(target), true);
});

test("historically disabled accounts retain an unknown disable date on delete and restore", async () => {
  target.banned = true;
  await execute(req(), targetId, { intent: "delete" });
  await execute(req(), targetId, { intent: "restore" });
  assert.equal(target.disabledAt, undefined);
});

test("deleted accounts cannot be enabled or edited through a disable request", async () => {
  target.deletedAt = new Date();
  for (const intent of ["enable", "disable"]) await assert.rejects(execute(req(), targetId, { intent }), (e) => e.statusCode === 409);
  assert.equal(saves, 0);
});

test("lifecycle itself requires user.manage before any mutation", async () => {
  await assert.rejects(execute(req(false), targetId, { intent: "delete" }), (e) => e.statusCode === 403);
  assert.equal(saves, 0);
});

test("lifecycle refuses a protected admin and deletion of the actor", async () => {
  target.isAdmin = true;
  await assert.rejects(execute({ auth: { ...req().auth, isAdmin: false } }, targetId, { intent: "delete" }), (e) => e.statusCode === 403);
  target._id = actorId;
  await assert.rejects(execute(req(), actorId, { intent: "delete" }), (e) => e.statusCode === 400);
  assert.equal(saves, 0);
});

test("deleted former administrators cannot count as remaining holders", async () => {
  rows.users[0].deletedAt = new Date();
  await assert.rejects(execute(req(), targetId, { intent: "delete" }), (e) => e.statusCode === 409);
  assert.equal(saves, 0);
});

test("known disable transitions record dates, enable clears them and expired bans start a new period", async () => {
  await execute(req(), targetId, { intent: "disable" });
  assert.ok(target.disabledAt instanceof Date);
  await execute(req(), targetId, { intent: "enable" });
  assert.equal(target.disabledAt, undefined);
  target.banned = true;
  target.banExpires = new Date("2000-01-01");
  await execute(req(), targetId, { intent: "disable" });
  assert.ok(target.disabledAt instanceof Date);
});

test("automatic unban skips deleted users and clears the known disable period for others", async () => {
  const expired = new Date("2000-01-01");
  const accounts = [{ banned: true, banExpires: expired, deletedAt: new Date(), disabledAt: expired }, { banned: true, banExpires: expired, disabledAt: expired }];
  User.updateMany = async (query, update) => {
    const matched = accounts.filter(sift(query));
    for (const account of matched) {
      Object.assign(account, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete account[key];
    }
    return { modifiedCount: matched.length };
  };
  assert.equal(await require("./authBan").liftExpiredBans(), 1);
  assert.equal(accounts[0].banned, true);
  assert.equal(accounts[1].banned, false);
  assert.equal(accounts[1].disabledAt, undefined);
});
