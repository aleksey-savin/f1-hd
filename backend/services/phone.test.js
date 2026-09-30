// node --test services/phone.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePhoneInput,
  toCanonicalPhone,
  isValidPhone,
  formatPhone,
  phoneSearchDigits,
  phoneDigitsPattern,
} = require("./phone");

// Общая таблица с frontend/src/util/phone.test.js и tg-service/src/bot/phone.test.ts:
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

test("raw input becomes canonical digits and reads back in one format", () => {
  for (const [raw, canonical, shown] of CASES) {
    assert.equal(parsePhoneInput(raw), canonical, `parse ${raw}`);
    assert.equal(formatPhone(canonical), shown, `format ${canonical}`);
  }
});

test("stored digits are never reinterpreted", () => {
  // Одни цифры — уже канон: немецкий номер не превращается в российский
  assert.equal(toCanonicalPhone("4930901820"), "4930901820");
  assert.equal(toCanonicalPhone("79145550142"), "79145550142");
  assert.equal(toCanonicalPhone(" 79145550142 "), "79145550142");
  assert.equal(toCanonicalPhone("+7 (914) 555-01-42"), "79145550142");
  assert.equal(toCanonicalPhone("+4930901820"), "4930901820");
  assert.equal(toCanonicalPhone(""), "");
  assert.equal(toCanonicalPhone(null), null);
  assert.equal(toCanonicalPhone(undefined), undefined);
});

test("valid means +7 with 10 digits, or 8–15 digits of another country", () => {
  for (const value of ["79145550142", "375291234567", "4930901820", "12025550143"]) {
    assert.equal(isValidPhone(value), true, value);
  }
  for (const value of ["", "7", "7914555014", "791455501420", "2222999", "0123456789"]) {
    assert.equal(isValidPhone(value), false, value);
  }
});

test("formatting tolerates legacy text and empty values", () => {
  assert.equal(formatPhone("+7 914 555-01-42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone(null), "");
  assert.equal(formatPhone(undefined), "");
});

test("a query that looks like a number is searched by its digits", () => {
  assert.deepEqual(phoneSearchDigits("+7 (914) 555"), ["7914555"]);
  assert.deepEqual(phoneSearchDigits("8 914 555 01 42"), ["89145550142", "79145550142"]);
  assert.deepEqual(phoneSearchDigits("555-01-42"), ["5550142"]);
  assert.deepEqual(phoneSearchDigits("914"), ["914"]);
  assert.deepEqual(phoneSearchDigits("91"), []);
  assert.deepEqual(phoneSearchDigits("Соколова"), []);
  assert.deepEqual(phoneSearchDigits("Соколова 914"), []);
  assert.deepEqual(phoneSearchDigits(""), []);
});

test("the digits of a query are found through any separators", () => {
  // Новые строки хранят номер в показе, старые — «+цифрами»: находятся обе
  const pattern = phoneDigitsPattern("9142073318");
  assert.equal(pattern.test("+7 (914) 207-33-18"), true);
  assert.equal(pattern.test("+79142073318"), true);
  assert.equal(pattern.test("+7 (914) 207-33-19"), false);
});
