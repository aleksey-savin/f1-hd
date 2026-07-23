import { useContext, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useActionData, useNavigate } from "react-router";

import {
  RiAddFill,
  RiArrowDownSLine,
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

// ≤ столько моделей у вендора — не сворачиваем, группы раскрыты сразу
const SMALL_CATALOG = 12;
// столько моделей в группе показываем до «Показать все …»
const GROUP_PREVIEW = 8;

const typeIdOf = (model) =>
  model.deviceTypeId?._id ? String(model.deviceTypeId._id) : "__none";

// Плитка модели в сетке группы: превью · название · конфигурации · переход.
// Внутри карточки вендора и группы типа префикс вендора и тип не дублируем —
// остаётся имя модели и число конфигураций.
const ModelTile = ({ model }) => {
  const title = model.name || "Без названия";
  const thumb = model.photos?.[0] ? photoUrl(model.photos[0]) : null;
  const count = model.configurationsCount || 0;
  const meta =
    count > 0
      ? `${count} ${plural(count, "конфигурация", "конфигурации", "конфигураций")}`
      : "без конфигураций";

  return (
    <Link
      to={`/inventory/device-models/${model._id}`}
      className="tw:group tw:flex tw:items-center tw:gap-3 tw:rounded-lg tw:px-3 tw:py-2 tw:text-inherit tw:no-underline tw:transition-colors tw:hover:bg-accent"
    >
      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:overflow-hidden tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
        {thumb ? (
          <img src={thumb} alt="" className="listrow-thumb" />
        ) : (
          <RiComputerLine size={18} />
        )}
      </span>
      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-sm tw:font-medium">{title}</div>
        <div className="tw:truncate tw:text-xs tw:text-muted-foreground tw:tabular-nums">
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
  const [search, setSearch] = useState("");
  // Свёрнутый/раскрытый набор групп (по id типа). Малый каталог — всё раскрыто.
  const [openIds, setOpenIds] = useState(() => {
    if (models.length > SMALL_CATALOG) return new Set();
    return new Set(models.map(typeIdOf));
  });
  // Группы, в которых нажали «Показать все …» (сняли лимит превью).
  const [fullIds, setFullIds] = useState(() => new Set());

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

  // Модели, сгруппированные по типу устройства; крупнейший тип — сверху
  // (композиция вендора «с первого взгляда»). Внутри группы — по алфавиту.
  const groups = useMemo(() => {
    const byType = new Map();
    for (const model of models) {
      const id = typeIdOf(model);
      if (!byType.has(id)) {
        byType.set(id, {
          id,
          name: model.deviceTypeId?.name || "Без типа",
          models: [],
        });
      }
      byType.get(id).models.push(model);
    }
    const arr = [...byType.values()];
    for (const group of arr) {
      group.models.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    arr.sort(
      (a, b) =>
        b.models.length - a.models.length || a.name.localeCompare(b.name),
    );
    return arr;
  }, [models]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const matchModel = (model) =>
    [model.name, model.deviceTypeId?.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);

  // Группы к показу: при поиске — только с совпадениями, и в них — совпавшие
  const viewGroups = groups
    .map((group) => ({
      ...group,
      shown: searching ? group.models.filter(matchModel) : group.models,
    }))
    .filter((group) => !searching || group.shown.length > 0);

  const grouped = groups.length > 1;
  const allOpen =
    viewGroups.length > 0 && viewGroups.every((group) => openIds.has(group.id));

  const toggleGroup = (id) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setOpenIds(allOpen ? new Set() : new Set(viewGroups.map((g) => g.id)));
  const showAllInGroup = (id) => setFullIds((prev) => new Set(prev).add(id));

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
  const filteredEmpty = !modelsEmpty && viewGroups.length === 0;
  const typeCount = groups.length;

  // Плитки группы: сетка (2 колонки) + «Показать все …» сверх лимита превью
  const renderTiles = (group) => {
    const full = searching || fullIds.has(group.id);
    const shown = full ? group.shown : group.shown.slice(0, GROUP_PREVIEW);
    const capped = !full && group.shown.length > GROUP_PREVIEW;
    return (
      <>
        <div className="tw:grid tw:grid-cols-1 tw:gap-1 tw:sm:grid-cols-2">
          {shown.map((model) => (
            <ModelTile key={model._id} model={model} />
          ))}
        </div>
        {capped && (
          <button
            type="button"
            onClick={() => showAllInGroup(group.id)}
            className="tw:mt-1 tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:font-semibold tw:text-accent-text tw:outline-none tw:hover:underline tw:focus-visible:underline"
          >
            Показать все {group.shown.length}{" "}
            {plural(group.shown.length, "модель", "модели", "моделей")}
            <RiArrowDownSLine size={15} aria-hidden />
          </button>
        )}
      </>
    );
  };

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
              {plural(models.length, "модель", "модели", "моделей")}{" "}
              {models.length > 0 && (
                <>
                  {sep} {bold(typeCount)}{" "}
                  {plural(typeCount, "тип", "типа", "типов")}{" "}
                </>
              )}
              {sep} {bold(deviceCount)}{" "}
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
              <RiAddFill /> Новая модель
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
                  <RiAddFill /> Новая модель
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
            {grouped && !searching && (
              <button
                type="button"
                onClick={toggleAll}
                className="tw:ml-auto tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-1.5 tw:text-sm tw:font-semibold tw:text-muted-foreground tw:outline-none tw:hover:text-accent-text tw:focus-visible:text-accent-text"
              >
                {allOpen ? "Свернуть все" : "Развернуть все"}
              </button>
            )}
          </div>

          {filteredEmpty ? (
            <Panel>
              <div className="tw:px-2 tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground">
                Ничего не нашлось. Измените запрос.
              </div>
            </Panel>
          ) : grouped ? (
            <div className="tw:flex tw:flex-col tw:gap-2">
              {viewGroups.map((group) => {
                const open = searching || openIds.has(group.id);
                const examples = group.models
                  .map((model) => model.name)
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(" · ");
                const countN = searching
                  ? group.shown.length
                  : group.models.length;
                return (
                  <section
                    key={group.id}
                    className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={open}
                      className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-3.5 tw:py-3 tw:text-left tw:text-inherit tw:transition-colors tw:outline-none tw:hover:bg-accent tw:focus-visible:bg-accent"
                    >
                      <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-sm tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
                        {monogramFor(group.name)}
                      </span>
                      <span className="tw:min-w-0 tw:flex-1">
                        <span className="tw:block tw:truncate tw:text-base tw:font-medium">
                          {group.name}
                        </span>
                        {!open && examples && (
                          <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
                            {examples}
                            {group.models.length > 3 ? " …" : ""}
                          </span>
                        )}
                      </span>
                      <span className="tw:flex-none tw:text-muted-foreground tw:tabular-nums">
                        <b className="tw:text-base tw:font-bold tw:text-foreground">
                          {countN}
                        </b>{" "}
                        <span className="tw:text-xs">
                          {searching
                            ? plural(countN, "найдена", "найдено", "найдено")
                            : plural(countN, "модель", "модели", "моделей")}
                        </span>
                      </span>
                      <RiArrowDownSLine
                        size={20}
                        aria-hidden
                        className={cn(
                          "tw:flex-none tw:text-faint tw:transition-transform",
                          open && "tw:rotate-180",
                        )}
                      />
                    </button>
                    {open && (
                      <div className="tw:border-t tw:border-border-soft tw:p-2">
                        {renderTiles(group)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            // Один тип — группировка не нужна: плитки сеткой напрямую
            <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-2">
              {renderTiles(viewGroups[0])}
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
