// Каталог статусов присутствия сотрудников.
// Держать в синхронизации три копии: backend/utils/workStatuses.js,
// telegram-bot/utils/workStatuses.js, frontend/src/util/work-statuses.js —
// синхронизация касается кодов, подписей, порядка и полей kind/manual/visit.
// Порядок массива задаёт порядок групп в баре статусов и на Telegram-табло.
//
// color здесь — css-переменные (--ws-st-* в styles/tailwind.css): светлая тема
// приглушённее, тёмная ярче; копии бота/бэкенда обходятся без цвета.
//
// СЕМАНТИКА ЖИВЁТ ЗДЕСЬ, а не в списках кодов по компонентам:
//   kind   — working: на связи; break: на смене, но недоступен (обед);
//            away: его нет; idle: рабочее время не идёт
//   manual — можно ли выбрать самому (отсутствия и «не на работе» ставит автоматика)
//   visit  — можно ли отправить к клиенту физически
export const WORK_STATUSES = [
  { code: "office", label: "в офисе", emoji: "🏢", kind: "working", manual: true, visit: true, longLived: false, color: "var(--ws-st-office)" },
  { code: "remote", label: "на удалёнке", emoji: "🏠", kind: "working", manual: true, visit: false, longLived: false, color: "var(--ws-st-remote)" },
  { code: "trip", label: "на выезде", emoji: "🚗", kind: "working", manual: true, visit: true, longLived: false, color: "var(--ws-st-trip)" },
  { code: "lunch", label: "обед", emoji: "🍜", kind: "break", manual: true, visit: false, longLived: false, color: "var(--ws-st-lunch)" },
  { code: "offshift", label: "не на работе", emoji: "🌙", kind: "idle", manual: false, visit: false, longLived: false, color: "var(--ws-st-offshift)" },
  { code: "vacation", label: "отпуск", emoji: "🌴", kind: "away", manual: false, visit: false, longLived: true, color: "var(--ws-st-vacation)" },
  { code: "sick", label: "болею", emoji: "🤒", kind: "away", manual: false, visit: false, longLived: true, color: "var(--ws-st-sick)" },
  { code: "absent", label: "отсутствует", emoji: "🚫", kind: "away", manual: false, visit: false, longLived: true, color: "var(--ws-st-absent)" },
  { code: "unset", label: "не указан", emoji: "▫️", kind: "idle", manual: true, visit: false, longLived: false, color: "var(--ws-st-unset)" },
];

export const DEFAULT_WORK_STATUS = "unset";

const codesWhere = (predicate) =>
  WORK_STATUSES.filter(predicate).map((status) => status.code);

export const MANUAL_STATUS_CODES = codesWhere((s) => s.manual);
// «Сейчас на связи» — обед сюда не входит: человек на смене, но недоступен
export const WORKING_STATUS_CODES = codesWhere((s) => s.kind === "working");
// На смене: работает или на обеде
export const ON_SHIFT_STATUS_CODES = codesWhere(
  (s) => s.kind === "working" || s.kind === "break",
);
export const BREAK_STATUS_CODES = codesWhere((s) => s.kind === "break");
export const AWAY_STATUS_CODES = codesWhere((s) => s.kind === "away");
export const VISIT_STATUS_CODES = codesWhere((s) => s.visit);

export const getWorkStatusMeta = (code) =>
  WORK_STATUSES.find((s) => s.code === code) ??
  WORK_STATUSES.find((s) => s.code === DEFAULT_WORK_STATUS);

/**
 * Может ли пользователь поставить себе этот статус руками — зеркало
 * canSetStatusManually на бэкенде. Нужен именно на фронте: action «Мой
 * аккаунт» намеренно глотает ошибки, поэтому запрещённые пункты надо не
 * показывать, а не полагаться на 403.
 */
export const canSetStatusManually = (user, code) => {
  const meta = WORK_STATUSES.find((s) => s.code === code);
  if (!meta) return false;
  if (user?.remoteOnly && code === "office") return false;
  if (meta.manual) return true;
  if (user?.workTimeMode === "free") return true;
  return Boolean(user?.isAdmin || user?.permissions?.canManageWorkSchedules);
};

/** Статусы для переключателя конкретного человека. */
export const selectableStatuses = (user) =>
  WORK_STATUSES.filter(
    (status) =>
      canSetStatusManually(user, status.code),
  );
