const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");
const {
  ON_SHIFT_STATUS_CODES,
  AWAY_STATUS_CODES,
  WORK_STATUS_BY_CODE,
  WORKING_STATUS_CODES,
} = require("@/utils/workStatuses");
const { getAbsenceType } = require("@/utils/absenceTypes");
const { resolveOvertimeSettings } = require("@/services/workOvertime");
const { buildScheduleContext, makePlanner } = require("@/services/workCalendar");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Автостатусы по графику: начало смены — «в офисе» (у remoteOnly «на
 * удалёнке»), окончание — «не на работе».
 *
 * РУЧНОЙ ВЫБОР ДЕРЖИТСЯ ДО КОНЦА ДНЯ, и для этого не понадобилось поле
 * «кто поставил»:
 *   • утром автомат трогает только тех, у кого сейчас «не на работе» или
 *     «не указан» — уже выбранная человеком «удалёнка» переживёт начало смены;
 *   • вечером переводит в «не на работе» только если статус не меняли уже
 *     ПОСЛЕ окончания смены — поставленное в 18:40 доживёт до ночного сброса.
 *
 * Работает только для workTimeMode === "scheduled": «свободные» ведут статусы
 * сами, исключённых из календаря автоматика не касается.
 *
 * Отсутствия сюда не относятся — их проставляет ночной syncStatusesWithAbsences.
 */

// Кого автоматика вправе перевести в рабочий статус в начале смены
const REPLACEABLE_AT_START = new Set(["offshift", "unset"]);

// Горизонт поиска ближайшей смены. Две недели: за ними обычно отпуск, и «до
// 25.09 09:00» в баре честнее пустоты; контекст отсутствий и календаря
// строится ровно на этот горизонт (см. toKey ниже).
const NEXT_SHIFT_HORIZON_DAYS = 14;

/**
 * Ближайшее начало смены человека: сегодня, если она ещё не началась, иначе
 * первый плановый день впереди без блокирующего отсутствия (dayPlan уже
 * знает про отпуска и праздники). Свободному режиму смен нет — null.
 */
const findNextShift = (planner, local, minutesNow) => {
  if (!planner.isScheduled) return null;
  for (let offset = 0; offset <= NEXT_SHIFT_HORIZON_DAYS; offset += 1) {
    const day = local.startOf("day").add(offset, "day");
    const plan = planner.dayPlan(day.format("YYYY-MM-DD"));
    if (plan.start === null) continue;
    if (offset === 0 && minutesNow >= plan.start) continue;
    return day.add(plan.start, "minute").toDate();
  }
  return null;
};

