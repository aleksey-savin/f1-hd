const { NodeSecuritySource } = require('../../models/proxmoxNodeSecurity');
const RELEASE_URL = 'https://www.proxmox.com/en/about/company-details/press-releases';
// A public whole-product catalogue, not a remote inventory matching endpoint.
const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=Proxmox&resultsPerPage=2000';
const LIFECYCLE_URL = 'https://forum.proxmox.com/threads/proxmox-ve-support-lifecycle.35755/';
const SIX_HOURS = 6 * 3600000;
const parseRelease = html => {
  const releases = [...html.replace(/<[^>]*>/g, ' ').matchAll(/Proxmox\s+(?:Virtual\s+Environment|VE)\s+(\d+)\.(\d+)/gi)]
    .map(m => ({ major: Number(m[1]), minor: Number(m[2]) }))
    .sort((a, b) => b.major - a.major || b.minor - a.minor);
  if (!releases.length) throw new Error('Не удалось определить версию на сайте Proxmox');
  return { latestMajor: releases[0].major, latestRelease: `${releases[0].major}.${releases[0].minor}` };
};
const parseLifecycle = html => {
  const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const supported = [...plain.matchAll(/Proxmox VE (\d+) First Release:\s*(\d{4}-\d{2})[^]*?Proxmox VE EOL:\s*(TBA|\d{4}-\d{2})/g)]
    .filter(match => match[3] === 'TBA')
    .map(match => Number(match[1]));
  if (!supported.length) throw new Error('Не удалось прочитать сроки поддержки Proxmox');
  return Math.max(...supported);
};
const parseCatalogue = data => {
  if (!Array.isArray(data.vulnerabilities) || !Number.isSafeInteger(data.totalResults) || data.totalResults > 2000 || data.vulnerabilities.length !== data.totalResults)
    throw new Error('NVD вернул неполный каталог CVE');
  if (!data.totalResults) throw new Error('NVD вернул пустой каталог CVE');
  const records = [];
  for (const row of data.vulnerabilities) {
    const cve = row.cve;
    if (!/^CVE-\d{4}-\d{4,}$/.test(cve?.id || '') || !Array.isArray(cve.descriptions)) throw new Error('Некорректный бюллетень NVD');
    if (cve.vulnStatus === 'Rejected') continue;
    const description = cve.descriptions.find(d => d.lang === 'en')?.value || '';
    if (/proxmox\s+(?:virtual\s+environment|ve\b)/i.test(description)) records.push({ id: cve.id });
  }
  if (!records.length) throw new Error('В каталоге NVD не найдены бюллетени Proxmox VE');
  return records;
};
const readPublic = async (url, fetcher) => {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: url === NVD_URL ? 'application/json' : 'text/html' } });
  if (!response.ok) throw new Error(`Источник недоступен (HTTP ${response.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      // for-await closes the response stream when the size bound is exceeded.
      throw new Error('Слишком большой ответ источника');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};
const fetchSources = async (previous = {}, fetcher = fetch) => {
  const [release, catalogue, lifecycle] = await Promise.allSettled([
    readPublic(RELEASE_URL, fetcher).then(parseRelease),
    readPublic(NVD_URL, fetcher).then(text => parseCatalogue(JSON.parse(text))),
    readPublic(LIFECYCLE_URL, fetcher).then(parseLifecycle),
  ]);
  const now = new Date();
  return {
    ...previous,
    ...(release.status === 'fulfilled' ? { latestRelease: release.value.latestRelease, checkedAt: now, releaseError: null } : { releaseError: 'Не удалось обновить сведения о выпусках Proxmox; показаны предыдущие данные, если они есть' }),
    ...(lifecycle.status === 'fulfilled' ? { latestMajor: lifecycle.value, lifecycleCheckedAt: now, lifecycleError: null } : { lifecycleError: 'Не удалось обновить сроки поддержки Proxmox; показаны последние проверенные сведения' }),
    ...(catalogue.status === 'fulfilled' ? { advisories: catalogue.value, cveCheckedAt: now, cveError: null } : { cveError: 'Не удалось обновить публичный каталог CVE Proxmox VE; проверены только встроенные правила бюллетеней' }),
  };
};
let pending;
const loadSources = async () => {
  if (pending) return pending;
  pending = (async () => {
    const cached = await NodeSecuritySource.findById('public-host-catalogue').select('+data').lean();
    if (cached && Date.now() - new Date(cached.checkedAt) < SIX_HOURS) return cached.data;
    const data = await fetchSources(cached?.data);
    await NodeSecuritySource.updateOne({ _id: 'public-host-catalogue' }, { $set: { data, checkedAt: new Date() } }, { upsert: true });
    return data;
  })();
  try { return await pending; } finally { pending = null; }
};
module.exports = { loadSources, fetchSources, parseRelease, parseCatalogue, parseLifecycle };
