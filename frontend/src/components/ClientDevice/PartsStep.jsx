import { RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Combobox from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import { cn } from "@/lib/utils";

import {
  configEmptyText,
  lowerFirstWord,
  modelPlaceholder,
  modelTitle,
  needsConfiguration,
} from "../DeviceBuild/part-models";
import { AddLink } from "../DeviceBuild/part-pickers";
import {
  WARRANTY_MONTHS,
  activeWarrantyMonths,
  addMonthsToDay,
  insertUnit,
  partsStepLead,
  unitPosition,
  unitWarranty,
  warrantyBase,
} from "./device-parts";

// Быстрая гарантия: «12 / 24 / 36 мес» от даты покупки. Выбранный чип держит
// месяцы: дата следует за датой покупки (и пересчитывается при сохранении).
// Дату можно выбрать и руками — тогда чип активен, лишь если она совпала.
const WarrantyChip = ({ active, onClick, children }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "cursor-pointer appearance-none rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border bg-transparent text-muted-foreground hover:text-foreground",
    )}
  >
    {children}
  </button>
);

/**
 * Шаг «Комплектующие» мастера нового ПК своей сборки (макет «ПК из сборки»,
 * разд. 2). Строка — одна физическая деталь: модель (у модели с несколькими
 * конфигурациями — и конфигурация), серийник, гарантия, закупка. Каждая
 * заполненная строка станет отдельным устройством в составе ПК; пустые не
 * уходят. Состояние строк живёт в мастере — шаг только рисует и меняет их.
 */
