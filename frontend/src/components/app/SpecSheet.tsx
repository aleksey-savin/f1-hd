import type { ReactNode } from "react";

import { splitColumns } from "./spec-sheet";

/**
 * Строка листа (`SpecRow` из `buildSpecGroups` подходит как есть). Значение
 * может быть и узлом: «Конфигурация» сборки ставит туда ссылку на модель детали.
 */
export interface SheetRow {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface SheetGroup {
  key: string;
  name: ReactNode;
  rows: SheetRow[];
}

/**
 * Характеристики по группам — вид «как в карточке магазина»: заголовок
 * группы, под ним строки «подпись · пунктир · значение». Только содержимое:
 * панель и метку над ней ставит карточка (модели, устройства).
 *
 * От `sm` строки группы — в две колонки сверху вниз, сначала левая
 * (`splitColumns`: ceil(n/2) слева); на телефоне одна. Пустых строк и групп
 * здесь нет — их выкинул `buildSpecGroups`.
 */
const Row = ({ row }: { row: SheetRow }) => (
  <div className="grid grid-cols-2 gap-x-2.5 py-1.25 text-sm leading-snug sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <dt className="flex min-w-0 items-end gap-1.5 text-muted-foreground">
      <span className="min-w-0">{row.label}</span>
      {/* Пунктир-поводок от подписи к значению */}
      <span
        aria-hidden
        className="mb-1 min-w-3 flex-1 border-b border-dotted border-border"
      />
    </dt>
    <dd className="m-0 self-end text-foreground tabular-nums wrap-anywhere">
      {row.value}
    </dd>
  </div>
);

const SpecSheet = ({ groups }: { groups: SheetGroup[] }) => (
  <div className="flex flex-col gap-4">
    {groups.map((group) => {
      const [left, right] = splitColumns(group.rows);
      return (
        <div key={group.key} className="min-w-0">
          <h4 className="mt-0 mb-2 text-base font-semibold">{group.name}</h4>
          <div className="grid sm:grid-cols-2 sm:gap-x-10">
            <dl className="m-0 min-w-0">
              {left.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </dl>
            {right.length > 0 && (
              <dl className="m-0 min-w-0">
                {right.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </dl>
            )}
          </div>
        </div>
      );
    })}
  </div>
);

export default SpecSheet;
