const { severityOf } = require('./cve-policy');
// Curated from the complete "Additional information" component lists on these
// Microsoft wrapper pages, verified 2026-11-18. These are candidate links only:
// even an applicable missing wrapper does not identify the installed framework
// or prove that every fix in its cumulative component is missing.
const base = 'https://support.microsoft.com/en-us/servicing/dotnetframework/';
const bundles = new Map([
  ['5128923', {
    source: `${base}windows-10/1809/2026/10/october-13-2026-5128923`,
    components: [
      { kb: '5127666', source: `${base}windows-10/1809/2026/10/october-13-2026-5127666` },
      { kb: '5127685', source: `${base}windows-10/1809/2026/10/october-13-2026-5127685` },
    ],
  }],
  ['5128928', {
    source: `${base}microsoft-server/2022/2026/10/october-13-2026-5128928`,
    components: [
      { kb: '5127687', source: `${base}microsoft-server/2022/2026/10/october-13-2026-5127687` },
      { kb: '5127693', source: `${base}microsoft-server/2022/2026/10/october-13-2026-5127693` },
    ],
  }],
]);
const rank = value => ['unknown', 'low', 'medium', 'high', 'critical'].indexOf(severityOf(value));
const bundleReviewFindings = (updates, rows) => {
  const catalog = new Map(rows.map(row => [row.kb, row]));
  const findings = new Map();
  for (const update of updates) {
    for (const kb of update.kb) {
      const bundle = bundles.get(kb);
      if (!bundle) continue;
      for (const component of bundle.components) {
        const row = catalog.get(component.kb);
        if (!row) continue; // Unknown catalog coverage is not a CVE identifier.
        for (const id of row.cves) {
          if (update.cves?.includes(id)) continue;
          const rating = row.ratings?.[id] || { severity: 'unknown' };
          if (!findings.has(id)) findings.set(id, {
            id,
            url: `https://msrc.microsoft.com/update-guide/vulnerability/${id}`,
            severity: severityOf(rating),
            ...(rating.score !== undefined ? { score: rating.score } : {}),
            packages: [], updates: [], reason: 'component-applicability-unconfirmed',
          });
          const finding = findings.get(id);
          if (rank(rating) > rank(finding) || (rank(rating) === rank(finding) && (rating.score || 0) > (finding.score || 0))) {
            finding.severity = severityOf(rating);
            delete finding.score;
            if (rating.score !== undefined) finding.score = rating.score;
          }
          if (!finding.updates.some(u => u.kb[0] === kb && u.componentKb === component.kb)) finding.updates.push({
            title: update.title, kb: [kb], componentKb: component.kb,
            source: bundle.source, componentSource: component.source,
            verifiedAt: '2026-11-18',
          });
        }
      }
    }
  }
  return [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));
};
module.exports = { bundleReviewFindings };
