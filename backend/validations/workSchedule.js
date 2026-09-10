/**
 * Проверка недельного графика — одна на все три входа: график сотрудника,
 * график обслуживания компании и собственный график тарифа.
 *
 * До 2026-09 проверялся только график сотрудника; график компании и тарифа
 * принимались как `isObject()`, и именно так в базе завелись вырожденные
 * окна `00:00–00:00`, которые бесшумно означают «всё переработка».
 *
 * Время задаётся в поясе ОРГАНИЗАЦИИ — в интерфейсе это сказано у поля.
 */

const {
  DAYS_OF_WEEK,
  MINUTES_PER_DAY,
  windowMinutes,
} = require("../services/workWindow");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Окно дня в минутах или null, если дня в графике нет. */
const windowOf = (day) => {
  if (!day?.isWorking) return null;
  if (day.is24hours) return { start: 0, end: MINUTES_PER_DAY };
  return windowMinutes(day.start, day.end);
};

/**
 * Общая проверка. `requireAllDays` — про полноту графика, а не про его форму:
 * график СОТРУДНИКА всегда приходит из редактора целиком и проверялся строго,
 * а у компаний и тарифов в базе лежат неполные недели (29 компаний из 33 и 22
 * тарифа из 23 — отсутствующий день схема и так читает как нерабочий).
 * Требовать там семь дней значит заблокировать сохранение телефона из-за
 * невыставленного воскресенья.
 */
const checkWeekSchedule = (value, { requireAllDays }) => {
  if (!value || typeof value !== "object") {
    throw new Error("График должен быть объектом");
  }

  for (const name of DAYS_OF_WEEK) {
    const day = value[name];
    if (!day || typeof day !== "object") {
      if (requireAllDays) {
        throw new Error(`В графике нет дня «${name}»`);
      }
      continue;
    }
    if (typeof day.isWorking !== "boolean") {
      throw new Error(`У дня «${name}» не указано, рабочий ли он`);
    }

    if (day.isWorking && !day.is24hours) {
      if (!TIME_RE.test(day.start) || !TIME_RE.test(day.end)) {
        throw new Error(`У дня «${name}» некорректное время (ждём ЧЧ:ММ)`);
      }
      // Конец РАНЬШЕ начала — смена через полночь, это допустимо.
      // Конец РАВЕН началу — нулевое окно: для суток есть флаг «24 часа».
      if (day.end === day.start) {
        throw new Error(
          `У дня «${name}» нулевое окно; для круглосуточного дня включите «24 часа»`,
        );
      }
    }

    if (day.breakMinutes !== undefined && day.breakMinutes !== null) {
      const brk = Number(day.breakMinutes);
      if (!Number.isFinite(brk) || brk < 0 || brk > 480) {
        throw new Error(`У дня «${name}» перерыв вне диапазона 0–480 минут`);
      }
    }
  }

  // Хвост смены не должен налезать на следующую: на двух сменах разом никто
  // не стоит, а расчёт в таком случае вынужден склеивать окна и норма
  // перестаёт сходиться с сеткой графика. Проверяем циклически: воскресенье
  // тоже сосед понедельника.
  for (let index = 0; index < DAYS_OF_WEEK.length; index += 1) {
    const name = DAYS_OF_WEEK[index];
    const nextName = DAYS_OF_WEEK[(index + 1) % DAYS_OF_WEEK.length];
    const window = windowOf(value[name]);
    const next = windowOf(value[nextName]);
    if (!window || !next) continue;

    const tail = window.end - MINUTES_PER_DAY;
    if (tail > next.start) {
      throw new Error(
        `Смена дня «${name}» заходит на смену дня «${nextName}»`,
      );
    }
  }

  return true;
};

/** График сотрудника: приходит из редактора целиком. */
const isWeekSchedule = (value) => checkWeekSchedule(value, { requireAllDays: true });

/** График обслуживания компании и тарифа: неполная неделя допустима. */
const isPartialWeekSchedule = (value) =>
  checkWeekSchedule(value, { requireAllDays: false });

module.exports = { isWeekSchedule, isPartialWeekSchedule, TIME_RE };
