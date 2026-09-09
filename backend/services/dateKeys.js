/**
 * Ключи календарных дат «YYYY-MM-DD» и перебор дней периода.
 *
 * Вынесено из `services/workCalendar` без изменений: те же функции нужны срезу
 * «давно без движения» (`services/ticketActivity`), а тянуть ради них весь
 * workCalendar нельзя — он поднимает mongoose и логгер, и юнит-тест чистой
 * арифметики начинает зависеть от прав на каталог логов.
 */

const pad = (n) => String(n).padStart(2, "0");

/** Календарная дата → ключ YYYY-MM-DD. Работаем в UTC: это дата, не инстант. */
const toDateKey = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const keyToUtc = (dateKey) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Перебор календарных дней периода включительно. */
const eachDayKey = function* (fromKey, toKey) {
  const cursor = keyToUtc(fromKey);
  const last = keyToUtc(toKey);
  while (cursor.valueOf() <= last.valueOf()) {
    yield toDateKey(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
};

module.exports = { pad, toDateKey, keyToUtc, eachDayKey };
