import type { AccessRequest } from "@/lib/access";

/**
 * Справочник разделов: один ответ на вопросы «как этот раздел называется»,
 * «где его список» и «каким правом он закрыт».
 *
 * До этого те же сведения лежали порознь: адреса — в маршрутах (`App.jsx`),
 * названия и права — в меню (`layout/Navigation/menu.js`), падежи и ссылка на
 * список — в контекстных 404 (`components/Error/entity-context.js`), а обратная
 * ссылка карточки была вписана руками в каждую из четырнадцати карточек. Пятое
 * место и было причиной того, что крошка вела в список раздела даже тому, кто
 * пришёл из другого раздела и права на этот список не имеет.
 *
 * Право берём то же, что стоит на маршруте списка (`handle.can` в `App.jsx`), —
 * крошка ведёт именно туда, и предлагать её без права значит предлагать 403.
 */
export type Section = {
  key: string;
  /** Адрес списка. Он же префикс всех адресов раздела. */
  listTo: string;
  /** Именительный падеж — так раздел подписан в крошке и в меню. */
  label: string;
  /** Право на список; у открытых всем разделов его нет. */
  can?: AccessRequest;
  /** Винительный падеж и местоимение — для контекстных 404. */
  acc?: string;
  pronoun?: string;
  /** Подпись кнопки возврата на 404. */
  backLabel?: string;
  /** В адресе номер, а не идентификатор: 404 называет его («Не нашли заявку №51713»). */
  numeric?: boolean;
  /**
   * Ключ раздела, который отвечает за этот у клиента. У клиента нет списка
   * заявок — его заявки живут блоком на главной, — и возвращать его надо туда,
   * а не на адрес, которого нет в его меню.
   */
  endUserSection?: string;
};

export const SECTIONS: Section[] = [
  { key: "dashboard", listTo: "/dashboard", label: "Главная" },

  {
    key: "tickets",
    listTo: "/tickets",
    label: "Заявки",
    acc: "заявку",
    pronoun: "её",
    backLabel: "К заявкам",
    numeric: true,
    endUserSection: "dashboard",
  },
  { key: "archive", listTo: "/archive", label: "Архив" },

  {
    key: "checklist-templates",
    listTo: "/tickets/checklist-templates",
    label: "Шаблоны чек-листов",
    can: { checklistTemplate: ["manage"] },
  },
  {
    key: "ticket-templates",
    listTo: "/ticket-templates",
    label: "Шаблоны заявок",
    can: { ticketTemplate: ["manage"] },
    acc: "шаблон заявки",
    pronoun: "его",
    backLabel: "К шаблонам",
  },
  {
    key: "routine-tasks",
    listTo: "/routine-tasks",
    label: "Регламенты",
    can: { routineTask: ["manage"] },
    acc: "регламентное задание",
    pronoun: "его",
    backLabel: "К регламентным заданиям",
  },
  {
    key: "ticket-categories",
    listTo: "/ticket-categories",
    label: "Категории",
    can: { ticketCategory: ["manage"] },
    acc: "категорию",
    pronoun: "её",
    backLabel: "К категориям",
  },

  {
    key: "companies",
    listTo: "/companies",
    label: "Компании",
    can: { company: ["read"] },
    acc: "компанию",
    pronoun: "её",
    backLabel: "К компаниям",
  },
  {
    key: "users",
    listTo: "/users",
    label: "Пользователи",
    can: { user: ["read"] },
    acc: "пользователя",
    pronoun: "его",
    backLabel: "К пользователям",
  },
  {
    key: "team-calendar",
    listTo: "/team/calendar",
    label: "Календарь команды",
    can: { schedule: ["read"] },
  },
  {
    key: "roles",
    listTo: "/roles",
    label: "Роли",
    can: { role: ["read"] },
  },

  {
    key: "knowledge-base",
    listTo: "/knowledge-base",
    label: "База знаний",
    can: { knowledge: ["read"] },
    acc: "заметку",
    pronoun: "её",
    backLabel: "К базе знаний",
  },

  {
    key: "service-plans",
    listTo: "/finances/service-plans",
    label: "Услуги",
    can: { servicePlan: ["read"] },
    acc: "услугу",
    pronoun: "её",
    backLabel: "К услугам",
  },
  {
    key: "approval",
    listTo: "/finances/approval",
    label: "Согласование работ",
    can: { approval: ["decide"] },
  },
  {
    key: "employees-report",
    listTo: "/finances/employees",
    label: "Сотрудники",
    can: { report: ["employees"] },
  },
  {
    key: "my-report",
    listTo: "/finances/my-report",
    label: "Мой отчёт",
    can: { report: ["own"] },
  },
  {
    key: "companies-report",
    listTo: "/report/companies",
    label: "Компании",
    can: { report: ["companies"] },
  },
  {
    key: "networks-report",
    listTo: "/report/networks",
    label: "Сети",
    can: { mikrotik: ["read"] },
  },

  {
    key: "client-devices",
    listTo: "/inventory/client-devices",
    label: "Устройства",
    can: { device: ["read"] },
    acc: "устройство",
    pronoun: "его",
    backLabel: "К устройствам",
  },
  {
    key: "locations",
    listTo: "/inventory/locations",
    label: "Расположения",
    can: { device: ["read"] },
    acc: "расположение",
    pronoun: "его",
    backLabel: "К расположениям",
  },
  {
    key: "device-types",
    listTo: "/inventory/device-types",
    label: "Типы устройств",
    can: { inventoryCatalog: ["read"] },
    acc: "тип устройства",
    pronoun: "его",
    backLabel: "К типам устройств",
  },
  {
    key: "device-models",
    listTo: "/inventory/device-models",
    label: "Модели устройств",
    can: { inventoryCatalog: ["read"] },
    acc: "модель устройства",
    pronoun: "её",
    backLabel: "К моделям",
  },
  {
    key: "vendors",
    listTo: "/inventory/vendors",
    label: "Вендоры",
    can: { inventoryCatalog: ["read"] },
    acc: "вендора",
    pronoun: "его",
    backLabel: "К вендорам",
  },
  {
    key: "device-attributes",
    listTo: "/inventory/device-attributes",
    label: "Атрибуты устройств",
    can: { inventoryCatalog: ["read"] },
    acc: "атрибут",
    pronoun: "его",
    backLabel: "К атрибутам",
  },
  {
    key: "suppliers",
    listTo: "/inventory/suppliers",
    label: "Поставщики",
    can: { supplier: ["read"] },
    acc: "поставщика",
    pronoun: "его",
    backLabel: "К поставщикам",
  },

  {
    key: "mikrotik",
    listTo: "/devices/mikrotik",
    label: "Мониторинг",
    can: { mikrotik: ["read"] },
  },

  {
    key: "preferences",
    listTo: "/preferences",
    label: "Настройки системы",
    can: { settings: ["read"] },
  },
  { key: "my-account", listTo: "/my-account", label: "Мой аккаунт" },
];