// now — точка отсчёта; параметр существует ради самопроверки
// (scripts/checkWorkStatusAuto.js), в проде всегда текущее время
const runWorkStatusAuto = async ({ now = undefined, userIds = null } = {}) => {
  const preferences = await Preferences.findOne({}).lean();
  const overtimeSettings = resolveOvertimeSettings(preferences);

  const staff = await User.find({
    ...(userIds ? { _id: { $in: userIds } } : {}),
    banned: { $ne: true },
    isEndUser: false,
    isServiceAccount: false,
    isCloudTelephony: false,
    hideWorkStatus: { $ne: true },
    workTimeMode: { $ne: "none" },
  })
    .select(
      "workStatus nextShiftAt timezone workSchedules workSchedule followProductionCalendar " +
        "workTimeMode remoteOnly",
    )
    .lean();

  if (!staff.length) {
    return { started: 0, ended: 0, awayApplied: 0 };
  }

  // Смены живут в разных поясах, поэтому «сегодня» у людей разное: контекст
  // строим на трое суток вокруг, чтобы накрыть любой сдвиг
  const nowUtc = now ? dayjs(now).utc() : dayjs.utc();
  const fromKey = nowUtc.subtract(1, "day").format("YYYY-MM-DD");
  const toKey = nowUtc.add(NEXT_SHIFT_HORIZON_DAYS + 1, "day").format("YYYY-MM-DD");

  const ctx = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: staff.map((user) => user._id),
    preferences,
  });

  let started = 0;
  let ended = 0;
  let awayApplied = 0;

  for (const user of staff) {
    const planner = makePlanner(user, ctx, overtimeSettings);

    const local = (now ? dayjs(now) : dayjs()).tz(planner.tz);
    const dateKey = local.format("YYYY-MM-DD");
    const minutesNow = local.hour() * 60 + local.minute();
    const plan = planner.dayPlan(dateKey);

    // Ближайшая смена — для бара («до 04.09 09:00» у тех, кого нет). Пишем
    // отдельно от статуса и только при изменении: статус меняется не каждый
    // день, а смена — раз в сутки
    const next = findNextShift(planner, local, minutesNow);
    const stored = user.nextShiftAt ? new Date(user.nextShiftAt).valueOf() : null;
    if (stored !== (next ? next.valueOf() : null)) {
      await User.updateOne({ _id: user._id }, { $set: { nextShiftAt: next } });
    }

    const code = user.workStatus?.code ?? "unset";
    // Кто поставил статус — теперь спрашиваем поле, а не время: у записей до
    // миграции флага нет, для них «авто» = служебные offshift/unset
    const isAuto =
      user.workStatus?.auto === true ||
      (user.workStatus?.auto === undefined && REPLACEABLE_AT_START.has(code));

    // Отсутствия делятся по смыслу статуса, а не по норме: «человека нет»
    // (отпуск, больничный, отгул) перебивает любой выбор, а «работает не
    // отсюда» (командировка) — это рабочий статус, он лишь подменяет
    // «в офисе» на старте смены и обеду среди дня не мешает.
    const meta = plan.absence ? getAbsenceType(plan.absence.type) : null;
    const wanted = meta?.workStatus || null;
    // Отсутствие «человека нет» — любое, чей статус не рабочий: отпуск и
    // больничный (away) и отгул с днями без содержания (offshift — прежний
    // «отсутствует» слит в «не на работе»)
    const isAway = Boolean(wanted && !WORKING_STATUS_CODES.includes(wanted));

    if (isAway) {
      // Заметка называет тип и срок: «не на работе» само по себе молчит.
      // Однодневному отсутствию срок не пишем — он и так сегодня
      const untilKey = plan.absence.toKey;
      const until =
        untilKey && untilKey !== dateKey
          ? ` до ${untilKey.slice(8, 10)}.${untilKey.slice(5, 7)}`
          : "";
      // Только при смене кода: уже стоящий статус не трогаем, иначе прогон
      // переписывал бы отметку времени раз в пять минут
      if (code !== wanted) {
        const note = `${meta.label}${until}`;
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              workStatus: { code: wanted, note, updatedAt: new Date(), auto: true },
            },
          },
        );
        awayApplied += 1;
      }
      continue;
    }

    // Отсутствие кончилось, а долгий статус остался — снимаем. Но не сразу:
    // отпуск/больничный админ вправе поставить руками как форс-мажор, без
    // заявки, и такой выбор живёт до конца суток — как и любой ручной.
    // Свободному графику «не на работе» не подходит: смены у него нет.
    const changedAtAway = user.workStatus?.updatedAt
      ? dayjs(user.workStatus.updatedAt)
      : null;
    const heldToday =
      !isAuto &&
      changedAtAway &&
      changedAtAway.valueOf() >= local.startOf("day").valueOf();
    // «Не на работе» по отгулу у свободного графика тоже освобождаем сами:
    // смены у него нет, и вернуть человека некому
    const staleOffshift =
      code === "offshift" && isAuto && !planner.isScheduled;
    if ((AWAY_STATUS_CODES.includes(code) && !heldToday) || staleOffshift) {
      const released = planner.isScheduled ? "offshift" : "unset";
      await User.updateOne(
        { _id: user._id },
        { $set: { workStatus: { code: released, note: "", updatedAt: new Date(), auto: true } } },
      );
      ended += 1;
      continue;
    }

    // Дальше — автоматика по графику; у свободного режима её нет
    if (!planner.isScheduled) {
      continue;
    }

    const inShift =
      plan.start !== null && plan.end !== null &&
      minutesNow >= plan.start && minutesNow < plan.end;

    if (inShift) {
      if (!isAuto) {
        continue; // человек уже выбрал себе статус — не трогаем
      }
      // Командировка задаёт рабочий статус вместо «в офисе»
      const next = wanted || (user.remoteOnly ? "remote" : "office");
      if (code === next) {
        continue;
      }
      await User.updateOne(
        { _id: user._id },
        { $set: { workStatus: { code: next, note: "", updatedAt: new Date(), auto: true } } },
      );
      started += 1;
      continue;
    }

    // Вне смены: рабочий статус гасим, но только если его не трогали после
    // окончания смены (иначе снесём осознанную переработку)
    if (!ON_SHIFT_STATUS_CODES.includes(code)) {
      continue;
    }
    const shiftEnd =
      plan.end !== null
        ? local.startOf("day").add(plan.end, "minute")
        : local.startOf("day");
    const changedAt = user.workStatus?.updatedAt
      ? dayjs(user.workStatus.updatedAt)
      : null;
    if (changedAt && changedAt.valueOf() >= shiftEnd.valueOf()) {
      continue;
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { workStatus: { code: "offshift", note: "", updatedAt: new Date(), auto: true } } },
    );
    ended += 1;
  }

  if (started || ended || awayApplied) {
    logger.log("info", "Work statuses auto-switched by schedule", {
      started,
      ended,
      awayApplied,
      startedLabel: WORK_STATUS_BY_CODE.office.label,
      endedLabel: WORK_STATUS_BY_CODE.offshift.label,
    });
  }

  return { started, ended, awayApplied };
};

module.exports = { runWorkStatusAuto, REPLACEABLE_AT_START };
