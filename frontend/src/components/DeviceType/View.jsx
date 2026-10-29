import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useActionData, useFetcher } from "react-router";

import {
  RiAddFill,
  RiApps2Line,
  RiArrowDownLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiComputerLine,
  RiCpuLine,
  RiDeleteBinLine,
  RiDraggable,
  RiEdit2Line,
  RiMoreLine,
  RiPriceTag3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import ChipSelect from "@/components/app/ChipSelect";
import SearchBar from "@/components/app/SearchBar";
import FormOutlet from "@/components/app/FormOutlet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { cn } from "@/lib/utils";

import { photoUrl } from "@/components/app/PhotoGallery";
import { groupLinks } from "@/components/app/spec-sheet";
import { deviceLinks, modelLinks } from "@/components/app/attribute-scope";
import { keySpecsLine, liveAssembly } from "@/components/app/assembly-specs";
import { valueTypeLabel } from "../DeviceAttribute/value-types";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useToastStore from "../../store/toast-store";
import { useCan } from "@/store/authed-user";
import {
  dropLineClass,
  moveItem,
  useDragReorder,
  useFlipRows,
} from "@/hooks/use-drag-reorder";

const dash = <span className="text-faint">—</span>;
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Микро-подпись + значение в панели «Основное».
const Detail = ({ label, children, className }) => (
  <div className={cn("min-w-0", className)}>
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div className="text-sm leading-relaxed break-words">
      {children || dash}
    </div>
  </div>
);

// «⋯» действия атрибута: Изменить (форма-шторка) · Выше/Ниже (порядок внутри
// группы: index/count — позиция в группе) · Удалить. Диалог удаления — ВНЕ radix-меню (меню размонтирует содержимое при
// закрытии), открывается состоянием. Ср. ConfigActions у карточки модели.
const AttrActions = ({ link, label, index, count, onMove }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Действия"
            title="Действия"
            className="flex-none text-faint"
          >
            <RiMoreLine />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to={`attributes/update/${link._id}`}>
              <RiEdit2Line /> Изменить
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => onMove(index, -1)}
          >
            <RiArrowUpLine /> Выше
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === count - 1}
            onSelect={() => onMove(index, 1)}
          >
            <RiArrowDownLine /> Ниже
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <RiDeleteBinLine /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteDialog
        item={{ _id: link._id, title: label }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Атрибут будет откреплён от типа. Значения в существующих конфигурациях не удаляются."
      />
    </>
  );
};

// Облегчённая строка модели типа (плитка · название · N конфигураций · переход)
const ModelRow = ({ model, from }) => {
  const fromState = useCrumbFrom(from);
  const title =
    [model.vendorId?.name, model.name].filter(Boolean).join(" ") ||
    "Без названия";
  const thumb = model.photos?.[0] ? photoUrl(model.photos[0]) : null;
  const count = model.configurationsCount || 0;
  const meta =
    count > 0
      ? `${count} ${plural(count, "конфигурация", "конфигурации", "конфигураций")}`
      : "без конфигураций";

  return (
    <Link
      to={`/inventory/device-models/${model._id}`}
      state={fromState}
      className="group relative flex items-center gap-3.5 px-4 py-2.5 text-inherit no-underline transition-colors hover:bg-accent before:absolute before:top-0 before:right-4 before:left-16 before:h-px before:bg-border-soft first:before:hidden"
    >
      <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <RiComputerLine size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">{title}</div>
        <div className="truncate text-sm text-muted-foreground tabular-nums">
          {meta}
        </div>
      </div>
      <RiArrowRightSLine aria-hidden className="flex-none text-faint" />
    </Link>
  );
};

// «Своя сборка»: чип ключевой характеристики — «Тип · что[, как]». Первое
// значение — способ по умолчанию, его не подписываем.
const AGGREGATE_LABELS = { sum: "сумма", list: "список" };
// Название атрибута со строчной — «объём модуля»; аббревиатуры (DDR, TDP) и
// названия вроде «M.2 …» (второй знак — не буква) не трогаем
const lowerFirst = (text) =>
  text.length > 1 &&
  /\p{L}/u.test(text[1]) &&
  text[1] === text[1].toLocaleLowerCase("ru")
    ? text[0].toLocaleLowerCase("ru") + text.slice(1)
    : text;
