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
  return <div className={cn("group", className)}>{children}</div>;
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
      className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
    >
      <Link to={to} onClick={onClick} aria-label={`Изменить: ${label}`}>
        <RiEdit2Line />
      </Link>
    </Button>
  );
}

/**
 * То же, но правка идёт в самой секции, а не в форме: карандаш включает у
 * секции режим правки (`onClick`), «Готово» его выключает.
 *
 * Так правится секция, которая и в покое меняет данные на месте, — чек-лист
 * заявки отмечают прямо на карточке, и уводить состав того же списка в форму
 * значило бы разорвать одно занятие между двумя поверхностями. Секцию, которая
 * только показывает сохранённое, правит форма — `SectionEditLink`.
 *
 * Режим обязателен: отмечать и перестраивать — разные занятия, и рука,
 * привыкшая ставить галочки, промахнётся по «удалить». Заодно у прав одна
 * точка — показывать кнопку или нет.
 */
export function SectionEditButton({
  label,
  editing,
  onToggle,
}: {
  /** Название секции — уходит в aria-label: «Изменить: Чек-лист». */
  label: string;
  editing: boolean;
  onToggle: () => void;
}) {
  if (editing)
    return (
      <Button variant="outline" size="xs" onClick={onToggle}>
        Готово
      </Button>
    );

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onToggle}
      aria-label={`Изменить: ${label}`}
      className="text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
    >
      <RiEdit2Line />
    </Button>
  );
}

// Панель-секция: тонкая граница на канве, без тени (язык статус-борда).
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
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
        "mt-6 mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase",
        id && "scroll-mt-28",
      )}
    >
      {children}
      {count != null && (
        <span className="font-semibold tracking-normal tabular-nums">
          · {count}
        </span>
      )}
      {action != null && (
        <span className="ms-auto flex items-center gap-2 font-normal tracking-normal normal-case">
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
  action,
  className,
}: {
  children: ReactNode;
  count?: number;
  /** Контрол подгруппы справа (outline `xs`) — как `action` у Eyebrow. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase",
        className,
      )}
    >
      {children}
      {count != null && (
        <span className="font-semibold tracking-normal tabular-nums">
          · {count}
        </span>
      )}
      {action != null && (
        <span className="ms-auto flex items-center gap-2 font-normal tracking-normal normal-case">
          {action}
        </span>
      )}
    </div>
  );
}
