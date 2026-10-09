// node --test services/mikrotik/hostGuard.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { assertPublicHost } = require("./hostGuard");

const blocked = (host, nets) =>
  assert.rejects(assertPublicHost(host, nets), { code: "MIKROTIK_BLOCKED_HOST" });

test("public addresses pass, private ones are blocked by default", async () => {
  await assertPublicHost("89.108.73.94", "");
  await blocked("10.0.50.1", "");
  await blocked("192.168.36.2", undefined);
  await blocked("172.16.0.5", "");
  await blocked("fd00::1", "");
});

test("an allowed address or block opens exactly that", async () => {
  await assertPublicHost("10.0.50.1", "10.0.50.1");
  await blocked("10.0.50.2", "10.0.50.1");
  await assertPublicHost("10.0.60.77", " 10.0.50.1 , 10.0.60.0/24 ");
  await blocked("10.0.61.1", "10.0.50.1,10.0.60.0/24");
});

test("loopback and link-local stay blocked even when listed", async () => {
  await blocked("127.0.0.1", "127.0.0.0/8");
  await blocked("169.254.169.254", "169.254.0.0/16");
  await blocked("0.0.0.0", "0.0.0.0/8");
  await blocked("::1", "");
});

test("malformed entries are ignored, not treated as allow-all", async () => {
  await blocked("10.0.50.1", "0.0.0.0/0");
  await blocked("10.0.50.1", "10.0.50.1/40,nonsense,/24");
  await blocked("fd00::1", "fd00::/8");
});
