// node --test services/mikrotik/upgradeDevice.test.js
// The module's requires reach models that import through the `@/` alias.
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { isRebootSessionDrop, downloadError } = require("./upgradeDevice");

test("only a read timeout counts as the session dying with the reboot", () => {
  assert.equal(isRebootSessionDrop(new Error("read timeout")), true);
  // Socket errors can only come from connect(): the reboot never reached the device.
  assert.equal(isRebootSessionDrop(new Error("connect ECONNRESET 10.0.0.1:8729")), false);
  assert.equal(isRebootSessionDrop(new Error("socket closed")), false);
  assert.equal(isRebootSessionDrop(new Error("write EPIPE")), false);
  assert.equal(isRebootSessionDrop(new Error("ETIMEDOUT: device did not respond within poll deadline")), false);
  assert.equal(isRebootSessionDrop(new Error("not enough permissions (9)")), false);
  assert.equal(isRebootSessionDrop(undefined), false);
});

test("a download watchdog timeout becomes an incomplete-download error", () => {
  const mapped = downloadError(new Error("SSH operation watchdog timeout"));
  assert.equal(mapped.code, "MIKROTIK_DOWNLOAD_INCOMPLETE");
  assert.match(mapped.message, /превышено 10 минут/);
});

test("other download errors pass through unchanged", () => {
  const other = new Error("Socket timeout");
  assert.equal(downloadError(other), other);
  const trap = Object.assign(new Error("not enough permissions (9)"), { code: "X" });
  assert.equal(downloadError(trap), trap);
});
