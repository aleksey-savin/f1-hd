// node --test services/mikrotik/pollEvents.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { bootedAtFrom, pollEvents } = require("./pollEvents");

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (seconds) => new Date(NOW.getTime() - seconds * 1000);

test("bootedAtFrom subtracts RouterOS uptime from the poll time", () => {
  assert.deepEqual(bootedAtFrom("1h30m", NOW), ago(5400));
  assert.deepEqual(bootedAtFrom("5w6d1h2m3s", NOW), ago(5 * 604800 + 6 * 86400 + 3723));
  assert.equal(bootedAtFrom(undefined, NOW), null);
  assert.equal(bootedAtFrom("soon", NOW), null);
});

test("a steady device produces no events", () => {
  const prev = { bootedAt: ago(86400), currentFirmware: "7.20.1", name: "GW", serialNumber: "S1" };
  const set = { bootedAt: ago(86400 - 20), currentFirmware: "7.20.1", name: "GW", serialNumber: "S1" };
  assert.deepEqual(pollEvents({ prev, set }), []);
});

test("a later boot time is a reboot dated by the boot, unexplained outside an upgrade", () => {
  const prev = { bootedAt: ago(86400) };
  const set = { bootedAt: ago(240) };
  assert.deepEqual(pollEvents({ prev, set }), [
    { kind: "reboot", at: ago(240), severity: "warning", data: { cause: "unknown", ranSeconds: 86160 } },
  ]);
  const [event] = pollEvents({ prev, set, upgrading: true });
  assert.equal(event.severity, "info");
  assert.equal(event.data.cause, "upgrade");
});

test("the first poll with a boot time and a poll without one stay silent", () => {
  assert.deepEqual(pollEvents({ prev: {}, set: { bootedAt: ago(60) } }), []);
  assert.deepEqual(pollEvents({ prev: { bootedAt: ago(86400) }, set: {} }), []);
  assert.deepEqual(pollEvents({ prev: null, set: { bootedAt: ago(60) } }), []);
});

test("version, name and serial changes are reported with both values", () => {
  const prev = { currentFirmware: "7.20.1", name: "GW", serialNumber: "S1" };
  const set = { currentFirmware: "7.23.7", name: "GW-01", serialNumber: "S2" };
  assert.deepEqual(pollEvents({ prev, set }), [
    { kind: "firmwareChanged", data: { from: "7.20.1", to: "7.23.7", cause: "unknown" } },
    { kind: "identityChanged", data: { from: "GW", to: "GW-01" } },
    { kind: "serialChanged", data: { from: "S1", to: "S2" } },
  ]);
});

test("a value seen for the first time is not a change", () => {
  assert.deepEqual(pollEvents({ prev: {}, set: { currentFirmware: "7.23.7", name: "GW", serialNumber: "S1" } }), []);
});
