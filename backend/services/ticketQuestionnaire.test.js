// node --test services/ticketQuestionnaire.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  FIELD_TYPES,
  DESCRIPTION_MODES,
  emptyAnswer,
  hasAnswer,
  normalizeAnswer,
  normalizeTemplateFields,
  collectAnswers,
  formatAnswer,
  composeDescription,
  descriptionIsEmpty,
} = require("./ticketQuestionnaire");

const def = (overrides) => ({
  key: "k1",
  name: "Вопрос",
  type: "text",
  options: [],
  required: false,
  hint: "",
  ...overrides,
});

test("vocabulary: six field types, three description modes", () => {
  assert.deepEqual(FIELD_TYPES, [
    "text",
    "select",
    "multiselect",
    "boolean",
    "number",
    "date",
  ]);
  assert.deepEqual(DESCRIPTION_MODES, ["required", "optional", "hidden"]);
});

test("emptyAnswer: string for text/select, array for multiselect, null otherwise", () => {
  assert.equal(emptyAnswer("text"), "");
  assert.equal(emptyAnswer("select"), "");
  assert.deepEqual(emptyAnswer("multiselect"), []);
  assert.equal(emptyAnswer("boolean"), null);
  assert.equal(emptyAnswer("number"), null);
  assert.equal(emptyAnswer("date"), null);
});

test("hasAnswer: blank strings, empty arrays, null and NaN are not answers", () => {
  assert.equal(hasAnswer("text", "  "), false);
  assert.equal(hasAnswer("text", "ok"), true);
  assert.equal(hasAnswer("multiselect", []), false);
  assert.equal(hasAnswer("multiselect", ["a"]), true);
  assert.equal(hasAnswer("boolean", null), false);
  assert.equal(hasAnswer("boolean", false), true);
  assert.equal(hasAnswer("number", null), false);
  assert.equal(hasAnswer("number", NaN), false);
  assert.equal(hasAnswer("number", 0), true);
  assert.equal(hasAnswer("date", ""), false);
  assert.equal(hasAnswer("date", "2026-09-15"), true);
});

test("normalizeAnswer: text is trimmed, null becomes empty string", () => {
  assert.deepEqual(normalizeAnswer(def({}), "  Петрова  "), {
    value: "Петрова",
  });
  assert.deepEqual(normalizeAnswer(def({}), null), { value: "" });
});

test("normalizeAnswer: select must be one of the options", () => {
  const field = def({ type: "select", options: ["A", "B"] });
  assert.deepEqual(normalizeAnswer(field, "B"), { value: "B" });
  assert.deepEqual(normalizeAnswer(field, ""), { value: "" });
  const bad = normalizeAnswer(field, "C");
  assert.equal(bad.value, "");
  assert.match(bad.error, /не из списка/);
});

test("normalizeAnswer: multiselect keeps only listed options, deduped, in option order", () => {
  const field = def({ type: "multiselect", options: ["A", "B", "C"] });
  assert.deepEqual(normalizeAnswer(field, ["C", "A", "C"]), {
    value: ["A", "C"],
  });
  assert.deepEqual(normalizeAnswer(field, "A"), { value: ["A"] });
  assert.deepEqual(normalizeAnswer(field, null), { value: [] });
  const bad = normalizeAnswer(field, ["A", "Z"]);
  assert.deepEqual(bad.value, ["A"]);
  assert.match(bad.error, /не из списка/);
});

test("normalizeAnswer: boolean accepts true/false and their strings, empty is null", () => {
  const field = def({ type: "boolean" });
  assert.deepEqual(normalizeAnswer(field, true), { value: true });
  assert.deepEqual(normalizeAnswer(field, "false"), { value: false });
  assert.deepEqual(normalizeAnswer(field, ""), { value: null });
  assert.deepEqual(normalizeAnswer(field, undefined), { value: null });
  const bad = normalizeAnswer(field, "maybe");
  assert.equal(bad.value, null);
  assert.match(bad.error, /Да.*Нет/);
});

test("normalizeAnswer: number parses strings with a comma, rejects garbage", () => {
  const field = def({ type: "number" });
  assert.deepEqual(normalizeAnswer(field, 2), { value: 2 });
  assert.deepEqual(normalizeAnswer(field, " 1,5 "), { value: 1.5 });
  assert.deepEqual(normalizeAnswer(field, ""), { value: null });
  const bad = normalizeAnswer(field, "two");
  assert.equal(bad.value, null);
  assert.match(bad.error, /число/);
});

test("normalizeAnswer: date is a calendar day key", () => {
  const field = def({ type: "date" });
  assert.deepEqual(normalizeAnswer(field, "2026-09-15"), {
    value: "2026-09-15",
  });
  assert.deepEqual(normalizeAnswer(field, ""), { value: null });
  assert.match(normalizeAnswer(field, "15.09.2026").error, /дату/);
  assert.match(normalizeAnswer(field, "2026-02-30").error, /дату/);
});

