import {
  RiBuilding2Line,
  RiCarLine,
  RiCheckboxBlankCircleLine,
  RiHome4Line,
  RiRestaurantLine,
  RiSunLine,
  RiThermometerLine,
  RiWalkLine,
} from "react-icons/ri";

// Каталог статусов присутствия сотрудников.
// Держать в синхронизации три копии: backend/utils/workStatuses.js,
// frontend/src/util/work-statuses.js —
// синхронизация касается кодов, подписей, порядка и полей kind/manual/visit.
// Порядок массива задаёт порядок групп в баре статусов и на Telegram-табло.
//
// color здесь — css-переменные (--ws-st-* в styles/tailwind.css): светлая тема
// приглушённее, тёмная ярче; icon — компонент `Ri*` для веба (бейдж аватара,
// заголовки групп, чипы меню). emoji остаются для Telegram-табло: там иконок
// нет. Копия бэкенда обходится без цвета и иконки.
//
// СЕМАНТИКА ЖИВЁТ ЗДЕСЬ, а не в списках кодов по компонентам:
//   kind   — working: на связи; break: на смене, но недоступен (обед);
//            away: его нет; idle: рабочее время не идёт
//   manual — можно ли выбрать самому (отпуск и болею ставит автоматика;
//            «не на работе» — и график, и сам человек при форс-мажоре)
//   visit  — можно ли отправить к клиенту физически
export const WORK_STATUSES = [
  {
    code: "office",
    label: "в офисе",
    emoji: "🏢",
    kind: "working",
    manual: true,
    visit: true,
    longLived: false,
    color: "var(--ws-st-office)",
    icon: RiBuilding2Line,
  },
  {
    code: "remote",
    label: "на удалёнке",
    emoji: "🏠",
    kind: "working",
    manual: true,
    visit: false,
    longLived: false,
    color: "var(--ws-st-remote)",
    icon: RiHome4Line,
  },
  {
    code: "trip",
    label: "на выезде",
    emoji: "🚗",
    kind: "working",
    manual: true,
    visit: true,
    longLived: false,
    color: "var(--ws-st-trip)",
    icon: RiCarLine,
  },
  {
    code: "lunch",
    label: "обед",
    emoji: "🍜",
    kind: "break",
    manual: true,
    visit: false,
    longLived: false,
    color: "var(--ws-st-lunch)",
    icon: RiRestaurantLine,
  },
  {
    code: "offshift",
    label: "не на работе",
    emoji: "🚶",
    kind: "idle",
    manual: true,
    visit: false,
    longLived: false,
    color: "var(--ws-st-offshift)",
    icon: RiWalkLine,
  },
  {
    code: "vacation",
    label: "отпуск",
    emoji: "🌴",
    kind: "away",
    manual: false,
    visit: false,
    longLived: true,
    color: "var(--ws-st-vacation)",
    icon: RiSunLine,
  },
  {
    code: "sick",
    label: "болею",
    emoji: "🤒",
    kind: "away",
    manual: false,
    visit: false,
    longLived: true,
    color: "var(--ws-st-sick)",
    icon: RiThermometerLine,
  },
  {
    code: "unset",
    label: "не указан",
    emoji: "▫️",
    kind: "idle",
    manual: true,
    visit: false,
    longLived: false,
    color: "var(--ws-st-unset)",
    icon: RiCheckboxBlankCircleLine,
  },
];

const DEFAULT_WORK_STATUS = "unset";

// На смене: работает или на обеде. Остальные срезы каталога (manual, working,
// break, away, visit) отдельными списками не держим — потребители читают поля
// статуса напрямую, а списки-производные повторяли бы правило вторым голосом.
export const ON_SHIFT_STATUS_CODES = WORK_STATUSES.filter(
  (s) => s.kind === "working" || s.kind === "break",
).map((s) => s.code);

export const getWorkStatusMeta = (code) =>
  WORK_STATUSES.find((s) => s.code === code) ??
  WORK_STATUSES.find((s) => s.code === DEFAULT_WORK_STATUS);

/**
 * Может ли пользователь поставить себе этот статус руками — зеркало
 * canSetStatusManually на бэкенде. Нужен именно на фронте: action «Мой
 * аккаунт» намеренно глотает ошибки, поэтому запрещённые пункты надо не
 * показывать, а не полагаться на 403.
 */
const canSetStatusManually = (user, code, can) => {
  const meta = WORK_STATUSES.find((s) => s.code === code);
  if (!meta) return false;
  if (user?.remoteOnly && code === "office") return false;
  if (meta.manual) return true;
  if (user?.workTimeMode === "free") return true;
  return can({ schedule: ["manage"] });
};

/**
 * Статусы для переключателя конкретного человека.
 *
 * `can` приходит параметром, а не берётся из `user`: функции контекст не
 * отдаёт — там лежат только `statements` и `isAdmin`, — и прежнее
 * `user.can({...})` роняло переключатель на TypeError у каждого, кто не
 * администратор (у администратора его прикрывало `isAdmin ||` слева).
 *
 * @param {object} user — чей переключатель
 * @param {(request: object) => boolean} can — из `useCan()`; уже учитывает `isAdmin`
 */
export const selectableStatuses = (user, can) =>
  WORK_STATUSES.filter((status) =>
    canSetStatusManually(user, status.code, can),
  );
