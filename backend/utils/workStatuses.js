// Каталог статусов присутствия сотрудников.
// Держать в синхронизации две копии: backend/utils/workStatuses.js и
// frontend/src/util/work-statuses.js. Третьей, в отправщике телеграма, больше
// нет: tg-service берёт каталог с сервера через GET /api/bot/config
// (у фронта дополнительно поле color с токеном --ws-st-*).
// Порядок массива задаёт порядок групп на Telegram-табло и в баре статусов.
//
// СЕМАНТИКА ЖИВЁТ ЗДЕСЬ, А НЕ В СПИСКАХ КОДОВ ПО КОДОВОЙ БАЗЕ. Раньше знание
// «кто на связи», «кого можно к клиенту», «что показывать группами» было
// размазано по шести захардкоженным массивам, и новый код статуса ронял
// сотрудника из вида «Сегодня». Теперь всё это — производные ниже.
//
//   kind   — working: на связи; break: на смене, но недоступен (обед);
//            away: его нет; idle: рабочее время не идёт
//   manual — можно ли выбрать самому. Отсутствия (отпуск, болею) ставятся
//            автоматически из подтверждённых заявок, «не на работе» — по графику
//   visit  — можно ли отправить к клиенту физически (удалёнка может быть и из
//            другой страны, поэтому она false)
const WORK_STATUSES = [
  { code: "office", label: "в офисе", emoji: "🏢", kind: "working", manual: true, visit: true, longLived: false },
  { code: "remote", label: "на удалёнке", emoji: "🏠", kind: "working", manual: true, visit: false, longLived: false },
  { code: "trip", label: "на выезде", emoji: "🚗", kind: "working", manual: true, visit: true, longLived: false },
  { code: "lunch", label: "обед", emoji: "🍜", kind: "break", manual: true, visit: false, longLived: false },
  { code: "offshift", label: "не на работе", emoji: "🌙", kind: "idle", manual: false, visit: false, longLived: false },
  { code: "vacation", label: "отпуск", emoji: "🌴", kind: "away", manual: false, visit: false, longLived: true },
  { code: "sick", label: "болею", emoji: "🤒", kind: "away", manual: false, visit: false, longLived: true },
  { code: "absent", label: "отсутствует", emoji: "🚫", kind: "away", manual: false, visit: false, longLived: true },
  { code: "unset", label: "не указан", emoji: "▫️", kind: "idle", manual: true, visit: false, longLived: false },
];

const WORK_STATUS_CODES = WORK_STATUSES.map((s) => s.code);
const WORK_STATUS_BY_CODE = Object.fromEntries(
  WORK_STATUSES.map((s) => [s.code, s]),
);
const DEFAULT_WORK_STATUS = "unset";

const codesWhere = (predicate) => WORK_STATUSES.filter(predicate).map((s) => s.code);

// longLived-статусы (отпуск, болею) переживают ночной автосброс
const LONG_LIVED_WORK_STATUSES = codesWhere((s) => s.longLived);
// Что человек может выбрать себе сам
const MANUAL_STATUS_CODES = codesWhere((s) => s.manual);
// «Сейчас на связи» — фасет списка людей (обед сюда не входит: человек на
// смене, но недоступен)
const WORKING_STATUS_CODES = codesWhere((s) => s.kind === "working");
// На смене: работает или на обеде — этим календарь считает доступность дня
const ON_SHIFT_STATUS_CODES = codesWhere((s) => s.kind === "working" || s.kind === "break");
const BREAK_STATUS_CODES = codesWhere((s) => s.kind === "break");
// Человека нет: отпуск, больничный
const AWAY_STATUS_CODES = codesWhere((s) => s.kind === "away");
// Кого можно физически отправить к клиенту
const VISIT_STATUS_CODES = codesWhere((s) => s.visit);

/**
 * Может ли пользователь поставить себе этот статус руками.
 *
 * Отсутствия и «не на работе» проставляет автоматика — иначе календарь и
 * статусы разъедутся. Исключения:
 *   • свободный режим учёта («free») — человек вне графика, ведёт статусы сам;
 *   • право «Графики и отсутствия» — форс-мажор, руками может всё.
 *
 * `can` приходит параметром: право живёт в роли, а не в документе, и прежнее
 * `user.permissions.canManageWorkSchedules` не видело его вовсе — сюда
 * передают сырой документ пользователя. Вызывающий берёт функцию из
 * `req.auth.can` (свой запрос) или из `canFor(user)` (чужой человек).
 *
 * @param {(request: object) => boolean} can
 */
const canSetStatusManually = (user, code, can) => {
  const meta = WORK_STATUS_BY_CODE[code];
  if (!meta) {
    return false;
  }
  // «Только удалённо» — офиса у человека нет, и это правило уровня API,
  // а не подсказка интерфейса
  if (user?.remoteOnly && code === "office") {
    return false;
  }
  if (meta.manual) {
    return true;
  }
  if (user?.workTimeMode === "free") {
    return true;
  }
  return can({ schedule: ["manage"] });
};

/** Статусы, которые показываем в переключателе конкретному человеку. */
const selectableStatuses = (user, can) =>
  WORK_STATUSES.filter((status) =>
    canSetStatusManually(user, status.code, can),
  );

module.exports = {
  WORK_STATUSES,
  WORK_STATUS_CODES,
  WORK_STATUS_BY_CODE,
  DEFAULT_WORK_STATUS,
  LONG_LIVED_WORK_STATUSES,
  MANUAL_STATUS_CODES,
  WORKING_STATUS_CODES,
  ON_SHIFT_STATUS_CODES,
  BREAK_STATUS_CODES,
  AWAY_STATUS_CODES,
  VISIT_STATUS_CODES,
  canSetStatusManually,
  selectableStatuses,
};
