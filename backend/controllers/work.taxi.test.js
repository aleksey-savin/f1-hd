const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
require("module-alias/register");
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const cached = new Module(filename);
  Object.assign(cached, { filename, loaded: true, exports });
  require.cache[filename] = cached;
};
stub("../utils/logger", { log() {} });
const { AppError } = require("../middleware/errorHandling");
const performer = { _id: "u1", firstName: "Максим", lastName: "Гурьянов" };
let saved, validationCalls, validationError, existingWork;
class Work {
  constructor(value) { Object.assign(this, value); }
  async save() { saved = this; }
  static async findById() { return existingWork; }
}
stub("../models/work", Work);
stub("../models/user", { findById: async () => performer });
stub("../models/ticket", { Ticket: {
  findById: async () => ({ company: { _id: "c1" } }),
  find: () => ({ select: () => ({ lean: async () => [] }) }),
} });
stub("../models/ticketCategory", { countDocuments: async () => 0 });
stub("../models/ticketLog", class { async save() {} });
stub("../services/ticketAccess", { assertTicketsAccessible: async () => [] });
stub("../services/taxi/integration", {
  validateWorkTaxiLinks: async (input) => {
    validationCalls.push(input);
    if (validationError) throw validationError;
    return input.taxiTripIds;
  },
});
const { add, update } = require("./work");
beforeEach(() => { saved = null; validationCalls = []; validationError = null; existingWork = null; });
const addWork = async (rides) => {
  let error;
  const req = { auth: { userId: "u1", legacy: { userId: "u1" } }, body: {
    tickets: ["t1", "t2"], description: "Настроен принтер", visitRequired: true,
    startedAt: "2026-11-09T00:25:00Z", finishedAt: "2026-11-09T01:15:00Z",
    taxiTripIds: rides,
  } };
  await add(req, { status() { return this; }, json() {} }, (value) => { error = value; });
  return error;
};
test("actual work validates selected rides with its final company, performer and all tickets", async () => {
  assert.equal(await addWork(["ride1"]), undefined);
  assert.equal(validationCalls.length, 1);
  assert.equal(validationCalls[0].work.company, "c1");
  assert.equal(validationCalls[0].work.finishedBy._id, "u1");
  assert.deepEqual(validationCalls[0].work.tickets, ["t1", "t2"]);
  assert.deepEqual(saved.taxiTripIds, ["ride1"]);
});
test("a forbidden ride cannot leave a saved work or turn a 403 into a server error", async () => {
  validationError = new AppError("Чужая поездка", 403, true);
  const error = await addWork(["foreign-ride"]);
  assert.equal(error?.statusCode, 403);
  assert.equal(saved, null);
});

test("editing a work preserves and revalidates existing ride links when the field is absent", async () => {
  existingWork = new Work({ _id: "w1", tickets: ["t1"], company: "c1", taxiTripIds: ["ride1"],
    visitRequired: true, startedAt: new Date("2026-11-09T00:25:00Z"),
    finishedAt: new Date("2026-11-09T01:15:00Z"), finishedBy: performer,
  });
  let error;
  await update({ auth: { userId: "u1", can: () => true, legacy: { userId: "u1" } },
    params: { workId: "w1" }, body: { description: "Исправлено описание" },
  }, { status() { return this; }, json() {} }, (value) => { error = value; });
  assert.equal(error, undefined);
  assert.deepEqual(saved.taxiTripIds, ["ride1"]);
  assert.deepEqual(validationCalls[0].taxiTripIds, ["ride1"]);
});

test("confirming a formerly planned no-taxi placeholder does not manufacture an explicit decision", async () => {
  existingWork = new Work({ _id: "w1", tickets: ["t1"], company: "c1", taxiTripIds: [],
    scheduled: true, visitRequired: true, taxiDecision: "none", executor: performer,
  });
  let error;
  await update({ auth: { userId: "u1", can: () => true, legacy: { userId: "u1" } }, params: { workId: "w1" },
    body: { startedAt: "2026-11-09T00:25:00Z", finishedAt: "2026-11-09T01:15:00Z", taxiDecision: "pending", taxiTripIds: [] },
  }, { status() { return this; }, json() {} }, (value) => { error = value; });
  assert.equal(error, undefined);
  assert.equal(saved.taxiDecision, "pending");
});
