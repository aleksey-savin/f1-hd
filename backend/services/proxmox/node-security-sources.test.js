const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchSources, parseCatalogue, parseRelease, parseLifecycle } = require('./node-security-sources');
const fixture = { totalResults: 2, vulnerabilities: [
  { cve: { id: 'CVE-2026-51083', descriptions: [{ lang: 'en', value: 'Proxmox Virtual Environment incorrect access control.' }] } },
  { cve: { id: 'CVE-2025-12345', descriptions: [{ lang: 'en', value: 'Proxmox Backup Server only.' }] } },
] };
test('public NVD catalogue is supplementary product coverage, never package matching', () => {
  assert.deepEqual(parseCatalogue(fixture).map(p => p.id), ['CVE-2026-51083']);
  assert.throws(() => parseCatalogue({ ...fixture, totalResults: 2001 }), /неполный/);
  assert.throws(() => parseCatalogue({ totalResults: 0, vulnerabilities: [] }), /пуст/);
});
test('latest official release is read dynamically and ignores older releases', () => {
  assert.deepEqual(parseRelease('<h2>Proxmox Virtual Environment 9.2 with Dynamic Load Balancer released</h2><h2>Proxmox VE 8.4 released</h2>'), { latestMajor: 9, latestRelease: '9.2' });
  assert.throws(() => parseRelease('<title>Cloudflare access denied</title>'), /версию/);
});
test('public sources send no local inventory and preserve previous good catalogue on failures', async () => {
  const previous = { latestMajor: 9, latestRelease: '9.1', checkedAt: new Date('2026-01-01'), advisories: [{ id: 'CVE-2026-51083' }], cveCheckedAt: new Date('2026-01-01') };
  const calls = [];
  const report = await fetchSources(previous, async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 503 };
  });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(new URL(call.url).protocol, 'https:');
    assert.doesNotMatch(call.url, /node-internal|8\.2\.7|node-secret-id/);
  }
  assert.deepEqual(report.advisories, previous.advisories);
  assert.equal(report.cveCheckedAt, previous.cveCheckedAt);
  assert.ok(report.cveError);
  assert.ok(report.releaseError);
});

test('latest supported major comes from vendor lifecycle and does not assume a preview is supported', () => {
  assert.equal(parseLifecycle('<p>Proxmox VE 10 First Release: TBA Debian EOL: TBA Proxmox VE EOL: TBA</p><p>Proxmox VE 9 First Release: 2025-08, Debian Version 13 (Trixie), Debian EOL: TBA, Proxmox VE EOL: TBA</p><p>Proxmox VE 8 First Release: 2023-06, Debian EOL: 2026-07, Proxmox VE EOL: 2026-08</p>'), 9);
  assert.throws(() => parseLifecycle('access denied'), /поддержки/);
});

test('successful public reads stamp source dates and update the supported major independently of release news', async () => {
  const { Readable } = require('node:stream');
  const result = await fetchSources({}, async url => ({
    ok: true,
    body: Readable.from([Buffer.from(url.includes('services.nvd.nist.gov') ? JSON.stringify(fixture)
      : url.includes('forum.proxmox.com') ? '<p>Proxmox VE 9 First Release: 2025-08, Debian EOL: TBA, Proxmox VE EOL: TBA</p>'
        : '<h2>Proxmox Virtual Environment 9.2 released</h2>')]),
  }));
  assert.equal(result.latestMajor, 9);
  assert.equal(result.latestRelease, '9.2');
  assert.equal(result.advisories.length, 1);
  assert.ok(result.cveCheckedAt instanceof Date);
  assert.ok(result.lifecycleCheckedAt instanceof Date);
  assert.equal(result.cveError, null);
  assert.equal(result.releaseError, null);
  assert.equal(result.lifecycleError, null);
});
