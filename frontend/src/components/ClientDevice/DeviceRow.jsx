import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  RiBox3Line,
  RiDeleteBinLine,
  RiEdit2Line,
  RiMapPin2Line,
  RiMoreLine,
  RiQrCodeLine,
  RiRouterLine,
  RiStackLine,
  RiUser3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { canManageEntity } from "@/components/app/entity-permissions";
import {
  DEVICE_STATUS_META,
  DeviceStatusText,
  deviceIcon,
  mikrotikStatus,
} from "@/components/app/device-status";
import { cn } from "@/lib/utils";
import { useAuthedUser, useCan } from "@/store/authed-user";

import QrDialog from "./QrDialog";

// Окно подсветки свежих строк — то же, что у app/ListRow.
const FRESH_MS = 8000;

const LIVE_DOT = {
  ok: "bg-primary",
  bad: "bg-destructive",
  off: "bg-faint",
};

// Инвентарный номер — опорный столбец реестра: его ищут глазами по вертикали,
// поэтому он моноширинный и в своей колонке, но текстом, а не рамкой — той же
// идиомой, что номер заявки в её строке (обрамлённая метка была единственным
// «боксом» внутри строк списков и выбивала реестр из общего ряда; макет
// «Устройства · строка реестра», 08.09). Отсутствие номера — пробел учёта,
// и говорит о себе словами, тихим форматом, как «не размещено».
const InventoryNumber = ({ number, className }) =>
  number ? (
    <span
      className={cn(
        "font-mono text-sm font-medium whitespace-nowrap text-muted-foreground tabular-nums",
        className,
      )}
    >
      {number}
    </span>
  ) : (
    <span className={cn("text-sm whitespace-nowrap text-faint", className)}>
      нет №
    </span>
  );

/**
 * Строка реестра устройств — жёсткие колонки: плитка типа (с живой точкой
 * связи Mikrotik) · имя + «тип · вендор · имя в сети» · инвентарный номер ·
 * компания · «у кого / где» · учётный статус · гнездо действий (QR и «⋯»).
 * Геометрия — строки списка с плиткой (`app/ListRow`): плитка 48 без кольца,
 * разделители от её правого края, гнездо с приглушённым глифом по наведению.
 *
 * Клик по строке ведёт на карточку устройства. У рабочих мест расположение
 * почти дословно повторяет закреплённого человека, поэтому колонка одна:
 * закреплено — показываем человека и расположение подстрокой, не закреплено —
 * само расположение.
 *
 * QR-код — из гнезда: на тач-экране кнопка видна всегда, поэтому на телефоне
 * гнездо остаётся (одна кнопка), а «⋯» там не нужен — правка и удаление живут
 * на карточке, куда ведёт тап по строке.
 */
