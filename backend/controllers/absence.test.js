require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const cached = new Module(filename);
  Object.assign(cached, { filename, loaded: true, exports });
  require.cache[filename] = cached;
};
stub("../utils/logger", { log() {} });
stub("../services/workStatusAuto", { runWorkStatusAuto: async () => {} });
let permissionRecipients;
stub("../services/permissions", { permissionFilter: async (action) => permissionRecipients ? { _id: { $in: permissionRecipients[action] || [] } } : {} });
let notifications;
stub("../services/absenceNotifications", { notifyAbsence: async (value) => { notifications.push(value); } });
const Absence = require("../models/absence");
const User = require("../models/user");
const findUserById = User.findById.bind(User);
const Preferences = require("../models/preferences");
const calendar = require("../services/workCalendar");
const realPlanner = calendar.makePlanner;
stub("../services/workCalendar", { ...calendar, buildScheduleContext: async () => ({
  preferences: { timezone: "Asia/Vladivostok" }, absencesByUser: new Map(), calendar: { isActive: false },
}), makePlanner: realPlanner });
const controller = require("./absence");
const userId = "62d0c0ed5a3314d41cc43ef3";
const otherId = "62d0c0ed5a3314d41cc43ef4";
const user = { _id: userId, firstName: "Иван", lastName: "Иванов", isEndUser: false,
  workSchedule: { Monday: { isWorking: true, start: "09:00", end: "18:00", breakMinutes: 60 } } };
const day = "2026-11-09";
const partial = { start: "09:00", end: "10:00" };
const record = (extra = {}) => ({ _id: "62d0c0ed5a3314d41cc43ef5", user: userId,
  type: "dayoff", from: new Date(`${day}T00:00:00Z`), to: new Date(`${day}T00:00:00Z`),
  status: "approved", requestedBy: userId, createdAt: new Date("2026-11-08T00:00:00Z"), ...extra });
const chain = (value) => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });
let stored, created, pending;
beforeEach((t) => {
  stored = []; created = null; pending = null; notifications = []; permissionRecipients = null;
  t.mock.method(Absence, "find", (query) => chain(stored.filter(sift(query))));
  t.mock.method(Absence, "findOne", (query) => chain(stored.find(sift(query)) || null));
  t.mock.method(Absence, "create", async (value) => { created = new Absence(value).toObject(); return created; });
  t.mock.method(Absence, "findById", () => pending || chain({ ...created, user, requestedBy: user, decidedBy: user }));
  t.mock.method(User, "findById", () => chain(user));
  t.mock.method(User, "find", () => chain([user]));
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "Asia/Vladivostok" }));
});
const call = async (handler, { body = {}, query = {}, params = {}, manager = true } = {}) => {
  let error;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  await handler({ body, query, params, auth: { userId, isAdmin: false, can: () => manager } }, res, (value) => { error = value; });
  return { res, error };
};
const add = (extra = {}, options = {}) => call(controller.add, { ...options, body: { type: "dayoff", from: day, to: day, timeRange: partial, ...extra } });

test("adding a non-overlapping partial absence preserves its clocks and never reduces norm", async () => {
  stored = [record({ timeRange: { start: "10:00", end: "11:00" } })];
  const { error, res } = await add();
  assert.equal(error, undefined);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(created.timeRange, partial);
  assert.deepEqual(res.body.absence.timeRange, partial);
  assert.equal(res.body.absence.reducesNorm, false);
});

test("add rejects real same-day, whole-day and neighboring overnight conflicts", async () => {
  for (const existing of [record({ timeRange: { start: "09:30", end: "11:00" } }), record(),
    record({ from: new Date("2026-11-08T00:00:00Z"), to: new Date("2026-11-08T00:00:00Z"), timeRange: { start: "23:00", end: "10:00" } })]) {
    stored = [existing]; created = null;
    const { error } = await add();
    assert.equal(error?.statusCode, 422);
    assert.equal(created, null);
  }
  stored = [record({ from: new Date("2026-11-10T00:00:00Z"), to: new Date("2026-11-10T00:00:00Z") })];
  assert.equal((await add({ timeRange: { start: "23:00", end: "02:00" } })).error?.statusCode, 422);
});

test("invalid partial requests return a validation error and never persist", async () => {
  for (const timeRange of [{ start: "09:00", end: "09:00" }, { start: "9:00", end: "10:00" }]) {
    assert.equal((await add({ timeRange })).error?.statusCode, 422);
    assert.equal(created, null);
  }
  assert.equal((await call(controller.impact, { query: { user: userId, from: day, to: day, timeRange: "{" } })).error?.statusCode, 422);
});

test("whole-day requests keep their norm and existing authorization and approval behavior", async () => {
  const whole = await add({ timeRange: undefined });
  assert.equal(whole.error, undefined);
  assert.equal(whole.res.body.absence.reducesNorm, true);
  assert.equal(whole.res.body.absence.timeRange, null);
  const own = await add({}, { manager: false });
  assert.equal(own.res.body.absence.status, "pending");
  created = null;
  const forbidden = await add({ user: otherId }, { manager: false });
  assert.equal(forbidden.error?.statusCode, 403);
  assert.equal(created, null);
});

