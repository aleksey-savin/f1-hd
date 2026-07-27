const ProductionCalendar = require("@/models/productionCalendar");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");

const { loadCalendar, isWeekend } = require("./fetch");

/**
 * Единственная точка правды о том, рабочий ли день по производственному
 * календарю. Кто спрашивает: services/workCalendar (норма и переработки),
 * страница «Графики работы», секция настроек.
 *
 * Кэш в памяти процесса: календарь года — неизменный справочник, читать его из
 * БД на каждую работу в отчёте незачем. Сбрасывается при перезагрузке года и
 * при смене настроек.
 */

const DEFAULT_COUNTRY = "ru";
const memo = new Map(); // `${country}:${year}` → { days: Map, holidays: Map, doc }

const memoKey = (country, year) => `${country}:${year}`;

const toIndex = (doc) => ({
  doc,
  holidays: new Map((doc.holidays || []).map((h) => [h.id, h.title])),
  days: new Map((doc.days || []).map((d) => [d.date, d])),
});

const dropMemo = (country, year) => {
  if (year === undefined) {
    for (const key of [...memo.keys()]) {
      if (key.startsWith(`${country}:`)) {
        memo.delete(key);
      }
    }
    return;
  }
  memo.delete(memoKey(country, year));
};

/** Настройки календаря с дефолтами — отдельные документы могут их не иметь. */
const resolveSettings = (preferences) => {
  const cfg = preferences?.productionCalendar || {};
  return {
    isActive: cfg.isActive !== false,
    country: (cfg.country || DEFAULT_COUNTRY).toLowerCase(),
    source: cfg.source || "xmlcalendar",
    overrides: cfg.overrides || [],
  };
};

