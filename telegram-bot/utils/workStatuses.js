// Каталог статусов присутствия сотрудников.
// Держать в синхронизации три копии: backend/utils/workStatuses.js,
// telegram-bot/utils/workStatuses.js, frontend/src/util/work-statuses.js.
// Порядок массива задаёт порядок групп на Telegram-табло и в баре статусов.
const WORK_STATUSES = [
  { code: "office", label: "в офисе", emoji: "🏢", longLived: false },
  { code: "remote", label: "на удалёнке", emoji: "🏠", longLived: false },
  { code: "trip", label: "на выезде", emoji: "🚗", longLived: false },
  { code: "lunch", label: "обед", emoji: "🍜", longLived: false },
  { code: "vacation", label: "отпуск", emoji: "🌴", longLived: true },
  { code: "sick", label: "болею", emoji: "🤒", longLived: true },
  { code: "unset", label: "не указан", emoji: "▫️", longLived: false },
];

const WORK_STATUS_CODES = WORK_STATUSES.map((s) => s.code);
const WORK_STATUS_BY_CODE = Object.fromEntries(
  WORK_STATUSES.map((s) => [s.code, s]),
);
const DEFAULT_WORK_STATUS = "unset";
// longLived-статусы (отпуск, болею) переживают ночной автосброс
const LONG_LIVED_WORK_STATUSES = WORK_STATUSES.filter((s) => s.longLived).map(
  (s) => s.code,
);

module.exports = {
  WORK_STATUSES,
  WORK_STATUS_CODES,
  WORK_STATUS_BY_CODE,
  DEFAULT_WORK_STATUS,
  LONG_LIVED_WORK_STATUSES,
};
