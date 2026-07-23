// Карта «маршрут → сущность» для контекстных 404: страница называет вещь, а
// не код («Не нашли заявку №51713»), и ведёт к списку раздела. Порядок важен:
// более специфичные префиксы — выше. Совпадение требует хвоста после префикса
// (id/номер) — сами списки в 404 по своим адресам не попадают.
const ENTITY_ROUTES = [
  {
    prefix: "/tickets/",
    acc: "заявку",
    pronoun: "её",
    numeric: true,
    listTo: "/tickets",
    listLabel: "К заявкам",
  },
  {
    prefix: "/companies/",
    acc: "компанию",
    pronoun: "её",
    listTo: "/companies",
    listLabel: "К компаниям",
  },
  {
    prefix: "/users/",
    acc: "пользователя",
    pronoun: "его",
    listTo: "/users",
    listLabel: "К пользователям",
  },
  {
    prefix: "/finances/service-plans/",
    acc: "услугу",
    pronoun: "её",
    listTo: "/finances/service-plans",
    listLabel: "К услугам",
  },
  {
    prefix: "/inventory/client-devices/",
    acc: "устройство",
    pronoun: "его",
    listTo: "/inventory/client-devices",
    listLabel: "К устройствам",
  },
  {
    prefix: "/inventory/locations/",
    acc: "расположение",
    pronoun: "его",
    listTo: "/inventory/locations",
    listLabel: "К расположениям",
  },
  {
    prefix: "/inventory/vendors/",
    acc: "вендора",
    pronoun: "его",
    listTo: "/inventory/vendors",
    listLabel: "К вендорам",
  },
  {
    prefix: "/inventory/device-types/",
    acc: "тип устройства",
    pronoun: "его",
    listTo: "/inventory/device-types",
    listLabel: "К типам устройств",
  },
  {
    prefix: "/inventory/device-models/",
    acc: "модель устройства",
    pronoun: "её",
    listTo: "/inventory/device-models",
    listLabel: "К моделям",
  },
  {
    prefix: "/inventory/device-attributes/",
    acc: "атрибут",
    pronoun: "его",
    listTo: "/inventory/device-attributes",
    listLabel: "К атрибутам",
  },
  {
    prefix: "/ticket-templates/",
    acc: "шаблон заявки",
    pronoun: "его",
    listTo: "/ticket-templates",
    listLabel: "К шаблонам",
  },
  {
    prefix: "/routine-tasks/",
    acc: "регламентное задание",
    pronoun: "его",
    listTo: "/routine-tasks",
    listLabel: "К регламентным заданиям",
  },
  {
    prefix: "/knowledge-base/",
    acc: "заметку",
    pronoun: "её",
    listTo: "/knowledge-base",
    listLabel: "К базе знаний",
  },
  {
    prefix: "/ticket-categories/",
    acc: "категорию",
    pronoun: "её",
    listTo: "/ticket-categories",
    listLabel: "К категориям",
  },
];

export function resolveEntityContext(pathname) {
  const route = ENTITY_ROUTES.find(
    (r) => pathname.startsWith(r.prefix) && pathname.length > r.prefix.length,
  );
  if (!route) return null;

  const tail = pathname.slice(route.prefix.length);
  const num = route.numeric ? tail.match(/^(\d+)/)?.[1] : null;

  return {
    title: num ? `Не нашли заявку №${num}` : `Не нашли ${route.acc}`,
    body: `Возможно, ${route.pronoun} удалили или в ссылке опечатка.`,
    listTo: route.listTo,
    listLabel: route.listLabel,
  };
}
