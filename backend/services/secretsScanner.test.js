// node --test services/secretsScanner.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { scanText, scanNote, redactSecrets } = require("./secretsScanner");

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

// Правило jwt начиналось с «\b»: на «-eyJ»×N граница слова есть перед каждым
// «eyJ», и от каждой регулярка дочитывала текст до конца в поисках точки —
// 40 000 знаков за секунды. Время процессорное, не по стенным часам.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

test("scanText: a JWT is found, also at the start of a line and after punctuation", () => {
  for (const text of [JWT, `токен ${JWT} в заметке`, `Authorization: "${JWT}"`, `(${JWT})`, `строка\n${JWT}`]) {
    assert.deepEqual(scanText(text).map((f) => f.category).filter((category) => category === "jwt"), ["jwt"], text);
  }
});

test("scanText: «-eyJ» ×10 000 is scanned in linear time", () => {
  for (const text of ["-eyJ".repeat(10_000), "_eyJ".repeat(10_000), `${"-eyJ".repeat(10_000)} ${JWT}`]) {
    const cpuBefore = process.cpuUsage();
    const found = scanText(text);
    const cpu = process.cpuUsage(cpuBefore);
    const ms = (cpu.user + cpu.system) / 1000;
    assert.ok(ms < 250, `${text.slice(0, 4)}×10 000: ${ms.toFixed(1)} мс`);
    assert.equal(found.some((f) => f.category === "jwt"), text.endsWith(JWT));
  }
});

test("scanText: a moderator's «не секрет» mark still drops the finding", () => {
  const [finding] = scanText("password = R00tP@ss123");
  assert.deepEqual(scanText("password = R00tP@ss123", "content", [finding.hash]), []);
});

// Заметку агента (agent.keyId) scanNote сканирует в копии без пометок портала —
// той же, что проверяет инструмент записи; заметку человека — как есть.
test("scanNote: the helpdesk's markers are not findings in an agent's note only", () => {
  const text = { title: "Роутер: password: [скрыто]", plainText: "Доступ: password: [скрыто], логин: [e-mail]" };
  const agent = { keyId: "66aa000000000000000000aa" };

  assert.deepEqual(scanNote({ ...text, agent }), []);
  assert.deepEqual(
    scanNote(text).map((f) => [f.location, f.category, f.maskedSnippet]),
    [
      ["title", "generic-api-key", "[•••••••"],
      ["content", "generic-api-key", "[скр•то],"],
      ["content", "generic-api-key", "[•••••••"],
    ],
  );
  // Метка без ключа — заметка человека
  assert.equal(scanNote({ ...text, agent: {} }).length, 3);
  // Настоящее значение, приклеенное к пометке, — находка и у агента
  assert.deepEqual(
    scanNote({ title: "Роутер", plainText: "password: [скрыто]R00tP@ss123", agent }).map((f) => [f.category, f.maskedSnippet]),
    [["generic-api-key", "R00t•••s123"]],
  );
  // Пометка модератора «не секрет» действует как раньше
  const [finding] = scanNote({ title: "Роутер", plainText: "password = R00tP@ss123", agent });
  assert.deepEqual(scanNote({ title: "Роутер", plainText: "password = R00tP@ss123", agent }, [finding.hash]), []);
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
