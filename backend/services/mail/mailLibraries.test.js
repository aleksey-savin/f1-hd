// node --test services/mail/mailLibraries.test.js
//
// Почтовые библиотеки — версии без известных дыр разбора адресов (S15).
// Тесты держат именно те места, которые чинили обновления: откат версии в
// lockfile снова их уронит.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const addressparser = require("nodemailer/lib/addressparser");

test("nodemailer: кавычки в локальной части не подменяют адрес получателя", () => {
  // До 7.0.7 разбиралось как victim@evil.example — письмо ушло бы не туда.
  // Кавычки 7.x снимает, 10.x оставляет; важен домен
  const [parsed] = addressparser('"victim@evil.example x"@internal.example');
  assert.match(parsed.address, /@internal\.example$/);
});

test("nodemailer: глубоко вложенные группы не роняют процесс", () => {
  // До 7.0.11 — RangeError: Maximum call stack size exceeded
  assert.doesNotThrow(() => addressparser(`${"g:".repeat(5000)}a@b.example`));
});

test("mailparser: заголовок From из мусора разбирается за линейное время", async () => {
  // mailparser 3.7.2 (addressparser из nodemailer 6.9.16) думал над этим
  // около 2 секунд; порог 500 мс — с запасом на загруженную машину
  const raw = `From: ${"[x]".repeat(20000)}\r\nTo: support@example.ru\r\nSubject: test\r\n\r\nbody\r\n`;
  const started = process.hrtime.bigint();
  await simpleParser(raw);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `${ms.toFixed(0)} мс`);
});

test("mailparser: обычное письмо разбирается в те же поля", async () => {
  const mail = await simpleParser(
    [
      "From: =?UTF-8?B?0JjQstCw0L0g0J/QtdGC0YDQvtCy?= <Ivan@Example.RU>",
      "To: support@example.ru",
      "Subject: =?UTF-8?B?0J3QtSDQv9C10YfQsNGC0LDQtdGC?=",
      "List-Id: <list.example.ru>",
      "Message-ID: <m1@example.ru>",
      "",
      "текст",
      "",
    ].join("\r\n"),
  );

  assert.deepEqual(mail.from.value, [{ address: "Ivan@Example.RU", name: "Иван Петров" }]);
  assert.equal(mail.subject, "Не печатает");
  assert.equal(mail.messageId, "<m1@example.ru>");
  assert.equal(mail.text, "текст\n");
  assert.deepEqual(mail.headers.get("list"), { id: { name: "list.example.ru" } });
});

test("nodemailer: письмо собирается тем же вызовом, что в services/mail/send.js", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });

  const info = await transport.sendMail({
    from: '"Служба поддержки" <hd@example.ru>',
    to: "user@example.ru",
    subject: "Заявка №51713",
    text: "",
    html: "<p>Готово</p>",
  });

  assert.deepEqual(info.envelope, { from: "hd@example.ru", to: ["user@example.ru"] });
  // Собранное письмо читается обратно тем же разборщиком, что и входящие
  const parsed = await simpleParser(info.message);
  assert.deepEqual(parsed.from.value, [{ address: "hd@example.ru", name: "Служба поддержки" }]);
  assert.equal(parsed.subject, "Заявка №51713");
  assert.equal(parsed.html, "<p>Готово</p>");
});
