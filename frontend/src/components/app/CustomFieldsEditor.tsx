import { Reorder, useDragControls } from "framer-motion";
import {
  RiAddLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDraggable,
} from "react-icons/ri";

import Combobox from "@/components/app/Combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { TYPE_OPTIONS, hasOptions } from "./custom-fields";

// Конструктор вопросов анкеты — общий блок с CustomFieldsView (определение в
// чтении), CustomFieldInput (ответ в форме заявки) и CustomFieldsAnswers
// (ответы на карточке). Контролируемый: value + onChange. Каждое поле несёт
// транзиентный `_key` для drag/ключей React; постоянный `key` вопроса выдаёт
// сервер и по нему сверяет ответы — конструктор его только сохраняет.
type EditableCustomField = {
  _key?: string;
  key?: string;
  name?: string;
  type?: string;
  options?: string[];
  required?: boolean;
  hint?: string;
  value?: unknown;
};

export const genFieldKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `cf-${Math.random().toString(16).slice(2)}-${Date.now()}`;

// Что увидит инициатор у вопроса без вариантов
const TYPE_NOTE: Record<string, string> = {
  text: "Свободный ввод — заполняется при создании заявки.",
  boolean: "Два варианта: «Да» и «Нет».",
  number: "Только число.",
  date: "Инициатор выберет день в календаре.",
};

// h-10 — высота контролов в ряду (гайд, «Типографика»): рядом с полем стоит
// `app/Combobox` выбора типа, и в одном ряду высота одна
const CF_INPUT =
  "h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/50";

const FieldRow = ({
  field,
  onPatch,
  onRemove,
}: {
  field: EditableCustomField;
  onPatch: (patch: Partial<EditableCustomField>) => void;
  onRemove: () => void;
}) => {
  const controls = useDragControls();
  const options = field.options ?? [];

  const changeType = (type: string) =>
    onPatch(
      hasOptions(type)
        ? { type, options: options.length ? options : [""] }
        : { type, options: [] },
    );

  return (
    <Reorder.Item
      as="div"
      value={field}
      dragListener={false}
      dragControls={controls}
      className="flex gap-2.5 rounded-xl border border-border bg-accent/40 p-3.5"
    >
      <span
        onPointerDown={(event) => controls.start(event)}
        style={{ touchAction: "none" }}
        aria-hidden
        title="Перетащить"
        className="mt-2 inline-grid size-5 flex-none cursor-grab place-items-start justify-center text-faint active:cursor-grabbing [&_svg]:size-4"
      >
        <RiDraggable />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2.5">
          <input
            value={field.name ?? ""}
            onChange={(event) => onPatch({ name: event.target.value })}
            placeholder="Название поля"
            aria-label="Название поля"
            className={cn(CF_INPUT, "min-w-40 flex-1 font-medium")}
          />
          {/* Выпадающий список — всегда app/Combobox (гайд, «Раскладка полей»):
              нативный select тут выбивался и видом, и поведением внутри
              шторки */}
          <div className="w-52 flex-none">
            <Combobox
              value={field.type ?? "text"}
              onChange={(next) => changeType(next ?? "text")}
              options={TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              ariaLabel="Тип поля"
              searchPlaceholder="Найти тип…"
              emptyText="Тип не нашёлся."
            />
          </div>
        </div>

        {/* Подсказка и обязательность — у каждого вопроса, любого типа */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <input
            value={field.hint ?? ""}
            onChange={(event) => onPatch({ hint: event.target.value })}
            placeholder="Подсказка — что и как заполнить"
            aria-label="Подсказка"
            className={cn(CF_INPUT, "min-w-40 flex-1")}
          />
          <Label
            htmlFor={`cf-required-${field._key}`}
            className="h-9 flex-none gap-2 text-sm font-semibold"
          >
            <Switch
              id={`cf-required-${field._key}`}
              checked={!!field.required}
              onCheckedChange={(checked) => onPatch({ required: checked })}
            />
            Обязательно
          </Label>
        </div>

        {hasOptions(field.type) ? (
          <div className="mt-3">
            <div className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">
              Опции
            </div>
            <div className="grid gap-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={option}
                    onChange={(event) =>
                      onPatch({
                        options: options.map((existing, position) =>
                          position === index ? event.target.value : existing,
                        ),
                      })
                    }
                    placeholder="Значение опции"
                    aria-label="Значение опции"
                    className={cn(CF_INPUT, "flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onPatch({
                        options: options.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                    title="Удалить опцию"
                    aria-label="Удалить опцию"
                    className="inline-grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent text-faint outline-none hover:bg-accent hover:text-destructive [&_svg]:size-4"
                  >
                    <RiCloseLine />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onPatch({ options: [...options, ""] })}
              className="mt-2 inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-accent-text outline-none hover:underline [&_svg]:size-4"
            >
              <RiAddLine /> Опция
            </button>
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted-foreground">
            {TYPE_NOTE[field.type ?? "text"] ?? TYPE_NOTE.text}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Удалить поле"
        aria-label="Удалить поле"
        className="mt-1 inline-grid size-8 flex-none cursor-pointer appearance-none place-items-center self-start rounded-md border-0 bg-transparent text-faint outline-none hover:bg-accent hover:text-destructive [&_svg]:size-[18px]"
      >
        <RiDeleteBinLine />
      </button>
    </Reorder.Item>
  );
};

const CustomFieldsEditor = ({
  value = [],
  onChange,
}: {
  value?: EditableCustomField[];
  onChange: (fields: EditableCustomField[]) => void;
}) => {
  const patch = (
    key: string | undefined,
    updates: Partial<EditableCustomField>,
  ) =>
    onChange(
      value.map((field) =>
        field._key === key ? { ...field, ...updates } : field,
      ),
    );

  const remove = (key: string | undefined) =>
    onChange(value.filter((field) => field._key !== key));

  const add = () =>
    onChange([
      ...value,
      {
        _key: genFieldKey(),
        key: genFieldKey(),
        name: "",
        type: "text",
        options: [],
        required: false,
        hint: "",
        value: "",
      },
    ]);

  return (
    <div>
      {value.length > 0 && (
        <Reorder.Group
          as="div"
          axis="y"
          values={value}
          onReorder={onChange}
          className="grid gap-2.5"
        >
          {value.map((field) => (
            <FieldRow
              key={field._key}
              field={field}
              onPatch={(updates) => patch(field._key, updates)}
              onRemove={() => remove(field._key)}
            />
          ))}
        </Reorder.Group>
      )}
      <button
        type="button"
        onClick={add}
        className="mt-2.5 inline-flex h-10 cursor-pointer appearance-none items-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent px-4 text-sm font-semibold text-accent-text outline-none hover:bg-accent [&_svg]:size-4"
      >
        <RiAddLine /> Новое поле
      </button>
    </div>
  );
};

export default CustomFieldsEditor;
