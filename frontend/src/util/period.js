// Календарные периоды для фильтров списков. Значения — строки yyyy-MM-dd в
// локальном времени (формат нативных полей даты и параметров from/to
// серверных выборок).
export const toIsoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

// Календарный месяц, в который попадает anchor (Date) → { from, to }
export const monthRange = (anchor) => {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: toIsoDay(from), to: toIsoDay(to) };
};

// Прошлый месяц — дефолтный период «Архива»: заявки и работы текущего месяца
// ещё «не в архиве», а глобальная выборка за всё время не несёт смысла
export const prevMonthRange = () => {
  const now = new Date();
  return monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 1));
};

// Диапазон — ровно календарный месяц? (произвольный период из шторки => false;
// от этого зависит подпись MonthStepper и индикация активного фильтра)
export const isFullMonthRange = (from, to) => {
  if (!from || !to) return false;
  const [year, month] = from.split("-").map(Number);
  const range = monthRange(new Date(year, (month || 1) - 1, 1));
  return range.from === from && range.to === to;
};
