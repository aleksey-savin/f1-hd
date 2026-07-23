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
export type EditableCustomField = {
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
  "tw:h-9 tw:w-full tw:appearance-none tw:rounded-lg tw:border tw:border-input tw:bg-card tw:px-3 tw:text-sm tw:text-foreground tw:outline-none tw:placeholder:text-faint tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50";

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
      className="tw:flex tw:gap-2.5 tw:rounded-xl tw:border tw:border-border tw:bg-accent/40 tw:p-3.5"
    >
      <span
        onPointerDown={(event) => controls.start(event)}
        style={{ touchAction: "none" }}
        aria-hidden
        title="Перетащить"
        className="tw:mt-2 tw:inline-grid tw:size-5 tw:flex-none tw:cursor-grab tw:place-items-start tw:justify-center tw:text-faint tw:active:cursor-grabbing tw:[&_svg]:size-4"
      >
        <RiDraggable />
      </span>

      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:flex tw:flex-wrap tw:gap-2.5">
          <input
            value={field.name ?? ""}
            onChange={(event) => onPatch({ name: event.target.value })}
            placeholder="Название поля"
            aria-label="Название поля"
            className={cn(CF_INPUT, "tw:min-w-40 tw:flex-1 tw:font-medium")}
          />
          <div className="tw:relative tw:flex-none">
            <select
              value={field.type ?? "text"}
              onChange={(event) => changeType(event.target.value)}
              aria-label="Тип поля"
              className={
                "tw:h-9 tw:w-52 tw:cursor-pointer tw:appearance-none tw:rounded-lg tw:border tw:border-input tw:bg-card tw:pr-8 tw:pl-3 tw:text-sm tw:font-medium tw:text-foreground tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
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
              className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:right-2.5 tw:size-4 tw:-translate-y-1/2 tw:text-faint"
            />
          </div>
        </div>

        {hasOptions(field.type) ? (
          <div className="tw:mt-3">
            <div className="tw:mb-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
              Опции
            </div>
            <div className="tw:grid tw:gap-2">
              {options.map((option, index) => (
                <div key={index} className="tw:flex tw:items-center tw:gap-2">
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
                    className={cn(CF_INPUT, "tw:flex-1")}
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
                    className="tw:inline-grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:text-faint tw:outline-none tw:hover:bg-accent tw:hover:text-destructive tw:[&_svg]:size-4"
                  >
                    <RiCloseLine />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onPatch({ options: [...options, ""] })}
              className="tw:mt-2 tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:font-semibold tw:text-accent-text tw:outline-none tw:hover:underline tw:[&_svg]:size-4"
            >
              <RiAddLine /> Опция
            </button>
          </div>
        ) : (
          <div className="tw:mt-2 tw:text-sm tw:text-muted-foreground">
            Свободный ввод — заполняется при создании заявки.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        title="Удалить поле"
        aria-label="Удалить поле"
        className="tw:mt-1 tw:inline-grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:self-start tw:rounded-md tw:border-0 tw:bg-transparent tw:text-faint tw:outline-none tw:hover:bg-accent tw:hover:text-destructive tw:[&_svg]:size-[18px]"
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
  const patch = (key: string | undefined, updates: Partial<EditableCustomField>) =>
    onChange(value.map((field) => (field._key === key ? { ...field, ...updates } : field)));

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
          className="tw:grid tw:gap-2.5"
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
        className="tw:mt-2.5 tw:inline-flex tw:h-10 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:rounded-lg tw:border tw:border-dashed tw:border-border tw:bg-transparent tw:px-4 tw:text-sm tw:font-semibold tw:text-accent-text tw:outline-none tw:hover:bg-accent tw:[&_svg]:size-4"
      >
        <RiAddLine /> Новое поле
      </button>
    </div>
  );
};

export default CustomFieldsEditor;
