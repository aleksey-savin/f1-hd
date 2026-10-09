// Подписи и геометрия секции «Активность» и плановых отключений — чистые
// функции. Всё здесь считается в поясе ОРГАНИЗАЦИИ (его присылает бэкенд):
// окна заданы в нём, сетка недели нарезана в нём, и подсказка «сегодня
// 20:00–22:00» обязана совпадать с тем, что видно в сетке.

const DAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
// Порядок показа недели — с понедельника.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// «07:00» — время инстанта в заданном поясе.
export const clockIn = (date, timeZone) =>
  new Date(date).toLocaleTimeString("ru", { timeZone, hour: "2-digit", minute: "2-digit" });

const dayKeyIn = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone });

const weekdayIn = (date, timeZone) =>
  DAY_SHORT[
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      new Date(date).toLocaleDateString("en-US", { timeZone, weekday: "short" }),
    )
  ];

// «пн–пт» для подряд идущих дней, иначе перечисление; «ежедневно» для семи.
const daysLabel = (days) => {
  const ordered = WEEK_ORDER.filter((day) => days.includes(day));
  if (ordered.length === 7) return "ежедневно";
  const positions = ordered.map((day) => WEEK_ORDER.indexOf(day));
  const consecutive = positions.every(
    (position, index) => index === 0 || position === positions[index - 1] + 1,
  );
  if (ordered.length >= 3 && consecutive) {
    return `${DAY_SHORT[ordered[0]]}–${DAY_SHORT[ordered[ordered.length - 1]]}`;
  }
  return ordered.map((day) => DAY_SHORT[day]).join(", ");
};

// «Ежедневно, 22:00–07:00» / «Пн–пт, 22:00–07:00; сб, вс, 18:00–09:00».
export const plannedSummary = (windows) => {
  if (!Array.isArray(windows) || windows.length === 0) return null;
  return capitalize(
    windows
      .map((window) => `${daysLabel(window.days)}, ${window.start}–${window.end}`)
      .join("; "),
  );
};

// Слоты недели (день * 24 + час, 0 — воскресенье 00:00), задетые окнами.
// Зеркало plannedSlots бэкенда (services/mikrotik/plannedOffline.js).
export const plannedSlotSet = (windows) => {
  const slots = new Set();
  for (const window of windows || []) {
    if (!CLOCK.test(window?.start) || !CLOCK.test(window?.end)) continue;
    const start = toMinutes(window.start);
    let end = toMinutes(window.end);
    if (end === start) continue;
    if (end < start) end += 1440;
    for (const day of window.days || []) {
      for (let minute = Math.floor(start / 60) * 60; minute < end; minute += 60) {
        slots.add((day * 24 + minute / 60) % 168);
      }
    }
  }
  return slots;
};

// Ступень заливки слота 1–4 относительно самого нагруженного; null — данных нет.
export const slotLevels = (slots) => {
  const max = Math.max(0, ...(slots || []).filter((value) => value !== null));
  return (slots || []).map((value) => {
    if (value === null) return null;
    if (max === 0) return 1;
    const share = value / max;
    return share > 0.75 ? 4 : share > 0.45 ? 3 : share > 0.2 ? 2 : 1;
  });
};

// «сегодня 20:00–22:00» / «завтра 03:00–05:00» / «пн 03:00–05:00»;
// для идущего окна — «до 14:00».
export const quietLabel = (quiet, timeZone, now = new Date()) => {
  if (!quiet) return null;
  if (quiet.current) return `до ${clockIn(quiet.to, timeZone)}`;

  const range = `${clockIn(quiet.from, timeZone)}–${clockIn(quiet.to, timeZone)}`;
  const fromKey = dayKeyIn(quiet.from, timeZone);
  if (fromKey === dayKeyIn(now, timeZone)) return `сегодня ${range}`;
  const tomorrow = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000);
  if (fromKey === dayKeyIn(tomorrow, timeZone)) return `завтра ${range}`;
  return `${weekdayIn(quiet.from, timeZone)} ${range}`;
};
