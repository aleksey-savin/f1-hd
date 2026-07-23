// Утилиты расписания (cron) для регламентных заданий: генерация строки из
// «дружелюбного» состояния конструктора, обратный разбор, человекочитаемый
// перевод и вычисление ближайших запусков. Планировщик пятипольный
// (`минута час день-мес месяц день-нед`), секунды не используются.
// Ближайшие запуски считаются по часовому поясу ОРГАНИЗАЦИИ — так же, как их
// исполняет node-cron на сервере (см. util/time-helpers).
import { toZonedTime, fromZonedTime } from "date-fns-tz";

import { getLocalStorageData } from "./auth";
import { DEFAULT_TIMEZONE } from "./format-date";

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WD_DAT = [
  "воскресеньям",
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
];
const MON = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "мая",
  "июн.",
  "июл.",
  "авг.",
  "сен.",
  "окт.",
  "ноя.",
  "дек.",
];

const pad = (n) => String(n).padStart(2, "0");
const isN = (x) => /^\d+$/.test(x);

const plural = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
};
const pMin = (n) => plural(n, "минуту", "минуты", "минут");
const pHour = (n) => plural(n, "час", "часа", "часов");
const pMonth = (n) => plural(n, "месяц", "месяца", "месяцев");
const pDay = (n) => plural(n, "день", "дня", "дней");

// Совпадает ли значение поля с частью cron (`*`, число, список, диапазон, шаг).
// lo0 — минимум поля (минуты/часы/дни-нед = 0, дни-мес/месяцы = 1): важно для
// шага `*/N`, чтобы «каждые 3 месяца» шли от января (1,4,7,10), а не от нуля.
const checkPart = (part, val, lo0 = 0) => {
  if (part === "*") return true;
  return part.split(",").some((seg) => {
    if (seg.indexOf("/") >= 0) {
      const t = seg.split("/");
      const step = parseInt(t[1], 10) || 1;
      let lo = lo0;
      let hi = Infinity;
      if (t[0] !== "*") {
        if (t[0].indexOf("-") >= 0) {
          const r = t[0].split("-");
          lo = +r[0];
          hi = +r[1];
        } else {
          lo = +t[0];
        }
      }
      return val >= lo && val <= hi && (val - lo) % step === 0;
    }
    if (seg.indexOf("-") >= 0) {
      const r = seg.split("-");
      return val >= +r[0] && val <= +r[1];
    }
    return parseInt(seg, 10) === val;
  });
};

export const isValidCron = (cron) => {
  if (!cron || typeof cron !== "string") return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d*,/-]+$/.test(p));
};

// Человекочитаемая фраза для типовых расписаний; null — если не раскладывается
// (тогда вызывающий показывает fallback или саму строку).
export const humanizeCron = (cron) => {
  if (!isValidCron(cron)) return null;
  const [mi, ho, dom, mo, dow] = cron.trim().split(/\s+/);
  const at = () => `в ${pad(+ho)}:${pad(+mi)}`;

  // Каждые N месяцев (день числа, месяц шагом)
  if (isN(mi) && isN(ho) && isN(dom) && /^\*\/\d+$/.test(mo) && dow === "*") {
    const n = +mo.split("/")[1];
    return `Каждые ${n} ${pMonth(n)}, ${+dom}-го числа ${at()}`;
  }
  if (mo !== "*") return null;

  if (/^\*\/\d+$/.test(mi) && ho === "*" && dom === "*" && dow === "*") {
    const n = +mi.split("/")[1];
    return `Каждые ${n} ${pMin(n)}`;
  }
  if (isN(mi) && ho === "*" && dom === "*" && dow === "*") {
    return `Каждый час в :${pad(+mi)}`;
  }
  if (isN(mi) && /^\*\/\d+$/.test(ho) && dom === "*" && dow === "*") {
    const n = +ho.split("/")[1];
    return `Каждые ${n} ${pHour(n)} в :${pad(+mi)}`;
  }
  if (isN(mi) && isN(ho)) {
    if (dom === "*" && dow === "*") return `Каждый день ${at()}`;
    if (dom === "*" && dow === "1-5") return `По будням ${at()}`;
    if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) {
      const days = [];
      dow.split(",").forEach((x) => {
        const v = +x === 7 ? 0 : +x;
        if (!days.includes(v)) days.push(v);
      });
      days.sort((a, b) => a - b);
      if (days.length === 2 && days.includes(0) && days.includes(6)) {
        return `По выходным ${at()}`;
      }
      return `По ${days.map((v) => WD_DAT[v]).join(", ")} ${at()}`;
    }
    if (isN(dom) && dow === "*") return `Ежемесячно ${+dom}-го числа ${at()}`;
  }
  return null;
};

// Всегда строка: фраза либо запасной текст.
export const describeCron = (cron) => {
  const phrase = humanizeCron(cron);
  if (phrase) return phrase;
  return isValidCron(cron) ? `По расписанию · ${cron}` : "Расписание не задано";
};