const byKey = new Map(SECTIONS.map((section) => [section.key, section]));

/** Раздел по ключу — для карточек, которые называют запаску сами. */
export const sectionByKey = (key: string | undefined): Section | undefined =>
  key ? byKey.get(key) : undefined;

/**
 * Раздел глазами конкретного человека: у клиента вместо «Заявок» — «Главная».
 * Так спрашивают крошка карточки и кнопка возврата на 404 — иначе они вели бы
 * клиента в список, которого у него нет (прямой адрес его оттуда всё равно
 * перебросит на главную, но обещать ссылкой один раздел и открывать другой —
 * хуже, чем сразу назвать верный).
 */
export const sectionAs = (
  section: Section | undefined,
  isEndUser: boolean | undefined,
): Section | undefined =>
  section && isEndUser && section.endUserSection
    ? byKey.get(section.endUserSection)
    : section;

/**
 * Раздел, которому принадлежит адрес.
 *
 * Совпадение — по САМОМУ ДЛИННОМУ подходящему `listTo`, а не по порядку в
 * массиве. Две другие таблицы адресов в приложении (`MIGRATED_ROUTES` и прежняя
 * карта 404) сопоставляются по порядку и носят предупреждения об этом в
 * комментариях: «/users/» обязан стоять раньше «/users». Здесь порядок ни на
 * что не влияет, поэтому раздел, дописанный не в то место, не может закрыть
 * собой соседний: «/tickets/checklist-templates» длиннее «/tickets» и
 * выигрывает у него сам.
 */
export function sectionForPath(pathname: string): Section | undefined {
  // Индекс рисует главную, но живёт по «/»; без этой ветки «/» стал бы
  // префиксом вообще всего.
  if (pathname === "/") return byKey.get("dashboard");

  let found: Section | undefined;
  for (const section of SECTIONS) {
    const fits =
      pathname === section.listTo || pathname.startsWith(`${section.listTo}/`);
    if (fits && (!found || section.listTo.length > found.listTo.length)) {
      found = section;
    }
  }
  return found;
}

/** Сам список раздела, а не карточка внутри него. */
export function sectionListFor(pathname: string): Section | undefined {
  if (pathname === "/") return byKey.get("dashboard");
  return SECTIONS.find((section) => section.listTo === pathname);
}
