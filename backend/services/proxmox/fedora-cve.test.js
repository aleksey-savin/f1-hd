const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFedoraInventory, collectorForFedora } = require('./fedora-inventory');
const { evaluateFedora } = require('./fedora-cve');
const os = { id: 'fedora', 'version-id': '42', 'kernel-release': '6.8.1-1.fc39.x86_64' };
const pkg = { signatureKeyId: 'c8ac4916105ef944', name: 'openssl', version: '1:3.2.1-1.fc42', arch: 'x86_64', source: 'openssl-3.2.1-1.fc42.src.rpm', sourceVersion: '1:3.2.1-1.fc42' };
const data = () => ({ schema: 1, packages: [{ ...pkg }], fedora: { checkedAt: '2026-11-18T01:00:00Z', metadataAvailable: true, advisories: [{ id: 'FEDORA-2026-abcdef1234', cves: ['CVE-2026-12345'], severity: 'Important', packages: [{ ...pkg, fixedVersion: '1:3.2.2-1.fc42' }] }] } });
const report = raw => evaluateFedora(parseFedoraInventory(os, JSON.stringify(raw)));
test('multiple CVEs do not inherit aggregate bulletin severity', () => {
  const raw = data();
  raw.fedora.advisories[0].cves.push('CVE-2026-54321');
  assert.deepEqual(report(raw).findings.map(f => f.severity), ['unknown', 'unknown']);
});
test('missing CVE references retain a visible coverage limitation', () => {
  const raw = data();
  raw.fedora.advisories[0].cves = [];
  const actual = report(raw);
  assert.equal(actual.status, 'partial');
  assert.ok(actual.limitations.some(s => s.includes('отсутствуют идентификаторы CVE')));
});
test('schema rejects fabricated package matches, failed metadata with results and oversize payloads', () => {
  const raw = data();
  raw.fedora.advisories[0].packages[0].arch = 'aarch64';
  assert.throws(() => report(raw));
  const failed = data();
  failed.fedora.metadataAvailable = false;
  assert.throws(() => report(failed));
  assert.throws(() => parseFedoraInventory(os, ' '.repeat(2 * 1024 * 1024 + 1)));
});
test('collector command is fixed and cannot interpolate requested guest data', () => {
  assert.deepEqual(collectorForFedora({ id: '$(touch bad)' }), collectorForFedora());
});

test('native collector errors explain missing RPM access or bindings without asserting a policy cause', () => {
  assert.throws(() => parseFedoraInventory(os, JSON.stringify({ schema: 1, errorCode: 'RPM_DATABASE_UNAVAILABLE' })), /Не удалось прочитать базу RPM через агент QEMU/);
  assert.throws(() => parseFedoraInventory(os, JSON.stringify({ schema: 1, errorCode: 'RPM_BINDINGS_UNAVAILABLE' })), /модуль Python rpm/);
  assert.throws(() => parseFedoraInventory(os, JSON.stringify({ schema: 1, errorCode: 'untrusted message' })), /Некорректный ответ/);
});

test('release suffix cannot confirm unsigned or COPR replacements as official Fedora packages', () => {
  assert.equal(report(data()).findings.length, 1);
  for (const signatureKeyId of [null, undefined, '1234567890abcdef', '105ef944']) {
    const raw = data();
    raw.packages[0].signatureKeyId = signatureKeyId;
    if (signatureKeyId === '105ef944') { assert.throws(() => report(raw)); continue; }
    const actual = report(raw);
    assert.equal(actual.findings.length, 0);
    assert.equal(actual.reviewFindings.length, 1);
    assert.ok(actual.limitations.some(text => text.includes('подпись')));
  }
});
