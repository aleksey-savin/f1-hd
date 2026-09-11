import { Link, useLocation, useResolvedPath } from "react-router";
import { RiArrowLeftSLine } from "react-icons/ri";

import { sectionAs, sectionByKey, sectionForPath } from "@/util/sections";
import { useAuthedUser, useCan } from "@/store/authed-user";

export type CrumbLink = { label: string; to?: string };

/** Откуда пришли: подпись страницы-источника и адрес возврата на неё. */
export type CrumbOrigin = { label: string; to: string };

/**
 * Собрать `state` для перехода в другой раздел: «я — вот эта страница».
 *
 * Транспорт — штатный `state` навигации роутера (`<Link state>` →
 * `useLocation().state`). Он лежит в записи History API, поэтому переживает
 * перезагрузку, а «назад» и «вперёд» сами отдают то значение, что было у своей
 * записи, — ничего синхронизировать не нужно.
 *
 * Адрес источника считается сам: `useResolvedPath(".")` — это адрес СВОЕГО
 * маршрута (над карточкой может стоять шторка правки, возвращать надо на
 * карточку), а `search` берём текущий, чтобы возврат к списку вернул и фильтры.
 */
export function useCrumbFrom(label: string | null | undefined) {
  const own = useResolvedPath(".").pathname;
  const { search } = useLocation();
  return label ? { from: { label, to: `${own}${search}` } } : undefined;
}

/**
 * Крошки страницы сущности: возврат туда, ОТКУДА пришли, плюс настоящая
 * иерархия, если она у сущности есть.
 *
 * Прежде каждая карточка носила свою копию ссылки со стрелкой, и адрес в ней
 * был константой — списком своего раздела. Выглядит такая ссылка как «назад», а
 * ведёт всегда в одно место, поэтому совпадала с ожиданием ровно в одном
 * случае: когда человек пришёл из этого самого списка. Пришёл из заявки —
 * уводила в «Пользователей», раздел, которого в его пути не было (а без права
 * на список — ещё и в 403).
 *
 * Порядок ответов:
 *   1) `state.from` перехода — «‹ Заявка №51713»;
 *   2) список раздела, если он человеку открыт, — «‹ Пользователи»; раздел
 *      берётся глазами этого человека (`sectionAs`): клиенту вместо списка
 *      заявок, которого у него нет, отвечает «‹ Главная»;
 *   3) название раздела приглушённым текстом, если права на список нет;
 *   4) ничего.
 *
 * Пункты 2–4 отвечают там, где источника нет: прямая ссылка, переход из списка
 * своего же раздела, новая вкладка (архив открывает заявки именно так).
 */
const Crumbs = ({
  section,
  chain,
}: {
  /**
   * Запасной раздел, когда из адреса он выводится неверно. Заявка в архиве
   * живёт по адресу `/tickets/:num`, но возвращать из неё в активный список
   * нельзя — там её уже нет.
   *
   * `false` — запаски нет вовсе. Так у карточки отчёта, куда сводка сама
   * редиректит тому, у кого объект ровно один: ссылка «наверх» вернула бы его
   * на эту же страницу.
   */
  section?: string | false;
  /** Настоящая иерархия: расположение внутри расположения, филиал внутри компании. */
  chain?: CrumbLink[];
}) => {
  const location = useLocation();
  const can = useCan();
  const { isEndUser } = useAuthedUser();
  const own = useResolvedPath(".").pathname;

  const from = (location.state as { from?: CrumbOrigin } | null)?.from;

  const fallback =
    section === false
      ? undefined
      : sectionAs(sectionByKey(section) ?? sectionForPath(own), isEndUser);
  const allowed = fallback && (!fallback.can || can(fallback.can));

  const first: CrumbLink | undefined = from
    ? { label: from.label, to: from.to }
    : fallback
      ? { label: fallback.label, to: allowed ? fallback.listTo : undefined }
      : undefined;

  const items = [...(first ? [first] : []), ...(chain ?? [])];
  if (!items.length) return null;

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-medium text-muted-foreground">
      {items.map((item, index) => {
        const inner = (
          <>
            {index === 0 && <RiArrowLeftSLine aria-hidden />}
            {item.label}
          </>
        );
        return (
          <span
            key={`${item.label}-${index}`}
            className="inline-flex items-center gap-1"
          >
            {index > 0 && (
              <span aria-hidden className="mx-1 text-faint">
                ›
              </span>
            )}
            {item.to ? (
              <Link
                to={item.to}
                className="inline-flex items-center gap-1 text-inherit no-underline hover:text-foreground"
              >
                {inner}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 text-faint">
                {inner}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default Crumbs;
