const dayjs = require("dayjs");
const utcPlugin = require("dayjs/plugin/utc");
const timezonePlugin = require("dayjs/plugin/timezone");
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

const Absence = require("@/models/absence");
const { resolveTimezone } = require("@/utils/datetime");
const { reducesNorm } = require("@/utils/absenceTypes");
const { buildCalendarContext } = require("@/services/productionCalendar");
const { DEFAULT_OVERTIME_SETTINGS } = require("@/utils/overtimeDefaults");

/**
 * Единственный источник правды о том, какой у сотрудника день.
 *
 * Сводит три вещи, которых в расчёте не было: производственный календарь РФ,
 * личный часовой пояс и подтверждённые отсутствия. Им пользуются норма часов,
 * переработки (services/workOvertime), табель «Графики работы» и оба отчёта.
 *
 * Разделение ответственности внутри дня:
 *   start/end — ОКНО ПРИСУТСТВИЯ, по нему считаются границы переработки;
 *   minutes   — ОПЛАЧИВАЕМАЯ НОРМА, окно минус перерыв.
 * Работа в обед переработкой не становится, а норма при этом сходится с
 * производственным календарём (8 ч при окне 09:00–18:00).
 */

// Ключи дат живут отдельным модулем: их делит срез «давно без движения»
// (services/ticketActivity), которому весь workCalendar с mongoose и логгером
// не нужен. Экспорт отсюда сохранён — на него завязаны отчёты.
const { toDateKey, keyToUtc, eachDayKey } = require("@/services/dateKeys");

// Разбор окна дня — тоже отдельным листовым модулем: ту же пару {start, end}
// читают биллинг и статический планировщик переработок, и раньше у каждого
// была своя копия (см. services/workWindow). Экспорт сохранён — на эти имена
// завязаны отчёты и валидации.
const {
  DAYS_OF_WEEK,
  MINUTES_PER_DAY,
  dayNameOfKey,
  parseTimeOfDay,
  windowMinutes,
} = require("@/services/workWindow");

/**
 * Личный пояс человека: где он находится. НА РАСЧЁТ НЕ ВЛИЯЕТ.
 *
 * До 2026-09 от него считались границы суток в переработках, и это делало
 * настройку «показывать даты в моём поясе» опасной: поставив себе удобный
 * пояс, сотрудник молча сдвигал бы себе доплаты. Теперь любой график —
 * и личный, и обслуживания — задаётся в поясе ОРГАНИЗАЦИИ, а личный пояс
 * остаётся показом («который час у него» в табеле, формат дат в интерфейсе).
 */
const resolvePersonalTimezone = (user, preferences) =>
  user?.timezone || resolveTimezone(preferences);

/**
 * Версия графика, действующая НА ДАТУ. График меняется со временем, и период
 * отчёта запросто накрывает смену версии — поэтому выбор идёт по каждому дню,
 * а не один раз на весь период.
 *
 * effectiveFrom = null означает «действует всегда» (так лежит запись, которую
 * миграция создала из прежнего одиночного workSchedule).
 */
const pickScheduleVersion = (user, dateKey) => {
  const versions = (user?.workSchedules || []).filter((v) => v?.schedule?.Monday);

  if (!versions.length) {
    // Легаси-поле, пока миграция не прогнана
    return user?.workSchedule?.Monday
      ? {
          schedule: user.workSchedule,
          followProductionCalendar: user.followProductionCalendar !== false,
        }
      : null;
  }

  const key = (version) =>
    version.effectiveFrom ? toDateKey(new Date(version.effectiveFrom)) : "";
  const sorted = [...versions].sort((a, b) => key(a).localeCompare(key(b)));

  let picked = null;
  for (const version of sorted) {
    if (key(version) <= dateKey) {
      picked = version;
    } else {
      break;
    }
  }
  return picked;
};

/**
 * Недельный график сотрудника на дату. Личный график — единственный, по
 * которому считается ЕГО норма: график компании/тарифа описывает окно
 * обслуживания клиента, а не рабочий день инженера.
 */
const resolveUserSchedule = (user, overtimeSettings, dateKey = "9999-12-31") => {
  const version = pickScheduleVersion(user, dateKey);
  if (version) {
    return {
      schedule: version.schedule,
      followProductionCalendar: version.followProductionCalendar !== false,
      source: "user",
    };
  }
  return {
    schedule: overtimeSettings?.defaultSchedule || DEFAULT_OVERTIME_SETTINGS.defaultSchedule,
    followProductionCalendar: user?.followProductionCalendar !== false,
    source: "fallback",
  };
};

