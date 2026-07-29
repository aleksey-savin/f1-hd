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
import { useAuthedUser } from "@/store/authed-user";
import useOffcanvasStore from "@/store/offcanvas";

import QrDialog from "./QrDialog";

// Окно подсветки свежих строк — то же, что у app/ListRow.
const FRESH_MS = 8000;

const LIVE_DOT = {
  ok: "tw:bg-primary",
  bad: "tw:bg-destructive",
  off: "tw:bg-faint",
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
      "tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-1.5 tw:rounded-md tw:border tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:tracking-wide tw:transition-colors",
      number
        ? "tw:border-border-soft tw:bg-accent tw:font-semibold tw:text-foreground tw:group-hover:border-input"
        : // Пустая метка — пробел учёта: пунктир вместо номера. Пунктир задаём
          // инлайном: без preflight классы border-dashed рисуют бокс (см. гайд).
          "tw:bg-transparent tw:font-sans tw:text-faint",
    )}
    style={number ? undefined : { border: "1px dashed var(--border)" }}
  >
    {number || "нет №"}
    <RiQrCodeLine
      size={11}
      aria-hidden
      className="tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-55 tw:pointer-coarse:opacity-55"
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
  const { _id: userId, permissions } = useAuthedUser();
  const canManage = canManageEntity(
    "clientDevice",
    permissions,
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
        "tw:group tw:relative tw:flex tw:cursor-pointer tw:items-center tw:gap-3 tw:px-4 tw:py-2.5 tw:transition-colors tw:md:gap-4 tw:md:px-5",
        "tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden",
        "tw:hover:bg-accent/60",
        justCreated && "tw:row-appear",
        justUpdated && "tw:row-flash",
      )}
    >
      <span
        aria-hidden
        className="tw:relative tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
      >
        <Icon size={19} />
        {mikro && (
          <span
            title={`Mikrotik: ${mikro.label}`}
            className={cn(
              "tw:absolute tw:-right-0.5 tw:-bottom-0.5 tw:size-2.5 tw:rounded-full tw:ring-2 tw:ring-card",
              LIVE_DOT[mikro.tone],
            )}
          />
        )}
      </span>

      <span className="tw:min-w-0 tw:flex-1">
        <span className="tw:flex tw:items-center tw:gap-2">
          <span
            className="tw:min-w-0 tw:truncate tw:font-medium"
            title={device.name}
          >
            {device.name}
          </span>
          {device.componentCount > 0 && (
            <span
              title={`Сборка: ${device.componentCount} комплектующих`}
              className="tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-md tw:bg-accent tw:px-1.5 tw:text-xs tw:font-semibold tw:text-muted-foreground tw:tabular-nums"
            >
              <RiStackLine size={12} aria-hidden />
              {device.componentCount}
            </span>
          )}
        </span>
        <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
          {/* До md колонки схлопнуты — метка едет в строку меты */}
          <span className="tw:flex-none tw:md:hidden" onClick={stop}>
            <InventoryTag number={device.inventoryNumber} onOpenQr={openQr} />
          </span>
          <span className="tw:truncate">{meta || "—"}</span>
          {/* Комплектующее попадает в список только по запросу и обязано
              назвать хозяина: у детали расположение и владелец — его. */}
          {device.parent && (
            <span
              title={`В составе: ${device.parent.name}`}
              className="tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-md tw:bg-accent tw:px-1.5 tw:text-xs tw:font-medium tw:text-muted-foreground"
            >
              <RiBox3Line size={12} aria-hidden />
              <span className="tw:max-md:hidden">в составе: </span>
              {device.parent.inventoryNumber || device.parent.name}
            </span>
          )}
          {device.hostname && !device.parent && (
            <span className="tw:hidden tw:flex-none tw:font-mono tw:text-xs tw:text-faint tw:lg:inline">
              {device.hostname}
            </span>
          )}
        </span>
        {/* Узкий экран: статус и принадлежность подстрокой */}
        <span className="tw:mt-0.5 tw:flex tw:min-w-0 tw:items-center tw:gap-2.5 tw:md:hidden">
          {status && (
            <DeviceStatusText tone={status.tone}>
              {status.label}
            </DeviceStatusText>
          )}
          <span className="tw:min-w-0 tw:truncate tw:text-xs tw:text-faint">
            {[device.company?.name, place.main].filter(Boolean).join(" · ") ||
              "—"}
          </span>
        </span>
      </span>

      <QrDialog device={device} open={qrOpen} onOpenChange={setQrOpen}>
        <span
          className="tw:hidden tw:w-32 tw:flex-none tw:md:block"
          onClick={stop}
        >
          <InventoryTag number={device.inventoryNumber} onOpenQr={openQr} />
        </span>
      </QrDialog>

      <span className="tw:hidden tw:w-40 tw:flex-none tw:truncate tw:text-sm tw:lg:block">
        {device.company?.name || <span className="tw:text-faint">—</span>}
      </span>

      <span className="tw:hidden tw:w-56 tw:min-w-0 tw:flex-none tw:items-center tw:gap-2 tw:lg:flex">
        <PlaceIcon
          size={15}
          className="tw:flex-none tw:text-faint"
          aria-hidden
        />
        <span className="tw:min-w-0">
          {place.main ? (
            <>
              <span
                className="tw:block tw:truncate tw:text-sm"
                title={place.main}
              >
                {place.main}
              </span>
              {place.sub && (
                <span
                  className="tw:block tw:truncate tw:text-xs tw:text-faint"
                  title={place.sub}
                >
                  {place.sub}
                </span>
              )}
            </>
          ) : (
            <span className="tw:text-sm tw:text-faint">не размещено</span>
          )}
        </span>
      </span>

      <span className="tw:hidden tw:w-36 tw:flex-none tw:md:block">
        {status && (
          <DeviceStatusText tone={status.tone} className="tw:text-sm">
            {status.label}
          </DeviceStatusText>
        )}
      </span>

      {/* Гнездо действий постоянной ширины (две кнопки 36px) — правый край
          ровный у всех строк, в том числе там, где прав на правку нет */}
      <span
        className="tw:hidden tw:w-18 tw:flex-none tw:items-center tw:justify-end tw:md:flex"
        onClick={stop}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          title="Показать QR-код"
          aria-label="Показать QR-код"
          onClick={openQr}
          className={cn(
            "tw:text-faint tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:pointer-coarse:opacity-100",
            qrOpen && "tw:opacity-100 tw:bg-accent tw:text-accent-text",
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
                  className="tw:text-faint tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:focus-visible:opacity-100 tw:data-[state=open]:opacity-100 tw:pointer-coarse:opacity-100"
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