const DeviceRow = ({ device }) => {
  const navigate = useNavigate();
  const { _id: userId } = useAuthedUser();
  const can = useCan();
  const canManage = canManageEntity("clientDevice", can, device, userId);

  const [qrOpen, setQrOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const Icon = deviceIcon(device.typeName);
  const status = DEVICE_STATUS_META[device.status];
  const mikro = mikrotikStatus(device);
  const meta = [device.typeName, device.vendorName].filter(Boolean).join(" · ");

  const createdAgo = device.createdAt
    ? Date.now() - Date.parse(device.createdAt)
    : Infinity;
  const updatedAgo = device.updatedAt
    ? Date.now() - Date.parse(device.updatedAt)
    : Infinity;
  const justCreated = createdAgo < FRESH_MS;
  const justUpdated = !justCreated && updatedAgo < FRESH_MS;

  const openQr = () => setQrOpen(true);
  const stop = (event) => event.stopPropagation();

  // Диалоги (QR, удаление) рендерятся в портал на <body>, но React-события
  // всплывают по дереву КОМПОНЕНТОВ, а не по DOM: клик внутри модала долетал до
  // строки, и закрытие уводило на карточку. Строка реагирует только на то, что
  // произошло в ней самой.
  const insideRow = (event) => event.currentTarget.contains(event.target);

  const place = device.user
    ? { icon: RiUser3Line, main: device.user.name, sub: device.location?.name }
    : {
        icon: RiMapPin2Line,
        main: device.location?.name || null,
        sub: null,
      };
  const PlaceIcon = place.icon;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (!insideRow(event)) return;
        navigate(`/inventory/client-devices/${device._id}`);
      }}
      onKeyDown={(event) => {
        if (!insideRow(event)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(`/inventory/client-devices/${device._id}`);
        }
      }}
      title="Открыть карточку устройства"
      className={cn(
        "group relative flex cursor-pointer items-center gap-4 px-5 py-3 transition-colors",
        // Разделитель — от правого края плитки (20 + 48 + 16), как у любой
        // строки с плиткой
        "before:absolute before:top-0 before:right-5 before:left-21 before:h-px before:bg-border-soft first:before:hidden",
        "hover:bg-accent/60",
        justCreated && "row-appear",
        justUpdated && "row-flash",
      )}
    >
      {/* Плитка вида — глиф типа без кольца: кольцо только у настоящей
          картинки (гайд → «Анатомия списка»). Живая точка связи — поверх. */}
      <span
        aria-hidden
        className="relative grid size-12 flex-none place-items-center rounded-xl bg-accent text-muted-foreground"
      >
        <Icon size={22} />
        {mikro && (
          <span
            title={`Mikrotik: ${mikro.label}`}
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
              LIVE_DOT[mikro.tone],
            )}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className="min-w-0 truncate text-base leading-tight font-medium"
            title={device.name}
          >
            {device.name}
          </span>
          {device.componentCount > 0 && (
            <span
              title={`Сборка: ${device.componentCount} комплектующих`}
              className="inline-flex flex-none items-center gap-1 rounded-md bg-accent px-1.5 text-xs font-semibold text-muted-foreground tabular-nums"
            >
              <RiStackLine size={12} aria-hidden />
              {device.componentCount}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {/* До md колонки схлопнуты — номер открывает строку меты */}
          <span className="flex-none md:hidden">
            <InventoryNumber number={device.inventoryNumber} />
          </span>
          <span className="truncate">
            {meta ? (
              <>
                <span className="md:hidden">· </span>
                {meta}
              </>
            ) : (
              "—"
            )}
          </span>
          {/* Комплектующее попадает в список только по запросу и обязано
              назвать хозяина: у детали расположение и владелец — его. */}
          {device.parent && (
            <span
              title={`В составе: ${device.parent.name}`}
              className="inline-flex flex-none items-center gap-1 rounded-md bg-accent px-1.5 text-xs font-medium text-muted-foreground"
            >
              <RiBox3Line size={12} aria-hidden />
              <span className="max-md:hidden">в составе: </span>
              {device.parent.inventoryNumber || device.parent.name}
            </span>
          )}
          {device.hostname && !device.parent && (
            <span className="hidden flex-none font-mono text-xs text-faint lg:inline">
              {device.hostname}
            </span>
          )}
        </span>
        {/* Узкий экран: статус и принадлежность подстрокой */}
        <span className="mt-0.5 flex min-w-0 items-center gap-2.5 md:hidden">
          {status && (
            <DeviceStatusText tone={status.tone}>
              {status.label}
            </DeviceStatusText>
          )}
          <span className="min-w-0 truncate text-xs text-faint">
            {[device.company?.name, place.main].filter(Boolean).join(" · ") ||
              "—"}
          </span>
        </span>
      </span>

      <span className="hidden w-32 flex-none truncate md:block">
        <InventoryNumber number={device.inventoryNumber} />
      </span>

      <span className="hidden w-40 flex-none truncate text-sm lg:block">
        {device.company?.name || <span className="text-faint">—</span>}
      </span>

      <span className="hidden w-56 min-w-0 flex-none items-center gap-2 lg:flex">
        <PlaceIcon size={15} className="flex-none text-faint" aria-hidden />
        <span className="min-w-0">
          {place.main ? (
            <>
              <span className="block truncate text-sm" title={place.main}>
                {place.main}
              </span>
              {place.sub && (
                <span
                  className="block truncate text-xs text-faint"
                  title={place.sub}
                >
                  {place.sub}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-faint">не размещено</span>
          )}
        </span>
      </span>

      <span className="hidden w-36 flex-none md:block">
        {status && (
          <DeviceStatusText tone={status.tone} className="text-sm">
            {status.label}
          </DeviceStatusText>
        )}
      </span>

      {/* Гнездо действий постоянной ширины — правый край ровный у всех строк,
          в том числе там, где прав на правку нет. Глиф приглушённый, а не
          блёклый, и только по наведению (на тач-экране — всегда): правило
          строки заявки. На телефоне в гнезде одна кнопка — QR. */}
      <span
        className="flex w-9 flex-none items-center justify-end md:w-18"
        onClick={stop}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          title="Показать QR-код"
          aria-label="Показать QR-код"
          onClick={openQr}
          className={cn(
            "text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            qrOpen && "bg-accent text-accent-text opacity-100",
          )}
        >
          <RiQrCodeLine />
        </Button>
        <QrDialog device={device} open={qrOpen} onOpenChange={setQrOpen} />
        {canManage && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Действия"
                  aria-label="Действия"
                  className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100 max-md:hidden"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`update/${device._id}`}>
                    <RiEdit2Line /> Изменить
                  </Link>
                </DropdownMenuItem>
                {device.mikrotikRecordId && (
                  <DropdownMenuItem asChild>
                    <Link
                      to={`/devices/mikrotik/records/${device.mikrotikRecordId}`}
                    >
                      <RiRouterLine /> Мониторинг Mikrotik
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DeleteDialog
              item={{ ...device, title: device.name }}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          </>
        )}
      </span>
    </div>
  );
};

export default DeviceRow;
