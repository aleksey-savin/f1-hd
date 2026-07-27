const Work = require("@/models/work");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Ядро агрегации работ — единственный источник правды для всех отчётов и
 * статистик (аналитика, дашборд, карточка компании, персональный отчёт).
 * До него формула длительности и классификация работ жили независимыми
 * копиями в каждом контроллере и расходились в краевых случаях.
 *
 * Принцип: одна выборка на весь диапазон + группировка в JS (вместо запроса
 * на компанию/период). Классификация «регламентной» требует populate
 * tickets → routineTask с проверкой существования (битая ссылка на удалённый
 * регламент = НЕ регламентная работа) — в aggregate это двойной $lookup с
 * риском тихо разойтись с populate-семантикой, поэтому find + JS.
 *
 * Периоды нарезают вызывающие (у каждого своя таймзона и свои границы) —
 * ядро принимает готовые Date.
 */

const MS_PER_MINUTE = 60 * 1000;

// Работы, у которых есть заявка с живым регламентом (tickets — с populate)
const isRoutineWork = (work) =>
  (work.tickets || []).some((ticket) => ticket && ticket.routineTask);

/** Класс работы: регламент → выезд → удалённая. */
const classifyWork = (work) =>
  isRoutineWork(work)
    ? "routineTask"
    : work.visitRequired === true
      ? "onSite"
      : "remote";

/**
 * Длительность работы в мс; без пары отметок времени — 0. Отрицательная
 * длительность (порча данных: finishedAt раньше startedAt) считается нулём —
 * иначе битая работа вычитается из итогов отчёта. Та же защита стоит в
 * агрегате архива работ (work.getFinished).
 */
const workDurationMs = (work) => {
  if (!work.startedAt || !work.finishedAt) {
    return 0;
  }
  return Math.max(
    0,
    new Date(work.finishedAt).getTime() - new Date(work.startedAt).getTime(),
  );
};

/**
 * Работы за период одной выборкой.
 * endExclusive: true → finishedAt < to (границы суток), false → ≤ to.
 * withTickets: populate заявок с регламентом — нужен только там, где
 * различаются классы работ (аналитика); дашборду и статистике компании
 * достаточно visitRequired.
 */
const loadWorks = async ({
  from,
  to,
  endExclusive = true,
  companyIds = null,
  executorIds = null,
  withTickets = true,
  extraSelect = "",
}) => {
  const query = {
    finishedAt: endExclusive ? { $gte: from, $lt: to } : { $gte: from, $lte: to },
  };
  if (companyIds) {
    query.company = { $in: companyIds };
  }
  if (executorIds) {
    query["finishedBy._id"] = { $in: executorIds };
  }

  const cursor = Work.find(query).select(
    `company visitRequired startedAt finishedAt finishedBy tickets${
      extraSelect ? ` ${extraSelect}` : ""
    }`,
  );

  if (withTickets) {
    // Вложенный populate обязателен: удалённый регламент должен давать null,
    // иначе сырой ObjectId классифицировал бы работу как регламентную
    cursor.populate({
      path: "tickets",
      select: "routineTask",
      populate: { path: "routineTask", select: "_id" },
    });
  }

  return cursor.lean();
};

/**
 * Итоги набора работ. Счётчик класса растёт у каждой работы, время — только
 * при обеих отметках (работа без времени всё равно выполнена).
 */
const summarize = (works) => {
  const summary = {
    totalWorks: works.length,
    totalTime: 0,
    onSite: { count: 0, time: 0 },
    remote: { count: 0, time: 0 },
    routineTask: { count: 0, time: 0 },
  };

  for (const work of works) {
    const bucket = summary[classifyWork(work)];
    bucket.count++;

    const duration = workDurationMs(work);
    bucket.time += duration;
    summary.totalTime += duration;
  }

  return summary;
};

/** Уникальные заявки набора (работа может закрывать несколько заявок). */
const countUniqueTickets = (works) => {
  const ids = new Set();
  for (const work of works) {
    for (const ticket of work.tickets || []) {
      ids.add((ticket._id ?? ticket).toString());
    }
  }
  return ids.size;
};

/** Группировка; keyFn возвращает null для работ вне групп. */
const groupBy = (works, keyFn) => {
  const groups = new Map();
  for (const work of works) {
    const key = keyFn(work);
    if (key == null) {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(work);
    } else {
      groups.set(key, [work]);
    }
  }
  return groups;
};

const idOf = (value) => {
  if (!value) return null;
  return (value._id ?? value).toString();
};

const groupByCompany = (works) => groupBy(works, (work) => idOf(work.company));

const groupByExecutor = (works) =>
  groupBy(works, (work) => idOf(work.finishedBy?._id));

/**
 * keyFn по нарезке периодов (границы включительные с обеих сторон — как их
 * строит generatePeriods). Периоды не пересекаются; работа вне всех периодов
 * в группы не попадает.
 */
const periodKeyFn = (periods) => {
  const bounds = periods.map((period) => ({
    key: period.key,
    start: new Date(period.start).getTime(),
    end: new Date(period.end).getTime(),
  }));

  return (work) => {
    if (!work.finishedAt) {
      return null;
    }
    const finishedAt = new Date(work.finishedAt).getTime();
    for (const bound of bounds) {
      if (finishedAt >= bound.start && finishedAt <= bound.end) {
        return bound.key;
      }
    }
    return null;
  };
};

/**
 * Интервал работы → куски по локальным суткам (byDay, календарь, переработки).
 * Работа, начатая вечером и законченная утром, даёт два куска.
 */
const splitIntoDaySegments = (startedAt, finishedAt, tz) => {
  const segments = [];
  const start = dayjs(startedAt).tz(tz);
  const finish = dayjs(finishedAt).tz(tz);

  let currentDay = start.startOf("day");
  const lastDay = finish.startOf("day");

  while (currentDay.valueOf() <= lastDay.valueOf()) {
    const segStart = Math.max(currentDay.valueOf(), start.valueOf());
    const segEnd = Math.min(currentDay.endOf("day").valueOf(), finish.valueOf());
    if (segEnd > segStart) {
      segments.push({
        date: currentDay.format("YYYY-MM-DD"),
        ms: segEnd - segStart,
      });
    }
    currentDay = currentDay.add(1, "day");
  }

  return segments;
};

const toMinutes = (ms) => Math.round(ms / MS_PER_MINUTE);

module.exports = {
  MS_PER_MINUTE,
  classifyWork,
  isRoutineWork,
  workDurationMs,
  loadWorks,
  summarize,
  countUniqueTickets,
  groupBy,
  groupByCompany,
  groupByExecutor,
  periodKeyFn,
  splitIntoDaySegments,
  toMinutes,
};
