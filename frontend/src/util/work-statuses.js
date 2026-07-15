// Каталог статусов присутствия сотрудников.
// Держать в синхронизации три копии: backend/utils/workStatuses.js,
// telegram-bot/utils/workStatuses.js, frontend/src/util/work-statuses.js —
// синхронизация касается кодов, подписей, порядка и longLived.
// Порядок массива задаёт порядок групп в баре статусов и на Telegram-табло.
// color здесь — css-переменные (--ws-st-* в styles/tailwind.css): светлая
// тема приглушённее, тёмная ярче; копии бота/бэкенда остаются на hex.
export const WORK_STATUSES = [
  { code: "office", label: "в офисе", emoji: "🏢", color: "var(--ws-st-office)", longLived: false },
  { code: "remote", label: "на удалёнке", emoji: "🏠", color: "var(--ws-st-remote)", longLived: false },
  { code: "trip", label: "на выезде", emoji: "🚗", color: "var(--ws-st-trip)", longLived: false },
  { code: "lunch", label: "обед", emoji: "🍜", color: "var(--ws-st-lunch)", longLived: false },
  { code: "vacation", label: "отпуск", emoji: "🌴", color: "var(--ws-st-vacation)", longLived: true },
  { code: "sick", label: "болею", emoji: "🤒", color: "var(--ws-st-sick)", longLived: true },
  { code: "unset", label: "не указан", emoji: "▫️", color: "var(--ws-st-unset)", longLived: false },
];

export const DEFAULT_WORK_STATUS = "unset";

export const getWorkStatusMeta = (code) =>
  WORK_STATUSES.find((s) => s.code === code) ??
  WORK_STATUSES.find((s) => s.code === DEFAULT_WORK_STATUS);
