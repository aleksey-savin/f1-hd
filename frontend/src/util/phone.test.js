// node --test src/util/phone.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  editPhoneInput,
  formatPhone,
  isValidPhone,
  parsePhoneInput,
  pastePhoneInput,
  phoneHref,
  phoneInputError,
  phoneInputText,
  phoneMatches,
  phoneWireValue,
  toCanonicalPhone,
  typePhoneInput,
} from "./phone.ts";

// Общая таблица с backend/services/phone.test.js и tg-service/src/bot/phone.test.ts:
// [как набрали или лежало в базе, канон, показ]
const CASES = [
  ["+7 (914) 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+79145550142", "79145550142", "+7 (914) 555-01-42"],
  ["8 914 555 01 42", "79145550142", "+7 (914) 555-01-42"],
  ["89145550142", "79145550142", "+7 (914) 555-01-42"],
  ["9145550142", "79145550142", "+7 (914) 555-01-42"],
  ["+ 7 914 555-01-42", "79145550142", "+7 (914) 555-01-42"],
  ["+7 (423) 222-29-99", "74232222999", "+7 (423) 222-29-99"],
  ["8-800-555-35-35", "78005553535", "+7 (800) 555-35-35"],
  ["+7 701 234 56 78", "77012345678", "+7 (701) 234-56-78"],
  ["+375 29 123-45-67", "375291234567", "+375291234567"],
  ["00 49 30 901820", "4930901820", "+4930901820"],
  ["8 10 375 29 123 45 67", "375291234567", "+375291234567"],
  ["+7", "", ""],
  ["8", "", ""],
  ["телефон", "", ""],
  ["", "", ""],
  ["222-29-99", "2222999", "2222999"],
  ["+7 (914) 555-01-4", "7914555014", "7914555014"],
];

test("one format with the backend and the bot", () => {
  for (const [raw, canonical, shown] of CASES) {
    assert.equal(parsePhoneInput(raw), canonical, `parse ${raw}`);
    assert.equal(formatPhone(canonical), shown, `format ${canonical}`);
  }
  assert.equal(toCanonicalPhone("4930901820"), "4930901820");
  assert.equal(toCanonicalPhone(undefined), "");
});

test("links only for numbers that can be dialled", () => {
  assert.equal(phoneHref("79145550142"), "tel:+79145550142");
  assert.equal(phoneHref("375291234567"), "tel:+375291234567");
  assert.equal(phoneHref("2222999"), undefined);
  assert.equal(phoneHref(""), undefined);
});

