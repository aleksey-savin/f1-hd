const fs = require("node:fs/promises");
const path = require("node:path");

const logger = require("../../utils/logger");

/**
 * Загрузка производственного календаря из внешних источников.
 *
 * Три уровня, в этом порядке:
 *  1) xmlcalendar.ru — статический XML, без ключей и лимитов. Единственный,
 *     кто отдаёт НАЗВАНИЯ праздников и переносы, поэтому основной.
 *  2) isdayoff.ru — строка кодов на каждый день года. Названий нет, но состав
 *     рабочих/нерабочих совпадает.
 *  3) Снимок в репозитории (backend/data/production-calendar/<cc>-<год>.json) —
 *     чтобы построение отчёта не зависело от доступности чужого сайта.
 *
 * Наружу все три отдают ОДНУ форму: { source, holidays[], days[], statistic }.
 * days содержит только дни-исключения; обычные Сб/Вс выводятся из дня недели.
 */

const TIMEOUT_MS = 10000;
const BUNDLED_DIR = path.join(__dirname, "..", "..", "data", "production-calendar");

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

const daysInYear = (year) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

// День недели по UTC — календарная дата, а не инстант: сдвигать зоной нечего.
const isWeekend = (year, month, day) => {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "text/plain,application/xml,application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
};

/**
 * Норма года при 40-часовой неделе — та же величина, что xmlcalendar кладёт в
 * statistic. Считаем сами и на ней же проверяем разбор: расхождение означает,
 * что формат источника поехал.
 */
const calcStatistic = (year, days) => {
  const byDate = new Map(days.map((day) => [day.date, day.type]));
  let workdays = 0;
  let hours40 = 0;

  for (let month = 1; month <= 12; month += 1) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const key = dateKey(year, month, day);
      const type = byDate.get(key);
      if (type === "holiday" || type === "dayoff") {
        continue;
      }
      if (isWeekend(year, month, day) && type !== "work") {
        continue;
      }
      workdays += 1;
      hours40 += type === "short" ? 7 : 8;
    }
  }

  return { workdays, hours40 };
};

/** xmlcalendar.ru — плоский XML, разбираем регулярками (зависимости не нужны). */
const parseXmlCalendar = (xml, year) => {
  const holidays = [...xml.matchAll(/<holiday\s+id="(\d+)"\s+title="([^"]*)"/g)].map((m) => ({
    id: Number(m[1]),
    title: m[2],
  }));

  const days = [];
  for (const match of xml.matchAll(/<day\s+([^/>]+)\/?>/g)) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([a-z]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    if (!attrs.d) {
      continue;
    }
    const [month, day] = attrs.d.split(".");
    const date = `${year}-${month}-${day}`;

    if (attrs.t === "2") {
      days.push({ date, type: "short" });
    } else if (attrs.t === "3") {
      days.push({ date, type: "work" });
    } else if (attrs.h) {
      days.push({ date, type: "holiday", holidayId: Number(attrs.h) });
    } else if (attrs.f) {
      days.push({
        date,
        type: "dayoff",
        transferredFrom: `${year}-${attrs.f.replace(".", "-")}`,
      });
    } else {
      days.push({ date, type: "holiday" });
    }
  }

  if (!days.length) {
    throw new Error("В ответе xmlcalendar нет ни одного дня");
  }
  return { source: "xmlcalendar", holidays, days, statistic: calcStatistic(year, days) };
};

/**
 * isdayoff.ru — строка длиной в год: 0 рабочий, 1 нерабочий, 2 сокращённый,
 * 4 нерабочий по covid-указам (для нас — обычный нерабочий). Названий
 * праздников нет, поэтому дни-праздники приезжают безымянными.
 */
