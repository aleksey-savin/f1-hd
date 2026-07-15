import { type ReactNode } from "react";

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
export function Eyebrow({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <div className="tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
      {children}
      {count != null && (
        <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
          · {count}
        </span>
      )}
    </div>
  );
}
