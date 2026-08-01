import {
  RiComputerLine,
  RiFocus3Line,
  RiHardDrive2Line,
  RiHeadphoneLine,
  RiMacbookLine,
  RiPlugLine,
  RiPrinterLine,
  RiRouterLine,
  RiServerLine,
  RiSmartphoneLine,
  RiTvLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

/**
 * Каталог учётных состояний техники — единственный источник подписей и тонов
 * для всего приложения: страница «Устройства», секция «Техника», виджет
 * «Окружение», карточка устройства.
 *
 * Тон — это стадия жизненного цикла, а не оценка: в эксплуатации — норма
 * (ok), свободное и запасённое — доступно (info), ремонт — требует внимания
 * (warn), выбывшее — приглушённо (off). Красного здесь нет намеренно: в
 * списках устройств destructive занят живым статусом связи Mikrotik («не в
 * сети»), и второе значение того же цвета сделало бы оба нечитаемыми.
 */
export const DEVICE_STATUS_META = {
  readyForDeployment: { label: "Готово к выдаче", tone: "info" },
  deployed: { label: "В эксплуатации", tone: "ok" },
  inReserve: { label: "В резерве", tone: "info" },
  inRepair: { label: "В ремонте", tone: "warn" },
  decommissioned: { label: "Списано", tone: "off" },
  disposed: { label: "Утилизировано", tone: "off" },
};

/** Порядок стадий для ленты парка и фильтров — по ходу жизненного цикла. */
export const DEVICE_STATUS_ORDER = [
  "deployed",
  "readyForDeployment",
  "inReserve",
  "inRepair",
  "decommissioned",
  "disposed",
];

/** Тот же каталог опциями (фильтры, формы). */
export const DEVICE_STATUS_OPTIONS = DEVICE_STATUS_ORDER.map((value) => ({
  value,
  label: DEVICE_STATUS_META[value].label,
}));

/** Подписи отдельной картой — для легаси-экранов, которым нужен только текст. */
export const DEVICE_STATUS_LABELS = Object.fromEntries(
  Object.entries(DEVICE_STATUS_META).map(([code, meta]) => [code, meta.label]),
);

const TONE_TEXT = {
  ok: "text-accent-text",
  warn: "text-warning",
  info: "text-info",
  bad: "text-destructive",
  off: "text-faint",
};
export const TONE_DOT = {
  ok: "bg-primary",
  warn: "bg-warning",
  info: "bg-info",
  bad: "bg-destructive",
  off: "bg-faint",
};

/** Цветной статус-текст с точкой — язык статус-борда, не заливной бейдж. */
export const DeviceStatusText = ({ tone = "off", className, children }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
      TONE_TEXT[tone],
      className,
    )}
  >
    <span
      aria-hidden
      className={cn("size-1.5 flex-none rounded-full", TONE_DOT[tone])}
    />
    {children}
  </span>
);

/**
 * Живой статус связи Mikrotik. Только для управляемых устройств; при
 * выключенном мониторинге данные устаревшие — так и пишем, не утверждая
 * онлайн/офлайн.
 */
export const mikrotikStatus = (device) => {
  if (!device.mikrotikManaged) return null;
  if (!device.mikrotikMonitoringEnabled)
    return { label: "мониторинг выкл", tone: "off" };
  if (device.mikrotikStatus === "online")
    return { label: "В сети", tone: "ok" };
  return { label: "Не в сети", tone: "bad" };
};

/**
 * Иконка по названию типа устройства — типы свободные (каталог заводит
 * администратор), поэтому матчим по ключевым словам с разумным запасным
 * вариантом.
 */
export const deviceIcon = (typeName = "") => {
  const t = (typeName || "").toLowerCase();
  if (/монитор|дисплей/.test(t)) return RiTvLine;
  if (/ноут|laptop/.test(t)) return RiMacbookLine;
  if (/систем|пк\b|компьютер|моноблок|настольн|desktop/.test(t))
    return RiComputerLine;
  if (/принт|мфу|сканер|печат/.test(t)) return RiPrinterLine;
  if (/сет|роутер|коммутат|маршрут|точка доступа|switch|router/.test(t))
    return RiRouterLine;
  if (/телефон|смартфон|phone/.test(t)) return RiSmartphoneLine;
  if (/сервер|server|схд|nas/.test(t)) return RiServerLine;
  if (/гарнитур|наушник|headset/.test(t)) return RiHeadphoneLine;
  if (/ибп|ups|бесперебойн|блок питания/.test(t)) return RiPlugLine;
  if (/камер|видеонаблюд/.test(t)) return RiFocus3Line;
  return RiHardDrive2Line;
};
