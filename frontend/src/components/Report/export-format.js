import { formatMoneyExact } from "../../util/money.js";

// Числа в выгрузке отчёта — общие для модели, печатной страницы и Excel.
// Чистый модуль (грузится в node --test).

/** Минуты → «03:30»: длительность в отчёте всегда двумя цифрами часов. */
export const hhmm = (minutes) => {
  const total = Math.max(0, Math.round(minutes || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Сумма отчёта — целыми рублями, как на карточке (`formatMoney`). */
export const rubles = (value) => formatMoneyExact(Math.round(value || 0));

/**
 * Момент → настенное время пояса, записанное как UTC.
 *
 * Excel поясов не знает: в ячейке лежит «дата и время» без зоны, и библиотека
 * пишет её из UTC-компонент значения. Чтобы в файле стояло 19:30 по поясу
 * организации, значение собирается из настенных частей этого пояса.
 */
export const wallClockAsUtc = (value, zone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) =>
    Number(parts.find((item) => item.type === type)?.value || 0);
  return new Date(
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    ),
  );
};
