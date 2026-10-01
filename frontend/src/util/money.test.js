// node --test src/util/money.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatMoneyExact, moneyInputValue, parseMoney } from "./money.js";

test("копейки вводятся и через запятую, и через точку", () => {
  assert.equal(parseMoney("1250,5"), 1250.5);
  assert.equal(parseMoney("1250.5"), 1250.5);
  assert.equal(parseMoney("1250,50"), 1250.5);
});

test("пробелы-разделители разрядов не мешают разбору", () => {
  assert.equal(parseMoney("1 250,50"), 1250.5);
  // Неразрывный и узкий неразрывный — так число приходит из toLocaleString
  assert.equal(parseMoney("1\u00a0250,50"), 1250.5);
  assert.equal(parseMoney("12\u202f500"), 12500);
});

test("сумма хранится не точнее копейки", () => {
  assert.equal(parseMoney("1041,666"), 1041.67);
  assert.equal(parseMoney(0.1 + 0.2), 0.3);
});

test("пустое и нечисловое значение — ноль, отрицательных цен нет", () => {
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney("абв"), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney(undefined), 0);
  assert.equal(parseMoney("-500"), 0);
});

test("число из базы проходит как есть", () => {
  assert.equal(parseMoney(1250.5), 1250.5);
  assert.equal(parseMoney(1000), 1000);
});

test("в поле сумма стоит с разрядами; копейки — только когда они есть", () => {
  assert.equal(moneyInputValue(1250.5), "1 250,50");
  assert.equal(moneyInputValue(1000), "1 000");
  assert.equal(moneyInputValue(958.5), "958,50");
  assert.equal(moneyInputValue(0), "0");
});

test("значение поля — обычные пробелы: неразрывный в поле ввода не стереть", () => {
  assert.equal(/[\u00a0\u202f]/.test(moneyInputValue(1250000.5)), false);
  assert.equal(moneyInputValue(1250000.5), "1 250 000,50");
});

test("введённое и показанное совпадают: поле не меняет сумму само", () => {
  for (const value of [0, 1, 958.5, 1041.67, 12500.04, 1250000.5]) {
    assert.equal(parseMoney(moneyInputValue(value)), value);
  }
});

test("сумма для показа: рубли без «,00», копейки двумя знаками", () => {
  assert.equal(formatMoneyExact(1250.5), "1\u00a0250,50\u00a0₽");
  assert.equal(formatMoneyExact(120000), "120\u00a0000\u00a0₽");
  assert.equal(formatMoneyExact("958,5"), "958,50\u00a0₽");
  assert.equal(formatMoneyExact(null), "0\u00a0₽");
});