const parseIsDayOff = (body, year) => {
  const codes = body.trim();
  const expected = daysInYear(year);
  if (codes.length !== expected) {
    throw new Error(`Ожидали ${expected} символов, пришло ${codes.length}`);
  }

  const days = [];
  let index = 0;
  for (let month = 1; month <= 12; month += 1) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const code = codes[index];
      index += 1;
      const weekend = isWeekend(year, month, day);
      const date = dateKey(year, month, day);

      if (code === "2") {
        days.push({ date, type: "short" });
      } else if ((code === "1" || code === "4") && !weekend) {
        days.push({ date, type: "holiday" });
      } else if (code === "0" && weekend) {
        days.push({ date, type: "work" });
      }
    }
  }

  return { source: "isdayoff", holidays: [], days, statistic: calcStatistic(year, days) };
};

const fromXmlCalendar = async (country, year) =>
  parseXmlCalendar(
    await fetchText(`https://xmlcalendar.ru/data/${country}/${year}/calendar.xml`),
    year,
  );

const fromIsDayOff = async (country, year) =>
  parseIsDayOff(
    await fetchText(`https://isdayoff.ru/api/getdata?year=${year}&cc=${country}&pre=1`),
    year,
  );

/** Снимок из репозитория. Его нет для всех лет — это нормально. */
const fromBundle = async (country, year) => {
  const raw = await fs.readFile(path.join(BUNDLED_DIR, `${country}-${year}.json`), "utf8");
  const parsed = JSON.parse(raw);
  return {
    source: "bundled",
    holidays: parsed.holidays || [],
    days: parsed.days || [],
    statistic: parsed.statistic || calcStatistic(year, parsed.days || []),
  };
};

const LOADERS = [
  { name: "xmlcalendar", load: fromXmlCalendar },
  { name: "isdayoff", load: fromIsDayOff },
  { name: "bundled", load: fromBundle },
];

/**
 * Проверка правдоподобия разбора. Нужна не от кривого кода, а от кривых
 * данных: на неутверждённый год isdayoff отдаёт сплошные нули, и парсер честно
 * делает из КАЖДОЙ субботы «рабочую» — получается год из 365 рабочих дней.
 * Такой «календарь» хуже отсутствия календаря, поэтому источник отвергаем и
 * идём к следующему; если не подошёл никто, расчёт вернётся к дню недели.
 */
const assertPlausible = ({ days, statistic }, year) => {
  if (statistic.workdays < 200 || statistic.workdays > 300) {
    throw new Error(
      `неправдоподобно: ${statistic.workdays} рабочих дней в ${year} году`,
    );
  }
  // Настоящих переносов на выходные — единицы в год
  const workingWeekends = days.filter((day) => day.type === "work").length;
  if (workingWeekends > 15) {
    throw new Error(
      `неправдоподобно: ${workingWeekends} рабочих выходных в ${year} году`,
    );
  }
};

/**
 * Пробует источники по порядку начиная с предпочитаемого. Возвращает
 * { calendar, errors } — errors нужны строке состояния в настройках, чтобы
 * назвать причину, а не молча показать «не работает».
 */
const loadCalendar = async (country, year, preferred = "xmlcalendar") => {
  const ordered = [
    ...LOADERS.filter((loader) => loader.name === preferred),
    ...LOADERS.filter((loader) => loader.name !== preferred),
  ];

  const errors = [];
  for (const loader of ordered) {
    try {
      const calendar = await loader.load(country, year);
      assertPlausible(calendar, year);
      if (errors.length) {
        logger.log("warn", "Production calendar loaded from fallback source", {
          country,
          year,
          source: loader.name,
          errors,
        });
      }
      return { calendar, errors };
    } catch (error) {
      errors.push(`${loader.name}: ${error.message}`);
    }
  }

  const error = new Error(`Не удалось загрузить календарь ${country} ${year}`);
  error.details = errors;
  throw error;
};

module.exports = {
  loadCalendar,
  calcStatistic,
  parseXmlCalendar,
  parseIsDayOff,
  isWeekend,
  dateKey,
};
