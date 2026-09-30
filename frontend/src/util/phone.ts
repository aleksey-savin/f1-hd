/**
 * Телефоны на экране и в поле ввода. В базе телефон — только цифры с кодом
 * страны («79145550142», «375291234567»); здесь — показ («+7 (914) 555-01-42»),
 * ссылка «позвонить», разбор набранного и вставленного, поиск по цифрам.
 * Копии правила: backend/services/phone.js (запись, письма) и
 * tg-service/src/bot/phone.ts (бот); таблица примеров в тестах у всех трёх
 * общая. Тесты рядом: `node --test src/util/phone.test.js`.
 */

export const digitsOf = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

/** Сырой ввод → цифры с кодом страны; правило то же, что у бэкенда. */
export const parsePhoneInput = (raw: unknown): string => {
  const text = String(raw ?? "").trim();
  let digits = digitsOf(text);
  if (!digits) return "";
  let international = text.startsWith("+");
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  } else if (!international && digits.startsWith("810") && digits.length > 11) {
    digits = digits.slice(3);
    international = true;
  }
  if (!international) {
    if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
  }
  return digits === "7" || digits === "8" ? "" : digits;
};

/** Значение из базы (одни цифры) — как есть; с разделителями — разбором. */
export const toCanonicalPhone = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return /^\d*$/.test(text) ? text : parsePhoneInput(text);
};

/** Годный номер: +7 и 10 цифр или 8–15 цифр другой страны. */
export const isValidPhone = (digits: string): boolean => {
  const value = String(digits ?? "");
  return value.startsWith("7") ? /^7\d{10}$/.test(value) : /^[1-9]\d{7,14}$/.test(value);
};

// «+7 (914) 555-01-42» по мере набора: digits начинаются с 7, их от 1 до 11
const maskRu = (digits: string): string => {
  const rest = digits.slice(1);
  if (!rest) return "+7";
  let text = `+7 (${rest.slice(0, 3)}`;
  if (rest.length > 3) text += `) ${rest.slice(3, 6)}`;
  if (rest.length > 6) text += `-${rest.slice(6, 8)}`;
  if (rest.length > 8) text += `-${rest.slice(8, 10)}`;
  return text;
};

/** Показ: «+7 (914) 555-01-42», другая страна — «+375291234567», негодное — как есть. */
export const formatPhone = (value: unknown): string => {
  const digits = toCanonicalPhone(value);
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) return maskRu(digits);
  return isValidPhone(digits) ? `+${digits}` : digits;
};

/** Ссылка «позвонить»; у номера, который не набрать, её нет. */
export const phoneHref = (value: unknown): string | undefined => {
  const digits = toCanonicalPhone(value);
  return digits && isValidPhone(digits) ? `tel:+${digits}` : undefined;
};

export type PhoneTyped = { text: string; wire: string };
export type PhoneEdit = PhoneTyped & { caret: number };

/**
 * Поле по мере набора: текст в поле и значение формы («+цифры»). Без плюса номер
 * российский — 8 и 7 впереди значат межгород и код страны, любая другая цифра —
 * начало номера без кода; после «+» — как набрали, до 15 цифр.
 */
export const typePhoneInput = (raw: string): PhoneTyped => {
  const international = raw.trimStart().startsWith("+");
  let digits = digitsOf(raw);
  if (!international) {
    if (!digits) return { text: "", wire: "" };
    digits = digits.startsWith("7") || digits.startsWith("8") ? `7${digits.slice(1)}` : `7${digits}`;
  }
  if (!digits) return { text: "+", wire: "" };
  if (digits.startsWith("7")) {
    digits = digits.slice(0, 11);
    // Один код страны — ещё не номер: форма получает пусто
    return { text: maskRu(digits), wire: digits.length > 1 ? `+${digits}` : "" };
  }
  digits = digits.slice(0, 15);
  return { text: `+${digits}`, wire: `+${digits}` };
};

/**
 * Вставка разбирается целиком, как у бэкенда: 12+ цифр без плюса — номер другой
 * страны. Номер без кода остаётся цифрами без плюса — поле скажет «Укажите
 * номер с кодом города».
 */
export const pastePhoneInput = (pasted: string): PhoneTyped => {
  // Подпись перед номером («Тел.: +49 …») не должна съесть плюс: разбираем с первого «+» или цифры
  const start = pasted.search(/[+\d]/);
  const text = start > 0 ? pasted.slice(start) : pasted;
  const digits = parsePhoneInput(text);
  if (!digits) return { text: "", wire: "" };
  if (isValidPhone(digits) || text.trim().startsWith("+")) {
    return typePhoneInput(`+${digits}`);
  }
  return { text: digits, wire: digits };
};

