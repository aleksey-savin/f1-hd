require("module-alias/register");
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sift = require("sift").default;

// Synthetic configuration only; no connection, listener, cookie or auth request.
process.env.BETTER_AUTH_SECRET = "telegram-continuity-test-only-secret-2026-11-07";
process.env.APP_PUBLIC_URL = "http://localhost:3000";
mongoose.set("bufferCommands", false);
const User = require("@/models/user");
const { initAuth, getAuth } = require("@/auth/bootstrap");
const { resolveActor } = require("./telegramActor");
const { updateMyAccount } = require("@/controllers/user");
const { revokeAllForUser } = require("./authSessions");
const { runStaffSessionCutover } = require("./staffSessionCutover");

before(async () => {
  // Initialize the REAL auth context/authorizeFor bridge on fake persistence.
  // Never call mongoose.connect; even unexpected persistence must fail closed.
  const originalDb = mongoose.connection.db;
  const originalReady = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  const originalClient = mongoose.connection.getClient;
  mongoose.connection.db = { collection: (name) => assert.fail(`unexpected auth initialization query: ${name}`) };
  Object.defineProperty(mongoose.connection, "readyState", { configurable: true, value: 1 });
  mongoose.connection.getClient = () => ({});
  try {
    await initAuth();
    await getAuth().$context;
  } finally {
    mongoose.connection.db = originalDb;
    mongoose.connection.getClient = originalClient;
    if (originalReady) Object.defineProperty(mongoose.connection, "readyState", originalReady);
    else delete mongoose.connection.readyState;
  }
});

const oid = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const setup = (t, isEndUser = false) => {
  const raw = {
    _id: oid(1), email: "linked@example.test", firstName: "Existing", lastName: "Link",
    isEndUser, isAdmin: false, banned: false,
    company: { _id: oid(2), isActive: true },
    telegramBot: { isActive: true, chatId: "123456789" }, // legacy: no linkedAt
    notify: { byTelegram: { newTicket: true }, byEmail: { newTicket: true } },
  };
  assert.equal(Object.hasOwn(raw.telegramBot, "linkedAt"), false);
  const user = User.hydrate(raw), writes = [];
  t.mock.method(user, "save", async function () {
    writes.push(this.modifiedPaths());
    this.$clearModifiedPaths();
    return this;
  });
  t.mock.method(User, "find", (filter) => {
    assert.deepEqual(filter, { "telegramBot.chatId": "123456789", "telegramBot.isActive": true });
    return { limit: async (limit) => {
      assert.equal(limit, 2);
      return [user].filter((row) => sift(filter)(row.toObject()));
    } };
  });
  t.mock.method(User, "findById", async (id) => String(id) === String(user._id) ? user : null);

  const rows = {
    authCutovers: [],
    authSessions: [
      { _id: oid(11), userId: oid(1) },
      { _id: oid(12), userId: String(oid(1)) },
      { _id: oid(13), userId: oid(3), impersonatedBy: String(oid(1)) },
      { _id: oid(14), userId: oid(3) },
    ],
    impersonationCodes: [{ _id: oid(21), adminId: String(oid(1)) }],
    telegramPairingCodes: [{ _id: oid(31), userId: String(oid(1)), marker: "pairing-unchanged" }],
    channels: [{ _id: oid(41), secrets: { marker: "channel-unchanged" } }],
    channelidentities: [{ _id: oid(51), userId: oid(1), externalId: "123456789" }],
    authAccounts: [{ _id: oid(61), userId: oid(1), password: "synthetic-password-marker" }],
    authTwoFactors: [{ _id: oid(71), userId: oid(1), marker: "totp-unchanged" }],
  };
  const db = { collection(name) {
    if (name === "organization") return { findOne: async () => null };
    assert.ok(["users", "authCutovers", "authSessions", "impersonationCodes"].includes(name),
      `must not touch bot/integration/credential persistence: ${name}`);
    return {
      find: (filter, { projection }) => ({ toArray: async () => {
        assert.deepEqual(filter, {});
        const source = name === "users" ? [user.toObject(), { _id: oid(3), isEndUser: true }] : rows[name];
        return source.map((row) => Object.fromEntries(Object.keys(projection)
          .filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])));
      } }),
      findOne: async (filter) => {
        assert.equal(name, "authCutovers");
        return rows[name].find(sift(filter)) || null;
      },
      updateOne: async (filter, update) => {
        assert.equal(name, "authCutovers");
        if (!rows[name].length) rows[name].push({ ...filter, ...update.$setOnInsert });
        return { acknowledged: true };
      },
      deleteMany: async (filter) => {
        assert.ok(["authSessions", "impersonationCodes"].includes(name));
        const before = rows[name].length;
        rows[name] = rows[name].filter((row) => !sift(filter)(row));
        return { deletedCount: before - rows[name].length };
      },
    };
  } };
  const originalDb = mongoose.connection.db;
  mongoose.connection.db = db;
  t.after(() => { mongoose.connection.db = originalDb; });
  return { user, writes, rows, db };
};

