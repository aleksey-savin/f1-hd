// Каталог статусов присутствия сотрудников.
// Держать в синхронизации три копии: backend/utils/workStatuses.js,
// telegram-bot/utils/workStatuses.js, frontend/src/util/work-statuses.js.
// Порядок массива задаёт порядок групп в баре статусов и на Telegram-табло.
// color подобран читаемым и на тёмной, и на светлой теме.
export const WORK_STATUSES = [
  { code: "office", label: "в офисе", emoji: "🏢", color: "#00bc8c", longLived: false },
  { code: "remote", label: "на удалёнке", emoji: "🏠", color: "#4d94e8", longLived: false },
  { code: "trip", label: "на выезде", emoji: "🚗", color: "#eb9c14", longLived: false },
  { code: "lunch", label: "обед", emoji: "🍜", color: "#f07030", longLived: false },
  { code: "vacation", label: "отпуск", emoji: "🌴", color: "#a58ae0", longLived: true },
  { code: "sick", label: "болею", emoji: "🤒", color: "#f05252", longLived: true },
  { code: "unset", label: "не указан", emoji: "▫️", color: "#82898f", longLived: false },
];

export const DEFAULT_WORK_STATUS = "unset";

export const getWorkStatusMeta = (code) =>
  WORK_STATUSES.find((s) => s.code === code) ??
  WORK_STATUSES.find((s) => s.code === DEFAULT_WORK_STATUS);