/** Позиция в тексте сразу после count-й цифры. */
export const caretAfterDigits = (text: string, count: number): number => {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/\d/.test(text.charAt(index))) continue;
    seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
};

/**
 * Правка в поле: новый текст, значение формы и место каретки — после той же
 * цифры, что до переформатирования. Удаление не-цифры (разделитель или плюс)
 * сохраняет плюс, какой был, пока в поле есть цифры; иначе номер другой страны
 * прочитался бы российским; стирается цифра рядом, как ждёт человек. Delete перед
 * плюсом ничего не делает. Код страны Backspace не стирает. Каретка никогда не встаёт перед плюсом.
 */
export const editPhoneInput = (previous: string, raw: string, caret: number, inputType = ""): PhoneEdit => {
  let source = raw;
  let digitsBefore = digitsOf(raw.slice(0, caret)).length;
  const digits = digitsOf(raw);
  const deleting = inputType.startsWith("delete");
  // Стёрли не цифру, а разделитель или плюс: цифр столько же. Плюс, какой был, остаётся —
  // иначе номер другой страны прочитался бы российским; стирается цифра рядом, как ждёт человек
  if (deleting && digits === digitsOf(previous)) {
    const plus = digits && previous.trimStart().startsWith("+") ? "+" : "";
    let kept = digits;
    // Код страны Backspace с разделителя не стирает: иначе номер молча стал бы чужим
    if (inputType === "deleteContentBackward" && digitsBefore > 1) {
      kept = `${digits.slice(0, digitsBefore - 1)}${digits.slice(digitsBefore)}`;
      digitsBefore -= 1;
    } else if (inputType === "deleteContentForward" && digitsBefore > 0 && digitsBefore < digits.length) {
      kept = `${digits.slice(0, digitsBefore)}${digits.slice(digitsBefore + 1)}`;
    }
    source = `${plus}${kept}`;
  }
  const next = typePhoneInput(source);
  // Без плюса перед номером встаёт 7 — каретка сдвигается на эту цифру
  const first = digitsOf(source).charAt(0);
  if (!source.trimStart().startsWith("+") && first && first !== "7" && first !== "8") {
    digitsBefore += 1;
  }
  // Каретка — после той же цифры; без цифр перед ней — сразу за плюсом, а если цифр нет вовсе — в конце
  const position = !digitsOf(next.text)
    ? next.text.length
    : digitsBefore > 0
      ? caretAfterDigits(next.text, digitsBefore)
      : next.text.startsWith("+")
        ? 1
        : 0;
  return { ...next, caret: position };
};

/** Текст поля для значения из базы или формы: канон, «+цифры» или старые цифры. */
export const phoneInputText = (value: unknown): string => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.startsWith("+")) return typePhoneInput(text).text;
  const digits = toCanonicalPhone(text);
  // Негодное из старых данных (без кода города) показываем как лежит
  return isValidPhone(digits) ? typePhoneInput(`+${digits}`).text : digits;
};

/** Значение формы для того же: «+цифры»; старые цифры без кода — как лежат. */
export const phoneWireValue = (value: unknown): string => {
  const text = phoneInputText(value);
  if (!text.startsWith("+")) return text;
  const digits = digitsOf(text);
  return digits.length > 1 ? `+${digits}` : "";
};

/** Ошибка под полем для значения формы; пустое — не ошибка. */
export const phoneInputError = (wire: string): string | null => {
  if (!wire) return null;
  if (!wire.startsWith("+")) return "Укажите номер с кодом города";
  const digits = digitsOf(wire);
  if (digits.startsWith("7")) {
    return digits.length === 11 ? null : "Номер неполный: нужно 11 цифр";
  }
  return digits.length >= 8 ? null : "Номер слишком короткий";
};

/**
 * Похож ли запрос на номер (цифры, пробелы, «+()-.», хотя бы три цифры) и какие
 * цифры искать: с ведущей 8 без плюса — ещё и вариант с 7.
 */
export const phoneSearchDigits = (query: string): string[] => {
  const text = String(query ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(text)) return [];
  const digits = digitsOf(text);
  if (digits.length < 3) return [];
  const variants = [digits];
  if (!text.startsWith("+") && digits.startsWith("8")) variants.push(`7${digits.slice(1)}`);
  return variants;
};

/** Нашёлся ли номер из запроса среди телефонов записи (по цифрам, подстрокой). */
export const phoneMatches = (query: string, phones: unknown[]): boolean => {
  const variants = phoneSearchDigits(query);
  if (!variants.length) return false;
  return phones.some((phone) => {
    const digits = toCanonicalPhone(phone);
    return Boolean(digits) && variants.some((variant) => digits.includes(variant));
  });
};
