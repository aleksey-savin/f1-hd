/**
 * Телефон приходит из бэкенда каноном — цифрами с кодом страны
 * («79145550142»). Показ — по правилу бэкенда (backend/services/phone.js) и веба
 * (frontend/src/util/phone.ts), таблица примеров в тестах общая:
 * «+7 (914) 555-01-42», номер другой страны — «+375291234567», негодный — как
 * лежит.
 */

const digitsOf = (value: string): string => value.replace(/\D/g, "");

// Разбор сырого текста — на случай значения со старой маской; из бэкенда
// приходит уже канон
const parsePhoneInput = (raw: string): string => {
  const text = raw.trim();
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

const isValidPhone = (digits: string): boolean =>
  digits.startsWith("7") ? /^7\d{10}$/.test(digits) : /^[1-9]\d{7,14}$/.test(digits);

export const formatPhone = (value: string | null | undefined): string => {
  const text = String(value ?? "").trim();
  const digits = /^\d*$/.test(text) ? text : parsePhoneInput(text);
  if (!digits) return "";
  if (/^7\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return isValidPhone(digits) ? `+${digits}` : digits;
};
