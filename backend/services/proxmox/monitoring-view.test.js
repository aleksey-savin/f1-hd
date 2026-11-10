const test = require('node:test');
const assert = require('node:assert/strict');
const { Observation, GuestSecurity } = require('../../models/proxmox');
const nodeSecurity = require('./node-security');
const { enrich } = require('./monitoring-view');
const now = new Date('2026-11-10T00:00:00Z');
test('enrichment scopes persistence reads and maps compact guest and node reports by resource id', async t => {
  const items = [
    { _id: 'node-a', kind: 'node', createdAt: new Date(+now - 600000) },
    { _id: 'guest-a', kind: 'guest', createdAt: new Date(+now - 600000) },
    { _id: 'guest-b', kind: 'guest', createdAt: now },
    { _id: 'storage-a', kind: 'storage' },
  ];
  let observationFilter, scanPipeline, nodeIds;
  t.mock.method(Observation, 'find', filter => {
    observationFilter = filter;
    return { lean: async () => [{ resourceId: 'guest-a', state: 'up', from: new Date(+now - 600000), lastSeenAt: now }] };
  });
  t.mock.method(GuestSecurity, 'aggregate', async pipeline => {
    scanPipeline = pipeline;
    return [{
      resourceId: 'guest-a', status: 'error', requestedAt: now, checkedAt: new Date(+now - 600000), lastError: 'Feed unavailable',
      inventory: { packages: ['private-inventory'] }, leaseToken: 'private-lease', job: { pid: 101 },
      report: { os: { id: 'mswindows', build: '20348.1' }, findingCount: 7000, reviewCount: 2, updatesCount: 5, rebootRequired: true,
        findings: [{ id: 'private-finding' }], reviewFindings: [{ id: 'private-review' }], inventory: 'private-report-data',
        updates: [{ id: 'kb', title: '.NET Framework', kb: ['123'], security: true, cves: [], internal: 'private-update-data' }],
      },
    }];
  });
  t.mock.method(nodeSecurity, 'getSummaries', async ids => { nodeIds = ids; return new Map([['node-a', { status: 'partial', version: '8.2.7' }]]); });
  const result = await enrich(items, now);
  assert.deepEqual(observationFilter.resourceId.$in, ['node-a', 'guest-a', 'guest-b']);
  assert.deepEqual(scanPipeline[0].$match.resourceId.$in, ['guest-a', 'guest-b']);
  assert.deepEqual(nodeIds, ['node-a']);
  const projection = scanPipeline[1].$project;
  assert.equal(projection.inventory, undefined);
  assert.equal(projection.job, undefined);
  assert.equal(projection.report.findings, undefined);
  assert.deepEqual(projection.report.findingCount, { $size: { $ifNull: ['$report.findings', []] } });
  assert.equal(result[0].nodeSecurity.version, '8.2.7');
  const guest = result[1].guestSecurity;
  assert.equal(guest.findingCount, 7000);
  assert.equal(guest.status, 'error');
  assert.equal(guest.lastError, 'Feed unavailable');
  assert.equal(+guest.checkedAt, +now - 600000);
  assert.deepEqual(guest.updates, [{ id: 'kb', title: '.NET Framework', kb: ['123'], security: true }]);
  assert.doesNotMatch(JSON.stringify(guest), /private-|findings|reviewFindings|inventory|leaseToken|job/);
  assert.equal(result[1].availability.upMs, 600000);
  assert.equal(result[2].guestSecurity, null);
  assert.equal(result[2].availability.upMs, 0);
  assert.equal(result[3], items[3]);
  assert.equal(items[1].guestSecurity, undefined);
});
test('non-resource lists do not load observations or vulnerability persistence', async t => {
  t.mock.method(Observation, 'find', () => assert.fail('no resource read'));
  t.mock.method(GuestSecurity, 'aggregate', () => assert.fail('no security read'));
  t.mock.method(nodeSecurity, 'getSummaries', () => assert.fail('no node read'));
  const items = [{ kind: 'connection', _id: 'c' }, { kind: 'storage', _id: 's' }];
  assert.equal(await enrich(items, now), items);
});
