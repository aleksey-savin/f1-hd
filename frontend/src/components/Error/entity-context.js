import { sectionForPath } from "@/util/sections";

/**
 * Контекст для 404: страница называет вещь, а не код («Не нашли заявку
 * №51713»), и ведёт к списку раздела.
 *
 * Своей карты адресов здесь больше нет — раздел, его список и падежи берутся из
 * общего справочника `util/sections`. Прежде та же карта жила тут копией и
 * расходилась с крошками карточек: раздел, переехавший на другой адрес,
 * приходилось править в двух местах, и одно из них забывали.
 */
export function resolveEntityContext(pathname) {
  const section = sectionForPath(pathname);
  // Падежи есть только у разделов с карточками; на самом списке называть нечего
  const tail = section ? pathname.slice(section.listTo.length + 1) : "";
  if (!section?.acc || !tail) return null;

  const num = section.numeric ? tail.match(/^(\d+)/)?.[1] : null;

  return {
    title: num ? `Не нашли ${section.acc} №${num}` : `Не нашли ${section.acc}`,
    body: `Возможно, ${section.pronoun} удалили или в ссылке опечатка.`,
    listTo: section.listTo,
    listLabel: section.backLabel,
  };
}
