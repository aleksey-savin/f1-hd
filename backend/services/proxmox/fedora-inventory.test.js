const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const nativeRpm = spawnSync('/usr/bin/python3', ['-c', 'import rpm']).status === 0;
const test = (name, fn) => nodeTest(name, { skip: nativeRpm ? false : 'Native RPM integration requires python3-rpm on the test host' }, fn);
const { collectorForFedora, parseFedoraInventory } = require('./fedora-inventory');
const { evaluateFedora } = require('./fedora-cve');
const os = { id: 'fedora', 'version-id': '42', 'pretty-name': 'Fedora Linux 42', 'kernel-release': '6.8.1-1.fc39.x86_64' };
const packageRows = [
  'openssl\t1\t3.2.1\t1.fc42\tx86_64\topenssl-3.2.1-1.fc42.src.rpm',
  'openssl\t1\t3.2.9\t1.fc42\ti686\topenssl-3.2.9-1.fc42.src.rpm',
  'kernel-core\t0\t6.8.1\t1.fc39\tx86_64\tkernel-6.8.1-1.fc39.src.rpm',
];
const advisory = (nevra = 'openssl-1:3.2.2-1.fc42.x86_64') => ({
  Name: 'FEDORA-2026-abcdef0123', Type: 'security', Severity: 'Important',
  references: [{ Id: 'CVE-2026-12345', Type: 'cve' }], collections: { packages: [nevra] },
});
// Execute the exact guest program, replacing only process I/O. RPM comparisons
// use the host's native librpm (not a JavaScript approximation).
function collect(advisories, rows = packageRows, failure = false) {
  const script = collectorForFedora()[2].split("<<'HD_FEDORA_PY'\n")[1].split('\nHD_FEDORA_PY')[0];
  const headers = rows.map(row => Object.fromEntries(['name', 'epoch', 'version', 'release', 'arch', 'sourcerpm'].map((key, i) => [key, row.split('\t')[i]])));
  const harness = `import subprocess, json, rpm\nfrom types import SimpleNamespace\nfixture_headers=json.loads(${JSON.stringify(JSON.stringify(headers))})\nclass Header(dict):\n    def sprintf(self, fmt): return 'RSA/SHA256, Wed 18 Nov 2026, Key ID c8ac4916105ef944'\nrpm.TransactionSet=lambda: SimpleNamespace(dbMatch=lambda: iter(Header(h) for h in fixture_headers))\nfixture_advisories=${JSON.stringify(JSON.stringify(advisories))}\ndef run(args, **kwargs):\n    if args[0] in ('rpm', '/usr/bin/rpm'): raise PermissionError(13, 'Permission denied', args[0])\n    ${failure === 'permission' ? "raise PermissionError(13, 'Permission denied', args[0])" : failure ? "raise subprocess.CalledProcessError(1,args)" : 'return SimpleNamespace(stdout=fixture_advisories,returncode=0)'}\nsubprocess.run=run\nexec(${JSON.stringify(script)})`;
  const result = spawnSync('/usr/bin/python3', ['-c', harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return parseFedoraInventory(os, result.stdout);
}
test('Fedora 42 dnf5 5.2 dictionary and newer arrays produce the same findings', () => {
  for (const feed of [{ 'FEDORA-2026-abcdef0123': advisory() }, [advisory()]]) {
    const report = evaluateFedora(collect(feed));
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].packages.length, 1);
    assert.equal(report.findings[0].packages[0].version, '1:3.2.1-1.fc42');
    assert.equal(report.findings[0].packages[0].arch, 'x86_64');
    assert.equal(report.findings[0].packages[0].fixedVersion, '1:3.2.2-1.fc42');
    assert.equal(report.kernelCovered, false);
    assert.equal(report.status, 'partial');
  }
});
test('native RPM epoch, tilde, caret and release comparisons reject already fixed packages', () => {
  const cases = [
    ['2', '1.0', '1.fc42', 'openssl-1:9.0-9.fc42.x86_64', false],
    ['0', '1.0~rc1', '1.fc42', 'openssl-1.0-1.fc42.x86_64', true],
    ['0', '1.0^git1', '1.fc42', 'openssl-1.0-1.fc42.x86_64', false],
    ['0', '1.0', '10.fc42', 'openssl-1.0-2.fc42.x86_64', false],
    ['0', '1.0', '1.fc42', 'openssl-1.0-1.fc42.x86_64', false],
  ];
  for (const [epoch, version, release, fixed, affected] of cases) {
    const report = evaluateFedora(collect([advisory(fixed)], [`openssl\t${epoch}\t${version}\t${release}\tx86_64\topenssl.src.rpm`]));
    assert.equal(report.findings.length > 0, affected, fixed);
  }
});
test('old Fedora kernel and foreign release packages never become confirmed current-release CVEs', () => {
  const report = evaluateFedora(collect([advisory('kernel-core-6.16.1-1.fc42.x86_64')]));
  assert.equal(report.findings.length, 0);
  assert.equal(report.reviewFindings.length, 1);
  assert.equal(report.kernelCovered, false);
});
test('failed or empty metadata cannot yield a clean report', () => {
  for (const inventory of [collect([]), collect([], packageRows, true)]) {
    const report = evaluateFedora(inventory);
    assert.equal(report.status, 'partial');
    assert.ok(report.limitations.length);
  }
});
test('boundary rejects invalid schema, package identity and unmatched advisory package', () => {
  assert.throws(() => parseFedoraInventory(os, '{}'));
  const inventory = collect([advisory()]);
  const raw = { schema: 1, packages: inventory.packages, fedora: inventory.fedora };
  raw.packages[0].name = 'bad\nname';
  assert.throws(() => parseFedoraInventory(os, JSON.stringify(raw)));
});

test('RPM inventory does not spawn rpm and denied DNF preserves inventory with explicit limitation', () => {
  const result = collect([], packageRows, 'permission');
  assert.equal(result.packages.length, 3);
  assert.equal(result.fedora.metadataError, 'permission_denied');
  assert.ok(evaluateFedora(result).limitations.some(text => /Нет доступа.*DNF5/.test(text)));
});

test('native RPM database failure emits a bounded structured error', () => {
  const script = collectorForFedora()[2].split("<<'HD_FEDORA_PY'\n")[1].split('\nHD_FEDORA_PY')[0];
  const harness = `import rpm\ndef denied(): raise rpm.error('rpmdb open failed')\nrpm.TransactionSet=denied\nexec(${JSON.stringify(script)})`;
  const result = spawnSync('/usr/bin/python3', ['-c', harness], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { schema: 1, errorCode: 'RPM_DATABASE_UNAVAILABLE' });
});
