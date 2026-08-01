import { Reorder, useDragControls } from "framer-motion";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDraggable,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

// Конструктор кастомных полей (форма-опросник) — общий с картой (CustomFieldsView
// показывает то же самое в чтении). Контролируемый: value + onChange. Каждое поле
// несёт транзиентный `_key` для drag/ключей (бэкенд его игнорирует по strict-схеме).
type EditableCustomField = {
  _key?: string;
  name?: string;
  type?: string;
  options?: string[];
  value?: unknown;
};

const TYPE_OPTIONS = [
  { value: "text", label: "Текст" },
  { value: "select", label: "Выбор" },
  { value: "multiselect", label: "Множественный выбор" },
];

export const genFieldKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `cf-${Math.random().toString(16).slice(2)}-${Date.now()}`;

const hasOptions = (type?: string) =>
  type === "select" || type === "multiselect";

const CF_INPUT =
  "h-9 w-full appearance-none rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/50";

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
          <div className="relative flex-none">
            <select
              value={field.type ?? "text"}
              onChange={(event) => changeType(event.target.value)}
              aria-label="Тип поля"
              className={
                "h-9 w-52 cursor-pointer appearance-none rounded-lg border border-input bg-card pr-8 pl-3 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/50"
              }
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <RiArrowDownSLine
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-faint"
            />
          </div>
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
            Свободный ввод — заполняется при создании заявки.
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
      { _key: genFieldKey(), name: "", type: "text", options: [], value: "" },
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
