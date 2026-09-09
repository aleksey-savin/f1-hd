import { useRef, useState } from "react";

import {
  RiArrowDownSLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
} from "react-icons/ri";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useInOverlay } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

type ComboboxOption = {
  value: string;
  label: string;
  /** Приглушённая строка под названием: должность, город, пояснение. */
  hint?: string;
  /**
   * Заголовок группы, под которой стоит опция. Группа — способ сказать про
   * опции то, что раньше говорили цветом: «Ведут категорию «Почта»» против
   * «Остальные» в ответственных заявки. Порядок групп — порядок первого
   * появления в `options`; опции без группы идут первыми, без заголовка.
   */
  group?: string;
  /**
   * Опция видна, но выбрать нельзя. Нужна там, где отсутствие варианта в
   * списке было бы враньём: сотрудник существует, но уже занят в другом
   * подразделении — и подпись объясняет, где именно.
   */
  disabled?: boolean;
  /**
   * Цвет точки перед названием — присутствие сотрудника в выборе
   * ответственного (тон статуса из каталога). Точка, а не иконка: в строке
   * списка ей хватает 8px, а смысл несёт подпись `hint`.
   */
  dot?: string;
};

/**
 * Приводит доменные объекты к опциям: `{value, label}` плюс необязательные
 * `hint`, `group` и `disabled`. Наружу уходят только эти поля, поэтому лишние
 * ключи доменного объекта в список выбора не протекают.
 */
export const toOptions = <T,>(
  items: T[] = [],
  map: {
    value: (item: T) => string;
    label: (item: T) => string;
    hint?: (item: T) => string | undefined;
    group?: (item: T) => string | undefined;
    disabled?: (item: T) => boolean;
    dot?: (item: T) => string | undefined;
  },
): ComboboxOption[] =>
  items.map((item) => ({
    value: map.value(item),
    label: map.label(item),
    hint: map.hint?.(item),
    group: map.group?.(item),
    disabled: map.disabled?.(item),
    dot: map.dot?.(item),
  }));

/**
 * Скрытый спутник поля — только ради нативной валидации формы.
 *
 * Combobox — это Popover с кнопкой, а не контрол формы, поэтому браузер о нём
 * ничего не знает и `required` сам по себе не работает. Зеркалим значение в
 * настоящий `<input required>`: он участвует в проверке при сабмите и держит
 * подсказку браузера у нижнего края поля.
 *
 * Прячем ПРОЗРАЧНОСТЬЮ, а не `hidden`/`display:none`: невидимый по display
 * контрол блокирует отправку молча — Chrome отказывается наводить на него
 * подсказку («not focusable») и просто роняет сабмит. Высота 1px, а не 0, по
 * той же причине; `pointer-events-none`, чтобы полоска не перехватывала клик
 * по нижней кромке триггера.
 */
export const RequiredMirror = ({
  value,
  disabled,
  onFocus,
}: {
  value: string;
  disabled?: boolean;
  onFocus: () => void;
}) => {
  if (disabled) return null;
  return (
    <input
      tabIndex={-1}
      aria-hidden
      required
      value={value}
      onChange={() => {}}
      onFocus={onFocus}
      className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-0"
    />
  );
};

// Группируем сохраняя порядок: список ответственных уже отсортирован, и
// перестановка групп по алфавиту поменяла бы смысл — первой должна идти та,
// ради которой группировка и заведена.
const groupOptions = (options: ComboboxOption[]) => {
  const groups: { key: string; heading?: string; items: ComboboxOption[] }[] =
    [];
  for (const option of options) {
    const heading = option.group;
    const key = heading ?? "";
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(option);
    else groups.push({ key, heading, items: [option] });
  }
  return groups;
};

/**
 * Выпадающий список с поиском — ПОЛЕ ФОРМЫ (в отличие от app/ChipCombobox,
 * который рисует чип для строки инструментов). Единственный селект приложения.
 *
 * Меню уходит в слой radix, поэтому работает и внутри шторки, и внутри диалога:
 * прокрутка его не обрезает. Ширина меню равна ширине поля
 * (`--radix-popover-trigger-width`), поэтому длинные подписи не растягивают
 * шторку.
 */