test("approval repeats precise overlap detection and preserves pending status on conflict", async (t) => {
  for (const [existingRange, expected] of [[{ start: "10:00", end: "11:00" }, 200], [{ start: "09:30", end: "11:00" }, 422]]) {
    pending = new Absence(record({ status: "pending", timeRange: partial }));
    t.mock.method(pending, "save", async () => { created = pending.toObject(); });
    // Populate reload follows save; the first lookup returns the pending document.
    let first = true;
    t.mock.method(Absence, "findById", () => { if (first) { first = false; return pending; } return chain({ ...created, user, requestedBy: user, decidedBy: user }); });
    stored = [record({ _id: "62d0c0ed5a3314d41cc43ef6", timeRange: existingRange })];
    const result = await call(controller.decide, { params: { id: pending._id }, body: { decision: "approve" } });
    assert.equal(result.error?.statusCode || result.res.statusCode, expected);
    assert.equal(pending.status, expected === 200 ? "approved" : "pending");
  }
});

test("approval rejects an overnight conflict saved under the previous date", async (t) => {
  pending = new Absence(record({ status: "pending", timeRange: partial }));
  t.mock.method(pending, "save", async () => { created = pending.toObject(); });
  stored = [record({ _id: "62d0c0ed5a3314d41cc43ef6", from: new Date("2026-11-08T00:00:00Z"),
    to: new Date("2026-11-08T00:00:00Z"), timeRange: { start: "23:00", end: "10:00" } })];
  const result = await call(controller.decide, { params: { id: pending._id }, body: { decision: "approve" } });
  assert.equal(result.error?.statusCode, 422);
  assert.equal(pending.status, "pending");
  assert.equal(created, null);
});

test("list serializes legacy and partial records with truthful norm behavior", async () => {
  stored = [record({ user }), record({ user, timeRange: partial })];
  const { res, error } = await call(controller.getAll);
  assert.equal(error, undefined);
  assert.deepEqual(res.body.absences.map((a) => [a.timeRange, a.reducesNorm]), [[null, true], [partial, false]]);
});

test("impact describes partial duration and effective schedule without changing whole-day response", async () => {
  const query = { user: userId, from: day, to: day };
  assert.deepEqual((await call(controller.impact, { query })).res.body, { workingDays: 1 });
  const result = await call(controller.impact, { query: { ...query, timeRange: JSON.stringify({ start: "23:00", end: "02:00" }) } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.res.body, { workingDays: 1, durationMinutes: 180, reducesNorm: false,
    scheduleWindow: { date: day, start: 540, end: 1080, crossesMidnight: false } });
});

test("impact selects work mode and does not invent schedule windows for free or excluded employees", async (t) => {
  for (const workTimeMode of ["free", "none"]) {
    let query;
    t.mock.method(User, "findById", (id) => {
      query = findUserById(id);
      t.mock.method(query, "lean", async () => Object.fromEntries(
        Object.entries({ ...user, workTimeMode, remoteOnly: true })
          .filter(([key]) => key === "_id" || query.projection()[key] === 1),
      ));
      return query;
    });
    const result = await call(controller.impact, { query: {
      user: userId, from: day, to: day, timeRange: JSON.stringify(partial),
    } });
    assert.equal(result.error, undefined);
    assert.equal(result.res.body.scheduleWindow, null);
    assert.equal(result.res.body.workingDays, 0);
    assert.equal(query.projection().workTimeMode, 1);
    assert.equal(query.projection().remoteOnly, 1);
  }
});

test("add selects the complete employee scheduling context", async (t) => {
  let query;
  t.mock.method(User, "findById", (id) => {
    query = findUserById(id);
    t.mock.method(query, "lean", async () => user);
    return query;
  });
  assert.equal((await add()).error, undefined);
  assert.equal(query.projection().workTimeMode, 1);
  assert.equal(query.projection().remoteOnly, 1);
});

test("request and decision notifications identify overnight date and time", async (t) => {
  await add({ timeRange: { start: "23:00", end: "02:00" } }, { manager: false });
  await new Promise(setImmediate);
  assert.match(notifications[0]?.text || "", /09\.11\.2026, 23:00–02:00 \+1/);
  pending = new Absence(record({ status: "pending", timeRange: { start: "23:00", end: "02:00" } }));
  t.mock.method(pending, "save", async () => { created = pending.toObject(); });
  let first = true;
  t.mock.method(Absence, "findById", () => { if (first) { first = false; return pending; } return chain({ ...created, user, requestedBy: user, decidedBy: user }); });
  await call(controller.decide, { params: { id: pending._id }, body: { decision: "reject" } });
  await new Promise(setImmediate);
  assert.match(notifications[1]?.text || "", /09\.11\.2026, 23:00–02:00 \+1/);
});

test("absence requests notify approvers and exclude managers without approval rights", async (t) => {
  const approver = { ...user, _id: otherId, firstName: "Согласующий" };
  const manager = { ...user, _id: "62d0c0ed5a3314d41cc43ef6", firstName: "Менеджер" };
  permissionRecipients = { "schedule.approve": [approver._id], "schedule.manage": [manager._id] };
  t.mock.method(User, "find", (query) => chain([approver, manager].filter(sift(query))));
  const result = await add({}, { manager: false });
  assert.equal(result.error, undefined);
  await new Promise(setImmediate);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].category, "absenceRequest");
  assert.deepEqual(notifications[0].recipients.map((person) => person._id), [otherId]);
});
