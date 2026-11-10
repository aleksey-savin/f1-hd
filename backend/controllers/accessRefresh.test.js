require("module-alias/register");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// Ticket initializes its database counter at import. Neither endpoint needs
// tickets in these requests; avoid starting database IO in the fixture.
const ticketPath = require.resolve("@/models/ticket");
const ticketModule = new Module(ticketPath);
ticketModule.loaded = true;
ticketModule.exports = { Ticket: {}, ticketDefaultFieldsSchema: {} };
require.cache[ticketPath] = ticketModule;

const Preferences = require("@/models/preferences");
const originalFind = Preferences.findOne;
Preferences.findOne = async () => ({});
after(() => { Preferences.findOne = originalFind; });

const { getMe } = require("./me");
const { pulse } = require("./pulse");
const { bus } = require("@/services/pulse");

const call = async (handler, auth) => {
  let body;
  const res = { status: () => res, set: () => res, json: (value) => { body = value; } };
  await handler({ auth, query: { cursor: bus.cursor() } }, res, (error) => { throw error; });
  return body;
};

test("me and pulse publish matching access versions and expose a revoked permission on the next pulse", async () => {
  const auth = {
    userId: "u1", user: { _id: "u1", isEndUser: false },
    isAdmin: false, isEndUser: false, can: () => false,
    statements: { ticket: ["perform"] }, grantStatements: { ticket: ["perform"] },
  };
  const me = await call(getMe, auth);
  const before = await call(pulse, auth);
  assert.equal(typeof me.accessVersion, "string");
  assert.deepEqual(before.access, { userId: "u1", version: me.accessVersion });
  const after = await call(pulse, { ...auth, statements: {}, grantStatements: {} });
  assert.notEqual(after.access.version, me.accessVersion);
});
