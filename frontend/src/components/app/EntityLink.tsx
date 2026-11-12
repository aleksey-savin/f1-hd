import { Link } from "@/components/app/navigation";
import type { ReactNode } from "react";


import { useCrumbFrom } from "@/components/app/Crumbs";

/**
 * Ссылка на карточку связанной сущности: инициатор заявки, компания устройства,
 * сотрудник рабочего места.
 *
 * Подчёркивание по наведению, а не всегда: строк-значений в «Деталях» много, и
 * постоянные подчёркивания превратили бы панель в список ссылок.
 *
 * `from` уточняет подпись текущей страницы. Общий Link из app/navigation
 * передаёт весь путь из верхнего бара, включая фильтры исходного списка.
 * Новая вкладка строит собственную иерархию без History state.
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
