import { type ReactNode } from "react";

import { Link } from "react-router";
import { RiEdit2Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Примитивы карточки сущности (View) — панель-секция на канве и uppercase-метка
// над ней. Эталон — components/ServicePlan/View.jsx.

// Секция карточки целиком — метка + панель. Нужна ради наведения: карандаш
// правки в метке проявляется при наведении на ЛЮБУЮ часть секции, а не на
// тонкую строку ярлыка. Без SectionEditLink оборачивать секцию незачем.
export function Section({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("tw:group", className)}>{children}</div>;
}

/**
 * Вход в общую форму, открытую сразу на этой секции (`update#<якорь>`).
 *
 * Иконка, а не кнопка с текстом: это навигация, а не отдельная операция.
 * Правимых секций на карточке бывает четыре и больше — четыре одинаковых
 * «Изменить» перестают различаться по надписи и читаются по позиции, а справа
 * выстраиваются в колонку кнопок, конкурирующую с содержимым. Обнаружимость
 * держит залитая «Изменить» в шапке — она одна на карточке и видна всегда.
 *
 * Проявляется по наведению на секцию; при фокусе с клавиатуры и на тач-экране
 * (`pointer-coarse`) виден всегда — как «⋯» в `app/ListRow`.
 *
 * Действие со СВОИМ именем («Выдать», «Прикрепить», «Задать график» у пустой
 * секции) остаётся текстовой кнопкой в `action` — оно называет операцию, а не
 * ведёт в ту же форму.
 */
export function SectionEditLink({
  to,
  label,
  onClick,
}: {
  /** Относительный путь с якорем секции, напр. `update#purchase`. */
  to: string;
  /** Название секции — уходит в aria-label: «Изменить: Размещение». */
  label: string;
  onClick?: () => void;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      // icon-xs — вровень с `xs`-кнопками секции («Выдать», «Прикрепить»)
      size="icon-xs"
      className="tw:text-faint tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100"
    >
      <Link to={to} onClick={onClick} aria-label={`Изменить: ${label}`}>
        <RiEdit2Line />
      </Link>
    </Button>
  );
}

// Панель-секция: тонкая граница на канве, без тени (язык статус-борда).
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
      {children}
    </section>
  );
}

// Метка секции над панелью + опциональный счётчик (tabular-nums).
// id — якорь для рейла-навигации (app/AnchorRail); scroll-mt держит метку
// под fixed-навбаром при переходе по якорю. action — контрол секции справа
// (outline-кнопка «Добавить …»: залитая на экране одна — у hero).
export function Eyebrow({
  children,
  count,
  id,
  action,
}: {
  children: ReactNode;
  count?: number;
  id?: string;
  action?: ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn(
        "tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase",
        id && "tw:scroll-mt-28",
      )}
    >
      {children}
      {count != null && (
        <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
          · {count}
        </span>
      )}
      {action != null && (
        <span className="tw:ms-auto tw:flex tw:items-center tw:gap-2 tw:font-normal tw:tracking-normal tw:normal-case">
          {action}
        </span>
      )}
    </div>
  );
}

// Метка подгруппы внутри панели/сетки — как Eyebrow, но без верхнего отступа
// секции (общая для карточек пользователя и компании).
export function SubLabel({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase",
        className,
      )}
    >
      {children}
      {count != null && (
        <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
          · {count}
        </span>
      )}
    </div>
  );
}
