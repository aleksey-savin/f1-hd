import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Примитивы карточки сущности (View) — панель-секция на канве и uppercase-метка
// над ней. Эталон — components/ServicePlan/View.jsx.

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
