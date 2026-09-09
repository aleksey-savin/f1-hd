const { randomUUID } = require("node:crypto");

const { htmlToPlainText } = require("../helpers/htmlToPlainText");

/**
 * Анкета шаблона заявки — чистая логика без моделей: что такое вопрос,
 * что считается ответом, как ответы проверяются против шаблона и как из них
 * собирается описание заявки, когда шаблон его скрыл.
 *
 * Одна и та же форма вопроса лежит и в шаблоне (определение), и в заявке
 * (снимок определения + `value`): шаблон правят после того, как заявки уже
 * созданы, а карточке нужно показать вопрос так, как его задали.
 *
 * Ответы хранятся по типу: строка у `text`/`select`, массив строк у
 * `multiselect`, `true`/`false`/`null` у `boolean`, конечное число или `null`
 * у `number`, ключ дня «ГГГГ-ММ-ДД» у `date` (календарная дата без пояса —
 * как у `app/DateField`, см. docs/datetime-conventions.md).
 */

const FIELD_TYPES = Object.freeze([
  "text",
  "select",
  "multiselect",
  "boolean",
  "number",
  "date",
]);

const DESCRIPTION_MODES = Object.freeze(["required", "optional", "hidden"]);

const CHOICE_TYPES = new Set(["select", "multiselect"]);

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const genFieldKey = () => randomUUID();

const hasOptions = (type) => CHOICE_TYPES.has(type);

const trimString = (value) => (value == null ? "" : String(value).trim());

/** Пустой ответ данного типа — то, с чего вопрос начинается в форме. */
const emptyAnswer = (type) => {
  if (type === "multiselect") return [];
  if (type === "boolean" || type === "number" || type === "date") return null;
  return "";
};

/** Есть ли ответ: пробелы, пустой массив, `null` и NaN ответом не считаются. */
const hasAnswer = (type, value) => {
  switch (type) {
    case "multiselect":
      return Array.isArray(value) && value.length > 0;
    case "boolean":
      return value === true || value === false;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return typeof value === "string" && value.trim() !== "";
    default:
      return trimString(value) !== "";
  }
};

const isCalendarDay = (dayKey) => {
  const match = DAY_KEY.exec(dayKey);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * Привести сырой ответ к хранимому виду по определению вопроса.
 * Непригодный ответ не выбрасывается, а превращается в пустой с ошибкой —
 * так один вопрос даёт одну ошибку, а не «неверно» и «не заполнено» разом.
 *
 * @returns {{ value: unknown, error?: string }}
 */
const normalizeAnswer = (definition, raw) => {
  const type = definition.type;
  const options = definition.options ?? [];

  switch (type) {
    case "select": {
      const value = trimString(raw);
      if (value && options.length && !options.includes(value)) {
        return { value: "", error: `Вариант «${value}» не из списка` };
      }
      return { value };
    }
    case "multiselect": {
      const picked = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
        .map(trimString)
        .filter(Boolean);
      const unknown = picked.filter((item) => !options.includes(item));
      // Порядок — как в шаблоне: так ответ читается одинаково в карточке,
      // в письме и в форме независимо от того, в каком порядке кликали
      const value = options.filter((option) => picked.includes(option));
      if (unknown.length) {
        return { value, error: `Вариант «${unknown[0]}» не из списка` };
      }
      return { value };
    }
    case "boolean": {
      if (raw === true || raw === "true") return { value: true };
      if (raw === false || raw === "false") return { value: false };
      if (raw == null || raw === "") return { value: null };
      return { value: null, error: "Выберите «Да» или «Нет»" };
    }
    case "number": {
      if (typeof raw === "number") {
        return Number.isFinite(raw)
          ? { value: raw }
          : { value: null, error: "Укажите число" };
      }
      const text = trimString(raw).replace(",", ".");
      if (text === "") return { value: null };
      const value = Number(text);
      return Number.isFinite(value)
        ? { value }
        : { value: null, error: "Укажите число" };
    }
    case "date": {
      const text = trimString(raw);
      if (text === "") return { value: null };
      return isCalendarDay(text)
        ? { value: text }
        : { value: null, error: "Укажите дату в формате ГГГГ-ММ-ДД" };
    }
    default:
      return { value: trimString(raw) };
  }
};

/**
 * Определения вопросов из формы шаблона → хранимый вид.
 * Строки без названия отбрасываются молча (пустая строка конструктора —
 * не ошибка, а недописанное), неизвестный тип становится текстом, ключ
 * выдаётся один раз и дальше живёт с вопросом через переименования.
 *
 * @returns {{ fields: object[], errors: { index: number, message: string }[] }}
 */
const normalizeTemplateFields = (raw) => {
  const fields = [];
  const errors = [];
  if (!Array.isArray(raw)) return { fields, errors };

  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const name = trimString(item.name);
    if (!name) return;

    const type = FIELD_TYPES.includes(item.type) ? item.type : "text";
    const options = hasOptions(type)
      ? [...new Set((item.options ?? []).map(trimString).filter(Boolean))]
      : [];
    if (hasOptions(type) && options.length === 0) {
      errors.push({ index, message: `У вопроса «${name}» нет вариантов` });
    }

    const definition = {
      key: trimString(item.key) || genFieldKey(),
      name,
      type,
      options,
      required: !!item.required,
      hint: trimString(item.hint),
    };
    // Слот ответа по умолчанию: непригодное значение не ошибка шаблона,
    // а просто пустой ответ
    const { value } = normalizeAnswer(definition, item.value);
    fields.push({
      ...definition,
      value: hasAnswer(type, value) ? value : emptyAnswer(type),
    });
  });

  return { fields, errors };
};

