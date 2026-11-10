const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMonitoringFilters, monitoringState } = require("./monitoring-query");
test("agent and OS filters constrain the database query before pagination", () => {
  const filter = { kind: "guest", archived: false };
  applyMonitoringFilters(filter, { agent: "responding", os: "Ubuntu 24.04 LTS" }, "guests");
  assert.equal(filter["guestAgent.state"], "responding");
  assert.equal(filter["guestOs.name"], "Ubuntu 24.04 LTS");
  assert.throws(() => applyMonitoringFilters({}, { agent: "bad" }, "guests"));
});
test("unknown-state filtering does not overwrite search or ownership clauses", () => {
  const search = [{ name: /production/ }];
  const filter = { $or: search, $and: [{ companyId: "tenant" }] };
  applyMonitoringFilters(filter, { state: "unknown", os: "unknown" }, "guests", new Date("2026-11-10T00:00:00Z"));
  assert.equal(filter.$or, search);
  assert.equal(filter.$and[0].companyId, "tenant");
  assert.equal(filter.$and.length, 3);
  assert.equal(filter.monitoringEnabled.$ne, false);
});
test("display state and filters distinguish monitoring off, stale data and a stopped VM", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const fresh = { kind: "guest", status: "running", lastCheckedAt: now };
  assert.equal(monitoringState(fresh, now), "up");
  assert.equal(monitoringState({ ...fresh, monitoringEnabled: false }, now), "disabled");
  assert.equal(monitoringState({ ...fresh, lastCheckedAt: new Date(0) }, now), "unknown");
  assert.equal(monitoringState({ ...fresh, status: "stopped" }, now), "stopped");
  assert.equal(monitoringState({ ...fresh, template: true }, now), "template");
  const filter = {};
  applyMonitoringFilters(filter, { state: "up" }, "guests", now);
  assert.equal(filter.status, "running");
  assert.equal(filter.template.$ne, true);
  assert.equal(+filter.lastCheckedAt.$gt, +now - 180000);
});

test('unknown state keeps stale templates but excludes fresh template status placeholders', () => {
  const match = require('sift').default;
  const now = new Date('2026-11-10T00:00:00Z');
  const filter = {};
  applyMonitoringFilters(filter, { state: 'unknown' }, 'guests', now);
  const fresh = { template: true, status: 'template', lastCheckedAt: now };
  assert.equal(match(filter)(fresh), false);
  assert.equal(match(filter)({ ...fresh, lastCheckedAt: new Date(+now - 180000) }), true);
  assert.equal(match(filter)({ ...fresh, lastError: 'API failed' }), true);
});
test('parent monitoring off overrides fresh and stale resource states without weakening scopes', () => {
  const match = require('sift').default;
  const now = new Date('2026-11-10T00:00:00Z');
  const row = { connectionId: 'off', monitoringEnabled: true, status: 'running', name: 'production', companyId: 'tenant', lastCheckedAt: now };
  const filter = { $or: [{ name: /production/ }], $and: [{ companyId: 'tenant' }] };
  applyMonitoringFilters(filter, { state: 'disabled' }, 'guests', now, ['off']);
  assert.equal(match(filter)(row), true);
  assert.equal(match(filter)({ ...row, companyId: 'other' }), false);
  assert.equal(match(filter)({ ...row, name: 'other' }), false);
  assert.equal(match(filter)({ ...row, connectionId: 'on' }), false);
  assert.equal(match(filter)({ ...row, connectionId: 'on', monitoringEnabled: false }), true);
  for (const state of ['unknown', 'up', 'down', 'stopped', 'template']) {
    const scoped = {};
    applyMonitoringFilters(scoped, { state }, 'guests', now, ['off']);
    assert.equal(match(scoped)({ ...row, status: state === 'down' ? 'offline' : state === 'stopped' ? 'stopped' : state === 'unknown' ? 'unrecognized' : 'running', template: state === 'template' }), false);
  }
  assert.equal(monitoringState({ ...row, connectionId: { monitoringEnabled: false } }, now), 'disabled');
  assert.equal(monitoringState({ ...row, connectionId: { monitoringEnabled: false }, lastCheckedAt: null }, now), 'disabled');
});
test('the stale threshold belongs only to unknown, never to both up and unknown', () => {
  const match = require('sift').default;
  const now = new Date('2026-11-10T00:00:00Z');
  const row = { status: 'running', lastCheckedAt: new Date(+now - 180000) };
  const filter = {};
  applyMonitoringFilters(filter, { state: 'up' }, 'guests', now);
  assert.equal(match(filter)(row), false);
  assert.equal(monitoringState(row, now), 'unknown');
});
