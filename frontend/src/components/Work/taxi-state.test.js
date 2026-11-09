import { test } from "node:test";
import assert from "node:assert/strict";
import { initialWorkTaxi, workTaxiSelection } from "./taxi-state.js";
const pending = { taxiTripIds: [], taxiDecision: "pending" };
test("planned and remote edits never manufacture a no-taxi decision", () => {
  const work = {
    visitRequired: true,
    taxiDecision: "none",
    taxiTripIds: ["legacy"],
  };
  assert.deepEqual(
    initialWorkTaxi({ mode: "updateScheduled", isPlan: true, work }),
    pending,
  );
  assert.deepEqual(
    initialWorkTaxi({
      mode: "update",
      isPlan: false,
      work: { ...work, visitRequired: false },
    }),
    pending,
  );
  assert.deepEqual(
    workTaxiSelection({ isPlan: true, visitRequired: true, withoutTaxi: true }),
    pending,
  );
  assert.deepEqual(
    workTaxiSelection({
      isPlan: false,
      visitRequired: false,
      withoutTaxi: true,
    }),
    pending,
  );
});
test("confirming an old plan resets legacy none and requires a fresh actual choice", () => {
  assert.deepEqual(
    initialWorkTaxi({
      mode: "confirm",
      isPlan: false,
      work: { visitRequired: true, taxiDecision: "none" },
    }),
    pending,
  );
  assert.deepEqual(
    workTaxiSelection({ isPlan: false, visitRequired: true }),
    pending,
  );
});
test("only the explicit actual on-site no-taxi choice is none; removing selections stays pending", () => {
  const context = { isPlan: false, visitRequired: true };
  assert.deepEqual(workTaxiSelection({ ...context, withoutTaxi: true }), {
    taxiTripIds: [],
    taxiDecision: "none",
  });
  assert.deepEqual(workTaxiSelection({ ...context, taxiTripIds: [] }), pending);
  assert.deepEqual(
    initialWorkTaxi({
      mode: "update",
      isPlan: false,
      work: { visitRequired: true, taxiDecision: "none" },
    }),
    { taxiTripIds: [], taxiDecision: "none" },
  );
  assert.deepEqual(
    workTaxiSelection({ ...context, taxiTripIds: ["ride", "ride"] }),
    { taxiTripIds: ["ride"], taxiDecision: "linked" },
  );
});
