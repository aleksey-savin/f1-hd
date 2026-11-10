const { test } = require("node:test");
const assert = require("node:assert/strict");
const { accessVersion } = require("./accessVersion");

const auth = {
  userId: "u1", isAdmin: false, isEndUser: false,
  statements: { ticket: ["perform", "readAll"], work: ["read"] },
  grantStatements: { ticket: ["perform", "readAll"], work: ["read"] },
};

test("access version changes when permissions are granted or revoked", () => {
  const before = accessVersion(auth);
  for (const statements of [{}, { ticket: ["perform"] }, { ...auth.statements, role: ["manage"] }]) {
    assert.notEqual(accessVersion({ ...auth, statements }), before);
  }
});

test("role ordering does not trigger a permission refresh", () => {
  assert.equal(accessVersion(auth), accessVersion({
    ...auth, statements: { work: ["read"], ticket: ["readAll", "perform"] },
  }));
});

test("grant rights, account audience, admin mirror and identity affect access version", () => {
  for (const patch of [
    { grantStatements: {} }, { isEndUser: true }, { isAdmin: true }, { userId: "u2" },
  ]) assert.notEqual(accessVersion({ ...auth, ...patch }), accessVersion(auth));
});
