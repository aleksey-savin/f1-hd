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
import useOffcanvasStore from "@/store/offcanvas";

import QrDialog from "./QrDialog";

// Окно подсветки свежих строк — то же, что у app/ListRow.
const FRESH_MS = 8000;

const LIVE_DOT = {
  ok: "bg-primary",
  bad: "bg-destructive",
  off: "bg-faint",
};

// Инвентарная метка — опорный столбец реестра: номер ищут глазами по
// вертикали, поэтому моноширинный и в своей колонке. Он же вход в QR: печатная
// наклейка и её машинный двойник живут в одном месте (глиф проступает по
// наведению на строку, на тач-экране виден всегда).
const InventoryTag = ({ number, onOpenQr }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onOpenQr();
    }}
    title="Показать QR-код"
    className={cn(
      "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs tracking-wide transition-colors",
      number
        ? "border-border-soft bg-accent font-semibold text-foreground group-hover:border-input"
        : // Пустая метка — пробел учёта: пунктир вместо номера. Пунктир задаём
          // инлайном: без preflight классы border-dashed рисуют бокс (см. гайд).
          "bg-transparent font-sans text-faint",
    )}
    style={number ? undefined : { border: "1px dashed var(--border)" }}
  >
    {number || "нет №"}
    <RiQrCodeLine
      size={11}
      aria-hidden
      className="opacity-0 transition-opacity group-hover:opacity-55 pointer-coarse:opacity-55"
    />
  </button>
);

/**
 * Строка реестра устройств — жёсткие колонки: плитка типа (с живой точкой
 * связи Mikrotik) · имя + «тип · вендор · имя в сети» · инвентарная метка ·
 * компания · «у кого / где» · учётный статус · гнездо действий (QR и «⋯»).
 *
 * Клик по строке ведёт на карточку устройства. У рабочих мест расположение
 * почти дословно повторяет закреплённого человека, поэтому колонка одна:
 * закреплено — показываем человека и расположение подстрокой, не закреплено —
 * само расположение.
 */
const DeviceRow = ({ device }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { _id: userId } = useAuthedUser();
  const can = useCan();
  const canManage = canManageEntity("clientDevice", can,
    device,
    userId,
  );

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
        "group relative flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors md:gap-4 md:px-5",
        "before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-border-soft first:before:hidden",
        "hover:bg-accent/60",
        justCreated && "row-appear",
        justUpdated && "row-flash",
      )}
    >
      <span
        aria-hidden
        className="relative grid size-10 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
      >
        <Icon size={19} />
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
          <span className="min-w-0 truncate text-base leading-tight font-medium" title={device.name}>
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
          {/* До md колонки схлопнуты — метка едет в строку меты */}
          <span className="flex-none md:hidden" onClick={stop}>
            <InventoryTag number={device.inventoryNumber} onOpenQr={openQr} />
          </span>
          <span className="truncate">{meta || "—"}</span>
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

      <QrDialog device={device} open={qrOpen} onOpenChange={setQrOpen}>
        <span className="hidden w-32 flex-none md:block" onClick={stop}>
          <InventoryTag number={device.inventoryNumber} onOpenQr={openQr} />
        </span>
      </QrDialog>

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

      {/* Гнездо действий постоянной ширины (две кнопки 36px) — правый край
          ровный у всех строк, в том числе там, где прав на правку нет */}
      <span
        className="hidden w-18 flex-none items-center justify-end md:flex"
        onClick={stop}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          title="Показать QR-код"
          aria-label="Показать QR-код"
          onClick={openQr}
          className={cn(
            "text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            qrOpen && "opacity-100 bg-accent text-accent-text",
          )}
        >
          <RiQrCodeLine />
        </Button>
        {canManage && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Действия"
                  aria-label="Действия"
                  className="text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`update/${device._id}`} onClick={offcanvas.setShow}>
                    <RiEdit2Line /> Изменить
                  </Link>
                </DropdownMenuItem>
                {device.mikrotikRecordId && (
                  <DropdownMenuItem asChild>
                    <Link
                      to={`/devices/mikrotik?recordId=${device.mikrotikRecordId}`}
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
