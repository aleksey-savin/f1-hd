/**
 * Телефон в базе — только цифры с кодом страны: «79145550142», «375291234567»
 * (E.164 без плюса). Здесь всё, что превращает ввод человека в эту форму и
 * обратно — в «+7 (914) 555-01-42». Копии правила: frontend/src/util/phone.ts
 * (поле ввода, показ, поиск) и tg-service/src/bot/phone.ts (карточка бота);
 * таблица примеров в тестах у всех трёх общая. Устройство: docs/phone-numbers.md.
 */

const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * Сырой ввод человека → канон. Без «+» номер считается российским: ведущая 8 у
 * ровно 11 цифр — выход на межгород, ровно 10 цифр — номер без кода страны. «+»
 * и «00» значат, что код страны уже набран, «810» — тоже, если цифр больше 11.
 * «+7» без номера (след старой маски) и слова вместо цифр дают пустую строку.
 */
const parsePhoneInput = (raw) => {
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
    if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
    else if (digits.length === 10) digits = `7${digits}`;
  }
  return digits === "7" || digits === "8" ? "" : digits;
};

/**
 * Значение для записи (сеттер Mongoose на всех полях телефона): одни цифры —
 * уже канон и остаются как есть, иначе немецкий «4930901820» при копировании
 * в снимок стал бы «74930901820»; всё с разделителями или плюсом — сырой ввод,
 * его разбирает parsePhoneInput. null и undefined не трогаем.
 */
const toCanonicalPhone = (value) => {
  if (value == null) return value;
  const text = String(value).trim();
  return /^\d*$/.test(text) ? text : parsePhoneInput(text);
};

/** Годный канон: +7 — ровно 11 цифр; другие страны — 8–15, код страны не с 0. */
const isValidPhone = (value) => {
  const digits = String(value ?? "");
  if (digits.startsWith("7")) return /^7\d{10}$/.test(digits);
  return /^[1-9]\d{7,14}$/.test(digits);
};

/**
 * Показ в текстах сервера (письма, заголовки «Диалогов»): «+7 (914) 555-01-42»,
 * другие страны — «+375291234567», негодное — как лежит.
 */
const formatPhone = (value) => {
  const digits = toCanonicalPhone(value ?? "");
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return isValidPhone(digits) ? `+${digits}` : digits;
};

/**
 * Запрос, похожий на номер целиком («+7 (914) 555», «8 914 555 01 42»,
 * «555-01-42»), → цифры для поиска подстрокой по канону; с ведущей 8 без плюса
 * — ещё и вариант с 7. Не номер или меньше трёх цифр — пустой список.
 */
const phoneSearchDigits = (query) => {
  const text = String(query ?? "").trim();
  if (!/^[+\d\s().-]+$/.test(text)) return [];
  const digits = digitsOf(text);
  if (digits.length < 3) return [];
  const variants = [digits];
  if (!text.startsWith("+") && digits[0] === "8") variants.push(`7${digits.slice(1)}`);
  return variants;
};

/**
 * Цифры из phoneSearchDigits → регулярка, которая находит их через любые
 * разделители: «9142073318» — и в «+7 (914) 207-33-18», и в «+79142073318».
 * Катастрофического перебора нет: цифра и \D — непересекающиеся классы.
 */
const phoneDigitsPattern = (digits) => new RegExp(digits.split("").join("\\D*"));

module.exports = {
  digitsOf,
  parsePhoneInput,
  toCanonicalPhone,
  isValidPhone,
  formatPhone,
  phoneSearchDigits,
  phoneDigitsPattern,
};
