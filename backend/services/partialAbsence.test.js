require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const loggerPath = require.resolve("../utils/logger");
const logger = new Module(loggerPath);
logger.filename = loggerPath; logger.loaded = true; logger.exports = { log: () => {} };
require.cache[loggerPath] = logger;
const Absence = require("../models/absence");
const Preferences = require("../models/preferences");
const User = require("../models/user");
const { buildScheduleContext, makePlanner } = require("./workCalendar");
const { resolveOvertimeSettings, calcWorkOvertime } = require("./workOvertime");
const { runWorkStatusAuto } = require("./workStatusAuto");
const prefs = { timezone: "Europe/Moscow", productionCalendar: { isActive: false } };
const day = { isWorking: true, is24hours: false, start: "09:00", end: "19:00", breakMinutes: 60 };
const week = Object.fromEntries(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((key, i) => [key, { ...day, isWorking: i < 5 }]));
const employee = (over = {}) => ({ _id: "u1", workTimeMode: "scheduled", workSchedules: [{ effectiveFrom: null, schedule: week, followProductionCalendar: false }], workStatus: { code: "offshift", auto: true, updatedAt: new Date("2026-07-27T02:30:00Z") }, ...over });
const absence = (start, end, date = "2026-07-27") => ({ user: "u1", type: "dayoff", status: "approved", from: new Date(`${date}T00:00:00Z`), to: new Date(`${date}T00:00:00Z`), timeRange: { start, end } });
const setup = (t, absences, person = employee()) => {
  t.mock.method(Absence, "find", (filter) => ({ select: () => ({ lean: async () => absences.filter(sift(filter)) }) }));
  t.mock.method(Preferences, "findOne", () => ({ lean: async () => prefs }));
  t.mock.method(User, "find", () => ({ select: () => ({ lean: async () => [person] }) }));
  t.mock.method(User, "updateOne", async (filter, update) => {
    if (!sift(filter)(person)) return { modifiedCount: 0 };
    if (update.$set.workStatus) person.workStatus = update.$set.workStatus;
    if ("nextShiftAt" in update.$set) person.nextShiftAt = update.$set.nextShiftAt;
    if ("workStatus.note" in update.$set) person.workStatus.note = update.$set["workStatus.note"];
    return { modifiedCount: 1 };
  });
  return person;
};
const planner = async (person) => makePlanner(person, await buildScheduleContext({ fromKey: "2026-07-27", toKey: "2026-07-28", userIds: ["u1"], preferences: prefs }), resolveOvertimeSettings(prefs));

test("partial absences leave norm and overtime intact but split availability", async (t) => {
  const person = setup(t, [absence("09:00", "11:00"), absence("17:00", "19:00")]);
  const plan = await planner(person);
  const monday = plan.dayPlan("2026-07-27");
  assert.equal(monday.minutes, 540);
  assert.equal(monday.kind, "work");
  assert.equal(monday.absence, null);
  assert.equal(plan.periodPlan("2026-07-27", "2026-07-27").normMinutes, 540);
  const pay = calcWorkOvertime({ startedAt: new Date("2026-07-27T06:00:00Z"), finishedAt: new Date("2026-07-27T08:00:00Z") }, { dayPlanFor: plan.dayPlan, tariffingPeriodMinutes: 15, tz: "Europe/Moscow" });
  assert.equal(pay.actualMs, 0);
  assert.deepEqual(plan.availabilityWindows("2026-07-27"), [{ start: 660, end: 1020 }]);
});

for (const [time, expected, next] of [["05:00", "offshift", "2026-07-27T08:00:00.000Z"], ["06:00", "offshift", "2026-07-27T08:00:00.000Z"], ["08:00", "office", null]]) {
  test(`late arrival at UTC ${time} affects only selected hours`, async (t) => {
    const person = setup(t, [absence("09:00", "11:00")]);
    await runWorkStatusAuto({ now: new Date(`2026-07-27T${time}:00Z`) });
    assert.equal(person.workStatus.code, expected);
    if (next) assert.equal(person.nextShiftAt.toISOString(), next);
  });
}

test("early departure ends presence without removing a whole workday", async (t) => {
  const person = setup(t, [absence("15:00", "19:00")], employee({ workStatus: { code: "office", auto: true } }));
  await runWorkStatusAuto({ now: new Date("2026-07-27T12:00:00Z") });
  assert.equal(person.workStatus.code, "offshift");
  assert.equal(person.nextShiftAt.toISOString(), "2026-07-28T06:00:00.000Z");
  assert.equal((await planner(person)).dayPlan("2026-07-27").minutes, 540);
  await runWorkStatusAuto({ now: new Date("2026-07-27T16:00:00Z") });
  assert.equal(person.workStatus.note, "", "expired partial absence must not leave an absence note after the shift");
});

test("free mode partial absence expires to unset without a fictional work schedule", async (t) => {
  const person = setup(t, [absence("09:00", "11:00")], employee({ workTimeMode: "free" }));
  await runWorkStatusAuto({ now: new Date("2026-07-27T06:30:00Z") });
  assert.equal(person.workStatus.code, "offshift");
  assert.equal(person.nextShiftAt.toISOString(), "2026-07-27T08:00:00.000Z");
  await runWorkStatusAuto({ now: new Date("2026-07-27T08:00:00Z") });
  assert.equal(person.workStatus.code, "unset");
  assert.equal(person.nextShiftAt, null);
});

test("an overnight partial absence applies after midnight and restores the same shift", async (t) => {
  const nightWeek = Object.fromEntries(Object.keys(week).map((key) => [key, { ...day, start: "22:00", end: "06:00" }]));
  const person = setup(t, [absence("23:00", "01:00")], employee({ workSchedules: [{ effectiveFrom: null, schedule: nightWeek, followProductionCalendar: false }], workStatus: { code: "office", auto: true } }));
  await runWorkStatusAuto({ now: new Date("2026-07-27T21:30:00Z") });
  assert.equal(person.workStatus.code, "offshift");
  assert.equal(person.nextShiftAt.toISOString(), "2026-07-27T22:00:00.000Z");
  await runWorkStatusAuto({ now: new Date("2026-07-27T22:00:00Z") });
  assert.equal(person.workStatus.code, "office");
});

for (const type of ["vacation", "sick"]) {
  test(`partial ${type} returns directly to the planned place at its end`, async (t) => {
    const person = setup(t, [{ ...absence("09:00", "11:00"), type }]);
    await runWorkStatusAuto({ now: new Date("2026-07-27T06:30:00Z") });
    assert.equal(person.workStatus.code, type);
    await runWorkStatusAuto({ now: new Date("2026-07-27T08:00:00Z") });
    assert.equal(person.workStatus.code, "office");
  });
}
