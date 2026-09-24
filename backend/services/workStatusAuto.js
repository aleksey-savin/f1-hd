const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");
const {
  ON_SHIFT_STATUS_CODES,
  AWAY_STATUS_CODES,
  WORK_STATUS_BY_CODE,
  WORKING_STATUS_CODES,
} = require("@/utils/workStatuses");
const { ABSENCE_TYPES, getAbsenceType } = require("@/utils/absenceTypes");
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

// Горизонт поиска ближайшей смены у работающего. Две недели: дальше искать
// незачем, смена найдётся на этой или на следующей. Отсутствующему смену ищут
// ЗА концом отсутствия (горизонт отсчитывается от него), поэтому контекст
// календаря и отсутствий дотягивается до самого далёкого конца — см. ниже.
const NEXT_SHIFT_HORIZON_DAYS = 14;

// «Отгул» из каталога типов → «отгул» в заметке: на табло она стоит после
// времени («до 26.09 09:00 · отгул»), заглавная посреди строки читалась бы
// обрывком
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

const {
  MINUTES_PER_DAY,
  shiftDayKey,
  instantOf,
} = require("@/services/workWindow");

/**
 * Смена, накрывающая момент: вчерашняя, если её хвост дотянулся, иначе
 * сегодняшняя. Смена через полночь принадлежит дню, в котором началась,
 * поэтому у ночника в 03:00 идёт ВЧЕРАШНЯЯ смена, а не сегодняшняя.
 */
const activeShiftOf = (planner, dateKey, minutesNow) => {
  const covers = (plan, offset) =>
    plan &&
    plan.start !== null &&
    plan.end !== null &&
    minutesNow >= plan.start + offset &&
    minutesNow < plan.end + offset;

  const prevKey = shiftDayKey(dateKey, -1);
  const prev = planner.dayPlan(prevKey);
  if (covers(prev, -MINUTES_PER_DAY)) {
    return { key: prevKey, plan: prev };
  }

  const today = planner.dayPlan(dateKey);
  return covers(today, 0) ? { key: dateKey, plan: today } : null;
};

/**
 * Ближайшее начало смены человека: сегодня, если она ещё не началась, иначе
 * первый плановый день впереди без блокирующего отсутствия (dayPlan уже
 * знает про отпуска и праздники). Свободному режиму смен нет — null.
 * horizonDays — докуда искать: отсутствующему горизонт считают от конца
 * отсутствия, иначе у отпуска длиннее двух недель «до …» пропадало бы.
 */
