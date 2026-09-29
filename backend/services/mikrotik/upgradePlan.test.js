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

// --- RouterOS 6 → 7 (toV7) -------------------------------------------------

const MB = 1024 * 1024;
const v6 = (over = {}) =>
  device({ currentFirmware: "6.45.9 (long-term)", totalMemory: 128 * MB, ...over });
const planV7 = (records, channelMode = "current") =>
  planUpgrade({ records, channelMode, releases, toV7: true });

test("toV7: a v6 device goes latest v6 → upgrade channel → the v7 branch", () => {
  const { items, skipped, hasV6 } = planV7([v6()]);
  assert.deepEqual(skipped, []);
  assert.equal(hasV6, true);
  assert.deepEqual(items[0].legs, ["long-term", "upgrade", "long-term"]);
  assert.equal(items[0].channel, "long-term");
  assert.equal(items[0].fromVersion, "6.45.9");
  assert.equal(items[0].toVersion, "7.23.7");
  assert.deepEqual(items[0].via, ["6.49.22", "7.x"]);
  assert.equal(items[0].majorUpgrade, true);
});

test("toV7: a device already on the latest v6 skips the first leg", () => {
  const { items } = planV7([v6({ currentFirmware: "6.49.22 (long-term)" })]);
  assert.deepEqual(items[0].legs, ["upgrade", "long-term"]);
  assert.deepEqual(items[0].via, ["7.x"]);
  assert.equal(items[0].toVersion, "7.23.7");
});

test("toV7: an explicit branch is the last leg", () => {
  const { items } = planV7([v6()], "stable");
  assert.deepEqual(items[0].legs, ["long-term", "upgrade", "stable"]);
  assert.equal(items[0].channel, "stable");
  assert.equal(items[0].toVersion, "7.24.4");
});

test("toV7: too little memory is skipped with the size named", () => {
  const { items, skipped } = planV7([v6({ totalMemory: 32 * MB })]);
  assert.equal(items.length, 0);
  assert.equal(skipped[0].reason, "мало памяти для RouterOS 7 (32 МБ)");
});

test("toV7: unknown memory is skipped until the next poll", () => {
  const { skipped } = planV7([v6({ totalMemory: undefined })]);
  assert.equal(skipped[0].reason, "объём памяти ещё не считан — повторите через 5 минут");
});

test("toV7 off: a v6 device stays within v6, single leg", () => {
  const { items, hasV6 } = plan([v6({ totalMemory: 32 * MB })]);
  assert.equal(hasV6, true);
  assert.equal(items[0].toVersion, "6.49.22");
  assert.deepEqual(items[0].legs, ["long-term"]);
  assert.deepEqual(items[0].via, []);
  assert.equal(items[0].majorUpgrade, false);
});

test("toV7: a v7 device is a plain single-leg upgrade", () => {
  const { items, hasV6 } = planV7([device()]);
  assert.equal(hasV6, false);
  assert.deepEqual(items[0].legs, ["long-term"]);
  assert.deepEqual(items[0].via, []);
  assert.equal(items[0].majorUpgrade, false);
  assert.equal(items[0].toVersion, "7.23.7");
});

test("hasV6 counts every given record, skipped ones too", () => {
  assert.equal(plan([device(), v6({ status: "offline" })]).hasV6, true);
  assert.equal(plan([device(), device()]).hasV6, false);
});
