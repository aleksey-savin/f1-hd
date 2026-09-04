import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  Outlet,
  useActionData,
  useFetcher,
  useNavigate,
} from "react-router";

import {
  RiAddFill,
  RiArrowDownLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiComputerLine,
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
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

import { photoUrl } from "@/components/app/PhotoGallery";
import { valueTypeLabel } from "../DeviceAttribute/value-types";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { useCan } from "@/store/authed-user";

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

// «⋯» действия атрибута: Изменить (форма-шторка) · Выше/Ниже (порядок) ·
// Удалить. Диалог удаления — ВНЕ radix-меню (меню размонтирует содержимое при
// закрытии), открывается состоянием. Ср. ConfigActions у карточки модели.
const AttrActions = ({ link, label, index, count, onMove }) => {
  const offcanvas = useOffcanvasStore();
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
            <Link
              to={`attributes/update/${link._id}`}
              onClick={offcanvas.setShow}
            >
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

const ViewDeviceType = ({ deviceType = {}, models = [] }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
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
  } = deviceType;

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

  const submitOrder = (nextItems) => {
    setItems(nextItems);
    reorderFetcher.submit(
      {
        intent: "reorder",
        orderedIds: JSON.stringify(nextItems.map((it) => it._id)),
      },
      { method: "post" },
    );
  };

  const onMove = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    submitOrder(next);
  };

  // Перетаскивание (десктоп): порядок применяется на сбросе; на тач-устройствах
  // порядок меняют «Выше/Ниже». Плавность даёт FLIP-анимация ниже.
  const dragIndex = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);

  const onDragStart = (index, id) => (event) => {
    dragIndex.current = index;
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    // Firefox не инициирует drag без данных в dataTransfer
    try {
      event.dataTransfer.setData("text/plain", id);
    } catch {
      /* некоторые окружения запрещают setData — не критично */
    }
  };
  const clearDrag = () => {
    dragIndex.current = null;
    setDraggingId(null);
    setOverId(null);
  };
  // Гард на dragIndex.current (ref обновляется синхронно) — не зависит от того,
  // успел ли React перерисоваться после dragstart, и исключает саму строку.
  const onDragEnter = (index, id) => () => {
    if (dragIndex.current !== null && index !== dragIndex.current)
      setOverId(id);
  };
  const onDrop = (index) => (event) => {
    event.preventDefault();
    const from = dragIndex.current;
    clearDrag();
    if (from === null || from === index) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    submitOrder(next);
  };

  // FLIP: строки плавно «доезжают» до новых позиций при любой смене порядка
  // (drag-drop и «Выше/Ниже») и при удалении соседних. offsetTop берём как
  // раскладочную позицию — она не зависит от самого transform, поэтому частые
  // пересортировки не сбивают замер. Уважаем prefers-reduced-motion.
  const rowRefs = useRef(new Map());
  const prevTops = useRef(new Map());
  const reduceMotion = useRef(false);
  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useLayoutEffect(() => {
    for (const [id, node] of rowRefs.current) {
      const top = node.offsetTop;
      const prev = prevTops.current.get(id);
      if (prev != null && !reduceMotion.current) {
        const dy = prev - top;
        if (dy) {
          node.style.transition = "none";
          node.style.transform = `translateY(${dy}px)`;
          node.getBoundingClientRect(); // reflow с инвертированным сдвигом
          node.style.transition = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";
          node.style.transform = "";
        }
      }
      prevTops.current.set(id, top);
    }
    // подчищаем исчезнувшие строки, чтобы карта не росла
    for (const id of prevTops.current.keys()) {
      if (!rowRefs.current.has(id)) prevTops.current.delete(id);
    }
  }, [items]);

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
  const modelsEmpty = models.length === 0;
  const filteredEmpty = !modelsEmpty && filteredModels.length === 0;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs />

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
              {sep} {kinds} {sep} {bold(attrCount)}{" "}
              {plural(attrCount, "атрибут", "атрибута", "атрибутов")} {sep}{" "}
              {bold(models.length)}{" "}
              {plural(models.length, "модель", "модели", "моделей")}
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
              <Link to={editTypeTo} onClick={offcanvas.setShow}>
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

      {/* Атрибуты — управляемая секция (добавить · изменить · порядок · удалить) */}
      <div className="mt-6 mb-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-faint uppercase">
          Атрибуты
          {attrCount > 0 && (
            <span className="font-semibold tracking-normal tabular-nums">
              · {attrCount}
            </span>
          )}
        </div>
        {canManage && (
          <Button asChild size="sm">
            <Link to="attributes/add" onClick={offcanvas.setShow}>
              <RiAddFill /> Добавить атрибут
            </Link>
          </Button>
        )}
      </div>

      {attrCount === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <RiPriceTag3Line
              size={40}
              aria-hidden
              className="mb-1 text-faint"
            />
            <div className="text-base font-semibold">У типа нет атрибутов</div>
            <p className="my-0 max-w-md text-sm text-muted-foreground">
              Добавьте атрибуты — они станут характеристиками конфигураций
              моделей этого типа.
            </p>
            {canManage && (
              <Button asChild className="mt-2">
                <Link to="attributes/add" onClick={offcanvas.setShow}>
                  <RiAddFill /> Добавить атрибут
                </Link>
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <Panel>
          {items.map((link, index) => {
            const meta =
              typeof link.attributeId === "object" ? link.attributeId : null;
            const selectType =
              meta?.valueType === "select" || meta?.valueType === "multiselect";
            const options = selectType ? meta?.options || [] : [];
            return (
              <div
                key={link._id}
                ref={(el) => {
                  if (el) rowRefs.current.set(link._id, el);
                  else rowRefs.current.delete(link._id);
                }}
                draggable={canManage}
                onDragStart={onDragStart(index, link._id)}
                onDragEnter={onDragEnter(index, link._id)}
                onDragEnd={clearDrag}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop(index)}
                className={cn(
                  "relative flex items-center gap-3 border-b border-border-soft py-3 last:border-b-0",
                  draggingId === link._id && "opacity-50",
                  // индикатор места вставки — акцентная линия по верху строки
                  overId === link._id &&
                    "before:absolute before:inset-x-0 before:-top-px before:z-10 before:h-0.5 before:rounded-full before:bg-primary",
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
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {options.map((option) => (
                        <span
                          key={option.value}
                          className="rounded-md bg-accent px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {option.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="flex-none text-sm text-muted-foreground">
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
                    count={items.length}
                    onMove={onMove}
                  />
                )}
              </div>
            );
          })}
        </Panel>
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
              Моделей этого типа пока нет
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

export default ViewDeviceType;
