// node --test services/mikrotik/upgradeGuard.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { isUpgrading, quietUnderUpgrade } = require("./upgradeGuard");

const NOW = new Date("2026-09-29T06:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

test("fresh flag keeps the device quiet", () => {
  assert.equal(isUpgrading({ upgrade: { jobId: "j", since: minutesAgo(5) } }, NOW), true);
});

test("stale flag is ignored", () => {
  assert.equal(isUpgrading({ upgrade: { jobId: "j", since: minutesAgo(91) } }, NOW), false);
});

test("no flag, or an empty nested object, is not an upgrade", () => {
  assert.equal(isUpgrading({}, NOW), false);
  assert.equal(isUpgrading({ upgrade: {} }, NOW), false);
});

test("dependent of an upgrading router is quiet", () => {
  const router = { _id: "r", upgrade: { jobId: "j", since: minutesAgo(3) } };
  const sw = { _id: "s", jumpRecordId: "r" };
  assert.equal(quietUnderUpgrade(sw, new Map([["r", router]]), NOW), true);
});

test("dependent of an unknown or idle router is not quiet", () => {
  const sw = { _id: "s", jumpRecordId: "r" };
  assert.equal(quietUnderUpgrade(sw, new Map(), NOW), false);
  assert.equal(quietUnderUpgrade(sw, new Map([["r", { _id: "r" }]]), NOW), false);
});