// Ближайшие срабатывания (по TZ организации). guard страхует от «мёртвых»
// выражений, которые не совпадут никогда.
export const nextCronRuns = (cron, count = 3, from = new Date()) => {
  if (!isValidCron(cron)) return [];
  const tz = getLocalStorageData().timezone || DEFAULT_TIMEZONE;
  const [mi, ho, dom, mo, dowRaw] = cron.trim().split(/\s+/);
  const dow = dowRaw.replace(/7/g, "0");

  const out = [];
  const d = toZonedTime(new Date(from), tz);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  let guard = 0;
  while (out.length < count && guard < 535000) {
    guard += 1;
    if (
      checkPart(mi, d.getMinutes(), 0) &&
      checkPart(ho, d.getHours(), 0) &&
      checkPart(dom, d.getDate(), 1) &&
      checkPart(mo, d.getMonth() + 1, 1) &&
      checkPart(dow, d.getDay(), 0)
    ) {
      out.push(fromZonedTime(new Date(d), tz));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
};

// «Пт, 18 июл · 09:00» — по TZ организации.
export const formatCronRun = (date) => {
  if (!date) return "—";
  const tz = getLocalStorageData().timezone || DEFAULT_TIMEZONE;
  const d = toZonedTime(new Date(date), tz);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

// «через 15 ч» — не зависит от TZ (разность инстантов одинакова).
export const relativeToNow = (date) => {
  if (!date) return "";
  const m = Math.round((new Date(date) - new Date()) / 60000);
  if (m < 1) return "сейчас";
  if (m < 60) return `через ${m} ${pMin(m)}`;
  const h = Math.round(m / 60);
  if (h < 24) return `через ${h} ${pHour(h)}`;
  const dd = Math.round(h / 24);
  return `через ${dd} ${pDay(dd)}`;
};

/* ---------- Конструктор: состояние ⇄ cron ---------- */

export const defaultScheduleState = () => ({
  freq: "daily",
  minute: 0,
  hour: 9,
  weekdaysOnly: false,
  days: [1, 3, 5],
  everyN: 30,
  everyUnit: "minutes",
  dom: 1,
});

export const buildCron = (s) => {
  if (s.freq === "minutes") {
    return s.everyUnit === "hours"
      ? `0 */${s.everyN} * * *`
      : `*/${s.everyN} * * * *`;
  }
  if (s.freq === "hourly") return `${s.minute} * * * *`;
  if (s.freq === "daily") {
    return `${s.minute} ${s.hour} * * ${s.weekdaysOnly ? "1-5" : "*"}`;
  }
  if (s.freq === "weekly") {
    const days = s.days.length
      ? [...s.days].sort((a, b) => a - b).join(",")
      : "*";
    return `${s.minute} ${s.hour} * * ${days}`;
  }
  if (s.freq === "monthly") return `${s.minute} ${s.hour} ${s.dom} * *`;
  return "0 9 * * *";
};

// Обратный разбор в состояние конструктора; null — если строка не сводится к
// «простым» правилам (тогда конструктор остаётся в режиме cron-строки).
export const parseCronToState = (cron) => {
  if (!isValidCron(cron)) return null;
  const [mi, ho, dom, mo, dow] = cron.trim().split(/\s+/);
  if (mo !== "*") return null;
  const s = defaultScheduleState();

  if (/^\*\/\d+$/.test(mi) && ho === "*" && dom === "*" && dow === "*") {
    return { ...s, freq: "minutes", everyUnit: "minutes", everyN: +mi.split("/")[1] };
  }
  if (mi === "0" && /^\*\/\d+$/.test(ho) && dom === "*" && dow === "*") {
    return { ...s, freq: "minutes", everyUnit: "hours", everyN: +ho.split("/")[1] };
  }
  if (isN(mi) && ho === "*" && dom === "*" && dow === "*") {
    return { ...s, freq: "hourly", minute: +mi };
  }
  if (isN(mi) && isN(ho)) {
    if (dom === "*" && dow === "*") {
      return { ...s, freq: "daily", minute: +mi, hour: +ho, weekdaysOnly: false };
    }
    if (dom === "*" && dow === "1-5") {
      return { ...s, freq: "daily", minute: +mi, hour: +ho, weekdaysOnly: true };
    }
    if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) {
      const days = [];
      dow.split(",").forEach((x) => {
        const v = +x === 7 ? 0 : +x;
        if (!days.includes(v)) days.push(v);
      });
      return { ...s, freq: "weekly", minute: +mi, hour: +ho, days };
    }
    if (isN(dom) && dow === "*") {
      return { ...s, freq: "monthly", minute: +mi, hour: +ho, dom: +dom };
    }
  }
  return null;
};

export const WEEKDAYS = WD;
