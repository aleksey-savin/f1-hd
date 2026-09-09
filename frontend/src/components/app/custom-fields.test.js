// node --test src/components/app/custom-fields.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INLINE_CHOICE_MAX,
  answerError,
  emptyAnswer,
  errorKeyOf,
  formatAnswer,
  hasAnswer,
  hasOptions,
  inlineChoices,
} from "./custom-fields.ts";

test("emptyAnswer mirrors the server: string, array, null", () => {
  assert.equal(emptyAnswer("text"), "");
  assert.deepEqual(emptyAnswer("multiselect"), []);
  assert.equal(emptyAnswer("boolean"), null);
  assert.equal(emptyAnswer("number"), null);
  assert.equal(emptyAnswer("date"), null);
});

test("hasAnswer: number may be the raw string while typing", () => {
  assert.equal(hasAnswer("number", "2"), true);
  assert.equal(hasAnswer("number", " "), false);
  assert.equal(hasAnswer("number", "abc"), false);
  assert.equal(hasAnswer("number", 0), true);
  assert.equal(hasAnswer("boolean", false), true);
  assert.equal(hasAnswer("boolean", null), false);
  assert.equal(hasAnswer("multiselect", []), false);
  assert.equal(hasAnswer("text", "  "), false);
});

test("formatAnswer: Да/Нет, dd.mm.yyyy, comma list, empty when unanswered", () => {
  assert.equal(formatAnswer({ type: "boolean", value: true }), "Да");
  assert.equal(formatAnswer({ type: "boolean", value: false }), "Нет");
  assert.equal(formatAnswer({ type: "date", value: "2026-09-15" }), "15.09.2026");
  assert.equal(formatAnswer({ type: "multiselect", value: ["A", "B"] }), "A, B");
  assert.equal(formatAnswer({ type: "number", value: 2 }), "2");
  assert.equal(formatAnswer({ type: "text", value: "" }), "");
});

test("answerError: the wording follows the control the person sees", () => {
  assert.equal(answerError({ type: "text" }), "Заполните поле");
  assert.equal(answerError({ type: "select" }), "Выберите вариант");
  assert.equal(answerError({ type: "multiselect" }), "Выберите хотя бы один вариант");
  assert.equal(answerError({ type: "boolean" }), "Выберите «Да» или «Нет»");
  assert.equal(answerError({ type: "number" }), "Укажите число");
  assert.equal(answerError({ type: "date" }), "Выберите дату");
});

test("inlineChoices: up to six options are shown inline, more go to a Combobox", () => {
  assert.equal(INLINE_CHOICE_MAX, 6);
  assert.equal(inlineChoices({ type: "select", options: ["a", "b"] }), true);
  assert.equal(inlineChoices({ type: "select", options: Array(7).fill("x") }), false);
  assert.equal(inlineChoices({ type: "text" }), false);
  assert.equal(hasOptions("multiselect"), true);
  assert.equal(hasOptions("boolean"), false);
});

test("errorKeyOf: key first, name as the legacy fallback", () => {
  assert.equal(errorKeyOf({ key: "k1", name: "ФИО" }), "field:k1");
  assert.equal(errorKeyOf({ name: "ФИО" }), "field:ФИО");
});
