const test = require('node:test');
const assert = require('node:assert/strict');
const { collectNode, evaluateNode, advanceScan, publicView } = require('./node-security');
const node = { _id: 'node-secret-id', kind: 'node', nodeName: 'node-internal', status: 'online' };
const connection = { monitoringEnabled: true };
const versions = [
  { Package: 'pve-manager', OldVersion: '8.2.7', Version: '8.4.21', CurrentState: 'Installed' },
  { Package: 'qemu-server', OldVersion: '8.2.4', Version: '8.4.10', CurrentState: 'Installed' },
  { Package: 'proxmox-ve', OldVersion: '8.2.0', Version: '8.4.0', CurrentState: 'Installed', RunningKernel: '6.8.12-4-pve' },
  { Package: 'not-installed', Version: '1.2', CurrentState: 'NotInstalled' },
];
const source = { checkedAt: new Date('2026-11-10'), latestMajor: 9, latestRelease: '9.2', advisories: [{ id: 'CVE-2026-51083' }, { id: 'CVE-2026-99999' }], cveCheckedAt: new Date('2026-11-10') };
const read = (updates) => async (_connection, path, options) => {
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
  if (path.endsWith('/apt/versions')) return versions;
  if (path.endsWith('/status')) return { kversion: 'Linux 6.8.12-4-pve #1 SMP' };
  if (updates instanceof Error) throw updates;
  return updates;
};
test('host GET permission fallback uses installed versions and explicitly partial package candidates', async () => {
  const inventory = await collectNode(node, connection, { request: read(new Error('HTTP 403')) });
  const report = evaluateNode(inventory, source, new Date('2026-11-10'));
  assert.equal(report.version, '8.2.7');
  assert.equal(report.latestVersion, '8.4.21');
  assert.equal(report.updatesComplete, false);
  assert.equal(report.updates.length, 3);
  assert.equal(report.packages.some(p => p.name === 'not-installed'), false);
  assert.equal(report.lifecycle.unsupported, true);
  assert.equal(report.latestMajor, 9);
  assert.deepEqual(report.findings.map(f => f.id), ['CVE-2026-51083', 'CVE-2026-64564']);
  assert.equal(report.status, 'partial');
  assert.equal(report.coverage.complete, false);
  assert.match(report.coverage.note, /полной/);
});
test('complete APT updates use actual installed values, ignore equal versions and downgrades', async () => {
  const inventory = await collectNode(node, connection, { request: read([
    { Package: 'openssl', OldVersion: '3.0.10-1~deb12u1', Version: '3.0.10-1' },
    { Package: 'unchanged', OldVersion: '1:1.2', Version: '1:1.2' },
    { Package: 'downgrade', OldVersion: '2:1.0', Version: '1:5.0' },
  ]) });
  assert.equal(inventory.updatesComplete, true);
  assert.deepEqual(inventory.updates.map(p => p.name), ['openssl']);
});
test('a new installed kernel does not hide a vulnerable running kernel', () => {
  const report = evaluateNode({ packages: [{ name: 'qemu-server', installed: '8.4.8', candidate: '8.4.10' }], updates: [], runningKernel: '6.8.12-40-pve', updatesComplete: true }, source);
  assert.deepEqual(report.findings.map(f => f.id), ['CVE-2026-64564']);
  const fixed = evaluateNode({ packages: [{ name: 'qemu-server', installed: '9.1.8', candidate: '9.1.8' }], updates: [], runningKernel: '6.8.12-41-pve', updatesComplete: true }, source);
  assert.equal(fixed.findings.length, 0);
  assert.equal(fixed.status, 'partial');
});
test('unverified kernel families are not matched as vanilla upstream versions', () => {
  const report = evaluateNode({ packages: [], updates: [], runningKernel: '6.14.1-1-pve', updatesComplete: true }, source);
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.runningKernel, false);
  assert.equal(report.coverage.complete, false);
});
test('failed collection preserves the last successful report and timestamp', async () => {
  const writes = [];
  await advanceScan({}, node, connection, { request: async () => { throw new Error('PVEAPIToken=private=secret HTTP 401'); }, save: async patch => writes.push(patch) });
  assert.equal(writes.at(-1).status, 'error');
  assert.equal(Object.hasOwn(writes.at(-1), 'report'), false);
  assert.equal(Object.hasOwn(writes.at(-1), 'checkedAt'), false);
  assert.doesNotMatch(writes.at(-1).lastError, /private|secret/);
});
test('public view does not expose private job state or arbitrary stored fields', () => {
  const view = publicView({ status: 'partial', report: { version: '8.2.7', findings: [] }, leaseToken: 'secret', inventory: versions, resourceId: 'internal' });
  assert.equal(view.version, '8.2.7');
  assert.equal(view.leaseToken, undefined);
  assert.equal(view.inventory, undefined);
  assert.equal(view.resourceId, undefined);
});

