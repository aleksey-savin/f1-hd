// node --test services/portalMarkers.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { withoutMarkers, MARKER_LITERALS } = require("./portalMarkers");
const { redactSecrets } = require("./secretsScanner");
const { redactConfig, SECRET, HIDDEN } = require("./mikrotik/configRedact");
const { maskText } = require("./mcp/maskText");

// Копия текста без пометок портала: чем заменяется пометка и почему. Список
// пометок в модуле повторён литералами (модуль — лист, см. его шапку), поэтому
// здесь же проверяется, что он совпадает с тем, что портал на самом деле пишет.

test("the replacement depends on what follows the marker", () => {
  const table = {
    // Конец текста, перевод строки, пробел — пустое значение в кавычках
    "password=[скрыто]": 'password=""',
    "password=[скрыто]\n/interface wireguard add name=wg1": 'password=""\n/interface wireguard add name=wg1',
    'password=[скрыто] comment="x"': 'password="" comment="x"',
    "password=[скрыто]\r\nnext": 'password=""\r\nnext',
    "password=[скрыто] next": 'password="" next',
    "[скрипт скрыт: 12 строк]": '""',
    // Любой другой знак — пустота: приклеенное встаёт на место значения
    "password: [скрыто]R00tP@ss123": "password: R00tP@ss123",
    'password="[скрыто]R00tP@ss123"': 'password="R00tP@ss123"',
    'password="[скрыто]"': 'password=""',
    "ftp://user:[скрыто]@host/path": "ftp://user:@host/path",
    "логин: [e-mail], телефон: [телефон]": 'логин: , телефон: ""',
    // Две пометки подряд: первая — пустота, вторая — по знаку за ней
    "password=[скрыто][секрет скрыт]": 'password=""',
    "password=[скрыто][секрет скрыт]R00tP@ss123": "password=R00tP@ss123",
    "password=[скрыто] [секрет скрыт]": 'password="" ""',
    // Проход один: сложившаяся из кусков пометка остаётся текстом
    "password=[скры[скрыто]то]qwe123": "password=[скрыто]qwe123",
    // Не пометки
    "[скрипт скрыт: 1234567 строк]": "[скрипт скрыт: 1234567 строк]",
    "[Скрыто] [скрыто": "[Скрыто] [скрыто",
  };
  for (const [text, expected] of Object.entries(table)) assert.equal(withoutMarkers(text), expected, text);
});

test("anything but a string is returned as is", () => {
  assert.equal(withoutMarkers(undefined), undefined);
  assert.equal(withoutMarkers(null), null);
  assert.equal(withoutMarkers(""), "");
});

test("the list matches what the helpdesk writes", () => {
  assert.ok(MARKER_LITERALS.includes(SECRET));
  assert.ok(MARKER_LITERALS.includes(HIDDEN));
  assert.equal(redactSecrets("password = R00tP@ss123").text, `password = ${SECRET}`);
  assert.equal(maskText("писать на ivan@romashka.example, звонить +7 (999) 123-45-67"), "писать на [e-mail], звонить [телефон]");
  for (const marker of ["[e-mail]", "[телефон]", "[скрипт скрыт]", "[вывод скрипта скрыт]", "[строка скрыта: не удалось разобрать]"]) {
    assert.ok(MARKER_LITERALS.includes(marker), marker);
  }
});

// Настоящий вывод redactConfig: после копии без пометок не остаётся ни одной
// квадратной скобки с кириллицей «скрыт»
test("a redacted RouterOS export has no marker left", () => {
  const exported = [
    "# 2026-10-11 10:00:00 by RouterOS 7.15.3",
    "/ppp secret",
    "add name=u1 password=R00tP@ss123 service=l2tp",
    "/interface wireguard",
    'add name=wg1 private-key="kD5vT1pZ8wQ3rY6uI9oP2aS4dF7gH0jK2lZ4xC6vB8n="',
    "/system script",
    'add name=backup source=":log info a\\n:log info b"',
    "/tool fetch",
    "add url=ftp://backup:Zx9qLm@10.0.0.7/dumps",
  ].join("\n");
  const text = redactConfig(exported)
    .sections.flatMap((section) => [section.path, ...section.lines])
    .join("\n");
  assert.equal(text.match(/\[[^\]\n]*скрыт[^\]\n]*\]/g).length, 4, text);
  assert.doesNotMatch(withoutMarkers(text), /\[[^\]\n]*скрыт[^\]\n]*\]/);
});