const Combobox = ({
  id,
  value,
  options,
  onChange,
  placeholder = "Выберите значение",
  searchPlaceholder = "Найти…",
  emptyText = "Ничего не нашлось.",
  clearable = false,
  clearLabel = "Не выбрано",
  disabled = false,
  loading = false,
  loadingText = "Загружаем…",
  required = false,
  name,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string | null;
  options: ComboboxOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Добавляет в список пункт сброса. */
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
  /** Опции ещё едут с сервера: в меню строка ожидания вместо «ничего нет». */
  loading?: boolean;
  loadingText?: string;
  /** Нативная валидация формы — через скрытый спутник, см. RequiredMirror. */
  required?: boolean;
  /** Имя поля в FormData: рендерит скрытый input со значением. */
  name?: string;
  /** Подпись для скринридера, когда видимого лейбла у поля нет. */
  ariaLabel?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inOverlay = useInOverlay(triggerRef);
  const selected = options.find((option) => option.value === value) ?? null;

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inOverlay}>
      {/* relative — якорь для скрытого спутника required */}
      <div className="relative">
        {required && (
          <RequiredMirror
            value={value ?? ""}
            disabled={disabled}
            onFocus={() => triggerRef.current?.focus()}
          />
        )}
        {/* name — контракт FormData: сабмит страницы читает значение через
            formData.get(name) */}
        {name && <input type="hidden" name={name} value={value ?? ""} />}
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            disabled={disabled}
            // appearance/border/bg заданы явно: preflight выключен, браузерные
            // дефолты <button> никто не сбрасывает
            // Высота и радиус — как у ui/Input: комбобокс и текстовое поле стоят
            // в одном ряду формы, и разнобой 36/40 там виден
            className={cn(
              "flex h-10 w-full appearance-none items-center gap-2 rounded-lg",
              "border border-input bg-background px-3 text-left text-sm",
              "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
              className,
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !selected && "text-muted-foreground",
              )}
            >
              {selected ? selected.label : placeholder}
            </span>
            {loading ? (
              <RiLoader4Line
                className="flex-none animate-spin text-faint"
                size={16}
              />
            ) : (
              <RiArrowDownSLine className="flex-none text-faint" size={16} />
            )}
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{loading ? loadingText : emptyText}</CommandEmpty>
            {clearable && (
              <CommandGroup>
                <CommandItem value={clearLabel} onSelect={() => pick(null)}>
                  <span className="flex-1 text-muted-foreground">
                    {clearLabel}
                  </span>
                  {value === null && <RiCheckLine size={16} />}
                </CommandItem>
              </CommandGroup>
            )}
            {groupOptions(options).map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    // value — то, по чему ищет cmdk: подпись, а не id
                    value={`${option.label} ${option.hint ?? ""}`}
                    disabled={option.disabled}
                    onSelect={() => pick(option.value)}
                  >
                    {option.dot && (
                      <span
                        aria-hidden
                        className="size-2 flex-none rounded-full"
                        style={{ background: option.dot }}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {option.value === value && (
                      <RiCheckLine className="flex-none" size={16} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/**
 * Тот же список с поиском, но с МНОЖЕСТВЕННЫМ выбором — поле формы, не чип
 * (чип-фасет строки инструментов — `app/ChipMultiCombobox`). Выбранное живёт
 * токенами внутри поля, меню при выборе не закрывается: набирают обычно
 * несколько значений подряд.
 *
 * Триггер — `div` с `role="combobox"`, а не `button`: у токена своя кнопка
 * «убрать», а кнопка внутри кнопки невалидна. Клавиатуру поэтому открываем
 * руками (Enter/Space).
 */
export const MultiCombobox = ({
  id,
  value,
  options,
  onChange,
  placeholder = "Выберите значения",
  searchPlaceholder = "Найти…",
  emptyText = "Ничего не нашлось.",
  disabled = false,
  required = false,
  name,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string[];
  options: ComboboxOption[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Пустой набор не даст отправить форму — см. RequiredMirror. */
  required?: boolean;
  /** Имя поля в FormData: по скрытому input на каждое значение. */
  name?: string;
  /** Подпись для скринридера, когда видимого лейбла у поля нет. */
  ariaLabel?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inOverlay = useInOverlay(triggerRef);
  const selected = options.filter((option) => value.includes(option.value));

  const toggle = (next: string) =>
    onChange(
      value.includes(next)
        ? value.filter((item) => item !== next)
        : [...value, next],
    );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inOverlay}>
      {/* relative — якорь для скрытого спутника required */}
      <div className="relative">
        {required && (
          <RequiredMirror
            value={value.join(",")}
            disabled={disabled}
            onFocus={() => triggerRef.current?.focus()}
          />
        )}
        {/* По полю на значение — иначе formData.getAll(name) вернёт одну
            склеенную строку вместо списка id */}
        {name &&
          value.map((item) => (
            <input key={item} type="hidden" name={name} value={item} />
          ))}
        <PopoverTrigger asChild>
          <div
            ref={triggerRef}
            id={id}
            role="combobox"
            aria-label={ariaLabel}
            tabIndex={disabled ? -1 : 0}
            aria-expanded={open}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className={cn(
              "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg",
              "border border-input bg-background px-2 py-1 text-sm",
              "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              disabled && "cursor-not-allowed opacity-60",
              className,
            )}
          >
            {selected.map((option) => (
              <span
                key={option.value}
                className="inline-flex items-center gap-1 rounded-md border border-border-soft bg-secondary py-0.5 pr-1 pl-2 text-xs"
              >
                <span className="max-w-60 truncate">{option.label}</span>
                <button
                  type="button"
                  aria-label={`Убрать «${option.label}»`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(option.value);
                  }}
                  // appearance/bg/border/p-0 явно: preflight выключен
                  className="appearance-none rounded-sm border-0 bg-transparent p-0 text-faint hover:text-foreground"
                >
                  <RiCloseLine size={14} />
                </button>
              </span>
            ))}

            {selected.length === 0 && (
              <span className="flex-1 px-1 text-muted-foreground">
                {placeholder}
              </span>
            )}

            <RiArrowDownSLine
              className="ml-auto flex-none text-faint"
              size={16}
            />
          </div>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groupOptions(options).map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.hint ?? ""}`}
                    disabled={option.disabled}
                    onSelect={() => toggle(option.value)}
                  >
                    {option.dot && (
                      <span
                        aria-hidden
                        className="size-2 flex-none rounded-full"
                        style={{ background: option.dot }}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {value.includes(option.value) && (
                      <RiCheckLine className="flex-none" size={16} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default Combobox;