test('concurrent workers use one durable lease and an expired lease is recoverable', async (t) => {
  const { NodeSecurity } = require('../../models/proxmoxNodeSecurity');
  const { Resource, Connection } = require('../../models/proxmox');
  const core = require('./core');
  const { processScan } = require('./node-security');
  const match = require('sift').default;
  let doc = { _id: 'scan', resourceId: 'node', status: 'queued', requestedAt: new Date() };
  const writes = [];
  const update = patch => {
    Object.assign(doc, patch.$set || {});
    for (const key of Object.keys(patch.$unset || {})) delete doc[key];
  };
  t.mock.method(NodeSecurity, 'findOneAndUpdate', (filter, patch) => ({ lean: async () => {
    if (!match(filter)(doc)) return null;
    update(patch);
    return { ...doc };
  } }));
  t.mock.method(NodeSecurity, 'updateOne', async (filter, patch) => {
    if (!match(filter)(doc)) return { matchedCount: 0 };
    update(patch);
    writes.push(patch);
    return { matchedCount: 1 };
  });
  t.mock.method(Resource, 'findById', () => ({ lean: async () => node }));
  t.mock.method(Connection, 'findById', () => ({ select: () => ({ lean: async () => connection }) }));
  t.mock.method(core, 'bump', () => {});
  let reads = 0;
  const deps = { request: async (...args) => { reads++; return read([])(...args); }, loadSources: async () => source };
  await Promise.all([processScan('scan', deps), processScan('scan', deps)]);
  assert.equal(reads, 3);
  assert.equal(doc.status, 'partial');
  assert.equal(doc.leaseToken, undefined);
  assert.equal(doc.report.version, '8.2.7');
  doc = { ...doc, status: 'checking', leaseToken: 'crashed-worker', leaseUntil: new Date(0) };
  await processScan('scan', deps);
  assert.equal(reads, 6);
  assert.equal(doc.status, 'partial');
  assert.ok(writes.length > 0);
});

test('a blocked transport lane cannot keep a host refresh running forever', async () => {
  await assert.rejects(collectNode(node, connection, { timeout: 5, request: async () => new Promise(() => {}) }), /время/);
});

test('disabled host monitoring prevents scheduled and manual package reads while retaining its report', async () => {
  const writes = [];
  const { refresh } = require('./node-security');
  const disabled = { ...node, monitoringEnabled: false };
  await advanceScan({ report: { version: '8.2.7' } }, disabled, connection, {
    request: async () => assert.fail('disabled host must not be queried'),
    save: async patch => writes.push(patch),
  });
  assert.equal(writes.at(-1).status, 'unavailable');
  assert.equal(Object.hasOwn(writes.at(-1), 'report'), false);
  assert.equal(Object.hasOwn(writes.at(-1), 'checkedAt'), false);
  await assert.rejects(refresh(disabled), /Мониторинг узла выключен/);
});
test('daily host scheduling excludes per-resource monitoring off before requesting work', async t => {
  const { NodeSecurity } = require('../../models/proxmoxNodeSecurity');
  const { Resource, Connection } = require('../../models/proxmox');
  const core = require('./core');
  const { tick } = require('./node-security');
  let filter, selected;
  const query = rows => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => rows });
  t.mock.method(core, 'enabled', async () => true);
  t.mock.method(Connection, 'find', () => query([{ _id: 'on-connection' }]));
  t.mock.method(Resource, 'find', value => {
    filter = value;
    return { select(value) { selected = value; return this; }, lean: async () => [] };
  });
  t.mock.method(NodeSecurity, 'find', () => query([]));
  await tick();
  assert.deepEqual(filter.monitoringEnabled, { $ne: false });
  assert.deepEqual(filter.connectionId, { $in: ['on-connection'] });
  assert.ok(selected.split(/\s+/).includes('monitoringEnabled'));
});

test('host list summaries aggregate scoped counts and omit full reports and private worker fields', async t => {
  const { NodeSecurity } = require('../../models/proxmoxNodeSecurity');
  const { getSummaries, getReport } = require('./node-security');
  const now = new Date('2026-11-10T00:00:00Z');
  let pipeline;
  const report = { version: '8.2.7', latestVersion: '8.4.21', latestMajor: 9, latestRelease: '9.2', lifecycle: { unsupported: true, eolAt: '2026-08', source: 'vendor', private: 'private-lifecycle' }, findingCount: 2, updatesCount: 49,
    packages: [{ name: 'private-package' }], findings: [{ id: 'private-finding' }], updates: [{ name: 'private-update' }], inventory: 'private-report-inventory' };
  t.mock.method(NodeSecurity, 'find', () => assert.fail('list must not load full reports'));
  t.mock.method(NodeSecurity, 'aggregate', async value => {
    pipeline = value;
    return [{ resourceId: 'node-a', status: 'error', checkedAt: now, lastError: 'Source unavailable', inventory: 'private-inventory', leaseToken: 'private-lease', job: 'private-job', report }];
  });
  t.mock.method(NodeSecurity, 'findOne', () => ({ lean: async () => ({ resourceId: 'node-a', status: 'partial', checkedAt: now, report }) }));
  const summaries = await getSummaries(['node-a', 'node-b']);
  assert.deepEqual(pipeline[0].$match, { resourceId: { $in: ['node-a', 'node-b'] } });
  const projected = pipeline[1].$project;
  assert.deepEqual(projected.report.findingCount, { $size: { $ifNull: ['$report.findings', []] } });
  assert.deepEqual(projected.report.updatesCount, { $size: { $ifNull: ['$report.updates', []] } });
  assert.equal(projected.report.packages, undefined);
  assert.equal(projected.report.findings, undefined);
  assert.equal(projected.report.updates, undefined);
  assert.equal(projected.inventory, undefined);
  const summary = summaries.get('node-a');
  assert.equal(summary.findingCount, 2);
  assert.equal(summary.updatesCount, 49);
  assert.equal(summary.version, '8.2.7');
  assert.equal(summary.lifecycle.unsupported, true);
  assert.equal(summary.status, 'error');
  assert.equal(summary.lastError, 'Source unavailable');
  assert.equal(+summary.checkedAt, +now);
  assert.equal(summaries.has('node-b'), false);
  assert.doesNotMatch(JSON.stringify(summary), /private|packages|findings|updates"|inventory|leaseToken|job/);
  const full = await getReport('node-a');
  assert.equal(full.packages.length, 1);
  assert.equal(full.findings.length, 1);
  assert.equal(full.updates.length, 1);
});
