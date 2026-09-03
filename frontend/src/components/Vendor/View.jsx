import { useEffect, useMemo, useState } from "react";
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

import { photoUrl } from "@/components/app/PhotoGallery";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { useCan } from "@/store/authed-user";

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
      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-inherit no-underline transition-colors hover:bg-accent"
    >
      <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <RiComputerLine size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground tabular-nums">
          {meta}
        </div>
      </div>
      <RiArrowRightSLine aria-hidden className="flex-none text-faint" />
    </Link>
  );
};

const ViewVendor = ({ vendor = {}, models = [] }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const can = useCan();
  const canManage = can({ inventoryCatalog: ["manage"] });
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

  const bold = (n) => <b className="font-semibold text-foreground">{n}</b>;
  const sep = <span className="text-faint">·</span>;

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
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {shown.map((model) => (
            <ModelTile key={model._id} model={model} />
          ))}
        </div>
        {capped && (
          <button
            type="button"
            onClick={() => showAllInGroup(group.id)}
            className="mt-1 inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-3 py-1.5 text-sm font-semibold text-accent-text outline-none hover:underline focus-visible:underline"
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
    <div className="mx-auto w-full max-w-4xl">
      <Link
        to="/inventory/vendors"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
      >
        <RiArrowLeftSLine /> Вендоры
      </Link>

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-14 flex-none place-items-center rounded-2xl text-2xl font-semibold inset-ring inset-ring-border",
            isActive
              ? "bg-accent text-muted-foreground"
              : "bg-accent/50 text-faint",
          )}
        >
          {monogramFor(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              "my-0 text-2xl leading-tight font-semibold tracking-tight break-words",
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
              {isActive ? "Активен" : "Отключён"}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {isMikrotikManagementEnabled && (
                <>
                  {sep}{" "}
                  <span className="font-medium text-accent-text">
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
              <Link to={editVendorTo} onClick={offcanvas.setShow}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Модели устройств вендора */}
      <div className="mt-6 mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
          Модели устройств
          {models.length > 0 && (
            <span className="font-semibold tracking-normal tabular-nums">
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
          <div className="flex flex-col items-center gap-2 px-6 py-9 text-center">
            <RiComputerLine size={40} aria-hidden className="mb-1 text-faint" />
            <div className="text-base font-semibold">
              Моделей этого вендора пока нет
            </div>
            <p className="my-0 max-w-md text-sm text-muted-foreground">
              Добавьте первую модель — она появится здесь и в общем списке
              моделей.
            </p>
            {canManage && (
              <Button asChild className="mt-2">
                <Link to={addModelTo} onClick={offcanvas.setShow}>
                  <RiAddFill /> Новая модель
                </Link>
              </Button>
            )}
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
            {grouped && !searching && (
              <button
                type="button"
                onClick={toggleAll}
                className="ml-auto inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent px-1 py-1.5 text-sm font-semibold text-muted-foreground outline-none hover:text-accent-text focus-visible:text-accent-text"
              >
                {allOpen ? "Свернуть все" : "Развернуть все"}
              </button>
            )}
          </div>

          {filteredEmpty ? (
            <Panel>
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Ничего не нашлось. Измените запрос.
              </div>
            </Panel>
          ) : grouped ? (
            <div className="flex flex-col gap-2">
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
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={open}
                      className="flex w-full cursor-pointer appearance-none items-center gap-3 border-0 bg-transparent px-3.5 py-3 text-left text-inherit transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
                    >
                      <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-sm font-semibold text-muted-foreground inset-ring inset-ring-border">
                        {monogramFor(group.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-medium">
                          {group.name}
                        </span>
                        {!open && examples && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {examples}
                            {group.models.length > 3 ? " …" : ""}
                          </span>
                        )}
                      </span>
                      <span className="flex-none text-muted-foreground tabular-nums">
                        <b className="text-base font-bold text-foreground">
                          {countN}
                        </b>{" "}
                        <span className="text-xs">
                          {searching
                            ? plural(countN, "найдена", "найдено", "найдено")
                            : plural(countN, "модель", "модели", "моделей")}
                        </span>
                      </span>
                      <RiArrowDownSLine
                        size={20}
                        aria-hidden
                        className={cn(
                          "flex-none text-faint transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </button>
                    {open && (
                      <div className="border-t border-border-soft p-2">
                        {renderTiles(group)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            // Один тип — группировка не нужна: плитки сеткой напрямую
            <div className="rounded-xl border border-border bg-card p-2">
              {renderTiles(viewGroups[0])}
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
