import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData } from "react-router";

import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiDraggable,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import FormWrapper from "@/components/app/FormWrapper";
import Combobox from "@/components/app/Combobox";
import Segmented from "@/components/app/Segmented";
import { FormHeader } from "@/components/app/FormLayout";
import { SubLabel } from "@/components/app/Panel";
import { load } from "@/store/form-data";
import { cn } from "@/lib/utils";
import {
  dropLineClass,
  moveItem,
  useDragReorder,
  useFlipRows,
} from "@/hooks/use-drag-reorder";

// Шторка «Своя сборка» (макет «Своя сборка ПК», разд. 2). Слоты — типы
// комплектующих с флагами «обязательная»/«несколько»; ключевые
// характеристики — из какого слота, что брать (название модели или атрибут
// типа слота) и как сводить несколько деталей. Порядок строк —
// перетаскиванием. Состав уходит целиком одним JSON (PUT …/assembly).

const MODEL = "model";
const AGGREGATES = [
  { value: "first", label: "первое" },
  { value: "sum", label: "сумма" },
  { value: "list", label: "список" },
];

// Ключ строки: id слота повторяться не может, но строка без типа его ещё не
// имеет — у строк свой локальный ключ (для React, перетаскивания и FLIP)
let rowSeq = 0;
const rowKey = () => `row-${++rowSeq}`;

const idOf = (ref) => (ref && typeof ref === "object" ? ref._id : ref) || null;

// Связки типа → атрибуты (populate attributeId), без осиротевших
const linksPath = (typeId) =>
  `/api/inventory/device-type-attributes/type/${typeId}`;

// Переключатель в строке слота — компактный, подпись справа (не SwitchField:
// тот — целая строка формы с подсказкой)
const InlineSwitch = ({ id, checked, onChange, label }) => (
  <span className="inline-flex items-center gap-2 whitespace-nowrap">
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
    <Label htmlFor={id} className="text-sm font-normal">
      {label}
    </Label>
  </span>
);

const RemoveButton = ({ onClick }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    aria-label="Убрать"
    title="Убрать"
    onClick={onClick}
    className="text-faint hover:text-destructive"
  >
    <RiCloseLine />
  </Button>
);

// Ручка порядка. Мышь — перетаскивание за строку (ручка как в макете); тач и
// клавиатура — «Выше»/«Ниже»: на грубом указателе кнопки вместо ручки, на
// десктопе они скрыты (sr-only) и проявляются, только получив фокус с
// клавиатуры, — вид строки мышью не меняется
const MoveHandle = ({ index, count, onMove, className }) => (
  <div className={cn("group/move flex flex-col items-center", className)}>
    <RiDraggable
      aria-hidden
      size={16}
      className="cursor-grab text-faint group-focus-within/move:hidden pointer-coarse:hidden"
    />
    <div className="sr-only flex-col focus-within:not-sr-only focus-within:flex pointer-coarse:not-sr-only pointer-coarse:flex">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Выше"
        title="Выше"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
        className="text-faint"
      >
        <RiArrowUpSLine />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Ниже"
        title="Ниже"
        disabled={index === count - 1}
        onClick={() => onMove(index, 1)}
        className="text-faint"
      >
        <RiArrowDownSLine />
      </Button>
    </div>
  </div>
);