/**
 * Время рабочей субботы: календарь говорит «этот выходной — рабочий», но в
 * недельном графике у субботы времени нет. Берём первый рабочий день недели.
 */
const firstWorkingDay = (schedule) => {
  for (const name of DAYS_OF_WEEK) {
    const day = schedule?.[name];
    if (day?.isWorking) {
      return day;
    }
  }
  return null;
};

const emptyDayPlan = (dateKey, kind, extra = {}) => ({
  date: dateKey,
  kind,
  start: null,
  end: null,
  crossesMidnight: false,
  minutes: 0,
  is24hours: false,
  holidayTitle: null,
  absence: null,
  ...extra,
});

/**
 * Контекст на отчёт: календарь задетых лет + отсутствия всех сотрудников
 * периода. Строится ОДИН раз, дальше планировщики работают без обращений к БД.
 */
const buildScheduleContext = async ({ fromKey, toKey, userIds, preferences }) => {
  const calendar = await buildCalendarContext(fromKey, toKey, preferences);

  const absencesByUser = new Map();
  if (userIds?.length) {
    const absences = await Absence.find({
      user: { $in: userIds },
      status: "approved",
      from: { $lte: keyToUtc(toKey) },
      to: { $gte: keyToUtc(fromKey) },
    })
      .select("user type from to status")
      .lean();

    for (const absence of absences) {
      const key = absence.user.toString();
      if (!absencesByUser.has(key)) {
        absencesByUser.set(key, []);
      }
      absencesByUser.get(key).push({
        type: absence.type,
        status: absence.status,
        fromKey: toDateKey(new Date(absence.from)),
        toKey: toDateKey(new Date(absence.to)),
        reducesNorm: reducesNorm(absence.type),
      });
    }
  }

  return { calendar, absencesByUser, preferences };
};

/**
 * Планировщик одного сотрудника. Отдаёт план любого дня и свод за период.
 *
 * Порядок правил в dayPlan (важен):
 *   1) база — день недели личного графика;
 *   2) производственный календарь, если сотрудник ему следует: праздник и
 *      перенесённый выходной делают день нерабочим, сокращённый укорачивает
 *      окно на час, а перенос НА выходной — наоборот делает его рабочим;
 *   3) подтверждённое отсутствие, снимающее норму, обнуляет день.
 * Обычные Сб/Вс календарь не переопределяют — их и так решает график
 * (иначе шестидневка ломалась бы).
 */
