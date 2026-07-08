// Общие помощники страницы персонального отчёта.
// Сервер отдаёт время в минутах — все форматтеры принимают минуты.

export const formatMinutes = (minutes) => {
  const value = Math.round(Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours === 0) {
    return `${mins} мин`;
  }
  if (mins === 0) {
    return `${hours} ч`;
  }
  return `${hours} ч ${mins} мин`;
};

// Статусы работ в биллинге — тексты согласованы с остальным модулем финансов
export const WORK_STATUS_META = {
  preview: { label: "Превью", variant: "info" },
  pendingApproval: { label: "На утверждении", variant: "secondary" },
  approved: { label: "Утверждён", variant: "success" },
  declined: { label: "Отклонён", variant: "danger" },
  underReview: { label: "На проверке", variant: "warning" },
  none: { label: "Вне биллинга", variant: "secondary" },
};

export const workStatusMeta = (status) =>
  WORK_STATUS_META[status || "none"] || WORK_STATUS_META.none;

export const SCHEDULE_SOURCE_LABELS = {
  plan: "график тарифа",
  company: "график компании",
  fallback: "резервный график",
};

export const WORK_ISSUE_LABELS = {
  noTimestamps: "нет времени",
  invalidRange: "время некорректно",
  over24h: "дольше 24 ч",
};

// Дельта к прошлому периоду для KPI-карт; при нулевой базе процент не считаем
export const computeDelta = (current, previous) => {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) {
    return { direction: curr > 0 ? "up" : "same", percent: null };
  }
  const percent = Math.round(((curr - prev) / prev) * 100);
  return {
    direction: percent > 0 ? "up" : percent < 0 ? "down" : "same",
    percent,
  };
};

// Цвета серий графика/полос. Значения заданы CSS-переменными в index.css
// (тёмная тема переопределяет переработку в dark-theme.css); палитра
// проверена валидатором на обеих поверхностях. Смена темы перезагружает
// страницу, поэтому одноразового чтения переменной достаточно.
export const chartColor = (name, fallback) => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};
