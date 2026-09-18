// node --test services/mcp/text.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { ticketPlainText, buildSnippet, iso, fallbackTerms, hasAllTerms } = require("./text");

// Описание заявки бывает трёх видов: HTML из редактора портала, текст письма с
// цитатой прошлой переписки, текст с data:-вставками. Агенту — чистый текст.

test("HTML from the portal editor becomes lines", () => {
  const ticket = {
    source: "Портал",
    description: "<p>Не печатает</p><p>принтер&nbsp;HP в <strong>305</strong></p><p><br></p>",
  };

  assert.equal(ticketPlainText(ticket), "Не печатает\nпринтер HP в 305");
});

test("an e-mail ticket loses the quoted previous correspondence", () => {
  const ticket = {
    source: "Почта",
    description:
      "Добрый день, не работает VPN.\n\nС уважением, Иван\n\nчт, 17 сент. 2026 г. в 10:00, Поддержка F1 <help@f1lab.ru>:\n> Заявка принята",
  };

  assert.equal(ticketPlainText(ticket), "Добрый день, не работает VPN.\n\nС уважением, Иван");
});

test("base64 data is dropped and empty descriptions are empty", () => {
  assert.equal(
    ticketPlainText({ source: "Другое", description: "скрин data:image/png;base64,iVBORw0KGgo= тут" }),
    "скрин [данные] тут",
  );
  assert.equal(ticketPlainText({ source: "Портал" }), "");
});

test("snippet and instants keep their previous behaviour", () => {
  assert.equal(iso(null), "—");
  assert.equal(iso(new Date("2026-09-17T10:00:00.000Z")), "2026-09-17T10:00:00.000Z");
  assert.match(buildSnippet(`${"а ".repeat(200)}VPN настроен`, ["vpn"]), /VPN настроен$/);
});

// Снипет живёт одной строкой списка (и у заявок, и у базы знаний): переносы из
// чужого текста схлопываем, иначе строка результата разъезжается.
test("a snippet is a single line", () => {
  const snippet = buildSnippet("первая строка\n\nвторая строка: VPN настроен\nтретья", ["vpn"]);

  assert.ok(!snippet.includes("\n"), snippet);
  assert.match(snippet, /вторая строка: VPN настроен/);
});

test("fallback terms: normalized words, at most 8; every term must occur", () => {
  assert.deepEqual(fallbackTerms("  VPN  192.168.10.5 Ёлка "), ["vpn", "192.168.10.5", "елка"]);
  assert.equal(fallbackTerms("1 2 3 4 5 6 7 8 9 10").length, 8);
  assert.equal(hasAllTerms("Сервер SRV-DC01 в офисе", ["srv-dc01", "офис"]), true);
  assert.equal(hasAllTerms("Сервер SRV-DC01", ["srv-dc01", "склад"]), false);
  assert.equal(hasAllTerms("что угодно", []), false);
});
