const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseIPv4Set,
  parsePorts,
  subtract,
  intersect,
  isGlobal,
} = require("./ip-set");
test("CIDR arithmetic stays interval based and handles full IPv4 and boundary ports", () => {
  assert.deepEqual(
    subtract(parseIPv4Set("0.0.0.0/0"), parseIPv4Set("10.0.0.1")),
    [
      [0, 167772161],
      [167772162, 4294967296],
    ],
  );
  assert.deepEqual(parsePorts("80,443,1000-1002"), [
    [80, 81],
    [443, 444],
    [1000, 1003],
  ]);
  assert.deepEqual(intersect(parsePorts("1-65535"), parsePorts("65535")), [
    [65535, 65536],
  ]);
  assert.equal(isGlobal("100.64.0.1"), false);
  assert.equal(isGlobal("203.0.113.1"), false);
  assert.equal(isGlobal("8.8.8.8"), true);
  assert.throws(() => parsePorts("0"));
  assert.throws(() => parseIPv4Set("999.1.1.1"));
});
