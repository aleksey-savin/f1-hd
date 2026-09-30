// node --test src/bot/phone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPhone } from "./phone.ts";

// Общая таблица с backend/services/phone.test.js и frontend/src/util/phone.test.js:
// [как набрали или лежало в базе, канон, показ]
const CASES: [string, string, string][] = [
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

test("the bot shows a stored number the way the web does", () => {
  for (const [, canonical, shown] of CASES) {
    assert.equal(formatPhone(canonical), shown, canonical);
  }
});

test("a legacy value with a mask still reads right; nothing gives empty", () => {
  assert.equal(formatPhone("+7 (914) 555-01-42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone("8 914 555 01 42"), "+7 (914) 555-01-42");
  assert.equal(formatPhone(undefined), "");
  assert.equal(formatPhone(null), "");
});
