import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";

import { RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormWrapper from "@/components/app/FormWrapper";
import Combobox from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import { FormHeader } from "@/components/app/FormLayout";
import { SubLabel } from "@/components/app/Panel";
import { liveAssembly } from "@/components/app/assembly-specs";
import { cn } from "@/lib/utils";
import {
  configEmptyText,
  idOf,
  lowerFirstWord,
  modelGoneOf,
  modelPlaceholder,
  modelTitle,
  needsConfiguration,
  slotGaps,
} from "./part-models";
import { AddLink, useModelConfigurations, useModelIndex } from "./part-pickers";

// Шторка «Новая сборка» / «Изменить сборку» (макет «Своя сборка ПК», разд. 4).
// Слоты типа — строками: в каждой модель комплектующей этого типа (у модели
// с несколькими конфигурациями — ещё и конфигурация), у слотов «несколько» —
// количество и «Ещё …» для другой модели. Тело уходит JSON-ом.

// Ключ строки — локальный: строка без модели своего id ещё не имеет
let rowSeq = 0;
const rowKey = () => `part-${++rowSeq}`;

const emptyRow = (typeId) => ({
  key: rowKey(),
  typeId,
  modelId: null,
  configId: null,
  quantity: 1,
  // Прежняя модель детали не годится — строка пуста, но подсказывает почему:
  // "deleted" — модель удалили, "retyped" — её перевели в другой тип
  modelGone: null,
});

// Строки по слотам: сохранённые детали слота, а пустой слот — одной пустой
// строкой. Детали вне слотов сервер не примет — в форму их не берём.
const initialRows = (slots, parts) => {
  const rows = [];
  for (const slot of slots) {
    const typeId = idOf(slot.typeId);
    const own = parts.filter((part) => idOf(part.typeId) === typeId);
    if (own.length === 0) {
      rows.push(emptyRow(typeId));
      continue;
    }
    for (const part of own) {
      const model = part.deviceModelId;
      // Сервер не примет ни удалённую модель, ни модель чужого типа
      const gone = modelGoneOf(model, typeId);
      const config = part.configurationId;
      rows.push({
        ...emptyRow(typeId),
        modelId: gone ? null : model._id,
        configId: !gone && config && !config.deletedAt ? config._id : null,
        quantity: slot.multiple && part.quantity > 0 ? part.quantity : 1,
        modelGone: gone,
      });
    }
  }
  return rows;
};

// Количество: «− N +». У слота без «несколько» — неактивно на единице
const QtyStepper = ({ value, onChange, disabled, label }) => (
  <div
    role="group"
    aria-label={`Количество: ${label}`}
    className={cn(
      "flex h-9 items-center overflow-hidden rounded-lg border border-border",
      disabled && "opacity-45",
    )}
  >
    <button
      type="button"
      aria-label="Меньше"
      disabled={disabled || value <= 1}
      onClick={() => onChange(value - 1)}
      className="h-full w-7 cursor-pointer appearance-none border-0 bg-transparent p-0 text-base text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
    >
      −
    </button>
    <span className="flex-1 text-center text-sm font-medium tabular-nums">
      {value}
    </span>
    <button
      type="button"
      aria-label="Больше"
      disabled={disabled}
      onClick={() => onChange(value + 1)}
      className="h-full w-7 cursor-pointer appearance-none border-0 bg-transparent p-0 text-base text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
    >
      +
    </button>
  </div>
);

// Сетка строки детали: подпись слота · модель · количество · «Убрать»; на
// телефоне подпись — отдельной строкой сверху
const PART_GRID =
  "grid grid-cols-[minmax(0,1fr)_88px_32px] items-center gap-x-2.5 gap-y-1 py-1.75 sm:grid-cols-[150px_minmax(0,1fr)_96px_32px]";

const DeviceBuildForm = ({ title, submitLabel, successState }) => {
  const { deviceType, models, build } = useLoaderData();
  // Слоты удалённых типов (populate → null) в форму не берём
  const slots = useMemo(
    () => liveAssembly(deviceType?.assembly).slots,
    [deviceType],
  );

  const [name, setName] = useState(build?.name || "");
  const [notes, setNotes] = useState(build?.notes || "");
  const [rows, setRows] = useState(() =>
    initialRows(slots, build?.parts || []),
  );

  // Детали типов, которых больше нет в слотах: при сохранении они уйдут
  const orphanTypes = useMemo(() => {
    const slotIds = new Set(slots.map((slot) => idOf(slot.typeId)));
    const names = new Map();
    for (const part of build?.parts || []) {
      const typeId = idOf(part.typeId);
      if (!slotIds.has(typeId)) names.set(typeId, part.typeId?.name || "—");
    }
    return [...names.values()];
  }, [slots, build]);

  // Модели каталога по типу комплектующей
  const { byId: modelById, byType: modelsByType } = useModelIndex(models);
  const savedModels = useMemo(
    () =>
      new Map(
        (build?.parts || [])
          .map((part) => part.deviceModelId)
          .filter((model) => model && !model.deletedAt)
          .map((model) => [model._id, model]),
      ),
    [build],
  );
  // Конфигурации моделей с несколькими конфигурациями (см. part-models)
  const configsByModel = useModelConfigurations(rows, modelById);

  // ── Строки ──
  const updateRow = (key, patch) =>
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  // Другая модель — конфигурация прежней к ней не относится
  const changeModel = (key, modelId) =>
    updateRow(key, { modelId, configId: null, modelGone: null });

  // «Ещё <тип>» — новая строка сразу после последней строки слота
  const addRow = (typeId) =>
    setRows((prev) => {
      let last = -1;
      prev.forEach((row, index) => {
        if (row.typeId === typeId) last = index;
      });
      const next = [...prev];
      next.splice(last + 1, 0, emptyRow(typeId));
      return next;
    });

  // Убрать: из нескольких строк слота — строку; единственную — очистить
  // (слот в форме остаётся, пустой)
  const removeRow = (row) =>
    setRows((prev) =>
      prev.filter((other) => other.typeId === row.typeId).length > 1
        ? prev.filter((other) => other.key !== row.key)
        : prev.map((other) =>
            other.key === row.key ? emptyRow(row.typeId) : other,
          ),
    );

  // ── Опции ──
  // Занятое соседними строками слота — по паре модель + конфигурация: вторую
  // такую же деталь даёт количество, а модель с несколькими конфигурациями
  // можно взять ещё раз — с другой конфигурацией
  const siblingsOf = (row) =>
    rows.filter(
      (other) =>
        other.key !== row.key && other.typeId === row.typeId && other.modelId,
    );
  const modelOptions = (row) => {
    const takenCount = new Map();
    for (const other of siblingsOf(row)) {
      takenCount.set(other.modelId, (takenCount.get(other.modelId) || 0) + 1);
    }
    const options = (modelsByType.get(row.typeId) || [])
      .filter(
        (model) =>
          (takenCount.get(model._id) || 0) <
          Math.max(model.configurationsCount || 0, 1),
      )
      .map((model) => ({ value: model._id, label: modelTitle(model) }));
    // Сохранённая модель, которой нет в (кэшированном) списке, — подпись
    // всё равно нужна, иначе поле покажется пустым
    const saved = row.modelId && savedModels.get(row.modelId);
    if (saved && !options.some((option) => option.value === row.modelId)) {
      options.unshift({ value: row.modelId, label: modelTitle(saved) });
    }
    return options;
  };
  // Конфигурации модели строки без взятых соседними строками с той же моделью
  const configOptionsOf = (row, options) => {
    if (!options) return options;
    const taken = new Set(
      siblingsOf(row)
        .filter((other) => other.modelId === row.modelId && other.configId)
        .map((other) => other.configId),
    );
    return options.filter((option) => !taken.has(option.value));
  };

  // ── Готовность ──
  const slotByType = new Map(slots.map((slot) => [idOf(slot.typeId), slot]));
  const needsConfig = (row) =>
    !!row.modelId && needsConfiguration(modelById.get(row.modelId));
  // Пустые обязательные слоты и модели без выбранной конфигурации
  const missing = slotGaps(slots, rows, modelById);
  const missingNote = missing.length
    ? `Не заполнено: ${missing.join(", ")}`
    : null;

  const buildBody = () => ({
    name: name.trim(),
    notes: notes.trim(),
    parts: rows
      .filter((row) => row.modelId)
      .map((row) => ({
        typeId: row.typeId,
        deviceModelId: row.modelId,
        configurationId: row.configId || null,
        quantity: row.quantity,
      })),
  });

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
      submitLabel={submitLabel}
      submitDisabled={missing.length > 0}
      actionsNote={missingNote}
      // Создание → карточка созданной сборки; правка — назад на карточку
      successTo={(data) =>
        data?._id ? `/inventory/device-builds/${data._id}` : undefined
      }
      successState={successState}
    >
      <Field label="Наименование" htmlFor="build-name" required>
        <Input
          id="build-name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Офисная сборка 2025"
        />
      </Field>

      <section className="pt-1">
        <SubLabel>Комплектующие</SubLabel>
        {slots.length === 0 && (
          <p className="my-0 text-sm text-muted-foreground">
            У типа не заданы комплектующие.
          </p>
        )}
        {rows.map((row, index) => {
          const slot = slotByType.get(row.typeId);
          const typeName = slot?.typeId?.name || "—";
          const first = index === 0 || rows[index - 1].typeId !== row.typeId;
          const lastOfSlot =
            index === rows.length - 1 || rows[index + 1].typeId !== row.typeId;
          const siblings = rows.filter((other) => other.typeId === row.typeId);
          const multiple = !!slot?.multiple;
          // undefined — грузится, null — не загрузилось
          const configOptions = row.modelId
            ? configsByModel[row.modelId]
            : undefined;
          const showConfigs = needsConfig(row);
          return (
            <div key={row.key}>
              <div
                className={cn(
                  PART_GRID,
                  index > 0 && "border-t border-border-soft",
                )}
              >
                {/* Подпись слота — у первой строки; у следующих место
                    держится пустым (десктоп) или убирается (телефон) */}
                <div
                  className={cn(
                    "col-span-full text-sm font-medium sm:col-span-1",
                    !first && "hidden sm:invisible sm:block",
                  )}
                >
                  {typeName}
                  {slot?.required && (
                    <span className="text-destructive"> *</span>
                  )}
                  {multiple && (
                    <span className="block text-xs font-normal text-faint">
                      несколько
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Combobox
                    id={`part-${row.key}`}
                    value={row.modelId}
                    onChange={(modelId) => modelId && changeModel(row.key, modelId)}
                    options={modelOptions(row)}
                    placeholder={modelPlaceholder(row.modelGone)}
                    searchPlaceholder="Найти модель"
                    emptyText="Моделей этого типа в каталоге нет."
                    ariaLabel={`Модель: ${typeName}`}
                  />
                  {showConfigs && (
                    <Combobox
                      id={`part-${row.key}-config`}
                      value={row.configId}
                      onChange={(configId) =>
                        updateRow(row.key, { configId })
                      }
                      options={configOptionsOf(row, configOptions) || []}
                      loading={configOptions === undefined}
                      placeholder="Выберите конфигурацию"
                      searchPlaceholder="Найти конфигурацию"
                      emptyText={configEmptyText(configOptions)}
                      ariaLabel={`Конфигурация: ${typeName}`}
                    />
                  )}
                </div>
                <QtyStepper
                  value={row.quantity}
                  disabled={!multiple}
                  label={typeName}
                  onChange={(quantity) => updateRow(row.key, { quantity })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Убрать"
                  title="Убрать"
                  disabled={siblings.length === 1 && !row.modelId}
                  onClick={() => removeRow(row)}
                  className="justify-self-center text-faint hover:text-destructive"
                >
                  <RiCloseLine />
                </Button>
              </div>
              {/* «Ещё <тип>» — другая модель в слот «несколько» */}
              {multiple && lastOfSlot && (
                <div className="grid grid-cols-1 gap-x-2.5 border-t border-border-soft py-1.75 sm:grid-cols-[150px_minmax(0,1fr)]">
                  <span aria-hidden className="hidden sm:block" />
                  <div>
                    <AddLink onClick={() => addRow(row.typeId)}>
                      Ещё {lowerFirstWord(typeName)}
                    </AddLink>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <p className="mt-2 mb-0 text-xs text-faint">
          В списке — модели каталога этого типа комплектующей.
        </p>
        {orphanTypes.length > 0 && (
          <p className="mt-1.5 mb-0 text-sm text-warning-text">
            Комплектующих «{orphanTypes.join("», «")}» больше нет в слотах
            типа — при сохранении они уберутся из сборки.
          </p>
        )}
      </section>

      <section className="mt-2.5 border-t border-border-soft pt-3.5">
        <SubLabel>Примечание</SubLabel>
        <Textarea
          id="build-notes"
          name="notes"
          rows={2}
          aria-label="Примечание"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Для кого и зачем эта сборка"
        />
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

export default DeviceBuildForm;
