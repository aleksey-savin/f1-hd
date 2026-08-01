import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { OVERLAP_META, overlapReason } from "./meta";

/**
 * Строка адреса внутри группы пересечения.
 *
 * Раскладка одна на обе ширины: на десктопе — четыре колонки фиксированной
 * ширины (правый край групп ровный), на узком — адрес строкой и вся мета под
 * ним. Отдельной мобильной ветки нет: расходится только сетка, а не состав.
 */
const OverlapRow = ({ entry, clashing }) => {
  const clash = clashing.includes(entry.address);
  const meta = [entry.interface, entry.deviceName, entry.comment]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid items-baseline gap-x-4 border-t border-border-soft px-4 py-1.5 text-sm md:grid-cols-[11rem_11rem_12rem_minmax(0,1fr)]">
      <span
        className={cn(
          "font-medium tabular-nums",
          clash && "font-semibold text-destructive",
        )}
      >
        {entry.address}
      </span>
      {/* На узком экране интерфейс, устройство и комментарий идут одной
          приглушённой строкой; на десктопе они разъезжаются по колонкам. */}
      <span className="truncate text-muted-foreground md:hidden">{meta}</span>
      <span className="truncate text-muted-foreground max-md:hidden">
        {entry.interface || <span className="text-faint">—</span>}
      </span>
      <span className="truncate max-md:hidden">
        <Link
          to={`/devices/mikrotik/records/${entry.recordId}`}
          className="text-foreground no-underline hover:underline"
        >
          {entry.deviceName}
        </Link>
      </span>
      <span className="truncate text-muted-foreground max-md:hidden">
        {entry.comment || <span className="text-faint">—</span>}
      </span>
    </div>
  );
};

/**
 * Секция «Пересечения»: группы по сети, причина названа словами.
 *
 * Группировка, а не подсветка строк, потому что пересечение — свойство ГРУППЫ:
 * по одной строке нельзя увидеть, с чем именно она столкнулась. Прежний отчёт
 * красил 34 строки из 132 и заставлял искать пару глазами.
 */
const NetworksOverlaps = ({ overlaps }) => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    {overlaps.map((overlap, index) => {
      const meta = OVERLAP_META[overlap.kind];
      return (
        <div
          key={overlap.network}
          className={cn(index > 0 && "border-t border-border")}
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-3 pb-2">
            <span className="font-semibold tabular-nums">
              {overlap.network}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-sm",
                meta.text,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block size-1.5 rounded-full align-middle",
                  meta.dot,
                )}
              />
              {overlapReason(overlap)}
            </span>
            <span className="text-sm text-faint tabular-nums">
              {overlap.addresses.length} адреса · {overlap.deviceCount} устр.
            </span>
          </div>
          {overlap.addresses.map((entry) => (
            <OverlapRow
              key={entry.id}
              entry={entry}
              clashing={overlap.clashing}
            />
          ))}
        </div>
      );
    })}
  </div>
);

export default NetworksOverlaps;