const keySpecWhat = (spec) => {
  const what =
    spec.source === "model"
      ? "модель"
      : spec.attributeId?.name
        ? lowerFirst(spec.attributeId.name)
        : "атрибут удалён";
  const how = AGGREGATE_LABELS[spec.aggregate];
  return how ? `${what}, ${how}` : what;
};

const Pill = ({ muted, children }) => (
  <span
    className={cn(
      "flex-none rounded-full px-2 py-0.5 text-xs font-semibold",
      muted
        ? "bg-accent text-muted-foreground"
        : "bg-primary/15 text-accent-text",
    )}
  >
    {children}
  </span>
);

// Строка сборки: название · ключевые характеристики · переход на карточку
const BuildRow = ({ build, keySpecs, slots, from }) => {
  const fromState = useCrumbFrom(from);
  const line = keySpecsLine(keySpecs, build.parts || [], slots);
  return (
    <Link
      to={`/inventory/device-builds/${build._id}`}
      state={fromState}
      className="group relative flex items-center gap-3 px-4 py-2.5 text-inherit no-underline transition-colors hover:bg-accent before:absolute before:top-0 before:right-4 before:left-4 before:h-px before:bg-border-soft first:before:hidden"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium">
          {build.name || "Без названия"}
        </div>
        {line && (
          <div className="truncate text-sm text-muted-foreground tabular-nums">
            {line}
          </div>
        )}
      </div>
      <RiArrowRightSLine aria-hidden className="flex-none text-faint" />
    </Link>
  );
};

