import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router";

import EntityLink from "@/components/app/EntityLink";
import { useCan } from "@/store/authed-user";

/**
 * Имя человека, ведущее на его карточку, — и просто имя тому, у кого права
 * «Видеть пользователей» нет.
 *
 * Правило одно на всё приложение и потому живёт здесь: карточка закрыта и
 * маршрутом, и ручкой `GET /users/:id` (`canReadUsers`), а ссылка на неё стояла
 * в десятке мест — устройство, расположение, сотрудники компании, журнал AD,
 * подразделение. Каждая из них у такого человека вела в «Нет доступа»: ссылка,
 * которая обещает страницу и отдаёт отказ, хуже отсутствующей ссылки.
 *
 * Две дороги перехода, обе прежние: `from` — крошка «откуда пришли» на чужую
 * карточку (`EntityLink`), `state`/`onClick`/`className` — обычная ссылка со
 * своим видом. Вид ссылок нарочно не унифицирован: у панели деталей,
 * списка-строки и шторки он разный и таким и остаётся.
 */
const UserLink = ({
  id,
  from,
  state,
  onClick,
  className,
  children,
}: {
  /** Идентификатор человека; пусто — останется один текст */
  id?: string | null;
  /** Подпись ЭТОЙ страницы в крошке карточки, куда ведём (см. `EntityLink`) */
  from?: string | null;
  state?: unknown;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  className?: string;
  children: ReactNode;
}) => {
  const can = useCan();

  if (!id || !can({ user: ["read"] })) return <>{children}</>;

  if (from !== undefined) {
    return (
      <EntityLink to={`/users/${id}`} from={from} className={className}>
        {children}
      </EntityLink>
    );
  }

  return (
    <Link to={`/users/${id}`} state={state} onClick={onClick} className={className}>
      {children}
    </Link>
  );
};

export default UserLink;
