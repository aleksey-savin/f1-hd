import { useContext, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useActionData, useNavigate } from "react-router";

import {
  RiAddFill,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiDoorLine,
  RiEdit2Line,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Panel } from "@/components/app/Panel";
import ChipSelect from "@/components/app/ChipSelect";
import SearchBar from "@/components/app/SearchBar";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { cn } from "@/lib/utils";

import { DEVICE_STATUS_LABELS as STATUS_LABELS } from "@/components/app/device-status";
import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const dash = <span className="text-faint">—</span>;
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Тон статуса устройства в строке: жизненный цикл цветным текстом
// (никаких заливных бейджей — язык карточек).
const STATUS_TONE = {
  readyForDeployment: "text-accent-text",
  deployed: "text-accent-text",
  inRepair: "text-warning",
  inReserve: "text-muted-foreground",
  decommissioned: "text-faint",
  disposed: "text-faint",
};

// Микро-подпись + значение в панели «Основное» (ср. карточку типа).
const Detail = ({ label, children, className }) => (
  <div className={cn("min-w-0", className)}>
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div className="text-[15px] leading-relaxed break-words">
      {children || dash}
    </div>
  </div>
);

// Ссылка на карточку связанной сущности (навигация вверх/вбок по иерархии).
const EntityLink = ({ to, children }) => (
  <Link
    to={to}
    className="font-medium text-accent-text no-underline hover:underline"
  >
    {children}
  </Link>
);

// Строка вложенного расположения: иконка типа · название · тип + устройства.
const ChildRow = ({ child }) => {
  const Icon = TYPE_ICON[child.type] || RiDoorLine;
  const meta = [
    TYPE_LABEL[child.type] || child.type,
    child.deviceCount > 0
      ? `${child.deviceCount} ${plural(child.deviceCount, "устройство", "устройства", "устройств")}`
      : "без устройств",
  ].join(" · ");

  return (
    <Link
      to={`/inventory/locations/${child._id}`}
      className="group relative flex items-center gap-3.5 px-4 py-2.5 text-inherit no-underline transition-colors hover:bg-accent before:absolute before:top-0 before:right-4 before:left-16 before:h-px before:bg-border-soft first:before:hidden"
    >
      <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">
          {child.name || "Без названия"}
        </div>
        <div className="truncate text-sm text-muted-foreground tabular-nums">
          {meta}
        </div>
      </div>
      <RiArrowRightSLine aria-hidden className="flex-none text-faint" />
    </Link>
  );
};

// Строка устройства «здесь»: название · тип + номер + пользователь · статус.
const DeviceRow = ({ device }) => {
  const meta = [
    device.typeName,
    device.inventoryNumber || device.serialNumber,
    device.userName,
  ]
    .filter(Boolean)
    .join(" · ");
  const statusLabel = STATUS_LABELS[device.status] || null;
  const statusTone = STATUS_TONE[device.status] || "text-muted-foreground";

  return (
    <Link
      to={`/inventory/client-devices/${device._id}`}
      className="group relative flex items-center gap-3.5 px-4 py-2.5 text-inherit no-underline transition-colors hover:bg-accent before:absolute before:top-0 before:right-4 before:left-16 before:h-px before:bg-border-soft first:before:hidden"
    >
      <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border">
        <RiComputerLine size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">{device.name}</div>
        <div className="truncate text-sm text-muted-foreground tabular-nums">
          {meta || "—"}
          {/* На узких экранах статус переезжает из правой колонки в мету */}
          {statusLabel && (
            <span className={cn("sm:hidden", statusTone)}>
              {meta ? " · " : ""}
              {statusLabel}
            </span>
          )}
        </div>
      </div>
      {statusLabel && (
        <span
          className={cn(
            "flex-none text-[13px] font-semibold max-sm:hidden",
            statusTone,
          )}
        >
          {statusLabel}
        </span>
      )}
      <RiArrowRightSLine aria-hidden className="flex-none text-faint" />
    </Link>
  );
};

