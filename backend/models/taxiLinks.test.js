const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
require("module-alias/register");
const Work = require("./work");
const User = require("./user");

test("work retains references to both inbound and return rides without copying expenses", () => {
  const inbound = new Types.ObjectId();
  const returning = new Types.ObjectId();
  const work = new Work({ taxiTripIds: [inbound, returning], taxiDecision: "linked" });
  assert.equal(work.taxiDecision, "linked");
  assert.deepEqual(work.toObject().taxiTripIds?.map(String), [String(inbound), String(returning)]);
  work.set("description", "Настроен принтер");
  assert.deepEqual(work.toObject().taxiTripIds?.map(String), [String(inbound), String(returning)]);
});

test("taxi presence retains its source and order reference through model casting", () => {
  const rideId = new Types.ObjectId();
  const user = new User({ workStatus: {
    code: "trip", note: "Автогарант · Шилкинская, 32а", auto: false,
    source: "taxi", taxiTripId: rideId,
  } });
  assert.equal(user.workStatus.source, "taxi");
  assert.equal(String(user.workStatus.taxiTripId), String(rideId));
  // Manual status replacement must release the association to the previous ride.
  user.set("workStatus", { code: "office", note: "", auto: false });
  assert.notEqual(user.workStatus.source, "taxi");
  assert.equal(user.workStatus.taxiTripId ?? null, null);
});