const saveProfile = async (user, body) => {
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const errors = [];
  await updateMyAccount({ userId: String(user._id), body }, res, (error) => errors.push(error));
  assert.equal(errors.length, 0, errors[0]?.originalError?.stack || errors[0]?.message);
  assert.equal(res.statusCode, 201);
  return res.payload;
};

for (const isEndUser of [false, true]) {
  test(`legacy Telegram binding resolves without linkedAt or browser session (client: ${isEndUser})`, async (t) => {
    const { user } = setup(t, isEndUser);
    const actor = await resolveActor("123456789");
    assert.equal(actor.userId, String(user._id));
    assert.equal(actor.isEndUser, isEndUser);
    assert.equal(actor.session, null);
    assert.equal(actor.user.telegramBot.chatId, "123456789");
  });
}

test("ban/unban and company deactivate/reactivate deny and restore the same saved Telegram binding", async (t) => {
  const { user } = setup(t), binding = user.telegramBot.toObject();
  user.banned = true;
  assert.equal(await resolveActor("123456789"), null);
  assert.deepEqual(user.telegramBot.toObject(), binding);
  user.banned = false;
  assert.equal((await resolveActor("123456789")).userId, String(user._id));
  user.company.isActive = false;
  assert.equal(await resolveActor("123456789"), null);
  assert.deepEqual(user.telegramBot.toObject(), binding);
  user.company.isActive = true;
  assert.equal((await resolveActor("123456789")).userId, String(user._id));
  assert.deepEqual(user.telegramBot.toObject(), binding);
});

test("browser revocation preserves Telegram identity with no browser/session fallback", async (t) => {
  const { user, rows } = setup(t), binding = user.telegramBot.toObject();
  assert.equal(await revokeAllForUser(user._id), 2);
  assert.deepEqual(rows.authSessions.map((row) => String(row._id)), [String(oid(13)), String(oid(14))]);
  const actor = await resolveActor("123456789");
  assert.equal(actor.userId, String(user._id));
  assert.equal(actor.session, null);
  assert.deepEqual(user.telegramBot.toObject(), binding);
});

test("staff cutover preserves bot links, pairing, channels, identities, passwords and TOTP", async (t) => {
  const { user, rows, db } = setup(t), binding = user.telegramBot.toObject();
  const protectedNames = ["telegramPairingCodes", "channels", "channelidentities", "authAccounts", "authTwoFactors"];
  const before = JSON.stringify(protectedNames.map((name) => rows[name]));
  const result = await runStaffSessionCutover({ db, apply: true });
  assert.deepEqual(result.deleted, { sessions: 3, codes: 1 });
  assert.deepEqual(rows.authSessions.map((row) => String(row._id)), [String(oid(14))]);
  assert.equal(JSON.stringify(protectedNames.map((name) => rows[name])), before);
  assert.deepEqual(user.telegramBot.toObject(), binding);
  assert.equal((await resolveActor("123456789")).userId, String(user._id));
});

test("ordinary profile and notification partial saves retain the existing Telegram binding", async (t) => {
  const { user, writes } = setup(t), binding = user.telegramBot.toObject();
  await saveProfile(user, { firstName: "Updated" });
  assert.equal(user.firstName, "Updated");
  assert.deepEqual(user.telegramBot.toObject(), binding);
  await saveProfile(user, { notify: { byTelegram: { newTicket: false } } });
  assert.equal(user.notify.byTelegram.newTicket, false);
  assert.equal(user.notify.byEmail.newTicket, true);
  assert.deepEqual(user.telegramBot.toObject(), binding);
  assert.ok(writes.every((paths) => paths.every((field) => !field.startsWith("telegramBot"))));
  assert.equal((await resolveActor("123456789")).userId, String(user._id));
});

test("explicit unlink remains distinct and prevents subsequent bot actor resolution", async (t) => {
  const { user, writes } = setup(t);
  await saveProfile(user, { telegramBot: { isActive: false } });
  assert.equal(user.telegramBot.isActive, false);
  assert.equal(user.telegramBot.chatId, "");
  assert.equal(user.telegramBot.linkedAt, null);
  assert.ok(writes[0].some((field) => field.startsWith("telegramBot")));
  assert.equal(await resolveActor("123456789"), null);
});
