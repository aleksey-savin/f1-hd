require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const loggerPath = require.resolve("../utils/logger");
const logger = new Module(loggerPath);
Object.assign(logger, { filename: loggerPath, loaded: true, exports: { log() {} } });
require.cache[loggerPath] = logger;
const User = require("../models/user");
const Absence = require("../models/absence");
const { buildTeamSchedule } = require("./teamScheduleService");
const chain = (value) => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });

test("pending queue retains overnight tails at the period boundary without expired requests", async (t) => {
  const person = { _id: "u1", firstName: "Иван", lastName: "Иванов" };
  const pending = (id, end, timeRange) => ({ _id: id, user: person, type: "dayoff", status: "pending", from: new Date(`${end}T00:00:00Z`), to: new Date(`${end}T00:00:00Z`), timeRange });
  const records = [
    pending("tail", "2026-08-31", { start: "23:00", end: "02:00" }),
    pending("midnight", "2026-08-31", { start: "23:00", end: "00:00" }),
    pending("day", "2026-08-31", null),
    pending("early", "2026-08-31", { start: "09:00", end: "11:00" }),
    pending("future", "2026-10-01", { start: "09:00", end: "11:00" }),
  ];
  t.mock.method(User, "find", () => chain([]));
  t.mock.method(Absence, "find", (query) => chain(records.filter(sift(query))));
  for (const timezone of ["Europe/Moscow", "America/New_York"]) {
    const result = await buildTeamSchedule({ from: "2026-09-01", to: "2026-09-30", preferences: { timezone, productionCalendar: { isActive: false } } });
    assert.deepEqual(result.pending.map((item) => item._id), ["tail", "future"], timezone);
  }
});
