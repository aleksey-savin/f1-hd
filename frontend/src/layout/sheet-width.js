/**
 * Ширина листа страницы по маршруту (согласованный макет, см.
 * docs/ux-ui-guide.md).
 *
 * Вынесено из layout/Root.jsx отдельным модулем ради теста рядом:
 * `node --test src/layout/sheet-width.test.js`.
 */

// maxWidth — контентная ширина страницы (её max-w-*) + горизонтальный p-4
// листа. Лист рисуется всегда (см. комментарий у него в Root.jsx), поэтому
// ширина маршрута управляет каждой страницей, а не только теми, под кем лежат
// обои. Маршрутов ФОРМ здесь нет: их ширину даёт хозяин (см. layoutPathname).
const MIGRATED_ROUTES = [
  // Главная: ролевой лендинг, PageShell max-w-7xl + 2×24.
  // «/» — точным совпадением, иначе префикс поймал бы вообще
  // всё остальное приложение.
  { path: "/dashboard", maxWidth: 1328 },
  { path: "/", maxWidth: 1328, exact: true },
  // Заявки: список ListWrapper (max-w-7xl) и карточка (тоже
  // max-w-7xl — рейл + секции + хроника); «/tickets/» (со
  // слэшем) ловит карточку и её вложенные маршруты
  { path: "/tickets/checklist-templates", maxWidth: 1328 },
  // Карточка шире списка: max-w-8xl (1440) + 2×24 — виджету
  // «Окружение» в 1280 не хватало места
  { path: "/tickets/", maxWidth: 1488 },
  { path: "/tickets", maxWidth: 1328, exact: true },
  // Расположения: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/locations/", maxWidth: 944 },
  { path: "/inventory/locations", maxWidth: 1328 },
  // Вендоры: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/vendors/", maxWidth: 944 },
  // ListWrapper: max-w-7xl (1280) + 2×24
  { path: "/inventory/vendors", maxWidth: 1328 },
  { path: "/inventory/device-attributes", maxWidth: 1328 },
  // Поставщики: карточка (max-w-4xl, со слэшем) матчится
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/suppliers/", maxWidth: 944 },
  { path: "/inventory/suppliers", maxWidth: 1328 },
  // Устройства: карточка (max-w-5xl + рейл, со слэшем) идёт
  // ДО точного «/inventory/client-devices»
  { path: "/inventory/client-devices/", maxWidth: 1072 },
  {
    path: "/inventory/client-devices",
    maxWidth: 1328,
    exact: true,
  },
  // Типы: карточка (max-w-4xl, со слэшем) матчится раньше
  // списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/device-types/", maxWidth: 944 },
  { path: "/inventory/device-types", maxWidth: 1328 },
  // Модели: карточка/формы (max-w-4xl, со слэшем) матчатся
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/inventory/device-models/", maxWidth: 944 },
  { path: "/inventory/device-models", maxWidth: 1328 },
  { path: "/ticket-categories", maxWidth: 1328 },
  // Компании: карточка /companies/:id — с рейлом-якорем
  // (max-w-5xl, со слэшем) — идёт ДО точного «/companies»
  { path: "/companies/", maxWidth: 1072 },
  { path: "/companies", maxWidth: 1328, exact: true },
  // Шаблоны: карточка (max-w-4xl, со слэшем) матчится раньше
  // списка (max-w-7xl) — порядок в .find важен
  { path: "/ticket-templates/", maxWidth: 944 },
  // ListWrapper: max-w-7xl (1280) + 2×24
  { path: "/ticket-templates", maxWidth: 1328 },
  // Регламенты: карточка (со слэшем) матчится раньше списка
  { path: "/routine-tasks/", maxWidth: 944 },
  { path: "/routine-tasks", maxWidth: 1328 },
  // Услуги: карточка/формы (max-w-4xl, со слэшем) матчатся
  // раньше списка (max-w-7xl) — порядок в .find важен
  { path: "/finances/service-plans/", maxWidth: 944 },
  { path: "/finances/service-plans", maxWidth: 1328 },
  // Пользователи: список на канве (max-w-7xl), карточка
  // /users/:id — уже (со слэшем), поэтому идёт ДО точного «/users»
  // карточка с рейлом-якорем: max-w-5xl (1024) + 2×24
  { path: "/users/", maxWidth: 1072 },
  { path: "/users", maxWidth: 1328, exact: true },
  // страница: max-w-4xl (896) + 2×24
  { path: "/my-account", maxWidth: 944 },
  // Архив заявок: список ListWrapper (max-w-7xl), вложенных
  // маршрутов нет
  { path: "/archive", maxWidth: 1328, exact: true },
  // Мониторинг Mikrotik: страница записи (max-w-5xl,
  // «records») матчится раньше списка (max-w-7xl)
  { path: "/devices/mikrotik/records", maxWidth: 1072 },
  { path: "/devices/mikrotik", maxWidth: 1328 },
  // Настройки системы: рейл + секции, как «Мой аккаунт»
  { path: "/preferences", maxWidth: 944 },
  // Отчёт «Компании»: сводка и карточки — один каркас
  // PageShell max-w-7xl (1280) + 2×24
  { path: "/report/companies", maxWidth: 1328 },
  // «Диапазоны сетей»: тот же каркас — пять колонок реестра
  // укладываются в 1280 без переносов
  { path: "/report/networks", maxWidth: 1328 },
  // «Согласование работ»: карточка отчёта (max-w-5xl + 2×24)
  // матчится раньше конвейера — со слэшем, как у карточек
  // сущностей под общим префиксом
  // Карточка отчёта шире конвейера: шесть колонок работ на
  // 1024 давились и лезли друг на друга (max-w-7xl + 2×24)
  { path: "/finances/approval/", maxWidth: 1328 },
  { path: "/finances/approval", maxWidth: 1328 },
  // Отчёты по сотрудникам — тот же каркас
  { path: "/finances/employees", maxWidth: 1328 },
  { path: "/finances/my-report", maxWidth: 1328 },
  // Календарь команды — тот же каркас, что у отчётов
  { path: "/team/calendar", maxWidth: 1328 },
  // База знаний: двухпанельный раздел (проводник + заметка)
  // одной шириной на все вложенные маршруты (add, :id)
  { path: "/knowledge-base", maxWidth: 1328 },
];

// Маршрут вне таблицы: ширина по умолчанию — max-w-7xl + поля.
const DEFAULT_SHEET_WIDTH = 1328;

/**
 * Хозяин шторки — маршрут, который видно ЗА формой.
 *
 * Форма живёт вложенным маршрутом списка или карточки, поэтому её адрес
 * начинается с адреса хозяина: «/inventory/suppliers/update/:id» под списком,
 * «/inventory/suppliers/:id/update» под карточкой. Таблица ищет префиксом, и
 * строка карточки («/inventory/suppliers/») ловила бы форму списка раньше
 * самого списка — лист под шторкой сужался бы с 1328 до 944. Поэтому ширину
 * решает не адрес формы, а самое глубокое совпадение БЕЗ `handle.sheet`;
 * список исключений «…/add» и «…/update» в таблице для этого не нужен.
 */
export const layoutPathname = (matches = []) => {
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (match?.handle?.sheet) continue;
    if (match?.pathname) return match.pathname;
  }
  return "/";
};

/** Ширина листа для адреса хозяина; порядок строк в таблице важен. */
export const resolveSheetWidth = (pathname) =>
  MIGRATED_ROUTES.find((route) =>
    route.exact ? pathname === route.path : pathname.startsWith(route.path),
  )?.maxWidth ?? DEFAULT_SHEET_WIDTH;
