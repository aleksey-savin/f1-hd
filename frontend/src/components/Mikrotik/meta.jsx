import { RiCloudLine, RiRouterLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Канон статуса записи мониторинга: цветной текст с точкой (не заливной бейдж).
// Ключ — rowStatus(row) из store/lists/mikrotik-devices.
export const STATUS_META = {
  online: {
    label: "В сети",
    text: "tw:text-accent-text",
    dot: "tw:bg-primary",
  },
  offline: {
    label: "Не в сети",
    text: "tw:text-destructive",
    dot: "tw:bg-destructive",
  },
  disabled: {
    label: "Выключен",
    text: "tw:text-faint",
    dot: "tw:bg-faint",
  },
};

// Иконка класса устройства: CHR — облако, остальные — роутер.
export const deviceIcon = (row) => {
  const board = String(row?.boardName || "").toLowerCase();
  if (board.startsWith("chr") || row?.type === "Cloud Hosted Router") {
    return RiCloudLine;
  }
  return RiRouterLine;
};

// Плитка-иконка устройства с live-точкой статуса (язык TechSection): общая для
// строки списка, шторки и hero страницы записи.
export const DeviceTile = ({ row, size = "md", className }) => {
  const Icon = deviceIcon(row);
  const status = row?.monitoringEnabled ? row?.status || "offline" : "disabled";
  const meta = STATUS_META[status] || STATUS_META.offline;
  return (
    <span
      aria-hidden
      className={cn(
        "tw:relative tw:grid tw:flex-none tw:place-items-center tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
        size === "lg"
          ? "tw:size-14 tw:rounded-2xl"
          : size === "sm"
            ? "tw:size-9 tw:rounded-lg"
            : "tw:size-11 tw:rounded-xl",
        className,
      )}
    >
      <Icon size={size === "lg" ? 26 : size === "sm" ? 17 : 20} />
      <span
        className={cn(
          "tw:absolute tw:rounded-full tw:border-2 tw:border-card",
          size === "lg"
            ? "tw:-right-0.5 tw:-bottom-0.5 tw:size-3.5"
            : "tw:-right-1 tw:-bottom-1 tw:size-3",
          meta.dot,
        )}
      />
    </span>
  );
};

// «3 ч 12 мин», «14 мин», «2 д 4 ч», «меньше минуты».
export const formatDurationShort = (ms) => {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  if (totalMinutes < 1) return "меньше минуты";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (minutes && !days) parts.push(`${minutes} мин`);
  return parts.join(" ") || "меньше минуты";
};

// «2 мин назад» / «только что» / полная дата для старого. Переехал в
// util/format-date (тот же формат нужен строке состояния почтовых каналов);
// здесь остаётся реэкспортом — импорты модуля Mikrotik не трогаем.
export { formatAgo } from "../../util/format-date";

// «99,87%» (ru-запятая, tabular на месте использования).
export const formatUptime = (pct) =>
  pct == null
    ? null
    : `${pct.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;

// Тон цифры доступности: тихая норма, янтарь < 99, красный < 95.
export const uptimeToneClass = (pct) => {
  if (pct == null) return "tw:text-faint";
  if (pct < 95) return "tw:font-semibold tw:text-destructive";
  if (pct < 99) return "tw:font-semibold tw:text-warning";
  return "tw:text-muted-foreground";
};

const HOUR_MS = 60 * 60 * 1000;

const toneForDowntime = (downtimeMs, windowMs) => {
  if (downtimeMs <= 0) return "ok";
  if (downtimeMs >= HOUR_MS || downtimeMs >= windowMs / 2) return "down";
  return "warn";
};

// Сегменты ленты из карты дней списка (uptimeDays: null | downtimeMs за окно
// 24 часа). Идущий простой пульсирует последним окном.
export const daySegments = (days, { ongoing = false } = {}) => {
  if (!Array.isArray(days)) return null;
  const segments = days.map((downtime) => ({
    tone: downtime == null ? "none" : toneForDowntime(downtime, 24 * HOUR_MS),
  }));
  if (ongoing) {
    const last = segments.length - 1;
    if (last >= 0 && segments[last].tone !== "none") {
      segments[last] = { tone: "down", pulse: true };
    }
  }
  return segments;
};

// Сегменты ленты из отчёта доступности: [from..to] нарезается на bucketCount
// окон, простои суммируются по пересечению с эпизодами.
export const reportSegments = (report, bucketCount) => {
  if (!report) return null;
  const from = new Date(report.from).getTime();
  const to = new Date(report.to).getTime();
  const since = new Date(report.monitoredSince || report.from).getTime();
  if (!(to > from)) return null;
  const step = (to - from) / bucketCount;

  const intervals = (report.outages || []).map((outage) => [
    new Date(outage.startedAt).getTime(),
    outage.endedAt ? new Date(outage.endedAt).getTime() : to,
  ]);

  const segments = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const winStart = from + index * step;
    const winEnd = winStart + step;
    if (winEnd <= since) {
      segments.push({ tone: "none" });
      continue;
    }
    const effStart = Math.max(winStart, since);
    let downtime = 0;
    for (const [start, end] of intervals) {
      const overlap = Math.min(end, winEnd) - Math.max(start, effStart);
      if (overlap > 0) downtime += overlap;
    }
    segments.push({ tone: toneForDowntime(downtime, winEnd - effStart) });
  }

  if (report.current?.status === "offline") {
    const last = segments.length - 1;
    if (last >= 0 && segments[last].tone !== "none") {
      segments[last] = { tone: "down", pulse: true };
    }
  }
  return segments;
};

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// «ежедневно в 03:00» / «еженедельно, вс в 03:30» / «ежемесячно, 1-го в 03:00».
export const formatSchedule = (schedule) => {
  if (!schedule || schedule.frequency === "off" || !schedule.frequency) {
    return null;
  }
  const time = schedule.time || "03:00";
  switch (schedule.frequency) {
    case "daily":
      return `ежедневно в ${time}`;
    case "weekly":
      return `еженедельно, ${WEEKDAYS_RU[schedule.weekday ?? 1] || "пн"} в ${time}`;
    case "monthly":
      return `ежемесячно, ${schedule.dayOfMonth ?? 1}-го в ${time}`;
    default:
      return null;
  }
};