/** Скачать год и записать снимок. Возвращает документ модели. */
const refreshYear = async (country, year, preferred) => {
  const { calendar, errors } = await loadCalendar(country, year, preferred);

  const doc = await ProductionCalendar.findOneAndUpdate(
    { country, year },
    {
      $set: {
        source: calendar.source,
        fetchedAt: new Date(),
        holidays: calendar.holidays,
        days: calendar.days,
        statistic: calendar.statistic,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  dropMemo(country, year);
  return { doc, source: calendar.source, errors };
};

/** Год из кэша → из БД → скачиванием. */
const getCalendar = async (year, country = DEFAULT_COUNTRY, { preferred } = {}) => {
  const key = memoKey(country, year);
  if (memo.has(key)) {
    return memo.get(key);
  }

  let doc = await ProductionCalendar.findOne({ country, year }).lean();
  if (!doc) {
    try {
      ({ doc } = await refreshYear(country, year, preferred));
    } catch (error) {
      // Запоминаем и неудачу: без этого КАЖДЫЙ запрос месяца из неизданного
      // года заново лезет в сеть и ждёт отказа. Успешный refreshYear память
      // сбрасывает сам (dropMemo), так что вышедший позже календарь подхватится
      memo.set(key, null);
      throw error;
    }
  }

  const index = toIndex(doc);
  memo.set(key, index);
  return index;
};

/**
 * Догрузить годы, которых ещё нет (крон и ленивое обращение к будущему году).
 * Ошибка одного года не должна ронять остальные: календарь следующего года
 * публикуется осенью, до этого 404 — штатная ситуация.
 */
const ensureYears = async (years, country = DEFAULT_COUNTRY, { preferred, force } = {}) => {
  const results = [];
  for (const year of years) {
    try {
      const existing = force ? null : await ProductionCalendar.findOne({ country, year }).lean();
      if (existing && !force) {
        results.push({ year, status: "already", source: existing.source });
        continue;
      }
      const { source, errors } = await refreshYear(country, year, preferred);
      results.push({ year, status: "loaded", source, errors });
    } catch (error) {
      results.push({ year, status: "failed", error: error.message, details: error.details });
    }
  }
  return results;
};

/**
 * Что за день. Возвращает всегда, даже когда календарь выключен или недоступен —
 * тогда работает голое правило «суббота и воскресенье нерабочие», то есть ровно
 * прежнее поведение расчёта.
 *
 * kind: "work" | "short" | "holiday" | "weekend"
 */
const classifyDay = (dateKey, index, { overrides } = {}) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekend = isWeekend(y, m, d);

  const override = overrides?.get?.(dateKey);
  if (override) {
    return {
      kind: override.kind,
      title: override.title || null,
      source: "override",
    };
  }

  const day = index?.days?.get(dateKey);
  if (day) {
    if (day.type === "holiday") {
      return {
        kind: "holiday",
        title: index.holidays.get(day.holidayId) || "Праздничный день",
        source: "calendar",
      };
    }
    if (day.type === "dayoff") {
      return {
        kind: "holiday",
        title: day.transferredFrom
          ? `Перенесённый выходной с ${day.transferredFrom.split("-").reverse().join(".")}`
          : "Перенесённый выходной",
        transferredFrom: day.transferredFrom || null,
        source: "calendar",
      };
    }
    if (day.type === "short") {
      return { kind: "short", title: "Сокращённый предпраздничный день", source: "calendar" };
    }
    if (day.type === "work") {
      return { kind: "work", title: "Рабочий день (перенос)", source: "calendar" };
    }
  }

  return { kind: weekend ? "weekend" : "work", title: null, source: "weekday" };
};

/**
 * Контекст на период: индекс календаря по всем задетым годам + карта ручных
 * исключений организации. Строится один раз на отчёт, дальше classifyDay —
 * чистая функция без обращений к БД.
 */
const buildCalendarContext = async (fromKey, toKey, preferences) => {
  const settings = resolveSettings(preferences);
  const overrides = new Map(
    settings.overrides
      .filter((o) => o.date && o.kind)
      .map((o) => [o.date, { kind: o.kind, title: o.title || null }]),
  );

  if (!settings.isActive) {
    return { isActive: false, settings, classify: (key) => classifyDay(key, null, { overrides }) };
  }

  const fromYear = Number(fromKey.slice(0, 4));
  const toYear = Number(toKey.slice(0, 4));
  const index = new Map();

  for (let year = fromYear; year <= toYear; year += 1) {
    try {
      index.set(year, await getCalendar(year, settings.country, { preferred: settings.source }));
    } catch (error) {
      // Год недоступен — считаем по дню недели, а не падаем всем отчётом
      logger.log("warn", "Production calendar year unavailable, falling back to weekdays", {
        year,
        country: settings.country,
        error: error.message,
      });
      index.set(year, null);
    }
  }

  return {
    isActive: true,
    settings,
    // Годы, для которых источника нет: дни в них посчитаны по дню недели, то
    // есть без праздников. Молчать об этом нельзя — январь без новогодних
    // выходных выглядит рабочим, и отпуск спланируют не туда
    missingYears: [...index.entries()]
      .filter(([, value]) => !value)
      .map(([year]) => year),
    classify: (key) => classifyDay(key, index.get(Number(key.slice(0, 4))), { overrides }),
  };
};

/** Строка состояния секции настроек (app/HealthRow). */
const getHealth = async (preferences) => {
  const settings = resolveSettings(preferences);
  const thisYear = new Date().getUTCFullYear();
  const docs = await ProductionCalendar.find({
    country: settings.country,
    year: { $in: [thisYear, thisYear + 1] },
  })
    .select("year source fetchedAt statistic days")
    .lean();

  const years = docs
    .map((doc) => ({
      year: doc.year,
      source: doc.source,
      fetchedAt: doc.fetchedAt,
      exceptions: (doc.days || []).length,
      statistic: doc.statistic,
    }))
    .sort((a, b) => a.year - b.year);

  const cfg = preferences?.productionCalendar || {};
  return {
    isActive: settings.isActive,
    country: settings.country,
    source: settings.source,
    lastSyncAt: cfg.lastSyncAt || null,
    lastError: cfg.lastError || "",
    lastErrorAt: cfg.lastErrorAt || null,
    overridesCount: settings.overrides.length,
    years,
  };
};

/** Ручное и кроновое обновление: пишет итог в Preferences для HealthRow. */
const syncCalendar = async ({ force = false } = {}) => {
  const preferences = await Preferences.findOne({});
  const settings = resolveSettings(preferences);
  const thisYear = new Date().getUTCFullYear();

  const results = await ensureYears([thisYear, thisYear + 1], settings.country, {
    preferred: settings.source,
    force,
  });

  // Следующий год до осени не опубликован — это не ошибка синхронизации
  const failedCurrent = results.find((r) => r.year === thisYear && r.status === "failed");
  const lastError = failedCurrent
    ? `Не удалось загрузить календарь на ${thisYear} год: ${failedCurrent.error}`
    : "";

  if (preferences) {
    preferences.productionCalendar = {
      ...(preferences.productionCalendar?.toObject?.() || preferences.productionCalendar || {}),
      lastSyncAt: new Date(),
      lastError,
      lastErrorAt: lastError ? new Date() : null,
    };
    await preferences.save();
  }

  return { results, lastError };
};

module.exports = {
  DEFAULT_COUNTRY,
  resolveSettings,
  getCalendar,
  ensureYears,
  refreshYear,
  classifyDay,
  buildCalendarContext,
  getHealth,
  syncCalendar,
  dropMemo,
};