const ViewDeviceType = ({ deviceType = {}, models = [], builds = [] }) => {
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const reorderFetcher = useFetcher();
  const can = useCan();
  const canManage = can({ inventoryCatalog: ["manage"] });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [vendorFilter, setVendorFilter] = useState(null);
  const [search, setSearch] = useState("");

  // Карточку открываем от начала (Root сбрасывает лишь мобильный контейнер)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Тосты: ошибка удаления типа «в использовании» / открепление атрибута
  useEffect(() => {
    if (actionData?.error) showToast("danger", actionData.message);
    if (actionData?.attributeDeleted)
      showToast("success", "Атрибут откреплён от типа");
  }, [actionData, showToast]);

  useEffect(() => {
    if (reorderFetcher.data?.error)
      showToast("danger", reorderFetcher.data.message);
  }, [reorderFetcher.data, showToast]);

  const {
    name,
    isActive,
    isComponent,
    isConsumable,
    isPeripheral,
    inventoryPrefix,
    attachableToTypeIds = [],
    attributes = [],
    assembly,
  } = deviceType;

  // «Своя сборка» — секции карточки только у включённой. Слоты/характеристики
  // с удалённым типом (populate → null) не показываем и в сводку не берём.
  const assemblyEnabled = !!assembly?.enabled;
  const { slots, keySpecs } = liveAssembly(assembly);
  // Без слотов сборку не из чего собрать — «Новая сборка» не показываем
  const canAddBuild = canManage && slots.length > 0;

  const kinds =
    [
      isComponent && "Комплектующие",
      isConsumable && "Расходники",
      isPeripheral && "Периферия",
    ]
      .filter(Boolean)
      .join(" · ") || "Основное устройство";
  const isSpecial = isComponent || isConsumable || isPeripheral;

  // Локальная (оптимистичная) последовательность атрибутов: порядок меняем сразу,
  // сервер догоняет ревалидацией лоадера — тогда пересобираем из свежих данных.
  const ordered = useMemo(
    () => [...attributes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [attributes],
  );
  const [items, setItems] = useState(ordered);
  useEffect(() => setItems(ordered), [ordered]);

  // Группы в порядке показа: по order группы, «Без группы» последней. Строки
  // внутри — по order связки, поэтому оптимистичный порядок ниже переписывает
  // order у локальных строк. Порядок групп общий для всех типов, здесь его не
  // меняют: перестановки — только внутри группы.
  // Две секции по уровню атрибута: «Атрибуты модели» и «Атрибуты устройства».
  // Ключ группы — с уровнем: «Без группы» есть в обеих, перестановки — внутри
  const sectionGroups = (links, scope) =>
    groupLinks(links, "Без группы").map((group) => ({
      ...group,
      key: `${scope}:${group.key}`,
    }));
  const modelGroups = useMemo(
    () => sectionGroups(modelLinks(items), "model"),
    [items],
  );
  const deviceGroups = useMemo(
    () => sectionGroups(deviceLinks(items), "device"),
    [items],
  );
  const groups = [...modelGroups, ...deviceGroups];
  // Подзаголовки — когда в секции есть хоть одна группа; без групп список как прежде
  const withHeads = (list) =>
    list.some((group) => !group.key.endsWith(":other"));

  // Только что добавленные (шторка «Добавить атрибуты») подсвечиваются
  // row-appear: новые id в свежих данных лоадера против прошлых. Анимация
  // однократная — класс можно не снимать.
  const knownIds = useRef(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  useEffect(() => {
    const ids = ordered.map((it) => String(it._id));
    if (knownIds.current) {
      const added = ids.filter((id) => !knownIds.current.has(id));
      if (added.length) setFreshIds(new Set(added));
    }
    knownIds.current = new Set(ids);
  }, [ordered]);

  // orderedIds — весь список в порядке показа (группа за группой); order =
  // позиция в нём, как и на сервере
  const submitOrder = (groupKey, groupLinksNext) => {
    const nextItems = groups
      .flatMap((group) =>
        group.key === groupKey ? groupLinksNext : group.links,
      )
      .map((it, order) => ({ ...it, order }));
    setItems(nextItems);
    reorderFetcher.submit(
      {
        intent: "reorder",
        orderedIds: JSON.stringify(nextItems.map((it) => it._id)),
      },
      { method: "post" },
    );
  };

  // «Выше/Ниже» из «⋯» — тач и клавиатура, где перетаскивания нет
  const onMove = (groupKey) => (index, dir) => {
    const links = groups.find((group) => group.key === groupKey)?.links;
    if (!links) return;
    const target = index + dir;
    if (target < 0 || target >= links.length) return;
    submitOrder(groupKey, moveItem(links, index, target));
  };

  // Перетаскивание (десктоп): порядок применяется на сбросе; корзина — группа,
  // бросок в чужую игнорируется: группу меняют в «⋯ → Изменить». Плавность
  // даёт FLIP (useFlipRows).
  const drag = useDragReorder({
    onMove: (groupKey, from, to) => {
      const links = groups.find((group) => group.key === groupKey)?.links;
      if (links) submitOrder(groupKey, moveItem(links, from, to));
    },
  });
  const rowRef = useFlipRows(items);

  // Опции чипа «Производитель» — уникальные вендоры среди моделей типа
  const vendorOptions = useMemo(() => {
    const byId = new Map();
    for (const model of models) {
      const vendor = model.vendorId;
      if (vendor?._id && !byId.has(String(vendor._id))) {
        byId.set(String(vendor._id), { value: vendor._id, label: vendor.name });
      }
    }
    return [...byId.values()].sort((a, b) =>
      (a.label || "").localeCompare(b.label || ""),
    );
  }, [models]);

  const filteredModels = models.filter((model) => {
    if (vendorFilter && String(model.vendorId?._id) !== String(vendorFilter)) {
      return false;
    }
    if (search.trim()) {
      const haystack = [model.vendorId?.name, model.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  const updaterName = userName(deviceType.updatedBy);
  const metaBits = [
    deviceType.updatedAt &&
      `Обновлено ${fmtDate(deviceType.updatedAt)}${updaterName ? `, ${updaterName}` : ""}`,
    deviceType.createdAt && `создано ${fmtDate(deviceType.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const bold = (n) => <b className="font-semibold text-foreground">{n}</b>;
  const sep = <span className="text-faint">·</span>;

  // Формы — вложенные маршруты карточки (шторка на месте): правка типа и
  // новая модель не уводят со страницы; после создания модели форма сама
  // переходит на карточку созданной модели (см. AddDeviceModelPage)
  const addModelTo = "models/add";
  const editTypeTo = "update";
  const attrCount = items.length;
  const modelCount = modelGroups.reduce((n, g) => n + g.links.length, 0);
  const deviceCount = deviceGroups.reduce((n, g) => n + g.links.length, 0);
  const modelsEmpty = models.length === 0;
  const filteredEmpty = !modelsEmpty && filteredModels.length === 0;

  // Строки секции: одна панель, группы — подзаголовками внутри (имя · счётчик)
  const renderRows = (sectionList) => {
    const showHeads = withHeads(sectionList);
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {sectionList.map((group) => (
          <div
            key={group.key}
            className="border-t border-border first:border-t-0"
          >
            {showHeads && (
              <div className="flex items-center gap-2 px-4 pt-2.5 pb-1 text-sm font-semibold text-muted-foreground">
                {group.name}
                <span className="font-medium text-faint tabular-nums">
                  · {group.links.length}
                </span>
              </div>
            )}
            {group.links.map((link, index) => {
              const meta =
                typeof link.attributeId === "object" ? link.attributeId : null;
              const selectType =
                meta?.valueType === "select" ||
                meta?.valueType === "multiselect";
              const options = selectType ? meta?.options || [] : [];
              return (
                <div
                  key={link._id}
                  ref={rowRef(link._id)}
                  {...(canManage
                    ? drag.rowProps(group.key, index, link._id)
                    : {})}
                  className={cn(
                    "relative flex items-center gap-3 px-4 py-2.5",
                    // разделитель — между строками группы, не под заголовком
                    index > 0 && "border-t border-border-soft",
                    freshIds.has(String(link._id)) && "row-appear",
                    drag.draggingId === link._id && "opacity-50",
                    // индикатор места вставки — акцентная линия там, куда
                    // строка ляжет
                    dropLineClass(drag.indicator(link._id)),
                  )}
                >
                  {canManage && (
                    <RiDraggable
                      aria-hidden
                      className="flex-none cursor-grab text-faint"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {meta?.name || "Атрибут"}
                      {meta?.unit && (
                        <span className="font-normal text-faint">
                          {" "}
                          ({meta.unit})
                        </span>
                      )}
                    </div>
                    {options.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {options.map((option) => (
                          <span
                            key={option.value}
                            className="rounded-md bg-accent px-1.5 py-px text-xs text-muted-foreground"
                          >
                            {option.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* На телефоне тип значения прячем — как в макете */}
                  <span className="hidden flex-none text-sm text-muted-foreground sm:inline">
                    {valueTypeLabel(meta?.valueType)}
                  </span>
                  {link.required && (
                    <span className="flex-none rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-accent-text">
                      обязательный
                    </span>
                  )}
                  {canManage && (
                    <AttrActions
                      link={link}
                      label={meta?.name || "Атрибут"}
                      index={index}
                      count={group.links.length}
                      onMove={onMove(group.key)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs />

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        {/* Плитка hero — глиф раздела, не монограмма: та же плитка, что в
            строке списка, одна на страницу */}
        <span
          aria-hidden
          className={cn(
            "grid size-14 flex-none place-items-center rounded-2xl",
            isActive
              ? "bg-accent text-muted-foreground"
              : "bg-accent/50 text-faint",
          )}
        >
          <RiApps2Line size={26} />
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
              {sep} {kinds} {sep} {bold(attrCount)}{" "}
              {plural(attrCount, "атрибут", "атрибута", "атрибутов")} {sep}{" "}
              {bold(models.length)}{" "}
              {plural(models.length, "модель", "модели", "моделей")}
              {assemblyEnabled && (
                <>
                  {" "}
                  {sep} {bold(builds.length)}{" "}
                  {plural(builds.length, "сборка", "сборки", "сборок")}
                </>
              )}
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
              <Link to={editTypeTo}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Основное */}
      <Eyebrow>Основное</Eyebrow>
      <Panel>
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Назначение">{kinds}</Detail>
          <Detail label="Префикс инв. номера">
            {inventoryPrefix ? (
              <span className="font-mono">{inventoryPrefix}</span>
            ) : null}
          </Detail>
        </div>
        {isSpecial && attachableToTypeIds.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
              Прикрепляется к типам
            </div>
            <div className="flex flex-wrap gap-1.5">
              {attachableToTypeIds.map((type) => (
                <span
                  key={type._id}
                  className="inline-flex items-center rounded-full border border-border-soft bg-accent px-2.5 py-1 text-sm font-medium"
                >
                  {type.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Атрибуты — две управляемые секции по уровню (добавить · изменить ·
          порядок · удалить): модели — характеристики конфигураций, устройства —
          параметры экземпляра */}
      <SectionHead
        title="Атрибуты модели"
        count={modelCount}
        hint="Одно значение на конфигурацию модели — заполняется в карточке модели."
        action={
          canManage && (
            <Button asChild size="sm">
              <Link to="attributes/add">
                <RiAddFill /> Добавить атрибуты
              </Link>
            </Button>
          )
        }
        className="mt-6"
      />
      {modelCount === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <RiPriceTag3Line
              size={40}
              aria-hidden
              className="mb-1 text-faint"
            />
            <div className="text-base font-semibold">
              У типа нет атрибутов модели
            </div>
            <p className="my-0 max-w-md text-sm text-muted-foreground">
              Добавьте атрибуты — они станут характеристиками конфигураций
              моделей этого типа.
            </p>
            {canManage && (
              <Button asChild className="mt-2">
                <Link to="attributes/add">
                  <RiAddFill /> Добавить атрибуты
                </Link>
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        renderRows(modelGroups)
      )}

      <SectionHead
        title="Атрибуты устройства"
        count={deviceCount}
        hint="Своё значение у каждого экземпляра — заполняется в карточке устройства."
        action={
          canManage && (
            <Button asChild size="sm" variant="outline">
              <Link to="attributes/add?scope=device">
                <RiAddFill /> Добавить атрибуты
              </Link>
            </Button>
          )
        }
        className="mt-8"
      />
      {deviceCount > 0 && renderRows(deviceGroups)}

      {/* «Своя сборка» — из каких комплектующих собирается ПК и чем он
          описывается в списках (макет «Своя сборка ПК», разд. 1) */}
      {assemblyEnabled && (
        <>
          <Eyebrow
            action={
              canManage ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="assembly">
                    <RiEdit2Line /> Изменить
                  </Link>
                </Button>
              ) : null
            }
          >
            Своя сборка
            {slots.length > 0 && (
              <span className="font-semibold tracking-normal tabular-nums">
                · {slots.length}{" "}
                {plural(
                  slots.length,
                  "комплектующая",
                  "комплектующие",
                  "комплектующих",
                )}
              </span>
            )}
          </Eyebrow>

          {slots.length === 0 ? (
            <Panel>
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <RiCpuLine size={40} aria-hidden className="mb-1 text-faint" />
                <div className="text-base font-semibold">
                  Комплектующие не заданы
                </div>
                <p className="my-0 max-w-md text-sm text-muted-foreground">
                  Задайте слоты — типы комплектующих, из которых собирается
                  устройство, и его ключевые характеристики.
                </p>
                {canManage && (
                  <Button asChild className="mt-2">
                    <Link to="assembly">
                      <RiEdit2Line /> Изменить
                    </Link>
                  </Button>
                )}
              </div>
            </Panel>
          ) : (
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="px-4 pt-2.5 pb-1 text-sm font-semibold text-muted-foreground">
                Комплектующие
              </div>
              {slots.map((slot) => (
                <div
                  key={slot.typeId._id}
                  className="flex items-center gap-3 border-t border-border-soft px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {slot.typeId.name}
                  </span>
                  {slot.multiple && <Pill muted>несколько</Pill>}
                  {slot.required && <Pill>обязательная</Pill>}
                </div>
              ))}
              <div className="border-t border-border px-4 pt-2.5 pb-1 text-sm font-semibold text-muted-foreground">
                Ключевые характеристики
              </div>
              {keySpecs.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 px-4 pt-1.5 pb-3.5">
                  {keySpecs.map((spec, index) => (
                    <span
                      key={`${spec.typeId._id}:${spec.source}:${spec.attributeId?._id ?? ""}:${index}`}
                      className="rounded-full bg-accent px-2.5 py-0.5 text-sm"
                    >
                      {spec.typeId.name}{" "}
                      <span className="text-muted-foreground">
                        · {keySpecWhat(spec)}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="px-4 pt-1.5 pb-3.5 text-sm text-muted-foreground">
                  Не заданы.
                </div>
              )}
              <div className="px-4 pb-3 text-sm text-muted-foreground">
                Так ПК своей сборки описывается в строке списка и в шапке
                карточки.
              </div>
            </section>
          )}

          {/* Сборки — шаблоны своей сборки; в строке ключевые характеристики */}
          <Eyebrow
            count={builds.length > 0 ? builds.length : undefined}
            action={
              canAddBuild ? (
                <Button asChild size="sm">
                  <Link to="builds/add">
                    <RiAddFill /> Новая сборка
                  </Link>
                </Button>
              ) : null
            }
          >
            Сборки
          </Eyebrow>

          {builds.length === 0 ? (
            <Panel>
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <RiComputerLine
                  size={40}
                  aria-hidden
                  className="mb-1 text-faint"
                />
                <div className="text-base font-semibold">Сборок пока нет</div>
                <p className="my-0 max-w-md text-sm text-muted-foreground">
                  Сборка — набор комплектующих по слотам, из которого потом
                  создаются устройства.
                </p>
                {canAddBuild && (
                  <Button asChild className="mt-2">
                    <Link to="builds/add">
                      <RiAddFill /> Новая сборка
                    </Link>
                  </Button>
                )}
              </div>
            </Panel>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card py-1.5">
              {builds.map((build) => (
                <BuildRow
                  key={build._id}
                  build={build}
                  keySpecs={keySpecs}
                  slots={slots}
                  from={name}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Модели устройств этого типа */}
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
            <Link to={addModelTo}>
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
              Моделей этого типа пока нет
            </div>
            <p className="my-0 max-w-md text-sm text-muted-foreground">
              Добавьте первую модель — она появится здесь и в общем списке
              моделей.
            </p>
            {canManage && (
              <Button asChild className="mt-2">
                <Link to={addModelTo}>
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
            {/* Чип показываем, как только есть хотя бы один вендор (у большинства
                типов модели одного производителя — но фильтр должен быть виден,
                как в макете). Прячем лишь когда вендоров нет вовсе. */}
            {vendorOptions.length > 0 && (
              <ChipSelect
                placeholder="Производитель"
                allLabel="Все"
                value={vendorFilter}
                options={vendorOptions}
                onChange={setVendorFilter}
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
              {filteredModels.map((model) => (
                <ModelRow from={name} key={model._id} model={model} />
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
        item={{ _id: deviceType._id, title: name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Тип и его атрибуты будут удалены. Тип с привязанными моделями удалить нельзя."
      />

      {/* Формы атрибутов (add / update) — нижняя шторка прямо на карточке */}
      <FormOutlet />
    </div>
  );
};

export default ViewDeviceType;

// Заголовок секции атрибутов: метка · счётчик, действие справа, подпись ниже
function SectionHead({ title, count, hint, action, className }) {
  return (
    <div className={cn("mb-2.5", className)}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
          {title}
          {count > 0 && (
            <span className="font-semibold tracking-normal tabular-nums">
              · {count}
            </span>
          )}
        </div>
        {action}
      </div>
      <p className="my-0 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
