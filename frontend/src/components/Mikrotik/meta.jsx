import { RiCloudLine, RiRouterLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Канон статуса записи мониторинга: цветной текст с точкой (не заливной бейдж).
// Ключ — rowStatus(row) из store/lists/mikrotik-devices. `tone` — тон для
// app/device-status → DeviceStatusText: строка борда рисует статус тем же
// компонентом, что реестр устройств.
export const STATUS_META = {
  online: {
    label: "В сети",
    tone: "ok",
    text: "text-accent-text",
    dot: "bg-primary",
  },
  offline: {
    label: "Не в сети",
    tone: "bad",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  disabled: {
    label: "Выключен",
    tone: "off",
    text: "text-faint",
    dot: "bg-faint",
  },
};

// Каталог причин пересечения диапазонов (ключ — overlap.kind с бэкенда):
// повторившаяся сеть означает три разных факта, и подпись с тоном у каждого
// свои. Каталог читают лента-сводки, заголовок группы и точка в строке
// реестра — чтобы вторая копия правила не разъехалась с первой.
//
// Красный только у поломки: адрес физически занят двумя устройствами. Разные
// маски — предупреждение: сеть поднимется, но перекрывает соседнюю. Общая сеть
// тоном не выделяется вовсе — два конца GRE и management-VLAN на пачке
// коммутаторов штатны, и красить их значило бы вернуть ту самую подсветку,
// которая стояла у четверти строк и ничего не различала.
export const OVERLAP_META = {
  addressClash: {
    label: "Адрес занят дважды",
    short: "Занят дважды",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  maskOverlap: {
    label: "Сети вложены",
    short: "Вложены",
    text: "text-warning",
    dot: "bg-warning",
  },
  sharedNetwork: {
    label: "Общая сеть",
    short: "Общая",
    text: "text-muted-foreground",
    dot: "bg-info",
  },
};

/** Порядок причин — от поломки к норме, тот же, что в ответе бэкенда. */
export const OVERLAP_ORDER = ["addressClash", "maskOverlap", "sharedNetwork"];

/**
 * Фраза под заголовком группы: называет ПРИЧИНУ конкретными значениями, а не
 * повторяет подпись каталога. «172.16.40.1/30 занят на двух устройствах»
 * проверяемо, «Адрес занят дважды» — нет.
 */
export const overlapReason = (overlap) => {
  if (overlap.kind === "addressClash") {
    return `${overlap.clashing.join(", ")} — на разных устройствах`;
  }
  if (overlap.kind === "maskOverlap") {
    const [widest, ...rest] = overlap.masks;
    return `/${widest} перекрывает ${rest.map((mask) => `/${mask}`).join(", ")}`;
  }
  return `одна сеть на ${overlap.deviceCount} ${
    overlap.deviceCount === 1 ? "устройстве" : "устройствах"
  }, адреса разные`;
};

// Иконка класса устройства: CHR — облако, остальные — роутер.
const deviceIcon = (row) => {
  const board = String(row?.boardName || "").toLowerCase();
  if (board.startsWith("chr") || row?.type === "Cloud Hosted Router") {
    return RiCloudLine;
  }
  return RiRouterLine;
};

// Плитка-иконка устройства с live-точкой статуса: строка борда (md — плитка
// строки списка, 48) и hero страницы записи (lg — 56). Без кольца: кольцо
// только у настоящей картинки (гайд → «Анатомия списка»). Точка — тем же
// диалектом, что у реестра устройств (обводка цвета панели через ring-2):
// один факт «в сети / не в сети» — один вид на обеих страницах.
export const DeviceTile = ({ row, size = "md", className }) => {
  const Icon = deviceIcon(row);
  const status = row?.monitoringEnabled ? row?.status || "offline" : "disabled";
  const meta = STATUS_META[status] || STATUS_META.offline;
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid flex-none place-items-center bg-accent text-muted-foreground",
        size === "lg" ? "size-14 rounded-2xl" : "size-12 rounded-xl",
        className,
      )}
    >
      <Icon size={size === "lg" ? 26 : 22} />
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-card",
          size === "lg" ? "size-3.5" : "size-2.5",
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
  if (pct == null) return "text-faint";
  if (pct < 95) return "font-semibold text-destructive";
  if (pct < 99) return "font-semibold text-warning";
  return "text-muted-foreground";
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
