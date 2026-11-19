const { compareDebianVersions } = require('./deb-version');
const { VENDOR_RATINGS } = require('./cve-policy');
const SOURCE = 'https://forum.proxmox.com/threads/proxmox-virtual-environment-security-advisories.149331/page-4';
const RULE = 'CVE-2026-64564';
// PSA-2026-00037-1 names proxmox-kernel-* and fixes for Trixie / Bookworm
// products (not just PVE servers). The patch number is not the branch: 7.0.6
// precedes 7.0.14. Do not extrapolate this curated rule to other kernel series.
const assessProxmoxKernel = inventory => {
  const { os, packages } = inventory;
  if (!os.kernel?.endsWith('-pve')) return null;
  const coverage = {
    kind: 'proxmox-vendor-rules', complete: false, rules: [RULE],
    source: SOURCE, verifiedAt: '2026-11-18T00:00:00.000Z', status: 'unknown',
    note: 'Проверяется только бюллетень Proxmox PSA-2026-00037-1 (SCTPhantom). Полный каталог уязвимостей ядра не проверен; загрузка SCTP и действующие меры защиты неизвестны.',
  };
  const result = { findings: [], reviewFindings: [], coverage };
  const running = /^(7\.0|6\.8)\.\d+-\d+-pve$/.exec(os.kernel);
  const fixed = os.id === 'debian' && running
    ? ({ '13:7.0': '7.0.14-10-pve', '12:6.8': '6.8.12-41-pve' })[`${os.version}:${running[1]}`]
    : null;
  if (!fixed) {
    coverage.note += ' Для этой ветки ядра и выпуска ОС применимость правила не установлена.';
    return result;
  }
  const installed = packages.filter(p => [
    `proxmox-kernel-${os.kernel}`, `proxmox-kernel-${os.kernel}-signed`,
  ].includes(p.name));
  if (!installed.length) {
    coverage.note += ' В инвентаризации отсутствует пакет работающего ядра Proxmox.';
    return result;
  }
  if (compareDebianVersions(os.kernel.slice(0, -4), fixed.slice(0, -4)) >= 0) {
    coverage.status = 'fixed';
    return result;
  }
  coverage.status = 'matched';
  result.findings.push({
    id: RULE, ...VENDOR_RATINGS[RULE], url: SOURCE,
    title: 'Повышение привилегий через SCTP',
    condition: 'Применимость по версии пакета работающего ядра; загрузка модуля SCTP и меры защиты не проверялись.',
    fixedVersion: fixed,
    packages: installed.map(p => ({ ...p, fixedVersion: fixed })), updates: [],
  });
  return result;
};
module.exports = { assessProxmoxKernel };
