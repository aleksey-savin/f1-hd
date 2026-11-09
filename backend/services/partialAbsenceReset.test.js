require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const { set } = require("lodash");
const loggerPath = require.resolve("../utils/logger");
const logger = new Module(loggerPath);
logger.filename = loggerPath; logger.loaded = true; logger.exports = { log: () => {} };
require.cache[loggerPath] = logger;
const User = require("../models/user");
const Absence = require("../models/absence");
const Preferences = require("../models/preferences");
const { TaxiTrip } = require("../models/taxi");
const { dayKey, dayKeyToUtcMidnight } = require("../utils/datetime");
const { runWorkStatusReset } = require("./workStatusReset");

test("nightly reset applies full-day absences but never promotes a partial one to a full day", async (t) => {
  const users = ["partial", "full"].map((_id) => ({ _id, isEndUser: false, isServiceAccount: false, isCloudTelephony: false, workTimeMode: "scheduled", workStatus: { code: "office", auto: true, note: "" } }));
  const date = dayKeyToUtcMidnight(dayKey(new Date(), "Europe/Moscow"));
  const absences = users.map((user) => ({ user: user._id, type: "vacation", status: "approved", from: date, to: date, timeRange: user._id === "partial" ? { start: "09:00", end: "11:00" } : null }));
  t.mock.method(TaxiTrip, "find", () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Preferences, "findOne", () => ({ lean: async () => ({ timezone: "Europe/Moscow" }) }));
  t.mock.method(Absence, "find", (filter) => ({ select: () => ({ lean: async () => absences.filter(sift(filter)) }) }));
  const update = async (filter, change, limit = Infinity) => {
    const rows = users.filter(sift(filter)).slice(0, limit);
    for (const user of rows) for (const [path, value] of Object.entries(change.$set)) set(user, path, structuredClone(value));
    return { modifiedCount: rows.length };
  };
  t.mock.method(User, "updateMany", (filter, change) => update(filter, change));
  t.mock.method(User, "updateOne", (filter, change) => update(filter, change, 1));
  await runWorkStatusReset();
  assert.equal(users[0].workStatus.code, "offshift");
  assert.equal(users[1].workStatus.code, "vacation");
});