const ViewLocation = ({
  location = {},
  ancestors = [],
  childLocations = [],
  devices = [],
}) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch] = useState("");

  // Карточку открываем от начала; deps по id — переход на вложенное
  // расположение не размонтирует компонент (тот же маршрут, другой :id)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location._id]);

  // Тост: ошибка удаления «есть устройства/вложенные» (action вернул { error })
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
  }, [actionData, showToast]);

  const {
    name,
    type,
    isActive = true,
    isPublic,
    description,
    address,
    company,
    subdivisions = [],
    assignedUser,
    defaultResponsible,
  } = location;

  const TypeIcon = TYPE_ICON[type] || RiDoorLine;
  const typeLabel = TYPE_LABEL[type] || type;
  const companyName = company?.alias || company?.fullTitle;
  const companyId = company?._id || company;
  const canHaveChildren = CHILD_CAPABLE.includes(type);

  // Опции чипа «Тип устройства» — уникальные типы среди устройств «здесь»
  const typeOptions = useMemo(() => {
    const byId = new Map();
    for (const device of devices) {
      if (device.typeId && !byId.has(String(device.typeId))) {
        byId.set(String(device.typeId), {
          value: device.typeId,
          label: device.typeName,
        });
      }
    }
    return [...byId.values()].sort((a, b) =>
      (a.label || "").localeCompare(b.label || ""),
    );
  }, [devices]);

  const filteredDevices = devices.filter((device) => {
    if (typeFilter && String(device.typeId) !== String(typeFilter)) {
      return false;
    }
    if (search.trim()) {
      const haystack = [
        device.name,
        device.typeName,
        device.inventoryNumber,
        device.serialNumber,
        device.userName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  const updaterName = userName(location.updatedBy);
  const metaBits = [
    location.updatedAt &&
      `Обновлено ${fmtDate(location.updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    location.createdAt && `создано ${fmtDate(location.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const bold = (n) => <b className="font-semibold text-foreground">{n}</b>;
  const sep = <span className="text-faint">·</span>;

  // Формы — вложенные маршруты карточки (шторка на месте): правка не уводит
  // со страницы; add наследует query-пресеты компании и родителя
  const addChildTo = `add?company=${companyId || ""}&parent=${location._id}`;
  const devicesEmpty = devices.length === 0;
  const filteredEmpty = !devicesEmpty && filteredDevices.length === 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Крошки — полная цепочка предков: список → здание → этаж; текущее
          расположение только в h1 */}
      <nav className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-medium text-muted-foreground">
        <Link
          to="/inventory/locations"
          className="inline-flex items-center gap-1 text-inherit no-underline hover:text-foreground"
        >
          <RiArrowLeftSLine /> Расположения
        </Link>
        {ancestors.map((ancestor) => (
          <span key={ancestor._id} className="inline-flex items-center gap-1">
            <span aria-hidden className="mx-1 text-faint">
              ›
            </span>
            <Link
              to={`/inventory/locations/${ancestor._id}`}
              className="text-inherit no-underline hover:text-foreground"
            >
              {ancestor.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-14 flex-none place-items-center rounded-2xl inset-ring inset-ring-border",
            isActive
              ? "bg-accent text-muted-foreground"
              : "bg-accent/50 text-faint",
          )}
        >
          <TypeIcon size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              "my-0 text-3xl leading-tight font-semibold tracking-tight break-words",
              !isActive && "text-muted-foreground",
            )}
          >
            {name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-2 text-sm font-semibold",
                isActive ? "text-accent-text" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isActive ? "bg-primary ring-4 ring-primary/20" : "bg-faint",
                )}
              />
              {isActive ? "Активно" : "Отключено"}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {sep} {typeLabel}
              {companyName && (
                <>
                  {" "}
                  {sep} {companyName}
                </>
              )}
              {isPublic && (
                <>
                  {" "}
                  {sep}{" "}
                  <span className="font-medium text-accent-text">
                    общедоступное
                  </span>
                </>
              )}{" "}
              {sep} {bold(childLocations.length)}{" "}
              {plural(
                childLocations.length,
                "вложенное",
                "вложенных",
                "вложенных",
              )}{" "}
              {sep} {bold(devices.length)}{" "}
              {plural(devices.length, "устройство", "устройства", "устройств")}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-none items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Действия"
                  title="Действия"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild>
              <Link to="update" onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Основное */}
      <div className="mt-6 mb-2.5 text-xs font-bold tracking-wider text-faint uppercase">
        Основное
      </div>
      <Panel>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Компания">{companyName}</Detail>
          <Detail label="Подразделения">
            {subdivisions.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {subdivisions.map((subdivision) => (
                  <span
                    key={subdivision._id}
                    className="inline-flex items-center rounded-full border border-border-soft bg-accent px-2.5 py-1 text-sm font-medium"
                  >
                    {subdivision.name}
                  </span>
                ))}
              </span>
            ) : null}
          </Detail>
          <Detail label="Адрес">{address}</Detail>
          {type === "workplace" && (
            <Detail label="Сотрудник">
              {assignedUser ? (
                <EntityLink to={`/users/${assignedUser._id}`}>
                  {userName(assignedUser)}
                </EntityLink>
              ) : null}
            </Detail>
          )}
          <Detail label="Ответственный по умолчанию">
            {defaultResponsible ? (
              <EntityLink to={`/users/${defaultResponsible._id}`}>
                {userName(defaultResponsible)}
              </EntityLink>
            ) : null}
          </Detail>
          {description && (
            <Detail label="Описание" className="sm:col-span-2">
              {description}
            </Detail>
          )}
        </div>
      </Panel>

      {/* Вложенные расположения */}
      <div className="mt-6 mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
          Вложенные расположения
          {childLocations.length > 0 && (
            <span className="font-semibold tracking-normal tabular-nums">
              · {childLocations.length}
            </span>
          )}
        </div>
        {canManage && canHaveChildren && (
          <Button asChild size="sm">
            <Link to={addChildTo} onClick={offcanvas.setShow}>
              <RiAddFill /> Новое расположение
            </Link>
          </Button>
        )}
      </div>

      {childLocations.length === 0 ? (
        <Panel>
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            {canHaveChildren
              ? "Вложенных расположений пока нет."
              : "У расположений этого типа не бывает вложенных."}
          </div>
        </Panel>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card py-1.5">
          {childLocations.map((child) => (
            <ChildRow key={child._id} child={child} />
          ))}
        </div>
      )}

      {/* Устройства непосредственно в этом расположении */}
      <div className="mt-6 mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
        Устройства здесь
        {devices.length > 0 && (
          <span className="font-semibold tracking-normal tabular-nums">
            · {devices.length}
          </span>
        )}
      </div>

      {devicesEmpty ? (
        <Panel>
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            Устройств в этом расположении нет.
          </div>
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <SearchBar
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:w-64"
            />
            {typeOptions.length > 0 && (
              <ChipSelect
                placeholder="Тип устройства"
                allLabel="Все типы"
                value={typeFilter}
                options={typeOptions}
                onChange={setTypeFilter}
              />
            )}
          </div>
          {filteredEmpty ? (
            <Panel>
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Ничего не нашлось. Измените запрос или фильтр.
              </div>
            </Panel>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card py-1.5">
              {filteredDevices.map((device) => (
                <DeviceRow key={device._id} device={device} />
              ))}
            </div>
          )}
        </>
      )}

      {metaBits && (
        <div className="mt-6 border-t border-border-soft pt-3.5 text-xs text-faint tabular-nums">
          {metaBits}
        </div>
      )}

      <DeleteDialog
        item={{ _id: location._id, title: name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Расположение будет удалено. С устройствами или вложенными расположениями удалить не дадут."
      />

      {/* Формы (правка / вложенное расположение) — нижняя шторка на карточке */}
      <FormSheet
        open={offcanvas.isActive}
        onOpenChange={(open) => {
          if (!open) {
            navigate(-1);
            offcanvas.setClose();
          }
        }}
      >
        <Outlet />
      </FormSheet>
    </div>
  );
};

export default ViewLocation;
