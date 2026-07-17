import {
  useContext,
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
  RiArrowLeftSLine,
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
import { Eyebrow, Panel } from "@/components/app/Panel";
import ChipSelect from "@/components/app/ChipSelect";
import SearchBar from "@/components/app/SearchBar";
import FormSheet from "@/components/app/FormSheet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";

import { photoUrl } from "../Devices/Photos";
import { valueTypeLabel } from "../DeviceAttribute/value-types";
import { formatShortDate } from "../../util/format-date";
import { plural } from "../../util/plural";
import useOffcanvasStore from "../../store/offcanvas";
import useToastStore from "../../store/toast-store";
import { AuthedUserContext } from "../../store/authed-user-context";

const dash = <span className="tw:text-faint">—</span>;
const fmtDate = (value) => (value ? formatShortDate(value) : null);
const userName = (u) =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null;

// Микро-подпись + значение в панели «Основное».
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
            className="tw:flex-none tw:text-faint"
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
const ModelRow = ({ model }) => {
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

const ViewDeviceType = ({ deviceType = {}, models = [] }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { showToast } = useToastStore();
  const actionData = useActionData();
  const reorderFetcher = useFetcher();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageClientDevices;
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

  const bold = (n) => (
    <b className="tw:font-semibold tw:text-foreground">{n}</b>
  );
  const sep = <span className="tw:text-faint">·</span>;

  // Формы — вложенные маршруты карточки (шторка на месте): правка типа и
  // новая модель не уводят со страницы; после создания модели форма сама
  // переходит на карточку созданной модели (см. AddDeviceModelPage)
  const addModelTo = "models/add";
  const editTypeTo = "update";
  const attrCount = items.length;
  const modelsEmpty = models.length === 0;
  const filteredEmpty = !modelsEmpty && filteredModels.length === 0;

  return (
    <div className="tw:mx-auto tw:w-full tw:max-w-4xl">
      <Link
        to="/inventory/device-types"
        className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        <RiArrowLeftSLine /> Типы устройств
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
              {sep} {kinds} {sep} {bold(attrCount)}{" "}
              {plural(attrCount, "атрибут", "атрибута", "атрибутов")} {sep}{" "}
              {bold(models.length)}{" "}
              {plural(models.length, "модель", "модели", "моделей")}
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
        <div className="tw:grid tw:gap-x-6 tw:gap-y-4 tw:sm:grid-cols-2">
          <Detail label="Назначение">{kinds}</Detail>
          <Detail label="Префикс инв. номера">
            {inventoryPrefix ? (
              <span className="tw:font-mono">{inventoryPrefix}</span>
            ) : null}
          </Detail>
        </div>
        {isSpecial && attachableToTypeIds.length > 0 && (
          <div className="tw:mt-4">
            <div className="tw:mb-1.5 tw:text-xs tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
              Прикрепляется к типам
            </div>
            <div className="tw:flex tw:flex-wrap tw:gap-1.5">
              {attachableToTypeIds.map((type) => (
                <span
                  key={type._id}
                  className="tw:inline-flex tw:items-center tw:rounded-full tw:border tw:border-border-soft tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium"
                >
                  {type.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Атрибуты — управляемая секция (добавить · изменить · порядок · удалить) */}
      <div className="tw:mt-6 tw:mb-2.5 tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
          Атрибуты
          {attrCount > 0 && (
            <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
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
          <div className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:px-6 tw:py-8 tw:text-center">
            <RiPriceTag3Line
              size={40}
              aria-hidden
              className="tw:mb-1 tw:text-faint"
            />
            <div className="tw:text-base tw:font-semibold">
              У типа нет атрибутов
            </div>
            <p className="tw:my-0 tw:max-w-md tw:text-sm tw:text-muted-foreground">
              Добавьте атрибуты — они станут характеристиками конфигураций
              моделей этого типа.
            </p>
            {canManage && (
              <Button asChild className="tw:mt-2">
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
                  "tw:relative tw:flex tw:items-center tw:gap-3 tw:border-b tw:border-border-soft tw:py-3 tw:last:border-b-0",
                  draggingId === link._id && "tw:opacity-50",
                  // индикатор места вставки — акцентная линия по верху строки
                  overId === link._id &&
                    "tw:before:absolute tw:before:inset-x-0 tw:before:-top-px tw:before:z-10 tw:before:h-0.5 tw:before:rounded-full tw:before:bg-primary",
                )}
              >
                {canManage && (
                  <RiDraggable
                    aria-hidden
                    className="tw:flex-none tw:cursor-grab tw:text-faint"
                  />
                )}
                <div className="tw:min-w-0 tw:flex-1">
                  <div className="tw:text-[15px] tw:font-medium">
                    {meta?.name || "Атрибут"}
                    {meta?.unit && (
                      <span className="tw:font-normal tw:text-faint">
                        {" "}
                        ({meta.unit})
                      </span>
                    )}
                  </div>
                  {options.length > 0 && (
                    <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1">
                      {options.map((option) => (
                        <span
                          key={option.value}
                          className="tw:rounded-md tw:bg-accent tw:px-1.5 tw:py-0.5 tw:text-xs tw:text-muted-foreground"
                        >
                          {option.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="tw:flex-none tw:text-sm tw:text-muted-foreground">
                  {valueTypeLabel(meta?.valueType)}
                </span>
                {link.required && (
                  <span className="tw:flex-none tw:rounded-full tw:bg-primary/15 tw:px-2 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-accent-text">
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
              Моделей этого типа пока нет
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
