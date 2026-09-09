/**
 * Словарь анкеты шаблона заявки — клиентская пара к
 * backend/services/ticketQuestionnaire: типы вопросов, пустой ответ и признак
 * ответа по типу, подпись ответа словами. Зависимостей нет нарочно: модуль
 * читают конструктор, форма, карточка и тест на node:test.
 *
 * Хранимый вид ответа по типу — строка у text/select, массив строк у
 * multiselect, true/false/null у boolean, число или null у number (в форме,
 * пока печатают, — сырая строка), ключ дня «ГГГГ-ММ-ДД» у date.
 */

export const FIELD_TYPES = [
  "text",
  "select",
  "multiselect",
  "boolean",
  "number",
  "date",
] as const;

export type CustomFieldType = (typeof FIELD_TYPES)[number];

export type CustomFieldDef = {
  /** Постоянный ключ вопроса (выдаёт сервер); ответы сверяются по нему. */
  key?: string;
  name?: string;
  type?: string;
  options?: string[];
  required?: boolean;
  hint?: string;
  value?: unknown;
};

export const TYPE_OPTIONS = [
  { value: "text", label: "Текст" },
  { value: "select", label: "Один из вариантов" },
  { value: "multiselect", label: "Несколько вариантов" },
  { value: "boolean", label: "Да / Нет" },
  { value: "number", label: "Число" },
  { value: "date", label: "Дата" },
] as const;

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

export type DescriptionMode = "required" | "optional" | "hidden";

export const DESCRIPTION_MODE_OPTIONS = [
  { value: "required", label: "Обязательно" },
  { value: "optional", label: "Необязательно" },
  { value: "hidden", label: "Скрыто" },
] as const;

export const DESCRIPTION_MODE_LABEL: Record<string, string> = Object.fromEntries(
  DESCRIPTION_MODE_OPTIONS.map((option) => [option.value, option.label]),
);

/**
 * До скольких вариантов вопрос показывает их все сразу (app/ChoiceGroup);
 * дальше — app/Combobox: шесть строк по 44 px ещё умещаются на экран телефона.
 */
export const INLINE_CHOICE_MAX = 6;

export const hasOptions = (type?: string) =>
  type === "select" || type === "multiselect";

export const inlineChoices = (field: CustomFieldDef) =>
  hasOptions(field.type) &&
  (field.options ?? []).length <= INLINE_CHOICE_MAX;

const trimString = (value: unknown) =>
  value == null ? "" : String(value).trim();

/** Пустой ответ данного типа — с него вопрос начинается в форме. */
export const emptyAnswer = (type?: string): unknown => {
  if (type === "multiselect") return [];
  if (type === "boolean" || type === "number" || type === "date") return null;
  return "";
};

/** Есть ли ответ: пробелы, пустой массив, null и не-число ответом не считаются. */
export const hasAnswer = (type: string | undefined, value: unknown): boolean => {
  switch (type) {
    case "multiselect":
      return Array.isArray(value) && value.length > 0;
    case "boolean":
      return value === true || value === false;
    case "number": {
      if (typeof value === "number") return Number.isFinite(value);
      const text = trimString(value).replace(",", ".");
      return text !== "" && Number.isFinite(Number(text));
    }
    default:
      return trimString(value) !== "";
  }
};

/** Что не так с обязательным вопросом без ответа — словами контрола. */
export const answerError = (field: CustomFieldDef): string => {
  switch (field.type) {
    case "select":
      return "Выберите вариант";
    case "multiselect":
      return "Выберите хотя бы один вариант";
    case "boolean":
      return "Выберите «Да» или «Нет»";
    case "number":
      return "Укажите число";
    case "date":
      return "Выберите дату";
    default:
      return "Заполните поле";
  }
};

/** Ключ ошибки вопроса в `errors` формы: по ключу, у старых шаблонов — по названию. */
export const errorKeyOf = (field: CustomFieldDef) =>
  `field:${field.key ?? field.name ?? ""}`;

/**
 * Положить сохранённые ответы на ТЕКУЩИЙ состав вопросов — клиентская пара к
 * серверному `collectAnswers`. Сверка по постоянному ключу, у записей без него
 * (черновики и заявки до появления ключей) — по названию.
 *
 * Состав берётся из шаблона, а не из сохранённого: пока черновик лежал, вопрос
 * могли переименовать, добавить или убрать, и возвращаться должны ответы, а не
 * устаревший набор вопросов. Пустой ответ не затирает значение по умолчанию.
 */
export const applySavedAnswers = (
  definitions: CustomFieldDef[],
  saved: CustomFieldDef[] = [],
): CustomFieldDef[] =>
  definitions.map((field) => {
    const found =
      (field.key && saved.find((item) => item?.key === field.key)) ||
      saved.find((item) => item && !item.key && item.name === field.name) ||
      saved.find((item) => item?.name === field.name);
    return found && hasAnswer(field.type, found.value)
      ? { ...field, value: found.value }
      : field;
  });

// «04.09.2026» из ключа дня — как util/format-date.formatDayKey, но без
// его зависимостей: строка уже является днём, переводить её в зону нельзя
const formatDayKey = (key: string) => {
  const [year, month, day] = key.split("-");
  return year && month && day ? `${day}.${month}.${year}` : key;
};

/** Ответ словами — на карточке и в сводках. Нет ответа — пусто. */
export const formatAnswer = (field: CustomFieldDef): string => {
  const { type, value } = field;
  if (!hasAnswer(type, value)) return "";
  switch (type) {
    case "boolean":
      return value ? "Да" : "Нет";
    case "date":
      return formatDayKey(String(value));
    case "multiselect":
      return (value as string[]).join(", ");
    case "number":
      return String(value).trim();
    default:
      return trimString(value);
  }
};
