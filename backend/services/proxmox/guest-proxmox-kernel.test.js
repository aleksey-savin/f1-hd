const test = require('node:test');
const assert = require('node:assert/strict');
const { assessProxmoxKernel } = require('./guest-proxmox-kernel');
const inventory = (kernel = '7.0.6-2-pve', version = '13') => ({
  os: { id: 'debian', version, kernel },
  packages: [{ name: `proxmox-kernel-${kernel}-signed`, version: kernel.replace('-pve', ''), source: 'proxmox-kernel-7.0', sourceVersion: kernel.replace('-pve', '') }],
});
test('PBS on Trixie with installed running 7.0.6 kernel matches vendor SCTP rule', () => {
  const result = assessProxmoxKernel(inventory());
  assert.equal(result.findings[0].id, 'CVE-2026-64564');
  assert.equal(result.findings[0].packages[0].name, 'proxmox-kernel-7.0.6-2-pve-signed');
  assert.equal(result.findings[0].fixedVersion, '7.0.14-10-pve');
  assert.equal(result.coverage.status, 'matched');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.kernelCovered, undefined);
});
test('fixed threshold and later patch versions have no match but only limited coverage', () => {
  for (const kernel of ['7.0.14-10-pve', '7.0.14-11-pve', '7.0.15-1-pve']) {
    const result = assessProxmoxKernel(inventory(kernel));
    assert.deepEqual(result.findings, []);
    assert.equal(result.coverage.status, 'fixed');
    assert.equal(result.coverage.complete, false);
  }
  assert.equal(assessProxmoxKernel(inventory('7.0.14-9-pve')).findings.length, 1);
});
test('Bookworm branch applies its own vendor threshold with numeric Debian comparison', () => {
  assert.equal(assessProxmoxKernel(inventory('6.8.12-9-pve', '12')).findings.length, 1);
  assert.equal(assessProxmoxKernel(inventory('6.8.12-41-pve', '12')).coverage.status, 'fixed');
});
test('other branches, mismatched distro and malformed PVE versions remain unknown', () => {
  for (const [kernel, version] of [['7.1.1-1-pve', '13'], ['6.8.12-9-pve', '13'], ['7.0.6-2-pve', '12'], ['custom-pve', '13']]) {
    const result = assessProxmoxKernel(inventory(kernel, version));
    assert.equal(result.coverage.status, 'unknown');
    assert.deepEqual(result.findings, []);
  }
});
test('missing matching package never confirms vulnerability from uname alone', () => {
  const input = inventory();
  input.packages = inventory('7.0.14-10-pve').packages;
  assert.equal(assessProxmoxKernel(input).coverage.status, 'unknown');
  assert.deepEqual(assessProxmoxKernel(input).findings, []);
});
test('unsigned installed kernel is supported; non-PVE kernels do not enter vendor assessment', () => {
  const input = inventory();
  input.packages[0].name = 'proxmox-kernel-7.0.6-2-pve';
  assert.equal(assessProxmoxKernel(input).findings.length, 1);
  input.os.kernel = '6.12.50-amd64';
  assert.equal(assessProxmoxKernel(input), null);
});
