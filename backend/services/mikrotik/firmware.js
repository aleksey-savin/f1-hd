const mongoose = require("mongoose");

const {
  RouterOsRelease,
  RouterOsCve,
  MikrotikFirmwareState,
} = require("../../models/mikrotikFirmware");
const Preferences = require("../../models/preferences");
const logger = require("../../utils/logger");

// Отслеживание релизов RouterOS и известных CVE. Источники:
//  - upgrade.mikrotik.com/routeros/NEWEST* — «последняя версия ветки», плоский
//    текст "7.23.2 1783069688" (версия + unix-время); тот же файл читает сам
//    RouterOS при check-for-updates;
//  - cdn.mikrotik.com/routeros/<ver>/CHANGELOG — текст чейнджлога;
//  - NVD API 2.0 (services.nvd.nist.gov) — CVE по cpe:2.3:o:mikrotik:routeros
//    с диапазонами версий и CVSS. Без ключа лимит 5 req/30s — нам хватает
//    (1 запрос/сутки); NVD_API_KEY опционален.
// Рефрешеры never-throw и деградируют на stale-кэш; вычисления — чистые функции.

// Вотчдог guardedCron только логирует таймаут, но не отменяет промис — без
// собственного таймаута зависший fetch дожил бы до следующего суточного прогона.
const FETCH_TIMEOUT_MS = 20000;

const RELEASE_URL_BASE = "https://upgrade.mikrotik.com/routeros/";
// v7 публикуется в файлах с префиксом NEWESTa7, v6 — NEWEST6 (проверено вживую).
const BRANCH_SOURCES = {
  "7.stable": "NEWESTa7.stable",
  "7.long-term": "NEWESTa7.long-term",
  "6.stable": "NEWEST6.stable",
  "6.long-term": "NEWEST6.long-term",
};
const changelogUrl = (version) =>
  `https://cdn.mikrotik.com/routeros/${version}/CHANGELOG`;

const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const NVD_CPE_PREFIX = "cpe:2.3:o:mikrotik:routeros";

// "7.15.3 (stable)" → { version, major, channel } — сырой формат поля version из
// /system/resource/print (канал в скобках). null, когда на версию не похоже;
// UI и оценка тогда молчат.
const parseFirmware = (raw) => {
  if (typeof raw !== "string") return null;
  const match = raw.match(
    /^\s*(\d+(?:\.\d+)*(?:[a-z]+\d*)?)\s*(?:\(([^)]+)\))?/i,
  );
  if (!match) return null;
  return {
    version: match[1],
    major: Number(match[1].match(/^\d+/)[0]),
    channel: match[2] ? match[2].trim().toLowerCase() : null,
  };
};

// "6.45beta54" → { nums: [6,45], pre: { tag: "beta", num: 54 } }.
const dissectVersion = (version) => {
  const match = String(version)
    .trim()
    .match(/^(\d+(?:\.\d+)*)(?:([a-z]+)(\d+)?)?/i);
  if (!match) return null;
  return {
    nums: match[1].split(".").map(Number),
    pre: match[2]
      ? { tag: match[2].toLowerCase(), num: match[3] ? Number(match[3]) : 0 }
      : null,
  };
};