test("normalizeTemplateFields: drops nameless rows, defaults type, assigns keys", () => {
  const { fields, errors } = normalizeTemplateFields([
    { name: "  ФИО ", type: "text", required: "yes", hint: " Как в паспорте " },
    { name: "", type: "text" },
    null,
    { name: "Оценка", type: "rating", key: "keep-me" },
  ]);
  assert.equal(errors.length, 0);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].name, "ФИО");
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].hint, "Как в паспорте");
  assert.equal(typeof fields[0].key, "string");
  assert.ok(fields[0].key.length > 0);
  assert.equal(fields[0].value, "");
  assert.equal(fields[1].type, "text");
  assert.equal(fields[1].key, "keep-me");
});

test("normalizeTemplateFields: choice options are trimmed and deduped; none is an error", () => {
  const { fields, errors } = normalizeTemplateFields([
    { name: "Должность", type: "select", options: [" A ", "", "A", "B"] },
    { name: "Пустой", type: "multiselect", options: ["", "  "] },
    { name: "Текст", type: "text", options: ["мусор"] },
  ]);
  assert.deepEqual(fields[0].options, ["A", "B"]);
  assert.deepEqual(fields[1].options, []);
  assert.deepEqual(fields[2].options, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].index, 1);
  assert.match(errors[0].message, /Пустой/);
});

test("collectAnswers: answers are matched by key, snapshot follows template order", () => {
  const definitions = [
    def({ key: "a", name: "ФИО", required: true }),
    def({ key: "b", name: "Пропуск", type: "boolean" }),
  ];
  const { customFields, errors } = collectAnswers({
    definitions,
    submitted: [
      { key: "b", name: "Пропуск (старое имя)", value: "true" },
      { key: "a", name: "ФИО", value: "Петрова" },
      { key: "zzz", name: "Чужое", value: "x" },
    ],
  });
  assert.equal(errors.length, 0);
  assert.deepEqual(
    customFields.map((field) => [field.key, field.name, field.value]),
    [
      ["a", "ФИО", "Петрова"],
      ["b", "Пропуск", true],
    ],
  );
  assert.equal(customFields[0].required, true);
  assert.equal(customFields[1].type, "boolean");
});

test("collectAnswers: legacy definitions without keys match by name", () => {
  const { customFields, errors } = collectAnswers({
    definitions: [def({ key: undefined, name: "ФИО" })],
    submitted: [{ name: "ФИО", value: "Иванов" }],
  });
  assert.equal(errors.length, 0);
  assert.equal(customFields[0].value, "Иванов");
});

test("collectAnswers: a required question without an answer is an error naming it", () => {
  const { customFields, errors } = collectAnswers({
    definitions: [
      def({ key: "a", name: "ФИО", required: true }),
      def({ key: "d", name: "Дата выхода", type: "date", required: true }),
    ],
    submitted: [{ key: "a", value: "   " }],
  });
  assert.equal(customFields.length, 2);
  assert.deepEqual(
    errors.map((error) => error.key),
    ["a", "d"],
  );
  assert.match(errors[0].message, /«ФИО»/);
  assert.match(errors[1].message, /«Дата выхода»/);
});

test("collectAnswers: an invalid answer is reported once, and not also as missing", () => {
  const { errors } = collectAnswers({
    definitions: [
      def({ key: "s", name: "Должность", type: "select", options: ["A"], required: true }),
    ],
    submitted: [{ key: "s", value: "Z" }],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /не из списка/);
});

test("formatAnswer: human strings per type, empty for no answer", () => {
  assert.equal(formatAnswer(def({ type: "boolean", value: true })), "Да");
  assert.equal(formatAnswer(def({ type: "boolean", value: false })), "Нет");
  assert.equal(formatAnswer(def({ type: "boolean", value: null })), "");
  assert.equal(formatAnswer(def({ type: "date", value: "2026-09-15" })), "15.09.2026");
  assert.equal(formatAnswer(def({ type: "multiselect", value: ["A", "B"] })), "A, B");
  assert.equal(formatAnswer(def({ type: "number", value: 1.5 })), "1.5");
  assert.equal(formatAnswer(def({ value: "  " })), "");
});

test("composeDescription: one paragraph per answered question, html-escaped", () => {
  const html = composeDescription([
    def({ name: "ФИО", value: "Петрова <Анна>" }),
    def({ name: "Рабочее место", value: "" }),
    def({ name: "Пропуск & ключ", type: "boolean", value: true }),
  ]);
  assert.equal(
    html,
    "<p><strong>ФИО:</strong> Петрова &lt;Анна&gt;</p>" +
      "<p><strong>Пропуск &amp; ключ:</strong> Да</p>",
  );
  assert.equal(composeDescription([def({ value: "" })]), "");
});

test("descriptionIsEmpty: the editor's empty document counts as empty", () => {
  assert.equal(descriptionIsEmpty(""), true);
  assert.equal(descriptionIsEmpty("<p><br></p>"), true);
  assert.equal(descriptionIsEmpty("<p>&nbsp;</p>"), true);
  assert.equal(descriptionIsEmpty("<p>Текст</p>"), false);
});