const findNextShift = (
  planner,
  local,
  minutesNow,
  horizonDays = NEXT_SHIFT_HORIZON_DAYS,
) => {
  if (!planner.isScheduled) return null;
  const todayKey = local.format("YYYY-MM-DD");
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dateKey = shiftDayKey(todayKey, offset);
    const plan = planner.dayPlan(dateKey);
    if (plan.start === null) continue;
    if (offset === 0 && minutesNow >= plan.start) continue;
    // instantOf, а не startOf("day").add(): dayjs держит смещение первого дня
    return new Date(instantOf(dateKey, plan.start, planner.tz));
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

  const staffIds = staff.map((user) => user._id);
  let ctx = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: staffIds,
    preferences,
  });

  // Отсутствующему бар пишет «до 05.10 09:00» — первую смену ПОСЛЕ отсутствия,
  // а оно бывает длиннее горизонта. Контекст дотягиваем до самого далёкого
  // конца плюс горизонт: иначе смена после отпуска попала бы на праздник или
  // на следующее отсутствие, которых контекст не знает
  const farthestKey = [...ctx.absencesByUser.values()]
    .flat()
    .reduce((max, absence) => (absence.toKey > max ? absence.toKey : max), toKey);
  if (farthestKey > toKey) {
    ctx = await buildScheduleContext({
      fromKey,
      toKey: dayjs
        .utc(farthestKey)
        .add(NEXT_SHIFT_HORIZON_DAYS + 1, "day")
        .format("YYYY-MM-DD"),
      userIds: staffIds,
      preferences,
    });
  }

  let started = 0;
  let ended = 0;
  let awayApplied = 0;

  for (const user of staff) {
    const planner = makePlanner(user, ctx, overtimeSettings);

    const local = (now ? dayjs(now) : dayjs()).tz(planner.tz);
    const dateKey = local.format("YYYY-MM-DD");
    const minutesNow = local.hour() * 60 + local.minute();
    const plan = planner.dayPlan(dateKey);
    const active = activeShiftOf(planner, dateKey, minutesNow);

    // Ближайшая смена — для бара («до 04.09 09:00» у тех, кого нет). Пишем
    // отдельно от статуса и только при изменении: статус меняется не каждый
    // день, а смена — раз в сутки
    // У отсутствующего — за концом отсутствия: отпуск длиннее горизонта не
    // должен оставлять бар без «до …»
    const blocking = plan.absence?.reducesNorm ? plan.absence : null;
    const horizon = blocking
      ? dayjs.utc(blocking.toKey).diff(dayjs.utc(dateKey), "day") +
        NEXT_SHIFT_HORIZON_DAYS
      : NEXT_SHIFT_HORIZON_DAYS;
    const next = findNextShift(planner, local, minutesNow, horizon);
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
      // Заметка говорит только то, чего табло не скажет само. Тип — когда
      // статус общий для нескольких типов («не на работе» и по отгулу, и по
      // дням без содержания); у отпуска и больничного статус и есть тип, и
      // заметка повторяла бы заголовок группы третий раз. Срок — только без
      // графика: с графиком «до 05.10 09:00» считает nextShiftAt (первая
      // смена после отсутствия), а однодневному сроку и так сегодня
      const sharedStatus =
        ABSENCE_TYPES.filter((type) => type.workStatus === wanted).length > 1;
      const untilKey = plan.absence.toKey;
      const note = [
        sharedStatus ? lowerFirst(meta.label) : "",
        !planner.isScheduled && untilKey && untilKey !== dateKey
          ? `до ${untilKey.slice(8, 10)}.${untilKey.slice(5, 7)}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      // Только при смене кода: уже стоящий статус не трогаем, иначе прогон
      // переписывал бы отметку времени раз в пять минут
      if (code !== wanted) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              workStatus: { code: wanted, note, updatedAt: new Date(), auto: true },
            },
          },
        );
        awayApplied += 1;
      } else if (isAuto && (user.workStatus?.note ?? "") !== note) {
        // Статус уже стоит, а заметка старого образца («Отпуск до 04.10»):
        // правим только её, отметку времени и флаг не трогаем. Ручная
        // заметка (auto: false) остаётся — её писал человек
        await User.updateOne(
          { _id: user._id },
          { $set: { "workStatus.note": note } },
        );
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
    // Ручной выбор держится до конца суток. У смены через полночь сутки
    // переключаются ПОСРЕДИ смены, поэтому держим её с начала — иначе
    // «удалёнка», поставленная в 23:00, испарялась бы в полночь.
    const holdSince =
      active && active.plan.end > MINUTES_PER_DAY
        ? Math.min(
            local.startOf("day").valueOf(),
            instantOf(active.key, active.plan.start, planner.tz),
          )
        : local.startOf("day").valueOf();
    const heldToday =
      !isAuto && changedAtAway && changedAtAway.valueOf() >= holdSince;
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

    const inShift = active !== null;

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
    // Конец смены, после которого ручной статус осмыслен. У ночной смены он
    // лежит во вчерашнем плане (её end больше суток), поэтому прежняя формула
    // «полночь + plan.end» никогда не срабатывала и автоматика затирала статус,
    // поставленный человеком утром. Ветка включается только для смены через
    // полночь — у дневных графиков поведение прежнее.
    const prevPlan = planner.dayPlan(shiftDayKey(dateKey, -1));
    const shiftEndMs =
      plan.end !== null && minutesNow >= plan.end
        ? instantOf(dateKey, plan.end, planner.tz)
        : prevPlan.end !== null && prevPlan.end > MINUTES_PER_DAY
          ? instantOf(shiftDayKey(dateKey, -1), prevPlan.end, planner.tz)
          : local.startOf("day").valueOf();
    const shiftEnd = dayjs(shiftEndMs);
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
