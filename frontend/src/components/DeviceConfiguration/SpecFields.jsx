import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import Field from "@/components/app/Field";
import DateField from "@/components/app/DateField";
import Combobox from "@/components/app/Combobox";
import FilterChip from "@/components/app/FilterChip";
import {
  groupLinks,
  parseMultiValue,
  serializeMultiValue,
} from "@/components/app/spec-sheet";

// Поля характеристик по связкам типа (атрибут + группа), сгруппированные как
// в SpecSheet. Общие у формы конфигурации и формы модели (раздел
// «Характеристики» в режиме одной конфигурации). Значения — массив
// { attributeId, value }; состояние держит форма, сюда приходит готовое,
// наверх — следующий массив целиком. Без связок не рендерит ничего:
// пояснение «у типа нет характеристик» у каждой формы своё. Те же поля — у
// параметров устройства (значения ClientDevice.attributes); errors — причина
// у поля по id атрибута (незаполненный обязательный).
const idOf = (ref) => String(ref?._id ?? ref ?? "");

// lead — поле, которое встаёт первым в сетку первой группы (имя устройства в
// паре с первым параметром, как в макете)
const SpecFields = ({
  links = [],
  values = [],
  onChange,
  errors = {},
  lead = null,
}) => {
  const getValue = (attributeId) => {
    const val = values.find((v) => idOf(v.attributeId) === idOf(attributeId));
    return val?.value ?? "";
  };

  const handleValueChange = (attributeId, value) => {
    const existing = values.find(
      (v) => idOf(v.attributeId) === idOf(attributeId),
    );
    onChange(
      existing
        ? values.map((v) =>
            idOf(v.attributeId) === idOf(attributeId) ? { ...v, value } : v,
          )
        : [...values, { attributeId, value }],
    );
  };

  const renderAttributeInput = (attrId, attrData) => {
    const value = getValue(attrId);
    const inputId = `attr-${attrId}`;

    switch (attrData.valueType) {
      case "boolean":
        return (
          <div className="flex h-9 items-center gap-2.5">
            <Switch
              id={inputId}
              checked={value === true || value === "true"}
              onCheckedChange={(checked) => handleValueChange(attrId, checked)}
            />
            <span className="text-sm text-muted-foreground">
              {value === true || value === "true" ? "Да" : "Нет"}
            </span>
          </div>
        );

      case "number":
        return (
          <Input
            id={inputId}
            type="number"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      case "select":
        return (
          <Combobox
            id={inputId}
            value={value || null}
            onChange={(next) => handleValueChange(attrId, next || "")}
            options={attrData.options || []}
            placeholder="Выберите…"
            clearable
            clearLabel="Не выбрано"
          />
        );

      case "multiselect": {
        const options = attrData.options || [];
        const selected = parseMultiValue(String(value ?? ""));
        // Старое текстовое значение вне вариантов не теряем: показываем
        // его выбранным вариантом, иначе сохранение молча его сотрёт
        const extra = selected
          .filter((item) => !options.some((o) => o.value === item))
          .map((item) => ({ value: item, label: item }));
        return (
          <div
            id={inputId}
            role="group"
            aria-label={attrData.name}
            className="flex flex-wrap gap-1.5"
          >
            {[...options, ...extra].map((option) => {
              const active = selected.includes(option.value);
              return (
                <FilterChip
                  key={option.value}
                  size="sm"
                  dot="none"
                  active={active}
                  className={
                    active
                      ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                      : "font-normal"
                  }
                  onClick={() => {
                    const next = active
                      ? selected.filter((item) => item !== option.value)
                      : [...selected, option.value];
                    // Порядок — как у вариантов, независимо от порядка нажатий
                    const ordered = [...options, ...extra]
                      .map((o) => o.value)
                      .filter((v) => next.includes(v));
                    handleValueChange(
                      attrId,
                      ordered.length ? serializeMultiValue(ordered) : "",
                    );
                  }}
                >
                  {option.label}
                </FilterChip>
              );
            })}
          </div>
        );
      }

      case "date":
        return (
          <DateField
            id={inputId}
            value={String(value || "")}
            onChange={(next) => handleValueChange(attrId, next)}
            captionLayout="dropdown"
          />
        );

      case "text":
        return (
          <Textarea
            id={inputId}
            rows={2}
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
          />
        );

      default:
        return (
          <Input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => handleValueChange(attrId, e.target.value)}
            placeholder="Введите значение"
            aria-invalid={errors[attrId] ? true : undefined}
          />
        );
    }
  };

  if (links.length === 0) return null;

  // Без единой группы заголовки не нужны — и «Прочее» тоже
  const groups = groupLinks(links, "Прочее");
  const hasGroups = groups.some((g) => g.key !== "other");

  return (
    <div>
      {groups.map((group, index) => (
        <section
          key={group.key}
          className={
            index === 0 ? "pt-1.5" : "mt-1.5 border-t border-border-soft pt-3.5"
          }
        >
          {hasGroups && (
            <h5 className="mt-0 mb-2.5 text-xs font-bold uppercase tracking-wider text-faint">
              {group.name}
            </h5>
          )}
          <div className="grid gap-x-4 sm:grid-cols-2">
            {index === 0 && lead}
            {group.links.map((attr) => {
              const attrData =
                typeof attr.attributeId === "object" ? attr.attributeId : null;
              if (!attrData) return null;
              const attrId = attrData._id;
              // Мультивыбор шире колонки: варианты — фразы столбиком
              const wide = attrData.valueType === "multiselect";

              return (
                <Field
                  key={attrId}
                  className={wide ? "sm:col-span-2" : undefined}
                  htmlFor={`attr-${attrId}`}
                  required={attr.required}
                  error={errors[attrId]}
                  label={
                    <>
                      {attrData.name || "Атрибут"}
                      {attrData.unit && (
                        <span className="font-normal text-faint">
                          {" "}
                          ({attrData.unit})
                        </span>
                      )}
                    </>
                  }
                >
                  {renderAttributeInput(attrId, attrData)}
                </Field>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default SpecFields;
