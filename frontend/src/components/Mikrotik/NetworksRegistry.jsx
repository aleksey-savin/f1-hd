import { Link } from "react-router";
import { RiArrowRightSLine } from "react-icons/ri";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { OVERLAP_META } from "./meta";

/**
 * Точка-признак в начале строки: пересечение видно и в реестре, но тоном, а не
 * заливкой строки. Место под неё зарезервировано у всех строк — иначе адреса
 * разъезжаются по левому краю.
 */
const OverlapDot = ({ kind }) => (
  <span
    aria-hidden
    className={cn(
      "me-2 inline-block size-1.5 rounded-full align-middle",
      kind ? OVERLAP_META[kind].dot : "bg-transparent",
    )}
  />
);

const DisabledTag = () => (
  <span className="ms-2 rounded border border-border px-1 text-xs text-faint">
    выкл
  </span>
);

const Dash = () => <span className="text-faint">—</span>;

const COLUMNS = [
  { key: "address", label: "Адрес" },
  { key: "network", label: "Сеть" },
  { key: "interface", label: "Интерфейс" },
  { key: "deviceName", label: "Устройство" },
  { key: "comment", label: "Комментарий" },
];

/** Десктоп: таблица с сортировкой кликом по заголовку. */
export const NetworksTable = ({ entries, sort, onSort }) => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map((column) => {
            const active = sort.key === column.key;
            return (
              <TableHead key={column.key} className="px-4">
                <button
                  type="button"
                  onClick={() =>
                    onSort({
                      key: column.key,
                      direction:
                        active && sort.direction === "asc" ? "desc" : "asc",
                    })
                  }
                  className={cn(
                    "inline-flex cursor-pointer appearance-none items-center gap-0.5 border-0 bg-transparent p-0 text-xs font-semibold tracking-wider uppercase outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
                    active ? "text-foreground" : "text-faint",
                  )}
                >
                  {column.label}
                  {active && (
                    <RiArrowRightSLine
                      size={14}
                      aria-hidden
                      className={cn(
                        "transition-transform",
                        sort.direction === "asc" ? "rotate-90" : "-rotate-90",
                      )}
                    />
                  )}
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow
            key={entry.id}
            className={cn(entry.disabled && "opacity-55")}
          >
            <TableCell className="px-4 font-medium tabular-nums">
              <OverlapDot kind={entry.overlap} />
              {entry.address}
              {entry.disabled && <DisabledTag />}
            </TableCell>
            <TableCell className="px-4 text-muted-foreground tabular-nums">
              {entry.network || <Dash />}
            </TableCell>
            <TableCell className="px-4 text-muted-foreground">
              {entry.interface || <Dash />}
            </TableCell>
            <TableCell className="px-4">
              <Link
                to={`/devices/mikrotik/records/${entry.recordId}`}
                className="text-foreground no-underline hover:underline"
              >
                {entry.deviceName}
              </Link>
            </TableCell>
            <TableCell className="max-w-0 truncate px-4 text-muted-foreground">
              {entry.comment || <Dash />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

/** Мобильная строка адреса — общая для плоского списка и для устройства. */
export const NetworkAddressRow = ({ entry, withDevice }) => (
  <div
    className={cn(
      "border-t border-border-soft px-4 py-2 first:border-t-0",
      entry.disabled && "opacity-55",
    )}
  >
    <div className="font-medium tabular-nums">
      <OverlapDot kind={entry.overlap} />
      {entry.address}
      {entry.disabled && <DisabledTag />}
    </div>
    <div className="truncate ps-3.5 text-sm text-muted-foreground">
      {[entry.interface, withDevice ? entry.deviceName : null, entry.comment]
        .filter(Boolean)
        .join(" · ") || "—"}
    </div>
  </div>
);

/**
 * Мобильный первый уровень: устройства со счётчиками.
 *
 * 18 строк помещаются на экран целиком и сами работают навигацией, тогда как
 * 139 адресов подряд — это семь экранов прокрутки. Точка у имени означает, что
 * внутри есть пересечение, — иначе, чтобы это узнать, пришлось бы заходить в
 * каждое.
 */
export const NetworksDeviceList = ({ devices, onOpen }) => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    {devices.map((device) => (
      <button
        key={device.name}
        type="button"
        onClick={() => onOpen(device.name)}
        className="flex w-full cursor-pointer appearance-none items-center gap-2.5 border-0 border-t border-border-soft bg-transparent px-4 py-3 text-start first:border-t-0 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 flex-none rounded-full",
            device.worstOverlap
              ? OVERLAP_META[device.worstOverlap].dot
              : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {device.name}
        </span>
        <span className="flex-none text-sm text-faint tabular-nums">
          {device.entries.length}
        </span>
        <RiArrowRightSLine
          size={16}
          aria-hidden
          className="flex-none text-faint"
        />
      </button>
    ))}
  </div>
);
