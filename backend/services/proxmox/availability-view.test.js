const test = require("node:test");
const assert = require("node:assert/strict");
const { availabilityView } = require("./availability-view");
test("a newly observed node has no invented green history", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const createdAt = new Date(+now - 120000);
  const result = availabilityView({ createdAt, lastCheckedAt: now }, [{ from: createdAt, lastSeenAt: now, state: "up" }], 30, now);
  assert.equal(result.availability, 100);
  assert.equal(result.segments.filter((segment) => segment.tone === "ok").length, 1);
  assert.equal(result.segments.filter((segment) => segment.tone === "none").length, 29);
});
test("availability periods count real downtime and leave collection gaps unknown", () => {
  const now = new Date("2026-11-10T00:00:00Z"), start = new Date(+now - 3600000);
  const result = availabilityView({ createdAt: start }, [
    { from: start, until: new Date(+start + 1200000), state: "up" },
    { from: new Date(+start + 1200000), until: new Date(+start + 1800000), state: "down" },
  ], 1, now);
  assert.equal(result.availability, 200 / 3);
  assert.equal(result.coverage, 50);
  assert.equal(result.downMs, 600000);
  assert.equal(result.episodes[0].durationMs, 600000);
  assert.equal(result.segments.length, 24);
  assert.throws(() => availabilityView({ createdAt: start }, [], 8, now));
});

test('downtime episodes are ordered by their starts regardless of persistence order', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const episode = minutes => ({ state: 'down', from: new Date(+now - minutes * 60000), until: new Date(+now - (minutes - 1) * 60000) });
  const result = availabilityView({ createdAt: new Date(+now - 86400000) }, [episode(30), episode(60), episode(10)], 1, now);
  assert.deepEqual(result.episodes.map(row => row.startedAt.toISOString()), ['2026-11-09T23:50:00.000Z', '2026-11-09T23:30:00.000Z', '2026-11-09T23:00:00.000Z']);
});
test('an open stale outage ends at last observation plus three minutes and leaves the gap unknown', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const start = new Date(+now - 30 * 60000), lastSeen = new Date(+now - 20 * 60000);
  const result = availabilityView({ createdAt: start }, [{ state: 'down', from: start, lastSeenAt: lastSeen, open: true }], 1, now);
  assert.equal(result.episodes[0].ongoing, false);
  assert.equal(+result.episodes[0].endedAt, +lastSeen + 180000);
  assert.equal(result.episodes[0].durationMs, 13 * 60000);
  assert.equal(result.downMs, 13 * 60000);
  assert.equal(result.unknownMs, 17 * 60000);
});
