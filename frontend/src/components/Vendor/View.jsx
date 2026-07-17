import { useContext, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useActionData, useNavigate } from "react-router";

import {
  RiAddFill,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiComputerLine,
  RiDeleteBinLine,
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
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

import { photoUrl } from "../Devices/Photos";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Облегчённая строка модели вендора (плитка · название · тип + конфигурации ·
// переход) — как ModelRow карточки типа, но мета ведёт с типа устройства.
const ModelRow = ({ model }) => {
  const title =
    [model.vendorId?.name, model.name].filter(Boolean).join(" ") ||
    "Без названия";
  const thumb = model.photos?.[0] ? photoUrl(model.photos[0]) : null;
  const count = model.configurationsCount || 0;
  const configsLabel =
    count > 0
      ? `${count} ${plural(count, "конфигурация", "конфигурации", "конфигураций")}`
      : "без конфигураций";
  const meta = [model.deviceTypeId?.name, configsLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      to={`/inventory/device-models/${model._id}`}
      className="tw:group tw:relative tw:flex tw:items-center tw:gap-3.5 tw:px-4 tw:py-2.5 tw:text-inherit tw:no-underline tw:transition-colors tw:hover:bg-accent tw:before:absolute tw:before:top-0 tw:before:right-4 tw:before:left-16 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden"
    >
      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:overflow-hidden tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
        {thumb ? (
          <img src={thumb} alt="" className="listrow-thumb" />
        ) : (
          <RiComputerLine size={18} />
        )}
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-base tw:font-medium">{title}</div>
        <div className="tw:truncate tw:text-sm tw:text-muted-foreground tw:tabular-nums">
          {meta}
        </div>
      </div>
      <RiArrowRightSLine aria-hidden className="tw:flex-none tw:text-faint" />
    </Link>
  );
};

const ViewVendor = ({ vendor = {}, models = [] }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch] = useState("");

  // Карточку открываем от начала (Root сбрасывает лишь мобильный контейнер)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Тост: ошибка удаления вендора «в использовании» (action вернул { error })
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
  }, [actionData, showToast]);

  const {
    name,
    isActive,
    isMikrotikManagementEnabled,
    deviceCount = 0,
  } = vendor;

  // Опции чипа «Тип устройства» — уникальные типы среди моделей вендора
  const typeOptions = useMemo(() => {
    const byId = new Map();
    for (const model of models) {
      const type = model.deviceTypeId;
      if (type?._id && !byId.has(String(type._id))) {
        byId.set(String(type._id), { value: type._id, label: type.name });
      }
    }
    return [...byId.values()].sort((a, b) =>
      (a.label || "").localeCompare(b.label || ""),
    );
  }, [models]);

  const filteredModels = models.filter((model) => {
    if (typeFilter && String(model.deviceTypeId?._id) !== String(typeFilter)) {
      return false;
    }
    if (search.trim()) {
      // Вендор у всех строк один — ищем по названию модели и типу
      const haystack = [model.name, model.deviceTypeId?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  const updaterName = userName(vendor.updatedBy);
  const metaBits = [
    vendor.updatedAt &&
      `Обновлено ${fmtDate(vendor.updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    vendor.createdAt && `создано ${fmtDate(vendor.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const bold = (n) => (
    <b className="tw:font-semibold tw:text-foreground">{n}</b>
  );
  const sep = <span className="tw:text-faint">·</span>;

  // Формы — вложенные маршруты карточки (шторка на месте): правка вендора не
  // уводит со страницы; после создания модели форма сама переходит на
  // карточку созданной модели (см. AddDeviceModelPage, пресет вендора)
  const addModelTo = "models/add";
  const editVendorTo = "update";
  const modelsEmpty = models.length === 0;
  const filteredEmpty = !modelsEmpty && filteredModels.length === 0;

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <Link
        to="/inventory/vendors"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Вендоры
      </Link>

      {/* Hero */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-4">
        <span
          aria-hidden
          className={cn(
            "tw:grid tw:size-14 tw:flex-none tw:place-items-center tw:rounded-2xl tw:text-2xl tw:font-semibold tw:inset-ring tw:inset-ring-border",
            isActive
              ? "tw:bg-accent tw:text-muted-foreground"
              : "tw:bg-accent/50 tw:text-faint",
          )}
        >
          {monogramFor(name)}
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
              {isActive ? "Активен" : "Отключён"}
            </span>
            <span className="tw:text-sm tw:text-muted-foreground tw:tabular-nums">
              {isMikrotikManagementEnabled && (
                <>
                  {sep}{" "}
                  <span className="tw:font-medium tw:text-accent-text">
                    управление прошивками
                  </span>{" "}
                </>
              )}
              {sep} {bold(models.length)}{" "}
              {plural(models.length, "модель", "модели", "моделей")} {sep}{" "}
              {bold(deviceCount)}{" "}
              {plural(deviceCount, "устройство", "устройства", "устройств")}
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
              <Link to={editVendorTo} onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Модели устройств вендора */}
      <div className="tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          Модели устройств
          {models.length > 0 && (
            <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
              · {models.length}
            </span>
          )}
        </div>
        {canManage && (
          <Button asChild size="sm">
            <Link to={addModelTo} onClick={offcanvas.setShow}>
              <RiAddFill /> Добавить модель
            </Link>
          </Button>
        )}
      </div>

      {modelsEmpty ? (
        <Panel>
          <div className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:px-6 tw:py-9 tw:text-center">
            <RiComputerLine
              size={40}
              aria-hidden
              className="tw:mb-1 tw:text-faint"
            />
            <div className="tw:text-base tw:font-semibold">
              Моделей этого вендора пока нет
            </div>
            <p className="tw:my-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
              Добавьте первую модель — она появится здесь и в общем списке
              моделей.
            </p>
            {canManage && (
              <Button asChild className="tw:mt-2">
                <Link to={addModelTo} onClick={offcanvas.setShow}>
                  <RiAddFill /> Добавить модель
                </Link>
              </Button>
            )}
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
              {filteredModels.map((model) => (
                <ModelRow key={model._id} model={model} />
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
        item={{ _id: vendor._id, title: name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Вендор будет удалён. Вендора с привязанными моделями удалить не дадут."
      />

      {/* Формы (правка вендора / новая модель) — нижняя шторка на карточке */}
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

export default ViewVendor;
