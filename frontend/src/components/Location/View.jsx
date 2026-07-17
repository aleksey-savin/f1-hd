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

import { STATUS_LABELS } from "../ClientDevice/constants";
import { TYPE_LABEL, TYPE_ICON, CHILD_CAPABLE } from "./type-meta";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const dash = <span className="tw:text-faint">—</span>;
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Тон статуса устройства в строке: жизненный цикл цветным текстом
// (никаких заливных бейджей — язык карточек).
const STATUS_TONE = {
  readyForDeployment: "tw:text-accent-text",
  deployed: "tw:text-accent-text",
  inRepair: "tw:text-warning",
  inReserve: "tw:text-muted-foreground",
  decommissioned: "tw:text-faint",
  disposed: "tw:text-faint",
};

// Микро-подпись + значение в панели «Основное» (ср. карточку типа).
const Detail = ({ label, children, className }) => (
  <div className={cn("tw:min-w-0", className)}>
    <div className="tw:mb-0.5 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
      {label}
    </div>
    <div className="tw:text-[15px] tw:leading-relaxed tw:break-words">
      {children || dash}
    </div>
  </div>
);

// Ссылка на карточку связанной сущности (навигация вверх/вбок по иерархии).
const EntityLink = ({ to, children }) => (
  <Link
    to={to}
    className="tw:font-medium tw:text-accent-text tw:no-underline tw:hover:underline"
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
      className="tw:group tw:relative tw:flex tw:items-center tw:gap-3.5 tw:px-4 tw:py-2.5 tw:text-inherit tw:no-underline tw:transition-colors tw:hover:bg-accent tw:before:absolute tw:before:top-0 tw:before:right-4 tw:before:left-16 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden"
    >
      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
        <Icon size={18} />
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-base tw:font-medium">
          {child.name || "Без названия"}
        </div>
        <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:tabular-nums">
          {meta}
        </div>
      </div>
      <RiArrowRightSLine aria-hidden className="tw:flex-none tw:text-faint" />
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
  const statusTone = STATUS_TONE[device.status] || "tw:text-muted-foreground";

  return (
    <Link
      to={`/inventory/client-devices/${device._id}`}
      className="tw:group tw:relative tw:flex tw:items-center tw:gap-3.5 tw:px-4 tw:py-2.5 tw:text-inherit tw:no-underline tw:transition-colors tw:hover:bg-accent tw:before:absolute tw:before:top-0 tw:before:right-4 tw:before:left-16 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden"
    >
      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
        <RiComputerLine size={18} />
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-base tw:font-medium">
          {device.name}
        </div>
        <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:tabular-nums">
          {meta || "—"}
          {/* На узких экранах статус переезжает из правой колонки в мету */}
          {statusLabel && (
            <span className={cn("tw:sm:hidden", statusTone)}>
              {meta ? " · " : ""}
              {statusLabel}
            </span>
          )}
        </div>
      </div>
      {statusLabel && (
        <span
          className={cn(
            "tw:flex-none tw:text-[13px] tw:font-semibold tw:max-sm:hidden",
            statusTone,
          )}
        >
          {statusLabel}
        </span>
      )}
      <RiArrowRightSLine aria-hidden className="tw:flex-none tw:text-faint" />
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

  const bold = (n) => (
    <b className="tw:font-semibold tw:text-foreground">{n}</b>
  );
  const sep = <span className="tw:text-faint">·</span>;

  // Формы — вложенные маршруты карточки (шторка на месте): правка не уводит
  // со страницы; add наследует query-пресеты компании и родителя
  const addChildTo = `add?company=${companyId || ""}&parent=${location._id}`;
  const devicesEmpty = devices.length === 0;
  const filteredEmpty = !devicesEmpty && filteredDevices.length === 0;

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      {/* Крошки — полная цепочка предков: список → здание → этаж; текущее
          расположение только в h1 */}
      <nav className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-1 tw:gap-y-1 tw:text-sm tw:font-medium tw:text-muted-foreground">
        <Link
          to="/inventory/locations"
          className="tw:inline-flex tw:items-center tw:gap-1 tw:text-inherit tw:no-underline tw:hover:text-foreground"
        >
          <RiArrowLeftSLine /> Расположения
        </Link>
        {ancestors.map((ancestor) => (
          <span key={ancestor._id} className="tw:inline-flex tw:items-center tw:gap-1">
            <span aria-hidden className="tw:mx-1 tw:text-faint">
              ›
            </span>
            <Link
              to={`/inventory/locations/${ancestor._id}`}
              className="tw:text-inherit tw:no-underline tw:hover:text-foreground"
            >
              {ancestor.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Hero */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className={cn(
            "tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:inset-ring tw:inset-ring-border",
            isActive
              ? "tw:bg-accent tw:text-muted-foreground"
              : "tw:bg-accent/50 tw:text-faint",
          )}
        >
          <TypeIcon size={26} />
        </span>
        <div className="tw:min-w-0 tw:flex-1">
          <h1
            className={cn(
              "tw:my-0 tw:text-3xl tw:leading-tight tw:font-semibold tw:tracking-tight tw:break-words",
              !isActive && "tw:text-muted-foreground",
            )}
          >
            {name}
          </h1>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5">
            <span
              className={cn(
                "tw:inline-flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold",
                isActive ? "tw:text-accent-text" : "tw:text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "tw:size-2 tw:rounded-full",
                  isActive
                    ? "tw:bg-primary tw:ring-4 tw:ring-primary/20"
                    : "tw:bg-faint",
                )}
              />
              {isActive ? "Активно" : "Отключено"}
            </span>
            <span className="tw:text-sm tw:text-muted-foreground tw:tabular-nums">
              {sep} {typeLabel}
              {companyName && <> {sep} {companyName}</>}
              {isPublic && (
                <>
                  {" "}
                  {sep}{" "}
                  <span className="tw:font-medium tw:text-accent-text">
                    общедоступное
                  </span>
                </>
              )}{" "}
              {sep} {bold(childLocations.length)}{" "}
              {plural(childLocations.length, "вложенное", "вложенных", "вложенных")}{" "}
              {sep} {bold(devices.length)}{" "}
              {plural(devices.length, "устройство", "устройства", "устройств")}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="tw:flex tw:flex-none tw:items-center tw:gap-2">
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
      <div className="tw:mt-6 tw:mb-2.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        Основное
      </div>
      <Panel>
        <div className="tw:grid tw:gap-x-6 tw:gap-y-4 tw:sm:grid-cols-2">
          <Detail label="Компания">{companyName}</Detail>
          <Detail label="Подразделения">
            {subdivisions.length > 0 ? (
              <span className="tw:flex tw:flex-wrap tw:gap-1.5">
                {subdivisions.map((subdivision) => (
                  <span
                    key={subdivision._id}
                    className="tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium"
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
            <Detail label="Описание" className="tw:sm:col-span-2">
              {description}
            </Detail>
          )}
        </div>
      </Panel>

      {/* Вложенные расположения */}
      <div className="tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          Вложенные расположения
          {childLocations.length > 0 && (
            <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
              · {childLocations.length}
            </span>
          )}
        </div>
        {canManage && canHaveChildren && (
          <Button asChild size="sm">
            <Link to={addChildTo} onClick={offcanvas.setShow}>
              <RiAddFill /> Добавить расположение
            </Link>
          </Button>
        )}
      </div>

      {childLocations.length === 0 ? (
        <Panel>
          <div className="tw:px-2 tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground">
            {canHaveChildren
              ? "Вложенных расположений пока нет."
              : "У расположений этого типа не бывает вложенных."}
          </div>
        </Panel>
      ) : (
        <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-1.5">
          {childLocations.map((child) => (
            <ChildRow key={child._id} child={child} />
          ))}
        </div>
      )}

      {/* Устройства непосредственно в этом расположении */}
      <div className="tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
        Устройства здесь
        {devices.length > 0 && (
          <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
            · {devices.length}
          </span>
        )}
      </div>

      {devicesEmpty ? (
        <Panel>
          <div className="tw:px-2 tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground">
            Устройств в этом расположении нет.
          </div>
        </Panel>
      ) : (
        <>
          <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
            <SearchBar
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="tw:w-full tw:sm:w-64"
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
              <div className="tw:px-2 tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground">
                Ничего не нашлось. Измените запрос или фильтр.
              </div>
            </Panel>
          ) : (
            <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-1.5">
              {filteredDevices.map((device) => (
                <DeviceRow key={device._id} device={device} />
              ))}
            </div>
          )}
        </>
      )}

      {metaBits && (
        <div className="tw:mt-6 tw:border-t tw:border-border-soft tw:pt-3.5 tw:text-xs tw:text-faint tw:tabular-nums">
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
