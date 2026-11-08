const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;
const { set } = require("lodash");
const Module = require("node:module");
require("module-alias/register");

// Do not open the application's file transports in this database-free test.
const loggerPath = require.resolve("../utils/logger");
const loggerStub = new Module(loggerPath);
loggerStub.filename = loggerPath;
loggerStub.loaded = true;
loggerStub.exports = { log: () => {} };
require.cache[loggerPath] = loggerStub;

const User = require("../models/user");
const Absence = require("../models/absence");
const Preferences = require("../models/preferences");
const { runWorkStatusReset } = require("./workStatusReset");

const beforeReset = new Date("2026-07-26T10:00:00Z");
const person = (overrides = {}) => ({
  _id: "u1",
  banned: false,
  isEndUser: false,
  isServiceAccount: false,
  isCloudTelephony: false,
  workTimeMode: "scheduled",
  workStatus: {
    code: "offshift", note: "вернусь завтра", auto: false, updatedAt: beforeReset,
  },
  ...overrides,
});

// Execute the service's Mongo filters against stored rows, including dotted $set.
const storage = (t, users, absences = []) => {
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({ timezone: "Europe/Moscow" }),
  }));
  t.mock.method(Absence, "find", (filter) => ({
    select: () => ({ lean: async () => absences.filter(sift(filter)) }),
  }));
  const update = async (filter, change, limit = Infinity) => {
    const matched = users.filter(sift(filter)).slice(0, limit);
    for (const user of matched) {
      for (const [path, value] of Object.entries(change.$set)) {
        set(user, path, structuredClone(value));
      }
    }
    return { modifiedCount: matched.length };
  };
  t.mock.method(User, "updateMany", (filter, change) => update(filter, change));
  t.mock.method(User, "updateOne", (filter, change) => update(filter, change, 1));
};

for (const workTimeMode of ["scheduled", "free", "none"]) {
  for (const code of ["offshift", "unset"]) {
    test(`nightly reset releases manual ${code} in ${workTimeMode} mode`, async (t) => {
      const user = person({ workTimeMode });
      user.workStatus.code = code;
      storage(t, [user]);

      await runWorkStatusReset();

      assert.equal(user.workStatus.code, workTimeMode === "scheduled" ? "offshift" : "unset");
      assert.equal(user.workStatus.auto, true);
      assert.equal(user.workStatus.note, "");
      assert.ok(user.workStatus.updatedAt > beforeReset);
    });
  }
}

test("nightly reset leaves automatic offshift settled", async (t) => {
  const user = person();
  user.workStatus = { code: "offshift", note: "", auto: true, updatedAt: beforeReset };
  storage(t, [user]);

  await runWorkStatusReset();

  assert.deepEqual(user.workStatus, {
    code: "offshift", note: "", auto: true, updatedAt: beforeReset,
  });
});

test("nightly reset reapplies an approved absence after releasing a manual status", async (t) => {
  const user = person();
  storage(t, [user], [{
    user: "u1", type: "vacation", status: "approved",
    from: new Date("2000-01-01T00:00:00Z"), to: new Date("2100-01-01T00:00:00Z"),
  }]);

  await runWorkStatusReset();

  assert.equal(user.workStatus.code, "vacation");
  assert.equal(user.workStatus.auto, true);
});

test("nightly reset excludes banned, end-user and service accounts", async (t) => {
  const users = [
    person({ banned: true }), person({ isEndUser: true }),
    person({ isServiceAccount: true }), person({ isCloudTelephony: true }),
  ];
  const initial = structuredClone(users);
  storage(t, users);

  await runWorkStatusReset();

  assert.deepEqual(users, initial);
});
