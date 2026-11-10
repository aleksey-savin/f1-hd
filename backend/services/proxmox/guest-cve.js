// Guest inventory stays in HD. Only public, release-wide feeds are downloaded.
const { loadFeed, ecosystemsFor } = require("./guest-cve-feed");
const { affectedByRanges, compareDebianVersions } = require("./deb-version");
const { severityOf } = require('./cve-policy');
const severityRank = finding => ['unknown', 'low', 'medium', 'high', 'critical'].indexOf(severityOf(finding));
const queryLinux = async (inventory, { load = loadFeed } = {}) => {
  const feed = await load({
    id: inventory.os.id,
    version: inventory.os.version,
  });
  const bySource = new Map();
  for (const p of inventory.packages) {
    if (!bySource.has(p.source)) bySource.set(p.source, []);
    bySource.get(p.source).push(p);
  }
  const findings = new Map(),
    review = new Map();
  for (const row of feed.rows) {
    const packages = (bySource.get(row.source) || []).filter(
      (p) =>
        (!/^linux(?:$|-(?:signed|hwe|aws|azure|gcp|oem|generic|lowlatency|kvm|raspi)(?:-|$))/.test(
          row.source,
        ) ||
          /^linux-(?:image|modules)(?:-|$)/.test(p.name)) &&
        affectedByRanges(p.sourceVersion, row.ranges),
    );
    if (!packages.length) continue;
    const binaryScope =
      row.source === "qemu" &&
      packages.every((p) => p.name === "qemu-guest-agent");
    const vendorVariant = packages.some((p) =>
      /[+~.-](?:pmx|pve)\d/.test(p.sourceVersion),
    );
    const target =
      row.review || binaryScope || vendorVariant ? review : findings;
    if (!target.has(row.id))
      target.set(row.id, {
        id: row.id,
        url:
          inventory.os.id === "debian"
            ? `https://security-tracker.debian.org/tracker/${row.id}`
            : `https://ubuntu.com/security/${row.id}`,
        severity: row.severity,
        packages: [],
        updates: [],
      });
    const finding = target.get(row.id);
    if (severityRank(row) > severityRank(finding)) finding.severity = row.severity;
    for (const p of packages) {
      const fixed =
        row.ranges
          .flatMap((r) => r.events)
          .filter(
            (e) =>
              e.fixed && compareDebianVersions(p.sourceVersion, e.fixed) < 0,
          )
          .map((e) => e.fixed)
          .sort(compareDebianVersions)[0] || null;
      if (
        !finding.packages.some(
          (x) => x.name === p.name && x.version === p.version,
        )
      )
        finding.packages.push({ ...p, fixedVersion: fixed });
      if (fixed && !finding.fixedVersion) finding.fixedVersion = fixed;
    }
  }
  for (const id of findings.keys()) review.delete(id);
  const order = (a, b) => b.id.localeCompare(a.id);
  const kernelPackages = inventory.packages.filter((p) =>
    [
      `linux-image-${inventory.os.kernel}`,
      `linux-image-unsigned-${inventory.os.kernel}`,
      `linux-modules-${inventory.os.kernel}`,
      `linux-modules-extra-${inventory.os.kernel}`,
    ].includes(p.name),
  );
  const kernelCovered = Boolean(
    inventory.os.kernel &&
      kernelPackages.some((p) =>
        feed.rows.some((row) => row.source === p.source),
      ),
  );
  return {
    status: kernelCovered ? "completed" : "partial",
    kernelCovered,
    os: inventory.os,
    packageCount: inventory.packages.length,
    source: feed.source,
    feedUpdatedAt: feed.fetchedAt,
    scope: "Пакеты гостевой ОС",
    findings: [...findings.values()].sort(order),
    reviewFindings: [...review.values()].sort(order),
    updates: [],
  };
};
const evaluateWindows = (inventory) => {
  const findings = new Map();
  for (const u of [...inventory.updates, ...(inventory.baselineUpdates || [])])
    for (const id of u.cves) {
      const rating = u.cveRatings?.[id] || { severity: 'unknown' };
      if (!findings.has(id))
        findings.set(id, {
          id,
          url: `https://msrc.microsoft.com/update-guide/vulnerability/${id}`,
          ...rating,
          packages: [],
          updates: [],
        });
      else if (severityRank(rating) > severityRank(findings.get(id)))
        Object.assign(findings.get(id), rating);
      findings.get(id).updates.push({ title: u.title, kb: u.kb });
    }
  return {
    status:
      inventory.baselineCovered !== true ||
      inventory.rebootRequired ||
      inventory.updates.some((u) => u.security && !u.cves.length)
        ? "partial"
        : "completed",
    source: "Windows Update · Microsoft MSRC",
    scope: "Сборка Windows и недостающие обновления",
    baselineCovered: inventory.baselineCovered === true,
    rebootRequired: inventory.rebootRequired || false,
    os: inventory.os,
    packageCount: 0,
    findings: [...findings.values()].sort((a, b) => b.id.localeCompare(a.id)),
    updates: inventory.updates,
  };
};
module.exports = { queryLinux, evaluateWindows, ecosystemsFor };
