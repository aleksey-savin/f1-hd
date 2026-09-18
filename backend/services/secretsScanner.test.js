// node --test services/secretsScanner.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { scanText, redactSecrets } = require("./secretsScanner");

// Сырой секрет наружу не отдаётся: scanText маскирует находки для модератора,
// redactSecrets заменяет значения в тексте для ИИ-агента. Первый тест фиксирует
// вывод scanText до выноса правил в общий сборщик — скан базы знаний не должен
// измениться ни на одну находку.

const findings = (text) => scanText(text).map((f) => [f.category, f.maskedSnippet]);

test("scanText: findings are unchanged by the shared collector", () => {
  assert.deepEqual(findings("password = R00tP@ss123"), [["generic-api-key", "R00t•••s123"]]);
  assert.deepEqual(findings("Пароль от роутера R00tP@$$-pass"), [["password-near-keyword", "R00t•••••pass"]]);
  assert.deepEqual(findings("| admin | Kap2022# |"), [["password-like", "K•••••••"]]);
  assert.deepEqual(findings("ключ AKIAJ7Q2W4E6R8T0Y2U4 в конфиге"), [["aws-access-key", "AKIA••••••••••••Y2U4"]]);
  assert.deepEqual(findings("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12"), [["github-token", "ghp_••••••••••••ij12"]]);
  assert.deepEqual(findings("changeme123 и test@example.com"), []);
  assert.deepEqual(findings("Не печатает принтер HP LaserJet 1020 в кабинете 305"), []);
});

test("scanText: a moderator's «не секрет» mark still drops the finding", () => {
  const [finding] = scanText("password = R00tP@ss123");
  assert.deepEqual(scanText("password = R00tP@ss123", "content", [finding.hash]), []);
});

test("redactSecrets: detected values are replaced, the rest of the text stays", () => {
  assert.deepEqual(redactSecrets("password = R00tP@ss123"), { text: "password = [секрет скрыт]", count: 1 });
  assert.deepEqual(redactSecrets("Пароль от роутера R00tP@$$-pass"), { text: "Пароль от роутера [секрет скрыт]", count: 1 });
  assert.deepEqual(redactSecrets("| admin | Kap2022# |"), { text: "| admin | [секрет скрыт] |", count: 1 });
  assert.deepEqual(redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij12"), { text: "token: [секрет скрыт]", count: 1 });
});

test("redactSecrets: every occurrence of a value is replaced", () => {
  assert.deepEqual(redactSecrets("пароль: Kap2022# (повторю: Kap2022#)"), {
    text: "пароль: [секрет скрыт] (повторю: [секрет скрыт])",
    count: 2,
  });
});

test("redactSecrets: a longer secret containing a shorter one is replaced whole", () => {
  const text = `пароль Abc123!x ${"и ещё немного текста ".repeat(3)}потом Abc123!x-long9`;

  const { text: redacted } = redactSecrets(text);

  assert.ok(!redacted.includes("long9"), redacted);
  assert.ok(!redacted.includes("Abc123!x"), redacted);
});

test("redactSecrets: text without secrets and empty input", () => {
  assert.deepEqual(redactSecrets("Не печатает принтер HP LaserJet 1020"), {
    text: "Не печатает принтер HP LaserJet 1020",
    count: 0,
  });
  assert.deepEqual(redactSecrets(undefined), { text: "", count: 0 });
});
