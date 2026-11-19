const { severityOf } = require('./cve-policy');
// Fedora 42 full fingerprint: B0F4950458F69E1150C6C5EDC8AC4916105EF944.
// Verified against https://fedoraproject.org/security/ on 2026-11-18.
// This is provenance from trusted installed RPM headers, not re-verification
// of payload bytes. Unknown release keys require review.
const FEDORA_KEYS = { '42': 'c8ac4916105ef944' };
const releaseOf = version => /\.fc(\d+)(?:\D|$)/.exec(version)?.[1];
const evaluateFedora = inventory => {
  const { os, packages, fedora } = inventory;
  const installed = new Map(packages.map(p => [JSON.stringify([p.name, p.arch, p.version]), p]));
  const findings = new Map();
  const review = new Map();
  const limitations = [
    'Проверены исправления из Fedora updateinfo; уязвимости без опубликованного исправления и сторонние репозитории не покрыты.',
    'Срок поддержки выпуска и полнота updateinfo не подтверждены; отсутствие совпадений не означает отсутствие уязвимостей.',
  ];
  if (!fedora.metadataAvailable) limitations.push('Метаданные Fedora недоступны или не удалось обновить их через DNF5.');
  if (fedora.metadataError === 'permission_denied') limitations.push('Нет доступа к запуску DNF5 через агент QEMU. Проверьте права гостевого агента.');
  const kernelCovered = false;
  limitations.push('Работающее ядро не подтверждено полным каталогом уязвимостей Fedora.');
  for (const advisory of fedora.advisories) {
    if (!advisory.cves.length) limitations.push(`В бюллетене ${advisory.id} отсутствуют идентификаторы CVE.`);
    for (const p of advisory.packages) {
      const sameRelease = releaseOf(p.version) === os.version && releaseOf(p.fixedVersion) === os.version;
      const signature = installed.get(JSON.stringify([p.name, p.arch, p.version])).signatureKeyId;
      const official = Boolean(FEDORA_KEYS[os.version] && signature === FEDORA_KEYS[os.version]);
      const target = sameRelease && official ? findings : review;
      for (const id of advisory.cves) {
        if (!target.has(id)) target.set(id, {
          id, url: `https://bodhi.fedoraproject.org/updates/${advisory.id}`,
          // An aggregate bulletin rating cannot rate every individual CVE.
          severity: advisory.cves.length === 1 ? severityOf(advisory) : 'unknown',
          packages: [], updates: [],
        });
        const finding = target.get(id);
        if (!finding.packages.some(x => x.name === p.name && x.arch === p.arch && x.version === p.version && x.fixedVersion === p.fixedVersion)) finding.packages.push(p);
        if (!finding.updates.some(x => x.title === advisory.id)) finding.updates.push({ title: advisory.id, kb: [] });
        if (!finding.fixedVersion) finding.fixedVersion = p.fixedVersion;
      }
    }
  }
  if (review.size) limitations.push('Для части совпадений выпуск пакета или подпись официальным ключом Fedora не подтверждены; сторонние и локальные сборки требуют проверки.');
  // Keep uncertain package matches even when another package confirms that CVE.
  return {
    status: 'partial', os, packageCount: packages.length, kernelCovered,
    source: 'Fedora updateinfo · RPM / DNF5', feedUpdatedAt: fedora.checkedAt,
    scope: 'Пакеты Fedora: опубликованные исправления безопасности', limitations,
    findings: [...findings.values()].sort((a, b) => b.id.localeCompare(a.id)),
    reviewFindings: [...review.values()].sort((a, b) => b.id.localeCompare(a.id)), updates: [],
  };
};
module.exports = { evaluateFedora };
