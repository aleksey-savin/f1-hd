const test = require('node:test');
const assert = require('node:assert/strict');
const { bundleReviewFindings } = require('./windows-kb-bundles');
const update = (kb) => ({ title: `Missing KB${kb}`, kb: [kb], cves: [], security: true });
const row = (kb, id, rating = { severity: 'high', score: 8.1 }) => ({ kb, cves: [id], ratings: { [id]: rating } });

test('missing official wrapper produces review evidence only from published component CVEs', () => {
  const findings = bundleReviewFindings([update('5128923')], [row('5127666', 'CVE-2026-12345'), row('5127685', 'CVE-2026-12346')]);
  assert.deepEqual(findings.map(f => f.id), ['CVE-2026-12345', 'CVE-2026-12346']);
  for (const f of findings) {
    assert.equal(f.reason, 'component-applicability-unconfirmed');
    assert.equal(f.severity, 'high');
    assert.equal(f.score, 8.1);
    assert.deepEqual(f.packages, []);
    assert.deepEqual(f.updates[0].kb, ['5128923']);
    assert.match(f.updates[0].source, /^https:\/\/support\.microsoft\.com\/en-us\/servicing\//);
    assert.match(f.url, /^https:\/\/msrc\.microsoft\.com\/update-guide\/vulnerability\/CVE-/);
  }
  assert.equal(findings[0].updates[0].componentKb, '5127666');
});
test('unrelated, absent wrappers and missing component catalog never invent CVEs', () => {
  const rows = [row('5127666', 'CVE-2026-12345')];
  assert.deepEqual(bundleReviewFindings([update('1234567')], rows), []);
  assert.deepEqual(bundleReviewFindings([], rows), []);
  assert.deepEqual(bundleReviewFindings([update('5128928')], rows), []);
  assert.deepEqual(bundleReviewFindings([update('5128923')], []), []);
});
test('server 2022 wrapper keeps both official component candidates and strongest individual rating without mutation', () => {
  const updates = [update('5128928')];
  const rows = [row('5127687', 'CVE-2026-12345', { severity: 'medium', score: 5.5 }), row('5127693', 'CVE-2026-12345', { severity: 'critical', score: 9.8 })];
  const before = JSON.stringify({ updates, rows });
  const [finding] = bundleReviewFindings(updates, rows);
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.score, 9.8);
  assert.deepEqual(finding.updates.map(u => u.componentKb), ['5127687', '5127693']);
  assert.equal(JSON.stringify({ updates, rows }), before);
  assert.equal(updates[0].cves.length, 0);
});
test('component without an individual rating stays unknown and keeps its source date', () => {
  const [finding] = bundleReviewFindings([update('5128923')], [{ kb: '5127666', cves: ['CVE-2026-12345'] }]);
  assert.equal(finding.severity, 'unknown');
  assert.equal(finding.updates[0].verifiedAt, '2026-11-18');
  assert.match(finding.updates[0].componentSource, /5127666$/);
});
test('a CVE already proven for the same update is not repeated as an uncertain component',()=>{
  assert.deepEqual(bundleReviewFindings([{title:'known',kb:['5128923'],cves:['CVE-2026-12345']}],[{kb:'5127666',cves:['CVE-2026-12345']}]),[]);
});
