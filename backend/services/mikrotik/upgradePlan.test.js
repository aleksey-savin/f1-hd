// node --test services/mikrotik/upgradePlan.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { planUpgrade } = require("./upgradePlan");

const releases = new Map([
  ["7.long-term", { version: "7.23.7" }],
  ["7.stable", { version: "7.24.4" }],
  ["6.long-term", { version: "6.49.22" }],
]);

let seq = 0;
const device = (over = {}) => ({
  _id: `id${(seq += 1)}`,
  name: `DEV-${seq}`,
  firmwareUpgradeEnabled: true,
  monitoringEnabled: true,
  status: "online",
  currentFirmware: "7.23.5 (long-term)",
  ...over,
});

const plan = (records, channelMode = "current", busyIds) =>
  planUpgrade({ records, channelMode, releases, busyIds });

test("current mode keeps the device's branch", () => {
  const { items, skipped } = plan([device({ name: "A" })]);
  assert.deepEqual(skipped, []);
  assert.equal(items[0].channel, "long-term");
  assert.equal(items[0].fromVersion, "7.23.5");
  assert.equal(items[0].toVersion, "7.23.7");
});

test("an explicit branch retargets the version", () => {
  const { items } = plan([device()], "stable");
  assert.equal(items[0].channel, "stable");
  assert.equal(items[0].toVersion, "7.24.4");
});

test("a downgrade is refused with both versions named", () => {
  const { items, skipped } = plan([device({ currentFirmware: "7.24.4 (stable)" })], "long-term");
  assert.equal(items.length, 0);
  assert.equal(skipped[0].reason, "это откат с 7.24.4 на 7.23.7");
});

test("each ineligible device gets its reason", () => {
  const { skipped } = plan([
    device({ name: "OFF", firmwareUpgradeEnabled: false }),
    device({ name: "MON", monitoringEnabled: false }),
    device({ name: "DOWN", status: "offline" }),
    device({ name: "NOFW", currentFirmware: undefined }),
    device({ name: "CUR", currentFirmware: "7.23.7 (long-term)" }),
  ]);
  const byName = Object.fromEntries(skipped.map((s) => [s.name, s.reason]));
  assert.equal(byName.OFF, "обновление из HD выключено");
  assert.equal(byName.MON, "мониторинг выключен");
  assert.equal(byName.DOWN, "не в сети");
  assert.equal(byName.NOFW, "версия прошивки ещё не считана");
  assert.equal(byName.CUR, "уже актуальна");
});

test("a device already in a running batch is skipped", () => {
  const busy = device();
  const { skipped } = plan([busy], "current", new Set([busy._id]));
  assert.equal(skipped[0].reason, "уже в другом пакете");
});

test("dependents run before their transit router", () => {
  const router = device({ name: "A-ROUTER" });
  const sw = device({ name: "Z-SWITCH", jumpRecordId: router._id });
  const other = device({ name: "M-OTHER" });
  const { items } = plan([router, sw, other]);
  assert.deepEqual(items.map((i) => i.name), ["M-OTHER", "Z-SWITCH", "A-ROUTER"]);
});

test("v6 devices stay within v6", () => {
  const { items } = plan([device({ currentFirmware: "6.48.6 (long-term)" })]);
  assert.equal(items[0].toVersion, "6.49.22");
});

test("an unknown mode is a programming error", () => {
  assert.throws(() => plan([device()], "testing"), /unknown channel mode/);
});
