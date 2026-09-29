import timezones, { TIMEZONE_REGIONS } from "../store/timezones.js";

// Каталог поясов → опции выпадашки и подписи. Чистый модуль: localStorage не
// читает, поэтому грузится в node --test (util/timezone-display — нет).
//
// Смещение не хранится в каталоге, а считается на момент показа: зашитое
// «Лондон (UTC +0:00)» было верным только зимой.

const offsetFormatters = new Map();

/** Смещение зоны от UTC в минутах на момент `at`; null — зону Intl не знает. */
export const zoneOffsetMinutes = (zone, at = new Date()) => {
  try {
    let format = offsetFormatters.get(zone);
    if (!format) {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
      });
      offsetFormatters.set(zone, format);
    }
    // «GMT+07:00», «GMT-03:30»; ровно UTC — просто «GMT»
    const name =
      format.formatToParts(at).find((part) => part.type === "timeZoneName")
        ?.value ?? "";
    if (name === "GMT") return 0;
    const match = name.match(/^GMT([+-])(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
  } catch {
    return null;
  }
};

/** «UTC+7», «UTC+5:30», «UTC−4», «UTC+0». */
export const utcOffsetLabel = (minutes) => {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
};

/** Главный город зоны из каталога («Ханой» для Asia/Ho_Chi_Minh) или null. */
export const catalogCity = (zone) =>
  timezones.find((entry) => entry.value === zone)?.cities[0] ?? null;

// Опции каталога меняются только со сменой смещений, а формы перерисовываются
// на каждое нажатие клавиши — держим последний расчёт на час
const HOUR = 60 * 60 * 1000;
let cached = { hour: null, options: [] };

const catalogOptions = (at) => {
  const hour = Math.floor(at.valueOf() / HOUR);
  if (cached.hour === hour) return cached.options;

  const options = timezones
    .map((entry) => ({ ...entry, offset: zoneOffsetMinutes(entry.value, at) }))
    // Старый браузер может не знать зону (Europe/Kyiv появилась в 2022-м)
    .filter((entry) => entry.offset !== null)
    .sort(
      (a, b) =>
        TIMEZONE_REGIONS.indexOf(a.region) - TIMEZONE_REGIONS.indexOf(b.region) ||
        a.offset - b.offset ||
        a.cities[0].localeCompare(b.cities[0], "ru"),
    )
    .map((entry) => ({
      value: entry.value,
      label: `${entry.cities.join(", ")} (${utcOffsetLabel(entry.offset)})`,
      hint: `${entry.country} · ${entry.value}`,
      group: entry.region,
    }));

  cached = { hour, options };
  return options;
};

/**
 * Опции для app/Combobox: группы по частям света, внутри — по смещению, затем
 * по городу; поиск идёт по подписи и подсказке (город, страна, «UTC+7», зона).
 *
 * `extra` — уже сохранённые значения. Зону вне каталога (её можно проставить
 * через API) показываем как есть первой строкой, иначе поле выглядело бы
 * пустым при заполненном значении.
 */
export const timezoneOptions = ({ at = new Date(), extra = [] } = {}) => {
  const options = catalogOptions(at);
  const unknown = [...new Set(extra.filter(Boolean))].filter(
    (value) => !options.some((option) => option.value === value),
  );
  if (!unknown.length) return options;

  return [
    ...unknown.map((value) => {
      const offset = zoneOffsetMinutes(value, at);
      return {
        value,
        label: offset === null ? value : `${value} (${utcOffsetLabel(offset)})`,
      };
    }),
    ...options,
  ];
};

/** Сдвиг словами: «на 3 ч раньше», «на 2 ч 30 мин позже»; 0 — null. */
export const shiftPhrase = (minutes) => {
  if (!minutes) return null;
  const abs = Math.abs(minutes);
  const amount = [
    Math.floor(abs / 60) && `${Math.floor(abs / 60)} ч`,
    abs % 60 && `${abs % 60} мин`,
  ]
    .filter(Boolean)
    .join(" ");
  return `на ${amount} ${minutes < 0 ? "раньше" : "позже"}`;
};

/** Настенное время со сдвигом по кругу суток: «09:00» и −180 → «06:00». */
export const shiftClock = (hhmm, minutes) => {
  const [hours, mins] = hhmm.split(":").map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