test("typing without a plus is Russian, with a plus — as dialled", () => {
  assert.deepEqual(typePhoneInput("9"), { text: "+7 (9", wire: "+79" });
  assert.deepEqual(typePhoneInput("8"), { text: "+7", wire: "" });
  assert.deepEqual(typePhoneInput("+7 (914) 55"), { text: "+7 (914) 55", wire: "+791455" });
  assert.deepEqual(typePhoneInput("+7 (914) 555-01-420"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(typePhoneInput("+375291234567"), { text: "+375291234567", wire: "+375291234567" });
  assert.deepEqual(typePhoneInput("+"), { text: "+", wire: "" });
  assert.deepEqual(typePhoneInput(""), { text: "", wire: "" });
});

test("paste takes the whole number, in any common shape", () => {
  assert.deepEqual(pastePhoneInput("8 (914) 555-01-42"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(pastePhoneInput("Тел.: +7 914 555-01-42"), { text: "+7 (914) 555-01-42", wire: "+79145550142" });
  assert.deepEqual(pastePhoneInput("375 29 123 45 67"), { text: "+375291234567", wire: "+375291234567" });
  assert.deepEqual(pastePhoneInput("222-29-99"), { text: "2222999", wire: "2222999" });
  assert.deepEqual(pastePhoneInput("телефон"), { text: "", wire: "" });
});

test("the caret stays after the same digit", () => {
  // Первая цифра в пустое поле: перед ней встала 7
  assert.deepEqual(editPhoneInput("", "9", 1), { text: "+7 (9", wire: "+79", caret: 5 });
  // Цифра, дописанная в середину
  assert.deepEqual(editPhoneInput("+7 (914) 555", "+7 (9140) 555", 8), {
    text: "+7 (914) 055-5",
    wire: "+79140555",
    caret: 10,
  });
  // Стёрли «)» — стирается цифра перед ней
  assert.deepEqual(editPhoneInput("+7 (914) 5", "+7 (914 5", 7, "deleteContentBackward"), {
    text: "+7 (915",
    wire: "+7915",
    caret: 6,
  });
});

test("errors: incomplete, too short, no area code", () => {
  assert.equal(phoneInputError(""), null);
  assert.equal(phoneInputError("+79145550142"), null);
  assert.equal(phoneInputError("+7914555014"), "Номер неполный: нужно 11 цифр");
  assert.equal(phoneInputError("+37529"), "Номер слишком короткий");
  assert.equal(phoneInputError("+375291234567"), null);
  assert.equal(phoneInputError("2222999"), "Укажите номер с кодом города");
});

test("stored values open in the field as they will be sent back", () => {
  assert.equal(phoneInputText("79145550142"), "+7 (914) 555-01-42");
  assert.equal(phoneWireValue("79145550142"), "+79145550142");
  assert.equal(phoneInputText("4930901820"), "+4930901820");
  assert.equal(phoneWireValue("4930901820"), "+4930901820");
  // Из старых данных, без кода города: как лежит — и сразу с ошибкой
  assert.equal(phoneInputText("2222999"), "2222999");
  assert.equal(phoneWireValue("2222999"), "2222999");
  // Значение формы («+цифры») открывается так же
  assert.equal(phoneInputText("+79145550142"), "+7 (914) 555-01-42");
  assert.equal(phoneWireValue(""), "");
  assert.equal(phoneWireValue("+7"), "");
});

test("search finds a number however it was typed", () => {
  const phones = ["79145550142", "74232222999"];
  assert.equal(phoneMatches("914 555", phones), true);
  assert.equal(phoneMatches("+7 (914)", phones), true);
  assert.equal(phoneMatches("8 914", phones), true);
  assert.equal(phoneMatches("222-29-99", phones), true);
  assert.equal(phoneMatches("Соколова", phones), false);
  assert.equal(phoneMatches("91", phones), false);
  assert.equal(phoneMatches("914", [undefined, ""]), false);
});

test("a lone plus keeps the caret after it, so a foreign number can be typed", () => {
  assert.deepEqual(editPhoneInput("", "+", 1), { text: "+", wire: "", caret: 1 });
  assert.deepEqual(editPhoneInput("+", "+3", 2), { text: "+3", wire: "+3", caret: 2 });
  assert.deepEqual(editPhoneInput("+7", "+", 1, "deleteContentBackward"), { text: "+", wire: "", caret: 1 });
});

test("Delete removes the digit after a separator", () => {
  assert.deepEqual(
    editPhoneInput("+7 (914) 555-01-42", "+7 (914 555-01-42", 7, "deleteContentForward"),
    { text: "+7 (914) 550-14-2", wire: "+7914550142", caret: 7 },
  );
});

test("Backspace on a separator never erases the country code", () => {
  assert.deepEqual(
    editPhoneInput("+7 (914) 555-01-42", "+7 914) 555-01-42", 3, "deleteContentBackward"),
    { text: "+7 (914) 555-01-42", wire: "+79145550142", caret: 2 },
  );
});

test("a label before a pasted foreign number keeps its plus", () => {
  assert.deepEqual(pastePhoneInput("Тел.: +49 30 901820"), { text: "+4930901820", wire: "+4930901820" });
});

test("isValidPhone tolerates a missing value", () => {
  assert.equal(isValidPhone(undefined), false);
  assert.equal(isValidPhone(null), false);
});

test("Delete before the plus changes nothing", () => {
  assert.deepEqual(
    editPhoneInput("+7 (701) 234-56-78", "7 (701) 234-56-78", 0, "deleteContentForward"),
    { text: "+7 (701) 234-56-78", wire: "+77012345678", caret: 1 },
  );
});

test("deleting the plus of a foreign number keeps it foreign", () => {
  assert.deepEqual(
    editPhoneInput("+375291234567", "375291234567", 0, "deleteContentBackward"),
    { text: "+375291234567", wire: "+375291234567", caret: 1 },
  );
});

test("after the country code is erased the caret stays after the plus", () => {
  assert.deepEqual(
    editPhoneInput("+7 (914) 555-01-42", "+ (914) 555-01-42", 1, "deleteContentBackward"),
    { text: "+9145550142", wire: "+9145550142", caret: 1 },
  );
});

test("a lone plus can be erased", () => {
  assert.deepEqual(editPhoneInput("+", "", 0, "deleteContentBackward"), { text: "", wire: "", caret: 0 });
  assert.deepEqual(editPhoneInput("+", "", 0, "deleteContentForward"), { text: "", wire: "", caret: 0 });
});

test("cutting the plus of a foreign number keeps it foreign", () => {
  assert.deepEqual(
    editPhoneInput("+375291234567", "375291234567", 0, "deleteByCut"),
    { text: "+375291234567", wire: "+375291234567", caret: 1 },
  );
});