const makePlanner = (user, ctx, overtimeSettings) => {
  // Единственный пояс расчёта — организации: в нём заданы все графики
  const tz = resolveTimezone(ctx.preferences);
  const personalTz = resolvePersonalTimezone(user, ctx.preferences);
  const mode = user?.workTimeMode || "scheduled";
  // Плановые дни есть только у тех, чьё время ведётся по графику. У «свободных»
  // и исключённых из календаря плана нет — только фактический статус.
  const isScheduled = mode === "scheduled";

  // Версия графика выбирается на каждый день: она могла смениться внутри периода
  const versionFor = (dateKey) => resolveUserSchedule(user, overtimeSettings, dateKey);
  // «Сегодня» — в поясе организации, а не по UTC: восточнее UTC до смены суток
  // выбиралась бы вчерашняя версия графика (docs/datetime-conventions.md
  // запрещает toISOString().slice для «сегодня»).
  const today = versionFor(dayjs().tz(tz).format("YYYY-MM-DD"));
  const source = today.source;
  const followsCalendar = today.followProductionCalendar && ctx.calendar.isActive;
  const absences = ctx.absencesByUser.get(String(user?._id)) || [];

  const absenceOn = (dateKey) =>
    absences.find((a) => dateKey >= a.fromKey && dateKey <= a.toKey) || null;

  // ignoreAbsence — «каким был бы день без отпуска»: нужно строке
  // «норма 71 ч, без отпуска — 151 ч» и подсчёту потерянных на отсутствии часов
  const dayPlan = (dateKey, { ignoreAbsence = false } = {}) => {
    const absenceOfDay = ignoreAbsence ? null : absenceOn(dateKey);

    // Время не ведётся по графику — плановых дней нет. Отсутствие всё равно
    // показываем: «свободному» его тоже могут оформить.
    if (!isScheduled) {
      return emptyDayPlan(dateKey, "unscheduled", { absence: absenceOfDay || null });
    }

    // Версия графика — на КОНКРЕТНЫЙ день: внутри периода она могла смениться
    const version = versionFor(dateKey);
    const schedule = version.schedule;
    const daySchedule = schedule?.[dayNameOfKey(dateKey)];
    const cal =
      version.followProductionCalendar && ctx.calendar.isActive
        ? ctx.calendar.classify(dateKey)
        : { kind: null, title: null };

    const absence = absenceOfDay;
    const absenceBlocks = absence && absence.reducesNorm;

    // 2) праздник и перенесённый выходной — нерабочие всегда
    if (cal.kind === "holiday") {
      return emptyDayPlan(dateKey, "holiday", {
        holidayTitle: cal.title,
        absence: absence || null,
      });
    }

    // 2) перенос НА выходной: день рабочий, время — от первого рабочего дня недели
    let effective = daySchedule;
    if (cal.kind === "work" && !daySchedule?.isWorking) {
      effective = firstWorkingDay(schedule);
    }

    if (!effective?.isWorking) {
      return emptyDayPlan(dateKey, "weekend", { absence: absence || null });
    }

    if (absenceBlocks) {
      return emptyDayPlan(dateKey, "absence", { absence });
    }

    if (effective.is24hours) {
      return {
        date: dateKey,
        kind: "work",
        start: 0,
        end: MINUTES_PER_DAY,
        // Сутки ПРИМЫКАЮТ к полуночи, но не переходят её
        crossesMidnight: false,
        minutes: MINUTES_PER_DAY,
        is24hours: true,
        holidayTitle: null,
        absence: absence || null,
      };
    }

    const window = windowMinutes(effective.start, effective.end);
    if (!window) {
      // Битое или нулевое время рабочего дня: норма 0, но день остаётся
      // рабочим — иначе вся работа за него ушла бы в переработку (легаси вело
      // себя так же, и на этом стоит живой тариф со всеми днями 00:00–00:00)
      return emptyDayPlan(dateKey, "work", { absence: absence || null });
    }

    // 2) предпраздничный день короче на час. Считаем в ДЛИНЕ, а не в `end`:
    // у окна через полночь end больше start на сутки, и прежний
    // Math.max(start, end - 60) схлопывал ночную смену в ноль.
    const short = cal.kind === "short";
    const length = short ? Math.max(0, window.length - 60) : window.length;
    const end = window.start + length;

    const breakMinutes = Math.max(0, Number(effective.breakMinutes) || 0);
    return {
      date: dateKey,
      kind: short ? "short" : "work",
      start: window.start,
      // Смещение от ТОЙ ЖЕ полуночи: у смены через полночь превышает 1440
      end,
      crossesMidnight: end > MINUTES_PER_DAY,
      minutes: Math.max(0, length - breakMinutes),
      is24hours: false,
      holidayTitle: short ? cal.title : null,
      absence: absence || null,
    };
  };

  const periodPlan = (fromKey, toKey) => {
    const days = [];
    let normMinutes = 0;
    let workingDays = 0;
    let absenceDays = 0;
    let absenceMinutes = 0;

    for (const dateKey of eachDayKey(fromKey, toKey)) {
      const plan = dayPlan(dateKey);
      days.push(plan);
      if (plan.kind === "absence") {
        absenceDays += 1;
        // Сколько норма потеряла на этом дне — тот же день, но без отсутствия
        absenceMinutes += dayPlan(dateKey, { ignoreAbsence: true }).minutes;
        continue;
      }
      if (plan.minutes > 0) {
        workingDays += 1;
        normMinutes += plan.minutes;
      }
    }

    return {
      days,
      normMinutes,
      workingDays,
      absenceDays,
      absenceMinutes,
      // Норма, какой она была бы без отсутствий — «без отпуска — 151 ч»
      normMinutesBeforeAbsences: normMinutes + absenceMinutes,
    };
  };

  return {
    tz,
    // Пояс человека — только для показа: «местное время» в табеле и подпись
    // в карточке. Ни одна цифра от него не зависит.
    personalTz,
    // График «на сегодня» — для карточки и API; расчёт дней берёт свою версию
    schedule: today.schedule,
    scheduleSource: source,
    hasPersonalSchedule: source === "user",
    scheduleVersions: (user?.workSchedules || []).length,
    workTimeMode: mode,
    isScheduled,
    remoteOnly: Boolean(user?.remoteOnly),
    followsCalendar,
    absences,
    dayPlan,
    periodPlan,
  };
};

module.exports = {
  DAYS_OF_WEEK,
  toDateKey,
  keyToUtc,
  dayNameOfKey,
  eachDayKey,
  parseTimeOfDay,
  resolvePersonalTimezone,
  resolveUserSchedule,
  firstWorkingDay,
  buildScheduleContext,
  makePlanner,
};
