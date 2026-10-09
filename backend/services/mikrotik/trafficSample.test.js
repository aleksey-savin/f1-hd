// node --test services/mikrotik/trafficSample.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { sumRxBytes, nextSample } = require("./trafficSample");

const AT = new Date("2026-10-09T03:20:00Z");
const minutesBefore = (m) => new Date(AT.getTime() - m * 60 * 1000);

test("sums rx-byte over physical interfaces only", () => {
  const rows = [
    { name: "ether1", type: "ether", "rx-byte": "1000" },
    { name: "wlan1", type: "wlan", "rx-byte": "200" },
    { name: "bridge1", type: "bridge", "rx-byte": "999999" },
    { name: "gre1", type: "gre-tunnel", "rx-byte": "999999" },
    { name: "vlan10", type: "vlan", "rx-byte": "999999" },
  ];
  assert.equal(sumRxBytes(rows), 1200);
});

test("no rows, no physical rows or a failed read give null", () => {
  assert.equal(sumRxBytes(undefined), null);
  assert.equal(sumRxBytes({ error: "read timeout" }), null);
  assert.equal(sumRxBytes([{ type: "bridge", "rx-byte": "5" }]), null);
  assert.equal(sumRxBytes([{ type: "ether", "rx-byte": "abc" }]), null);
});

test("first sample is stored and writes no bucket", () => {
  const out = nextSample(undefined, 5000, AT);
  assert.deepEqual(out.traffic, { counter: 5000, at: AT });
  assert.equal(out.bucket, null);
});

test("normal delta lands in the hour of the new sample", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(5) }, 8000, AT);
  assert.deepEqual(out.bucket, {
    hour: new Date("2026-10-09T03:00:00Z"),
    bytes: 3000,
    seconds: 300,
  });
  assert.deepEqual(out.traffic, { counter: 8000, at: AT });
});

test("counter reset writes no bucket but stores the new sample", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(5) }, 120, AT);
  assert.equal(out.bucket, null);
  assert.equal(out.traffic.counter, 120);
});

test("a gap longer than 15 minutes writes no bucket", () => {
  const out = nextSample({ counter: 5000, at: minutesBefore(16) }, 9000, AT);
  assert.equal(out.bucket, null);
  assert.equal(out.traffic.counter, 9000);
});

test("a clock that went backwards writes no bucket", () => {
  const out = nextSample({ counter: 5000, at: new Date(AT.getTime() + 1000) }, 9000, AT);
  assert.equal(out.bucket, null);
});
