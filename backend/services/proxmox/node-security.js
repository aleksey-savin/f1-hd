const { randomUUID } = require('node:crypto');
const { NodeSecurity } = require('../../models/proxmoxNodeSecurity');
const { Resource, Connection } = require('../../models/proxmox');
const { compareDebianVersions } = require('./deb-version');
const { request } = require('./transport');
const { fail, publicError } = require('./policy');
const { applyCvePolicy, severityCountsProjection, VENDOR_RATINGS } = require('./cve-policy');
const LIFECYCLE_URL = 'https://forum.proxmox.com/threads/proxmox-ve-support-lifecycle.35755/';
const ADVISORY_URL = 'https://forum.proxmox.com/threads/proxmox-virtual-environment-security-advisories.149331/';
const active = ['queued', 'checking'];
const daily = 24 * 3600000;
const publicView = (scan, prefs) => scan ? applyCvePolicy({
  ...scan.report,
  status: scan.status,
  requestedAt: scan.requestedAt,
  checkedAt: scan.checkedAt,
  lastError: scan.lastError || null,
}, prefs) : null;
const packagesFrom = rows => {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('API вернул некорректный список пакетов');
  const result = new Map();
  for (const row of rows) {
    if (row.CurrentState && row.CurrentState !== 'Installed') continue;
    if (typeof row.Package !== 'string' || !/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?$/.test(row.Package))
      throw new Error('API вернул некорректное имя пакета');
    const installed = row.OldVersion || row.Version;
    compareDebianVersions(installed, row.Version);
    result.set(row.Package, { name: row.Package, installed, candidate: row.Version });
  }
  return [...result.values()];
};
const upgraded = p => compareDebianVersions(p.candidate, p.installed) > 0;
const collectNode = async (resource, connection, deps = {}) => {
  const call = deps.request || request;
  const base = `/nodes/${encodeURIComponent(resource.nodeName)}`;
  // The transport timeout starts after a routed lane opens. This deadline also
  // bounds waiting for that lane and aborts the eventual queued GET.
  const read = async path => {
    const timeout = deps.timeout || 8000;
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        call(connection, path, { method: 'GET', timeout, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('Истекло время чтения API Proxmox');
            controller.abort(error);
            reject(error);
          }, timeout);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  // Explicit GETs only: do not update the node's APT indexes or change packages.
  const versions = await read(`${base}/apt/versions`);
  const packages = packagesFrom(versions);
  if (!packages.some(p => p.name === 'pve-manager')) throw new Error('API не вернул установленный pve-manager');
  let updates, updatesComplete = true, updatesError = null;
  try {
    updates = packagesFrom(await read(`${base}/apt/update`)).filter(upgraded);
  } catch (error) {
    // /apt/versions returns candidates for the PVE subset even without Sys.Modify.
    updates = packages.filter(upgraded);
    updatesComplete = false;
    updatesError = /HTTP 403/.test(error.message)
      ? 'Для полного списка обновлений токену не хватает права Sys.Modify. Показаны кандидаты пакетов Proxmox из apt/versions'
      : 'Полный список обновлений недоступен. Показаны кандидаты пакетов Proxmox из apt/versions';
  }
  let runningKernel = versions.find(row => typeof row.RunningKernel === 'string')?.RunningKernel || null;
  let kernelError = null;
  try {
    const status = await read(`${base}/status`);
    const raw = status?.['current-kernel']?.release || status?.kversion;
    if (typeof raw === 'string') runningKernel = raw.match(/(?:Linux\s+)?(\d[^\s]*-pve)(?:\s|$)/)?.[1] || runningKernel;
  } catch {
    if (!runningKernel) kernelError = 'API не вернул версию работающего ядра';
  }
  return { packages, updates, updatesComplete, updatesError, runningKernel, kernelError };
};
const evaluateNode = (inventory, sources, now = new Date()) => {
  const manager = inventory.packages.find(p => p.name === 'pve-manager');
  const version = manager?.installed || null;
  const major = Number(version?.match(/^(?:\d+:)?(\d+)\./)?.[1]);
  const eol = { 1: '2013-01', 2: '2014-05', 3: '2017-02', 4: '2018-06', 5: '2020-07', 6: '2022-09', 7: '2024-07', 8: '2026-08' }[major];
  const lifecycle = {
    unsupported: eol ? now.toISOString().slice(0, 7) > eol : major === 9 ? false : null,
    eolAt: eol || null,
    // Vendor publishes a month, not an exact final support day.
    precision: eol ? 'month' : null,
    source: LIFECYCLE_URL,
    verifiedAt: '2026-11-10',
    lastCheckedAt: sources.lifecycleCheckedAt || null,
    lastError: sources.lifecycleError || null,
  };
  const findings = [];
  const qemu = inventory.packages.find(p => p.name === 'qemu-server');
  const qemuMajor = qemu?.installed.match(/^(?:\d+:)?([89])\./)?.[1];
  const fixed = { 8: '8.4.8', 9: '9.1.8' }[qemuMajor];
  if (fixed && compareDebianVersions(qemu.installed, fixed) < 0) findings.push({
    id: 'CVE-2026-51083', ...VENDOR_RATINGS['CVE-2026-51083'], title: 'Раскрытие хешей паролей cloud-init', package: 'qemu-server',
    installed: qemu.installed, fixed, condition: 'Пользователь с ограниченными правами может получить хеш пароля через cloudinit/dump',
    url: `${ADVISORY_URL}page-2`,
  });
  const kernel = inventory.runningKernel?.match(/^(6\.8\.12|7\.0\.14)-(\d+)-pve$/);
  const kernelFixed = kernel ? { '6.8.12': '6.8.12-41', '7.0.14': '7.0.14-10' }[kernel[1]] : null;
  if (kernelFixed && compareDebianVersions(`${kernel[1]}-${kernel[2]}`, kernelFixed) < 0) findings.push({
    id: 'CVE-2026-64564', ...VENDOR_RATINGS['CVE-2026-64564'], title: 'Повышение привилегий через SCTP', package: 'Работающее ядро Proxmox',
    installed: inventory.runningKernel, fixed: `${kernelFixed}-pve`,
    condition: 'Для атаки нужен SCTP; загрузка модуля на узле не проверялась', url: `${ADVISORY_URL}page-4`,
  });
  return {
    ...inventory, status: 'partial', version, latestVersion: manager?.candidate || null,
    latestMajor: sources.latestMajor || null, latestRelease: sources.latestRelease || null,
    releaseCheckedAt: sources.checkedAt || null, releaseError: sources.releaseError || null,
    lifecycle, findings, cveCheckedAt: sources.cveCheckedAt || null,
    cveError: sources.cveError || null,
    coverage: {
      complete: false, kind: 'vendor-package-rules', rules: ['CVE-2026-51083', 'CVE-2026-64564'],
      runningKernel: Boolean(kernel),
      unassessedAdvisories: sources.cveCheckedAt ? (sources.advisories || []).filter(a => !['CVE-2026-51083', 'CVE-2026-64564'].includes(a.id)).length : null,
      note: 'Проверены только отдельные бюллетени Proxmox. Каталог CVE продукта не сопоставляется с пакетами. Это не результат полной проверки безопасности хоста; отсутствие совпадений не подтверждает безопасность',
    },
    source: { packages: 'Proxmox API: apt/versions; apt/update (кэш узла, без обновления индексов)', advisories: ADVISORY_URL, catalogue: 'https://nvd.nist.gov/', lifecycle: LIFECYCLE_URL },
  };
};
const advanceScan = async (_scan, resource, connection, deps = {}) => {
  const save = deps.save;
  if (!resource || resource.archived || resource.monitoringEnabled === false || resource.kind !== 'node' || !connection || connection.archived || !connection.monitoringEnabled)
    return save({ status: 'unavailable', lastError: 'Для проверки нужен узел с включённым мониторингом подключения' });
  try {
    const inventory = await collectNode(resource, connection, deps);
    const sources = await (deps.loadSources || require('./node-security-sources').loadSources)();
    const report = evaluateNode(inventory, sources);
    await save({ status: 'partial', report, checkedAt: new Date(), lastError: null });
  } catch (error) {
    await save({ status: 'error', lastError: publicError(error) });
  }
};
const refresh = async resource => {
  if (resource.monitoringEnabled === false) fail('Мониторинг узла выключен', 422);
  if (resource.kind !== 'node' || resource.archived) fail('Проверка безопасности доступна для хостов Proxmox', 422);
  await NodeSecurity.init();
  try {
    await NodeSecurity.updateOne({ resourceId: resource._id }, { $setOnInsert: { status: 'error' } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  await NodeSecurity.updateOne({ resourceId: resource._id, status: { $nin: active } }, {
    $set: { status: 'queued', requestedAt: new Date(), lastError: null },
    $unset: { leaseToken: '', leaseUntil: '' },
  });
  require('./core').bump();
  return getReport(resource._id);
};
const processScan = async (id, deps = {}) => {
  const token = randomUUID();
  const scan = await NodeSecurity.findOneAndUpdate({ _id: id, status: { $in: active }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] }, {
    $set: { status: 'checking', leaseToken: token, leaseUntil: new Date(Date.now() + 3 * 60000) },
  }, { returnDocument: 'after' }).lean();
  if (!scan) return;
  const save = async patch => {
    const result = await NodeSecurity.updateOne({ _id: id, leaseToken: token }, { $set: patch });
    if (!result.matchedCount) throw new Error('Проверка передана другому обработчику');
  };
  try {
    const resource = await Resource.findById(scan.resourceId).lean();
    const connection = resource ? await Connection.findById(resource.connectionId).select('+tokenSecret').lean() : null;
    await advanceScan(scan, resource, connection, { ...deps, save });
  } finally {
    await NodeSecurity.updateOne({ _id: id, leaseToken: token }, { $unset: { leaseToken: '', leaseUntil: '' } });
    require('./core').bump();
  }
};
const getReport = async (resourceId, prefs) => publicView(await NodeSecurity.findOne({ resourceId }).lean(), prefs);
const getSummaries = async (resourceIds, prefs) => {
  if (!resourceIds.length) return new Map();
  // Aggregate counts in MongoDB so fleet lists never load package inventories
  // or vulnerability/update arrays into application memory.
  const rows = await NodeSecurity.aggregate([
    { $match: { resourceId: { $in: resourceIds } } },
    { $project: {
      resourceId: 1, status: 1, requestedAt: 1, checkedAt: 1, lastError: 1,
      report: {
        version: '$report.version', latestVersion: '$report.latestVersion', latestMajor: '$report.latestMajor', latestRelease: '$report.latestRelease',
        lifecycle: {
          unsupported: '$report.lifecycle.unsupported', eolAt: '$report.lifecycle.eolAt', precision: '$report.lifecycle.precision',
          source: '$report.lifecycle.source', verifiedAt: '$report.lifecycle.verifiedAt', lastCheckedAt: '$report.lifecycle.lastCheckedAt', lastError: '$report.lifecycle.lastError',
        },
        updatesComplete: '$report.updatesComplete', cveCheckedAt: '$report.cveCheckedAt', cveError: '$report.cveError',
        findingCount: { $size: { $ifNull: ['$report.findings', []] } },
        severityCounts: severityCountsProjection(),
        updatesCount: { $size: { $ifNull: ['$report.updates', []] } },
      },
    } },
  ]);
  return new Map(rows.map(row => {
    const report = row.report || {}, lifecycle = report.lifecycle || {};
    return [String(row.resourceId), applyCvePolicy({
      status: row.status, requestedAt: row.requestedAt, checkedAt: row.checkedAt, lastError: row.lastError || null,
      version: report.version, latestVersion: report.latestVersion, latestMajor: report.latestMajor, latestRelease: report.latestRelease,
      lifecycle: {
        unsupported: lifecycle.unsupported, eolAt: lifecycle.eolAt, precision: lifecycle.precision,
        source: lifecycle.source, verifiedAt: lifecycle.verifiedAt, lastCheckedAt: lifecycle.lastCheckedAt, lastError: lifecycle.lastError,
      },
      updatesComplete: report.updatesComplete, cveCheckedAt: report.cveCheckedAt, cveError: report.cveError,
      findingCount: report.findingCount || 0, updatesCount: report.updatesCount || 0,
      severityCounts: report.severityCounts,
    }, prefs)];
  }));
};
const tick = async () => {
  if (!(await require('./core').enabled())) return;
  const connections = await Connection.find({ archived: false, monitoringEnabled: true }).select('_id').lean();
  const resources = await Resource.find({ connectionId: { $in: connections.map(c => c._id) }, kind: 'node', archived: false, monitoringEnabled: { $ne: false } }).select('_id kind archived monitoringEnabled').lean();
  const scans = await NodeSecurity.find({ resourceId: { $in: resources.map(r => r._id) } }).select('resourceId status requestedAt').lean();
  const byId = new Map(scans.map(s => [String(s.resourceId), s]));
  const due = resources.filter(resource => {
    const scan = byId.get(String(resource._id));
    return !scan || (!active.includes(scan.status) && Date.now() - new Date(scan.requestedAt || 0) > (scan.status === 'partial' ? daily : 6 * 3600000));
  }).sort((a, b) => new Date(byId.get(String(a._id))?.requestedAt || 0) - new Date(byId.get(String(b._id))?.requestedAt || 0));
  for (const resource of due.slice(0, 3)) await refresh(resource);
  const pending = await NodeSecurity.find({ status: { $in: active }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] }).sort({ requestedAt: 1 }).limit(3).select('_id').lean();
  // Each node can use the same routed SSH lane; bounded sequential processing.
  for (const scan of pending) await processScan(scan._id);
};
module.exports = { refresh, tick, getReport, getSummaries, processScan, advanceScan, collectNode, evaluateNode, publicView };
