require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");
const validation = require("./team");
const Absence = require("../models/absence");
const payload = { user: "62d0c0ed5a3314d41cc43ef3", type: "dayoff", from: "2026-11-09", to: "2026-11-09" };
const errors = async (chains, value, location) => {
  const req = { body: {}, query: {}, params: {}, [location]: value };
  for (const chain of chains) await chain.run(req);
  return validationResult(req).array();
};

test("add and impact accept whole-day legacy requests and valid same-day or overnight clocks", async () => {
  for (const [chains, location] of [[validation.absenceAdd, "body"], [validation.absenceImpact, "query"]]) {
    for (const timeRange of [undefined, null, { start: "09:00", end: "10:00" }, { start: "23:00", end: "02:00" }]) {
      assert.deepEqual(await errors(chains, { ...payload, timeRange }, location), []);
    }
  }
});

test("add and impact reject malformed, empty or multiple-day partial periods", async () => {
  for (const [chains, location] of [[validation.absenceAdd, "body"], [validation.absenceImpact, "query"]]) {
    for (const timeRange of ["09:00–10:00", [], {}, { start: "9:00", end: "10:00" }, { start: "24:00", end: "10:00" }, { start: "09:60", end: "10:00" }, { start: "09:00", end: "09:00" }, { start: 9, end: "10:00" }]) {
      assert.ok((await errors(chains, { ...payload, timeRange }, location)).length, JSON.stringify(timeRange));
    }
    assert.ok((await errors(chains, { ...payload, to: "2026-11-10", timeRange: { start: "09:00", end: "10:00" } }, location)).length);
  }
});

test("impact accepts JSON query clocks and rejects broken JSON or invalid encoded clocks", async () => {
  assert.deepEqual(await errors(validation.absenceImpact, { ...payload, timeRange: JSON.stringify({ start: "23:00", end: "02:00" }) }, "query"), []);
  for (const timeRange of ["{", JSON.stringify({ start: "23:00", end: "24:00" })]) {
    assert.ok((await errors(validation.absenceImpact, { ...payload, timeRange }, "query")).length);
  }
});

test("absence persistence keeps optional clocks without subdocument ids and preserves legacy whole days", () => {
  const partial = new Absence({ ...payload, requestedBy: payload.user, timeRange: { start: "23:00", end: "02:00" } });
  assert.deepEqual(partial.toObject().timeRange, { start: "23:00", end: "02:00" });
  assert.equal(new Absence({ ...payload, requestedBy: payload.user }).toObject().timeRange ?? null, null);
});
