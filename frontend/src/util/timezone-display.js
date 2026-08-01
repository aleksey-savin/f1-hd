import { formatInTimeZone, getTimezoneOffset } from "date-fns-tz";

import { DEFAULT_TIMEZONE } from "./format-date";
import { getLocalStorageData } from "./auth";
import timezones from "../store/timezones";

// Показ часового пояса клиента: который час у заявителя и насколько это
// расходится с нашим временем. Сам каскад (заявитель → подразделение → предки →
// компания → организация) считает бэкенд (services/clientTimezone) — здесь
// только отображение.
//
// Бизнес-таймзона читается при каждом вызове, а не кэшируется в модуле: после
// логина и правки настроек значение в localStorage меняется
// (та же причина, что в util/format-date.js).

// Ночь у клиента: звонить нельзя ни при каком графике работы.
const NIGHT_FROM = 21;
const NIGHT_TO = 8;

const SOURCE_LABELS = {
  user: "личный пояс",
  subdivision: "пояс подразделения",
  company: "пояс компании",
  global: "пояс организации",
};

/** Часовой пояс организации — то, в чём показаны все даты приложения. */
export const orgTimezone = () =>
  getLocalStorageData().timezone || DEFAULT_TIMEZONE;

/**
 * Человеческое название зоны. Сначала — подпись из каталога-выпадашки: её же
 * выбирал администратор, и она узнаваемее машинной («Калининград» вместо
 * «Восточная Европа»). Дальше — Intl, в конце — хвост IANA.
 */
export const tzCity = (timezone) => {
  if (!timezone) return "";

  const known = timezones.find((zone) => zone.value === timezone);
  if (known) return known.label.split(" (")[0];

  try {
    const name = new Intl.DateTimeFormat("ru", {
      timeZone: timezone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (name) return name.split(",")[0].trim();
  } catch {
    // ниже — фолбэк на хвост IANA
  }

  return timezone.split("/").pop().replace(/_/g, " ");
};

/**
 * Разница между зоной клиента и нашей, в минутах. Сравниваем фактические
 * смещения, а не идентификаторы: Europe/Volgograd и Europe/Moscow — разные
 * строки, но одно и то же настенное время, и сообщать о «другом поясе» не о чем.
 */
export const tzOffsetMinutes = (
  timezone,
  base = orgTimezone(),
  at = new Date(),
) => {
  try {
    const target = getTimezoneOffset(timezone, at);
    const from = getTimezoneOffset(base, at);
    if (Number.isNaN(target) || Number.isNaN(from)) return null;
    return Math.round((target - from) / 60000);
  } catch {
    return null;
  }
};

/** Смещение словами: «+7 ч», «−3 ч 30 мин». */
const tzOffsetLabel = (minutes) => {
  if (!minutes) return "";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ч`);
  if (rest) parts.push(`${rest} мин`);
  return `${sign}${parts.join(" ")}`;
};

/** Настенное время в зоне клиента: «03:14». */
const tzLocalTime = (timezone, at = new Date()) => {
  try {
    return formatInTimeZone(at, timezone, "HH:mm");
  } catch {
    return "";
  }
};

const isNightAt = (timezone, at = new Date()) => {
  try {
    const hour = Number(formatInTimeZone(at, timezone, "H"));
    return hour >= NIGHT_FROM || hour < NIGHT_TO;
  } catch {
    return false;
  }
};

/**
 * Пояс, который унаследует человек в этом подразделении, если своего у него нет.
 * Только для подсказок в формах: истину считает бэкенд
 * (services/clientTimezone), здесь — обход уже загруженного формой плоского
 * списка подразделений компании.
 */
export const inheritedTimezone = ({
  subdivision,
  subdivisions = [],
  companyTimezone,
}) => {
  const byId = new Map(subdivisions.map((item) => [String(item._id), item]));
  const seen = new Set();

  let node = subdivision;
  while (node && !seen.has(String(node._id))) {
    seen.add(String(node._id));
    if (node.timezone) return node.timezone;
    node = node.parent ? byId.get(String(node.parent)) : null;
  }

  return companyTimezone || orgTimezone();
};

/**
 * Всё нужное для показа одной строкой. `clientTimezone` — объект с бэкенда
 * `{ timezone, source, sourceName }`. Возвращает null, если пояс неизвестен;
 * решение «показывать или нет» остаётся за вызывающим (флаг `differs`).
 */
export const describeClientTimezone = (clientTimezone, at = new Date()) => {
  const timezone = clientTimezone?.timezone;
  if (!timezone) return null;

  const offsetMinutes = tzOffsetMinutes(timezone, orgTimezone(), at);
  if (offsetMinutes === null) return null;

  const city = tzCity(timezone);
  const localTime = tzLocalTime(timezone, at);
  const sourceLabel = SOURCE_LABELS[clientTimezone.source] || "часовой пояс";
  const sourceName = clientTimezone.sourceName;

  return {
    timezone,
    differs: offsetMinutes !== 0,
    city,
    localTime,
    offsetMinutes,
    offsetLabel: tzOffsetLabel(offsetMinutes),
    isNight: isNightAt(timezone, at),
    source: clientTimezone.source,
    sourceName,
    title: `У клиента сейчас ${localTime} — ${city}. Источник: ${sourceLabel}${
      sourceName ? ` «${sourceName}»` : ""
    } · ${timezone}`,
  };
};