const PartsStep = ({
  slots,
  units,
  onUnitsChange,
  modelIndex,
  knownModels,
  configsByModel,
  supplierOptions,
  pcPurchasedAt,
  today,
  attempted,
  gaps,
}) => {
  const slotByType = new Map(slots.map((slot) => [slot.typeId._id, slot]));
  const filledCount = units.filter((unit) => unit.modelId).length;
  // После «Далее»: обязательные слоты, где нет ни одной детали, — рамкой
  // у первой строки слота
  const emptyRequired = new Set(
    attempted
      ? slots
          .filter(
            (slot) =>
              slot.required &&
              !units.some(
                (unit) => unit.typeId === slot.typeId._id && unit.modelId,
              ),
          )
          .map((slot) => slot.typeId._id)
      : [],
  );

  const update = (key, patch) =>
    onUnitsChange((prev) =>
      prev.map((unit) => (unit.key === key ? { ...unit, ...patch } : unit)),
    );
  const remove = (key) =>
    onUnitsChange((prev) => prev.filter((unit) => unit.key !== key));
  const add = (typeId) => onUnitsChange((prev) => insertUnit(prev, typeId));

  // Модели типа детали; модель из сборки, которой нет в (кэшированном)
  // каталоге, — всё равно с подписью, иначе поле покажется пустым
  const modelOptions = (unit) => {
    const options = (modelIndex.byType.get(unit.typeId) || []).map((model) => ({
      value: model._id,
      label: modelTitle(model),
    }));
    const known = unit.modelId && knownModels.get(unit.modelId);
    if (known && !options.some((option) => option.value === unit.modelId)) {
      options.unshift({ value: unit.modelId, label: modelTitle(known) });
    }
    return options;
  };

  return (
    <>
      <p className="mt-0 mb-2.5 text-sm text-muted-foreground">
        {partsStepLead(filledCount)}
      </p>

      {units.map((unit, index) => {
        const slot = slotByType.get(unit.typeId);
        const typeName = slot?.typeId.name || "—";
        const position = unitPosition(units, unit);
        const first = index === 0 || units[index - 1].typeId !== unit.typeId;
        const lastOfSlot =
          index === units.length - 1 || units[index + 1].typeId !== unit.typeId;
        const showConfigs =
          !!unit.modelId &&
          needsConfiguration(modelIndex.byId.get(unit.modelId));
        // undefined — грузится, null — не загрузилось
        const configOptions = showConfigs
          ? configsByModel[unit.modelId]
          : undefined;
        const base = warrantyBase(unit, pcPurchasedAt, today);
        const activeMonths = activeWarrantyMonths(unit, base);
        const modelInvalid = first && emptyRequired.has(unit.typeId);
        const configInvalid = attempted && showConfigs && !unit.configId;
        const label = position ? `${typeName}, ${position}` : typeName;

        return (
          <div key={unit.key}>
            <div
              className={cn(
                "py-3",
                index === 0 ? "pt-1" : "border-t border-border-soft",
              )}
            >
              <div className="mb-2 flex items-baseline gap-2">
                <b className="text-sm font-semibold">{typeName}</b>
                {position && (
                  <span className="text-xs text-faint">{position}</span>
                )}
                {/* Лишнюю единицу слота можно убрать; единственную —
                    очистить модель (пустая строка не уходит) */}
                {position && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Убрать: ${label}`}
                    title="Убрать"
                    onClick={() => remove(unit.key)}
                    className="ms-auto self-center text-faint hover:text-destructive"
                  >
                    <RiCloseLine />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
                <div className="col-span-2 flex min-w-0 flex-col gap-1.5 lg:col-span-1">
                  <Combobox
                    id={`unit-${unit.key}-model`}
                    value={unit.modelId}
                    onChange={(modelId) =>
                      update(unit.key, {
                        modelId: modelId || null,
                        // Другая модель — конфигурация прежней к ней не относится
                        configId: null,
                        modelGone: null,
                      })
                    }
                    options={modelOptions(unit)}
                    clearable
                    clearLabel="Без детали"
                    placeholder={modelPlaceholder(unit.modelGone)}
                    searchPlaceholder="Найти модель"
                    emptyText="Моделей этого типа в каталоге нет."
                    ariaLabel={`Модель: ${label}`}
                    className={modelInvalid ? "border-destructive" : undefined}
                  />
                  {showConfigs && (
                    <Combobox
                      id={`unit-${unit.key}-config`}
                      value={unit.configId}
                      onChange={(configId) => update(unit.key, { configId })}
                      options={configOptions || []}
                      loading={configOptions === undefined}
                      placeholder="Конфигурация"
                      searchPlaceholder="Найти конфигурацию"
                      emptyText={configEmptyText(configOptions)}
                      ariaLabel={`Конфигурация: ${label}`}
                      className={
                        configInvalid ? "border-destructive" : undefined
                      }
                    />
                  )}
                </div>
                <Input
                  id={`unit-${unit.key}-serial`}
                  value={unit.serialNumber}
                  onChange={(event) =>
                    update(unit.key, { serialNumber: event.target.value })
                  }
                  placeholder="Серийный номер"
                  aria-label={`Серийный номер: ${label}`}
                  className="font-mono"
                />
                <DateField
                  id={`unit-${unit.key}-warranty`}
                  value={unitWarranty(unit, base)}
                  onChange={(next) =>
                    update(unit.key, {
                      warrantyExpirationDate: next,
                      warrantyMonths: null,
                    })
                  }
                  placeholder="Гарантия до"
                  ariaLabel={`Гарантия до: ${label}`}
                  captionLayout="dropdown"
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3.5">
                <span
                  role="group"
                  aria-label={`Гарантия от даты покупки: ${label}`}
                  className="inline-flex gap-1"
                >
                  {WARRANTY_MONTHS.map((months) => (
                    <WarrantyChip
                      key={months}
                      active={activeMonths === months}
                      onClick={() =>
                        update(unit.key, {
                          warrantyExpirationDate: addMonthsToDay(base, months),
                          warrantyMonths: months,
                        })
                      }
                    >
                      {months} мес
                    </WarrantyChip>
                  ))}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Switch
                    id={`unit-${unit.key}-same`}
                    checked={unit.samePurchase}
                    onCheckedChange={(checked) =>
                      update(unit.key, { samePurchase: checked })
                    }
                  />
                  <Label
                    htmlFor={`unit-${unit.key}-same`}
                    className="text-sm font-normal whitespace-nowrap"
                  >
                    Закупка как у ПК
                  </Label>
                </span>
              </div>

              {!unit.samePurchase && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <DateField
                    id={`unit-${unit.key}-purchased`}
                    value={unit.purchasedAt}
                    onChange={(next) => update(unit.key, { purchasedAt: next })}
                    placeholder="Дата покупки"
                    ariaLabel={`Дата покупки: ${label}`}
                    captionLayout="dropdown"
                  />
                  <Combobox
                    id={`unit-${unit.key}-supplier`}
                    value={unit.supplierId || null}
                    onChange={(next) =>
                      update(unit.key, { supplierId: next || "" })
                    }
                    options={supplierOptions}
                    clearable
                    placeholder="Поставщик"
                    searchPlaceholder="Найти поставщика…"
                    ariaLabel={`Поставщик: ${label}`}
                  />
                </div>
              )}
            </div>

            {/* «Ещё <тип>» — ещё одна единица в слот «несколько» */}
            {slot?.multiple && lastOfSlot && (
              <div className="pb-3">
                <AddLink onClick={() => add(unit.typeId)}>
                  Ещё {lowerFirstWord(typeName)}
                </AddLink>
              </div>
            )}
          </div>
        );
      })}

      {/* Пояснение у кнопок на телефоне скрыто — повторяем под строками */}
      {attempted && gaps.length > 0 && (
        <p
          role="alert"
          className="mt-1 mb-0 text-sm text-destructive sm:hidden"
        >
          Не заполнено: {gaps.join(", ")}
        </p>
      )}
    </>
  );
};

export default PartsStep;