/**
 * Ответы из формы против определений шаблона → снимок полей заявки.
 * Порядок — шаблона; лишние ответы отбрасываются; совпадение по `key`,
 * у шаблонов без ключей (заведены до их появления) — по названию.
 *
 * @returns {{ customFields: object[], errors: { key?: string, name: string, message: string }[] }}
 */
const collectAnswers = ({ definitions = [], submitted = [] }) => {
  const answers = Array.isArray(submitted) ? submitted.filter(Boolean) : [];
  const customFields = [];
  const errors = [];

  for (const definition of definitions) {
    const found =
      (definition.key &&
        answers.find((answer) => answer.key === definition.key)) ||
      answers.find((answer) => !answer.key && answer.name === definition.name) ||
      answers.find((answer) => answer.name === definition.name);

    const { value, error } = found
      ? normalizeAnswer(definition, found.value)
      : { value: emptyAnswer(definition.type) };

    const report = (message) =>
      errors.push({ key: definition.key, name: definition.name, message });

    if (error) report(error);
    else if (definition.required && !hasAnswer(definition.type, value)) {
      report(`Ответьте на вопрос «${definition.name}»`);
    }

    customFields.push({
      key: definition.key,
      name: definition.name,
      type: definition.type,
      options: definition.options ?? [],
      required: !!definition.required,
      hint: definition.hint ?? "",
      value,
    });
  }

  return { customFields, errors };
};

/** Ответ словами — для описания, письма и подсказки ИИ. Нет ответа — пусто. */
const formatAnswer = (field) => {
  const { type, value } = field;
  if (!hasAnswer(type, value)) return "";
  switch (type) {
    case "boolean":
      return value ? "Да" : "Нет";
    case "date": {
      const match = DAY_KEY.exec(value);
      return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
    }
    case "multiselect":
      return value.join(", ");
    case "number":
      return String(value);
    default:
      return trimString(value);
  }
};

// Своя, а не из services/telegramMessage: та тянет модели, а описание
// уходит в письмо как есть — экранировать обязаны здесь
const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Описание заявки из ответов — когда шаблон описание скрыл. Абзац на
 * вопрос, только `<p>`/`<strong>`: строка уходит в письмо без очистки и на
 * карточку через DOMPurify.
 */
const composeDescription = (fields = []) =>
  fields
    .filter((field) => hasAnswer(field.type, field.value))
    .map(
      (field) =>
        `<p><strong>${escapeHtml(field.name)}:</strong> ${escapeHtml(formatAnswer(field))}</p>`,
    )
    .join("");

// Серверная пара к htmlIsEmpty формы: пустой документ редактора —
// «<p><br></p>», и проверка на пустую строку его бы пропустила
const descriptionIsEmpty = (html) => htmlToPlainText(html) === "";

module.exports = {
  FIELD_TYPES,
  DESCRIPTION_MODES,
  genFieldKey,
  hasOptions,
  emptyAnswer,
  hasAnswer,
  normalizeAnswer,
  normalizeTemplateFields,
  collectAnswers,
  formatAnswer,
  composeDescription,
  descriptionIsEmpty,
};