// Числовое посегментное сравнение (semver не годится: у RouterOS бывают
// двухсегментные версии вроде "7.16"). Недостающие сегменты = 0; буквенный хвост
// при равном числовом префиксе = pre-release, т.е. МЕНЬШЕ релиза: 6.45beta54 < 6.45.
// Неразбираемое значение считается самым старым.
const compareVersions = (a, b) => {
  const da = dissectVersion(a);
  const db = dissectVersion(b);
  if (!da || !db) return !da && !db ? 0 : da ? 1 : -1;
  const len = Math.max(da.nums.length, db.nums.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (da.nums[i] || 0) - (db.nums[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (!da.pre && !db.pre) return 0;
  if (!da.pre) return 1;
  if (!db.pre) return -1;
  if (da.pre.tag !== db.pre.tag) return da.pre.tag < db.pre.tag ? -1 : 1;
  return Math.sign(da.pre.num - db.pre.num);
};

// Ветка, с чьим последним релизом сравнивается устройство. testing/development и
// неизвестный канал целятся в stable того же major: рекомендовать testing-билд
// нельзя, а стабильный путь обновления валиден всегда. major ≤ 6 → ветка 6
// (древним v5 сначала положен апгрейд на 6.x).
const branchKeyFor = (parsed) => {
  if (!parsed) return null;
  const major = parsed.major <= 6 ? "6" : "7";
  const channel = parsed.channel === "long-term" ? "long-term" : "stable";
  return `${major}.${channel}`;
};

// Канал устройства против sw_edition CPE-критерия. Неизвестный/testing канал —
// консервативно любой критерий: лучше ложная тревога, чем пропущенная дыра.
const editionMatches = (edition, channel) => {
  if (edition === "any") return true;
  if (channel === "stable") return edition === "stable";
  if (channel === "long-term") return edition === "ltr";
  return true;
};

// Версия попадает под критерий: точная версия ИЛИ все заданные границы диапазона.
// Критерий без того и другого = «все версии» (NVD-семантика голого cpe...:*:...);
// такой матчер накрывает и latest, поэтому fix-check ниже его отфильтрует.
const cveMatchesVersion = (matcher, version) => {
  if (matcher.exactVersion) {
    return compareVersions(version, matcher.exactVersion) === 0;
  }
  const bounds = [
    [matcher.versionStartIncluding, (c) => c >= 0],
    [matcher.versionStartExcluding, (c) => c > 0],
    [matcher.versionEndIncluding, (c) => c <= 0],
    [matcher.versionEndExcluding, (c) => c < 0],
  ];
  for (const [bound, ok] of bounds) {
    if (bound && !ok(compareVersions(version, bound))) return false;
  }
  return true;
};

const minScoreFor = (minSeverity) => (minSeverity === "critical" ? 9 : 7);

const fetchText = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

// Обновить кэш «последняя версия ветки» (4 канала). Per-channel try/catch: сбой
// одного канала не мешает остальным; при сбое stale-документ сохраняется, пишутся
// только lastError/lastErrorAt. Чейнджлог тянется один раз на новую версию;
// его отказ не роняет обновление версии.
const refreshReleases = async () => {
  for (const [key, file] of Object.entries(BRANCH_SOURCES)) {
    try {
      const body = await fetchText(RELEASE_URL_BASE + file);
      const [version, ts] = body.trim().split(/\s+/);
      if (!version || !/^\d/.test(version)) {
        throw new Error(`unexpected payload "${body.slice(0, 40)}"`);
      }

      const existing = await RouterOsRelease.findById(key).lean();
      let changelog = existing?.changelog;
      if (!existing || existing.version !== version || !changelog) {
        try {
          changelog = await fetchText(changelogUrl(version));
        } catch (error) {
          changelog = changelog || "";
          logger.log("warn", "RouterOS changelog fetch failed", {
            key,
            version,
            error: error.message,
          });
        }
      }

      const set = { version, changelog, fetchedAt: new Date() };
      if (ts && /^\d+$/.test(ts)) set.releasedAt = new Date(Number(ts) * 1000);
      await RouterOsRelease.updateOne(
        { _id: key },
        { $set: set, $unset: { lastError: "", lastErrorAt: "" } },
        { upsert: true },
      );
    } catch (error) {
      logger.log("error", "RouterOS release refresh failed", {
        key,
        error: error.message,
      });
      await RouterOsRelease.updateOne(
        { _id: key },
        { $set: { lastError: error.message, lastErrorAt: new Date() } },
        { upsert: true },
      ).catch(() => {});
    }
  }
};

// NVD-запись → компактный документ кэша. Матчеры — только из vulnerable:true
// критериев cpe:2.3:o:mikrotik:routeros (CVE «приложения X на RouterOS»
// остаются без матчеров и пропускаются). CPE 2.3 после split(":"): [5] —
// версия, [9] — sw_edition; для routeros NVD ставит там "ltr" (long-term),
// "-" (аналитик разделил ветки — это stable) или "*" (канал не указан).
const mapNvdVulnerability = (cve) => {
  if (!cve?.id) return null;

  const matchers = [];
  for (const config of cve.configurations || []) {
    for (const node of config.nodes || []) {
      for (const match of node.cpeMatch || []) {
        if (!match.vulnerable) continue;
        const criteria = match.criteria || "";
        if (!criteria.startsWith(`${NVD_CPE_PREFIX}:`)) continue;
        const parts = criteria.split(":");
        const rawVersion = parts[5];
        const swEdition = parts[9];
        const matcher = {
          edition:
            swEdition === "ltr" ? "ltr" : swEdition === "-" ? "stable" : "any",
        };
        if (rawVersion && rawVersion !== "*" && rawVersion !== "-") {
          matcher.exactVersion = rawVersion;
        }
        for (const key of [
          "versionStartIncluding",
          "versionStartExcluding",
          "versionEndIncluding",
          "versionEndExcluding",
        ]) {
          if (match[key]) matcher[key] = match[key];
        }
        matchers.push(matcher);
      }
    }
  }
  if (!matchers.length) return null;

  const metrics = cve.metrics || {};
  const metric =
    metrics.cvssMetricV31?.[0] ||
    metrics.cvssMetricV30?.[0] ||
    metrics.cvssMetricV2?.[0];
  // У v2 baseSeverity лежит на уровне метрики, у v3 — внутри cvssData.
  const baseSeverity =
    metric?.cvssData?.baseSeverity || metric?.baseSeverity || null;

  return {
    cveId: cve.id,
    baseScore: metric?.cvssData?.baseScore ?? null,
    baseSeverity: baseSeverity ? String(baseSeverity).toUpperCase() : null,
    description:
      (cve.descriptions || []).find((d) => d.lang === "en")?.value || "",
    matchers,
    published: cve.published ? new Date(cve.published) : undefined,
    lastModified: cve.lastModified ? new Date(cve.lastModified) : undefined,
    fetchedAt: new Date(),
  };
};

// Полная синхронизация кэша CVE с NVD. Кэш замещается ТОЛЬКО после полностью
// успешного фетча всех страниц (upsert + удаление исчезнувших id); любой сбой —
// прежний набор остаётся, в state("cve-sync") пишется lastError.
const refreshCves = async () => {
  try {
    const headers = process.env.NVD_API_KEY
      ? { apiKey: process.env.NVD_API_KEY }
      : {};
    const all = [];
    let startIndex = 0;
    let total = Infinity;
    while (startIndex < total) {
      const url =
        `${NVD_URL}?virtualMatchString=${encodeURIComponent(NVD_CPE_PREFIX)}` +
        `&resultsPerPage=2000&startIndex=${startIndex}`;
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`NVD HTTP ${res.status}`);
      const data = await res.json();
      total = data.totalResults ?? 0;
      const page = data.vulnerabilities || [];
      all.push(...page);
      if (!page.length) break;
      startIndex += data.resultsPerPage || page.length;
    }
    // Пустой ответ почти наверняка сбой на стороне NVD — не стирать кэш.
    if (!all.length) throw new Error("NVD returned zero vulnerabilities");

    const docs = all.map((v) => mapNvdVulnerability(v.cve)).filter(Boolean);
    if (docs.length) {
      await RouterOsCve.bulkWrite(
        docs.map((doc) => ({
          updateOne: {
            filter: { cveId: doc.cveId },
            update: { $set: doc },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      await RouterOsCve.deleteMany({
        cveId: { $nin: docs.map((d) => d.cveId) },
      });
    }

    await MikrotikFirmwareState.updateOne(
      { _id: "cve-sync" },
      {
        $set: { lastSuccessAt: new Date(), cveCount: docs.length },
        $unset: { lastError: "", lastErrorAt: "" },
      },
      { upsert: true },
    );
  } catch (error) {
    logger.log("error", "RouterOS CVE refresh failed", {
      error: error.message,
    });
    await MikrotikFirmwareState.updateOne(
      { _id: "cve-sync" },
      { $set: { lastError: error.message, lastErrorAt: new Date() } },
      { upsert: true },
    ).catch(() => {});
  }
};

// Один запрос БД на список/прогон (паттерн computeUptimeMap): дальше
// evaluateFirmware — чистое вычисление. Порог общий для индикаторов и заявки.
const loadFirmwareContext = async () => {
  const [releases, cves, prefs] = await Promise.all([
    RouterOsRelease.find().lean(),
    RouterOsCve.find().lean(),
    Preferences.findOne({}).select("mikrotik.securityUpdateTicket").lean(),
  ]);
  const minSeverity =
    prefs?.mikrotik?.securityUpdateTicket?.minSeverity || "high";
  return {
    releases: new Map(
      releases.filter((r) => r.version).map((r) => [r._id, r]),
    ),
    cves,
    minScore: minScoreFor(minSeverity),
    minSeverity,
  };
};

// Оценка записи устройства против кэша. null — данных нет (нет прошивки или не
// парсится). «Уязвимо» = есть CVE ≥ порога, который матчится на установленную
// версию, но НЕ матчится на последнюю версию ветки — т.е. обновление реально
// закрывает дыру (иначе неисправленный CVE давал бы вечную красную иконку без
// действия). Пустой кэш релизов ⇒ latestVersion null ⇒ vulnerable false.
const evaluateFirmware = (record, ctx) => {
  const parsed = parseFirmware(record?.currentFirmware);
  if (!parsed) return null;

  const branchKey = branchKeyFor(parsed);
  const latestVersion = ctx.releases.get(branchKey)?.version || null;
  const updateAvailable = Boolean(
    latestVersion && compareVersions(parsed.version, latestVersion) < 0,
  );

  const cves = [];
  if (latestVersion) {
    for (const cve of ctx.cves) {
      if (!(cve.baseScore >= ctx.minScore)) continue;
      const applicable = (cve.matchers || []).filter((m) =>
        editionMatches(m.edition, parsed.channel),
      );
      if (!applicable.some((m) => cveMatchesVersion(m, parsed.version))) {
        continue;
      }
      if (applicable.some((m) => cveMatchesVersion(m, latestVersion))) {
        continue;
      }
      cves.push({
        id: cve.cveId,
        score: cve.baseScore,
        severity: cve.baseSeverity,
        description: cve.description,
      });
    }
    cves.sort((a, b) => b.score - a.score);
  }

  return {
    channel: parsed.channel,
    branchKey,
    installedVersion: parsed.version,
    latestVersion,
    updateAvailable,
    vulnerable: cves.length > 0,
    cves,
  };
};

// Суточный прогон: релизы → CVE → синхронизация авто-заявки безопасности.
// securityTicket подключается лениво: он требует этот модуль (evaluateFirmware),
// верхнеуровневый require здесь замкнул бы цикл CommonJS.
const runMikrotikFirmwareRefresh = async () => {
  await refreshReleases();
  await refreshCves();
  try {
    const { syncSecurityTicket } = require("./securityTicket");
    await syncSecurityTicket(await loadFirmwareContext());
  } catch (error) {
    logger.log("error", "Mikrotik security ticket sync failed", {
      error: error.message,
    });
  }
};

const STALE_MS = 24 * 60 * 60 * 1000;

// Boot-путь: первый деплой / долгий простой не ждут суточного крона. Свежи и
// релизы, и CVE-синк — пропуск.
const runMikrotikFirmwareRefreshIfStale = async () => {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const cutoff = new Date(Date.now() - STALE_MS);
    const [freshRelease, cveSync] = await Promise.all([
      RouterOsRelease.findOne({ fetchedAt: { $gte: cutoff } })
        .select("_id")
        .lean(),
      MikrotikFirmwareState.findById("cve-sync").select("lastSuccessAt").lean(),
    ]);
    const cveFresh = cveSync?.lastSuccessAt && cveSync.lastSuccessAt >= cutoff;
    if (freshRelease && cveFresh) return;
    logger.log(
      "info",
      "Mikrotik firmware cache is stale or empty — refreshing on boot",
    );
    await runMikrotikFirmwareRefresh();
  } catch (error) {
    logger.log("error", "Mikrotik firmware boot refresh failed", {
      error: error.message,
    });
  }
};

module.exports = {
  parseFirmware,
  compareVersions,
  branchKeyFor,
  editionMatches,
  cveMatchesVersion,
  minScoreFor,
  refreshReleases,
  refreshCves,
  loadFirmwareContext,
  evaluateFirmware,
  runMikrotikFirmwareRefresh,
  runMikrotikFirmwareRefreshIfStale,
};