const AddLink = ({ onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="mt-2 inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
  >
    <RiAddLine size={15} /> {children}
  </button>
);

const Hint = ({ children }) => (
  <p className="mt-2 mb-0 text-sm text-muted-foreground">{children}</p>
);

const AssemblyForm = () => {
  const loaderData = useLoaderData();
  const deviceType = loaderData?.deviceType;
  const componentTypes = loaderData?.componentTypes;
  const assembly = deviceType?.assembly;

  const [slots, setSlots] = useState(() =>
    (assembly?.slots || []).map((slot) => ({
      key: rowKey(),
      typeId: idOf(slot.typeId),
      required: !!slot.required,
      multiple: !!slot.multiple,
    })),
  );
  const [specs, setSpecs] = useState(() =>
    (assembly?.keySpecs || []).map((spec) => ({
      key: rowKey(),
      typeId: idOf(spec.typeId),
      what: spec.source === MODEL ? MODEL : idOf(spec.attributeId),
      // Название модели не складывается: «сумма» у него — «первое»
      aggregate:
        spec.source === MODEL && spec.aggregate === "sum"
          ? "first"
          : spec.aggregate || "first",
    })),
  );

  // Имена типов: справочник комплектующих + то, что пришло populate'ом (тип
  // мог перестать быть комплектующей — подпись всё равно нужна)
  const typeNames = useMemo(() => {
    const names = new Map();
    for (const item of [...(assembly?.slots || []), ...(assembly?.keySpecs || [])]) {
      if (item.typeId?._id) names.set(item.typeId._id, item.typeId.name);
    }
    for (const type of componentTypes || []) names.set(type._id, type.name);
    return names;
  }, [assembly, componentTypes]);

  // Атрибуты из сохранённых характеристик — подпись и тип значения, пока
  // список атрибутов типа слота ещё едет
  const seedAttrs = useMemo(() => {
    const byId = new Map();
    for (const spec of assembly?.keySpecs || []) {
      if (spec.attributeId?._id) byId.set(spec.attributeId._id, spec.attributeId);
    }
    return byId;
  }, [assembly]);

  // Атрибуты типов слотов — лениво, по мере выбора слота в характеристике;
  // кэш по id типа (повторный выбор того же слота запроса не делает). Сбой
  // не запоминается: следующий выбор слота спросит снова, а пока поле не
  // висит в «Загружаем…» (failedTypes)
  const [attrsByType, setAttrsByType] = useState({});
  const [failedTypes, setFailedTypes] = useState(() => new Set());
  const requested = useRef(new Set());
  const specTypeIds = specs
    .map((spec) => spec.typeId)
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    for (const typeId of specTypeIds ? specTypeIds.split("|") : []) {
      if (requested.current.has(typeId)) continue;
      requested.current.add(typeId);
      setFailedTypes((prev) => {
        if (!prev.has(typeId)) return prev;
        const next = new Set(prev);
        next.delete(typeId);
        return next;
      });
      load(linksPath(typeId))
        .then((links) => {
          const attrs = (Array.isArray(links) ? links : [])
            .map((link) => link.attributeId)
            .filter((attr) => attr && typeof attr === "object");
          setAttrsByType((prev) => ({ ...prev, [typeId]: attrs }));
        })
        .catch(() => {
          requested.current.delete(typeId);
          setFailedTypes((prev) => new Set(prev).add(typeId));
        });
    }
  }, [specTypeIds]);

  const attrOf = (typeId, attrId) =>
    attrsByType[typeId]?.find((attr) => attr._id === attrId) ||
    seedAttrs.get(attrId) ||
    null;
  // «Сумма» — только по числовому атрибуту (название модели не складывается)
  const canSum = (spec) =>
    !!spec.what &&
    spec.what !== MODEL &&
    attrOf(spec.typeId, spec.what)?.valueType === "number";

  // ── Слоты ──
  const updateSlot = (key, patch) =>
    setSlots((prev) =>
      prev.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    );

  // Смена типа слота переносит его характеристики на новый тип; атрибут
  // старого типа к новому не подходит — сбрасываем (модель остаётся моделью)
  const changeSlotType = (key, typeId) => {
    const prevTypeId = slots.find((slot) => slot.key === key)?.typeId;
    updateSlot(key, { typeId });
    if (prevTypeId && prevTypeId !== typeId) {
      setSpecs((prev) =>
        prev.map((spec) =>
          spec.typeId === prevTypeId
            ? {
                ...spec,
                typeId,
                what: spec.what === MODEL ? MODEL : null,
                aggregate: spec.aggregate === "sum" ? "first" : spec.aggregate,
              }
            : spec,
        ),
      );
    }
  };

  // Убрать слот — вместе с характеристиками, которые на него ссылаются
  const removeSlot = (key) => {
    const typeId = slots.find((slot) => slot.key === key)?.typeId;
    setSlots((prev) => prev.filter((slot) => slot.key !== key));
    if (typeId) setSpecs((prev) => prev.filter((spec) => spec.typeId !== typeId));
  };

  const addSlot = () =>
    setSlots((prev) => [
      ...prev,
      { key: rowKey(), typeId: null, required: false, multiple: false },
    ]);

  // ── Ключевые характеристики ──
  const updateSpec = (key, patch) =>
    setSpecs((prev) =>
      prev.map((spec) => (spec.key === key ? { ...spec, ...patch } : spec)),
    );

  // Другой слот — атрибут сбрасывается (он принадлежал прежнему типу)
  const changeSpecSlot = (spec, typeId) => {
    if (typeId === spec.typeId) return;
    updateSpec(spec.key, {
      typeId,
      what: spec.what === MODEL ? MODEL : null,
      aggregate: spec.aggregate === "sum" ? "first" : spec.aggregate,
    });
  };

  const changeSpecWhat = (spec, what) => {
    const next = { ...spec, what };
    updateSpec(spec.key, {
      what,
      aggregate:
        spec.aggregate === "sum" && !canSum(next) ? "first" : spec.aggregate,
    });
  };

  const removeSpec = (key) =>
    setSpecs((prev) => prev.filter((spec) => spec.key !== key));

  const chosenSlots = slots.filter((slot) => slot.typeId);
  const addSpec = () => {
    // Новая строка сразу на первом слоте — чаще всего его и описывают
    const typeId = chosenSlots[0]?.typeId ?? null;
    setSpecs((prev) => [
      ...prev,
      { key: rowKey(), typeId, what: null, aggregate: "first" },
    ]);
  };

  // ── Перетаскивание (корзины: слоты / характеристики) ──
  const drag = useDragReorder({
    onMove: (bucket, from, to) => {
      if (bucket === "slots") setSlots((prev) => moveItem(prev, from, to));
      else setSpecs((prev) => moveItem(prev, from, to));
    },
  });
  // «Выше/Ниже» — тач и клавиатура, где перетаскивания нет
  const moveSlot = (index, dir) =>
    setSlots((prev) => {
      const to = index + dir;
      return to < 0 || to >= prev.length ? prev : moveItem(prev, index, to);
    });
  const moveSpec = (index, dir) =>
    setSpecs((prev) => {
      const to = index + dir;
      return to < 0 || to >= prev.length ? prev : moveItem(prev, index, to);
    });
  const flipOrder = useMemo(
    () => [...slots, ...specs].map((row) => row.key).join("|"),
    [slots, specs],
  );
  const rowRef = useFlipRows(flipOrder);

  const rowClass = (key, index) =>
    cn(
      "relative grid items-center py-2",
      index > 0 && "border-t border-border-soft",
      drag.draggingId === key && "opacity-50",
      dropLineClass(drag.indicator(key)),
    );

  // ── Опции ──
  const slotTypeOptions = (slot) => {
    const taken = new Set(
      slots
        .filter((other) => other.key !== slot.key && other.typeId)
        .map((other) => other.typeId),
    );
    const options = (componentTypes || [])
      .filter((type) => !taken.has(type._id))
      .map((type) => ({ value: type._id, label: type.name }));
    // Сохранённый тип, который больше не комплектующая: подпись видна,
    // сервер такой слот не примет — его надо сменить или убрать
    if (slot.typeId && !options.some((option) => option.value === slot.typeId)) {
      options.unshift({
        value: slot.typeId,
        label: typeNames.get(slot.typeId) || "Тип удалён",
        hint: "не комплектующая",
      });
    }
    return options;
  };

  const specSlotOptions = chosenSlots.map((slot) => ({
    value: slot.typeId,
    label: typeNames.get(slot.typeId) || "Тип удалён",
  }));

  const whatOptions = (spec) => {
    const attrs = spec.typeId ? attrsByType[spec.typeId] : null;
    const options = [{ value: MODEL, label: "Название модели" }];
    for (const attr of attrs || []) {
      options.push({
        value: attr._id,
        label: attr.unit ? `${attr.name} (${attr.unit})` : attr.name,
      });
    }
    // Пока список едет — хотя бы сохранённый атрибут, чтобы поле не пустело
    if (
      spec.what &&
      spec.what !== MODEL &&
      !options.some((option) => option.value === spec.what)
    ) {
      const seed = seedAttrs.get(spec.what);
      if (seed) options.push({ value: seed._id, label: seed.name });
    }
    return options;
  };

  // ── Готовность к сохранению ──
  const missing = [];
  if (slots.some((slot) => !slot.typeId)) missing.push("тип комплектующей");
  // Характеристика без слота (или со слотом, которого больше нет) и без
  // «что брать» — у второй называем слот
  const slotTypeSet = new Set(chosenSlots.map((slot) => slot.typeId));
  if (specs.some((spec) => !slotTypeSet.has(spec.typeId))) {
    missing.push("слот характеристики");
  }
  const whatGaps = specs
    .filter((spec) => slotTypeSet.has(spec.typeId) && !spec.what)
    .map((spec) => typeNames.get(spec.typeId) || "Тип удалён");
  if (whatGaps.length) {
    missing.push(`что брать — ${[...new Set(whatGaps)].join(", ")}`);
  }
  const missingNote = missing.length ? `Не выбрано: ${missing.join("; ")}` : null;

  const buildBody = () => ({
    slots: slots.map(({ typeId, required, multiple }) => ({
      typeId,
      required,
      multiple,
    })),
    keySpecs: specs.map((spec) => ({
      typeId: spec.typeId,
      source: spec.what === MODEL ? "model" : "attribute",
      attributeId: spec.what === MODEL ? null : spec.what,
      aggregate: spec.aggregate,
    })),
  });

  const title = "Своя сборка";

  return (
    <FormWrapper
      title={title}
      header={
        <FormHeader
          title={title}
          subtitle={deviceType?.name ? `Тип: ${deviceType.name}` : null}
        />
      }
      json={buildBody}
      submitDisabled={missing.length > 0}
      actionsNote={missingNote || "Брендовые модели типа не затрагиваются."}
      successTo={`/inventory/device-types/${deviceType?._id}`}
    >
      <section className="pt-1">
        <SubLabel>Комплектующие</SubLabel>
        {slots.length === 0 && (
          <p className="my-0 text-sm text-muted-foreground">
            Комплектующие не заданы.
          </p>
        )}
        {slots.map((slot, index) => (
          <div
            key={slot.key}
            ref={rowRef(slot.key)}
            {...drag.rowProps("slots", index, slot.key)}
            className={cn(
              rowClass(slot.key, index),
              // Телефон: переключатели — второй строкой под полем
              "grid-cols-[auto_minmax(0,1fr)_32px] gap-x-3 gap-y-1.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_32px]",
            )}
          >
            <MoveHandle
              index={index}
              count={slots.length}
              onMove={moveSlot}
              className="col-start-1 row-start-1 sm:col-auto sm:row-auto"
            />
            <div className="col-start-2 row-start-1 min-w-0 sm:col-auto sm:row-auto">
              <Combobox
                id={`slot-${slot.key}`}
                value={slot.typeId}
                onChange={(typeId) => typeId && changeSlotType(slot.key, typeId)}
                options={slotTypeOptions(slot)}
                placeholder="Выберите тип комплектующей"
                searchPlaceholder="Найти тип"
                emptyText="Свободных типов-комплектующих нет."
                ariaLabel="Тип комплектующей"
              />
            </div>
            <div className="col-start-2 row-start-2 flex flex-wrap gap-x-3.5 gap-y-1 sm:contents">
              <InlineSwitch
                id={`slot-${slot.key}-required`}
                checked={slot.required}
                onChange={(required) => updateSlot(slot.key, { required })}
                label="обязательная"
              />
              <InlineSwitch
                id={`slot-${slot.key}-multiple`}
                checked={slot.multiple}
                onChange={(multiple) => updateSlot(slot.key, { multiple })}
                label="несколько"
              />
            </div>
            <div className="col-start-3 row-start-1 sm:col-auto sm:row-auto">
              <RemoveButton onClick={() => removeSlot(slot.key)} />
            </div>
          </div>
        ))}
        <AddLink onClick={addSlot}>Добавить комплектующую</AddLink>
        <Hint>В слоты можно ставить только типы-комплектующие.</Hint>
      </section>

      <section className="mt-2.5 border-t border-border-soft pt-3.5">
        <SubLabel>Ключевые характеристики</SubLabel>
        {specs.length === 0 && (
          <p className="my-0 text-sm text-muted-foreground">
            Не заданы — сборка в списках будет только с названием.
          </p>
        )}
        {specs.map((spec, index) => {
          const sumOk = canSum(spec);
          const attrsLoading =
            !!spec.typeId &&
            attrsByType[spec.typeId] === undefined &&
            !failedTypes.has(spec.typeId);
          return (
            <div
              key={spec.key}
              ref={rowRef(spec.key)}
              {...drag.rowProps("specs", index, spec.key)}
              className={cn(
                rowClass(spec.key, index),
                // Телефон: «что брать» и сведение — строками под слотом
                "grid-cols-[auto_minmax(0,1fr)_32px] gap-x-2.5 gap-y-1.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto_32px]",
              )}
            >
              <MoveHandle
                index={index}
                count={specs.length}
                onMove={moveSpec}
                className="col-start-1 row-start-1 sm:col-auto sm:row-auto"
              />
              <div className="col-start-2 row-start-1 min-w-0 sm:col-auto sm:row-auto">
                <Combobox
                  id={`spec-${spec.key}-slot`}
                  value={spec.typeId}
                  onChange={(typeId) => typeId && changeSpecSlot(spec, typeId)}
                  options={specSlotOptions}
                  placeholder="Слот"
                  searchPlaceholder="Найти слот"
                  emptyText="Сначала выберите комплектующие."
                  ariaLabel="Из какого слота"
                />
              </div>
              <div className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto">
                <Combobox
                  id={`spec-${spec.key}-what`}
                  value={spec.what}
                  onChange={(what) => what && changeSpecWhat(spec, what)}
                  options={whatOptions(spec)}
                  placeholder="Что брать"
                  searchPlaceholder="Найти атрибут"
                  loading={attrsLoading}
                  disabled={!spec.typeId}
                  ariaLabel="Что брать"
                />
              </div>
              <Segmented
                ariaLabel="Как сводить несколько деталей"
                compact
                fit
                className="col-start-2 row-start-3 justify-self-start sm:col-auto sm:row-auto"
                value={spec.aggregate}
                onChange={(aggregate) => updateSpec(spec.key, { aggregate })}
                options={AGGREGATES.map((option) =>
                  option.value === "sum" && !sumOk
                    ? {
                        ...option,
                        disabled: true,
                        title: "Сумма — только для числового атрибута",
                      }
                    : option,
                )}
              />
              <div className="col-start-3 row-start-1 sm:col-auto sm:row-auto">
                <RemoveButton onClick={() => removeSpec(spec.key)} />
              </div>
            </div>
          );
        })}
        <AddLink onClick={addSpec} disabled={chosenSlots.length === 0}>
          Добавить характеристику
        </AddLink>
        <Hint>«Сумма» — только для чисел: 2 модуля по 8 ГБ дают 16 ГБ.</Hint>
      </section>

      {/* Пояснение у кнопок на телефоне скрыто — повторяем под полями */}
      {missingNote && (
        <p className="mt-3 mb-0 text-sm text-muted-foreground sm:hidden">
          {missingNote}
        </p>
      )}
    </FormWrapper>
  );
};

export default AssemblyForm;
