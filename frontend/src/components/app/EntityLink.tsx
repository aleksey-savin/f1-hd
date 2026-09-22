import type { ReactNode } from "react";
import { Link } from "react-router";

import { useCrumbFrom } from "@/components/app/Crumbs";

/**
 * Ссылка на карточку связанной сущности: инициатор заявки, компания устройства,
 * сотрудник рабочего места.
 *
 * Подчёркивание по наведению, а не всегда: строк-значений в «Деталях» много, и
 * постоянные подчёркивания превратили бы панель в список ссылок.
 *
 * **`from` — как назвать ЭТУ страницу в крошке той, куда ведём.** Подпись
 * («Заявка 51713») кладётся в `state` перехода, адрес источника компонент
 * считает сам. Без `from` целевая карточка покажет свой раздел — это верно для
 * перехода внутри раздела (из списка в карточку) и неверно для перехода в
 * чужой, ради которого проп и заведён.
 *
 * Жила двумя копиями — в деталях заявки и в карточке расположения — и копии
 * успели разойтись цветом. Общий вид взят у заявки: там связанных сущностей
 * больше всего, и приглушённый цвет держит панель читаемой.
 */
const EntityLink = ({
  to,
  from,
  className,
  children,
}: {
  to: string;
  from?: string | null;
  className?: string;
  children: ReactNode;
}) => (
  <Link
    to={to}
    state={useCrumbFrom(from)}
    className={
      className ??
      "font-medium text-foreground no-underline hover:text-accent-text hover:underline"
    }
  >
    {children}
  </Link>
);

export default EntityLink;
