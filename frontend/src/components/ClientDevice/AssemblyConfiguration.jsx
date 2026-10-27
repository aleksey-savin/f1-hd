import { Link } from "react-router";
import {
  RiAddLine,
  RiAlertLine,
  RiArrowRightUpLine,
  RiCpuLine,
  RiLinkUnlink,
  RiLinksLine,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { partTitle, warrantyNote } from "@/components/app/assembly-specs";
import { cn } from "@/lib/utils";

import { plural } from "../../util/plural";

// «Конфигурация» ПК своей сборки (макет «ПК из сборки», разд. 3): строки
// сверки со сборкой (diffWithBuild → collapseDiffRows) — слот, деталь-устройство
// со ссылкой, серийник и гарантия, метки отличий и «в сборке: …».

const TAG = {
  replaced: {
    label: "заменена",
    className: "bg-accent text-muted-foreground",
  },
  added: { label: "добавлена", className: "bg-primary/15 text-accent-text" },
  missing: {
    label: "не установлена",
    className: "bg-warning/15 text-warning-text",
  },
};

const TONE = {
  soon: "text-warning-text",
  expired: "text-destructive",
};

const devicePath = (part) => `/inventory/client-devices/${part.deviceId}`;

// Подпись детали в меню строки, где устройств несколько: серийник, без него —
// инвентарный номер, иначе модель
const deviceLabel = (part) =>
  part.serialNumber
    ? `SN ${part.serialNumber}`
    : part.inventoryNumber || partTitle(part);

// Ранняя гарантия из нескольких — она и важна
const earliestWarranty = (devices) =>
  devices
    .map((part) => part.warrantyExpirationDate)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;

/** Предупреждение над панелью: пусты обязательные слоты. */
export const MissingRequiredAlert = ({ names }) =>
  names.length > 0 ? (
    <div
      role="alert"
      className="mb-2.5 flex items-start gap-2.5 rounded-lg bg-warning/10 px-3.5 py-2.5 text-sm text-foreground"
    >
      <RiAlertLine
        size={16}
        aria-hidden
        className="mt-0.5 flex-none text-warning"
      />
      <div>
        Не установлен обязательный {names.map((n) => `«${n}»`).join(", ")}.
        Прикрепите деталь или создайте новую.
      </div>
    </div>
  ) : null;

const RowMeta = ({ row, today }) => {
  const multi = row.devices.length > 1;
  const first = row.devices[0];
  const note = warrantyNote(
    multi ? earliestWarranty(row.devices) : first.warrantyExpirationDate,
    today,
  );
  const lead = multi
    ? `${row.devices.length} ${plural(row.devices.length, "устройство", "устройства", "устройств")}`
    : first.serialNumber
      ? `SN ${first.serialNumber}`
      : "без серийника";
  return (
    <div className="mt-px truncate text-sm text-muted-foreground tabular-nums">
      {lead}
      {note && (
        <>
          {" · "}
          <span className={TONE[note.tone]}>{note.text}</span>
        </>
      )}
    </div>
  );
};

// «⋯» строки. Без права управления меню есть только у строки из нескольких
// устройств — иначе до каждого из них не дойти (у одиночной ссылка — имя).
const RowMenu = ({
  row,
  canManage,
  detachingId,
  onDetach,
  onNew,
  onAttach,
}) => {
  const items = [];
  if (!row.part) {
    items.push(
      <DropdownMenuItem key="new" onSelect={onNew}>
        <RiAddLine /> Новая
      </DropdownMenuItem>,
      <DropdownMenuItem key="attach" onSelect={onAttach}>
        <RiLinksLine /> Прикрепить
      </DropdownMenuItem>,
    );
  } else if (row.devices.length === 1) {
    items.push(
      <DropdownMenuItem
        key="detach"
        disabled={detachingId === row.part.deviceId}
        onSelect={() => onDetach(row.part.deviceId)}
      >
        <RiLinkUnlink /> Открепить
      </DropdownMenuItem>,
    );
  } else {
    // Несколько устройств одной строкой: открыть — каждое, всем;
    // открепить — каждое, с правом управления
    row.devices.forEach((part) =>
      items.push(
        <DropdownMenuItem key={`open-${part.deviceId}`} asChild>
          <Link to={devicePath(part)}>
            <RiArrowRightUpLine /> Открыть: {deviceLabel(part)}
          </Link>
        </DropdownMenuItem>,
      ),
    );
    if (canManage) {
      items.push(<DropdownMenuSeparator key="sep" />);
      row.devices.forEach((part) =>
        items.push(
          <DropdownMenuItem
            key={`detach-${part.deviceId}`}
            disabled={detachingId === part.deviceId}
            onSelect={() => onDetach(part.deviceId)}
          >
            <RiLinkUnlink /> Открепить: {deviceLabel(part)}
          </DropdownMenuItem>,
        ),
      );
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Действия"
          title="Действия"
          className="text-faint"
        >
          <RiMoreLine />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{items}</DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * `summary` — сжатая сводка ключевых характеристик первой строкой панели
 * (макет «Шапка карточки устройства»): в шапке карточки её больше нет.
 * Строки «Конфигурации» (и «Подключено» — тем же видом). Сетка как в макете: слот · деталь · метки · «⋯»;
 * на телефоне слот — строкой над деталью, метки — под ней.
 * `connected` — строки «Подключено»: устройство без модели называется типом,
 * без типа — инвентарным номером.
 */
const AssemblyConfiguration = ({
  rows,
  connected = false,
  canManage,
  detachingId,
  onDetach,
  onNew,
  onAttach,
  summary,
}) => {
  const today = new Date();
  // Строки до края панели — отступ панели гасится (см. app/Panel)
  return (
    <div className="-mx-4 -my-4 md:-mx-5 md:-my-5">
      {summary && (
        <div className="flex items-start gap-2.5 border-b border-border-soft px-4 py-3">
          <RiCpuLine
            size={16}
            aria-hidden
            className="mt-0.5 flex-none text-accent-text"
          />
          <span className="line-clamp-2 font-semibold" title={summary}>
            {summary}
          </span>
        </div>
      )}
      {rows.map((row) => {
        const tag = row.tag ? TAG[row.tag] : null;
        const single = row.devices.length === 1;
        const title = !row.part
          ? "не установлен"
          : connected && !row.part.deviceModelId
            ? row.part.typeId?.name ||
              row.part.inventoryNumber ||
              partTitle(row.part)
            : partTitle(row.part);
        return (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-0.5 border-t border-border-soft px-4 py-2.5 first:border-t-0 md:grid-cols-[9.5rem_minmax(0,1fr)_auto_2rem]"
          >
            <span className="col-span-2 row-start-1 text-sm text-muted-foreground md:col-span-1 md:col-start-1">
              {row.slotLabel}
            </span>
            <div className="col-start-1 row-start-2 min-w-0 md:col-start-2 md:row-start-1">
              <div
                className={cn(
                  "truncate",
                  row.part ? "font-medium" : "text-muted-foreground",
                )}
              >
                {single ? (
                  <Link
                    to={devicePath(row.part)}
                    className="text-foreground no-underline hover:text-accent-text"
                  >
                    {title}
                  </Link>
                ) : (
                  title
                )}
                {row.units > 1 && (
                  <span className="font-normal text-faint"> × {row.units}</span>
                )}
              </div>
              {row.part && <RowMeta row={row} today={today} />}
              {row.buildTitle && (
                <div className="mt-0.5 truncate text-xs text-faint">
                  в сборке: {row.buildTitle}
                </div>
              )}
            </div>
            {tag && (
              <span className="col-start-1 row-start-3 flex justify-start gap-1.5 md:col-start-3 md:row-start-1 md:justify-end">
                <span
                  className={cn(
                    "flex-none rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
                    tag.className,
                  )}
                >
                  {tag.label}
                </span>
              </span>
            )}
            {(canManage || row.devices.length > 1) && (
              <span className="col-start-2 row-start-2 md:col-start-4 md:row-start-1">
                <RowMenu
                  row={row}
                  canManage={canManage}
                  detachingId={detachingId}
                  onDetach={onDetach}
                  onNew={onNew}
                  onAttach={onAttach}
                />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AssemblyConfiguration;
