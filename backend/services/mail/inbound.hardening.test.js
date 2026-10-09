// node --test services/mail/inbound.hardening.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");

const { senderAddress, senderLine, senderDomain, inboundEnvelope } = require("./inbound");

const parse = (...headers) =>
  simpleParser(`${headers.join("\r\n")}\r\n\r\nТекст письма\r\n`);
const word = (text) => `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;

test("an address that is not written in the From header is nobody's address", async () => {
  for (const headers of [
    [`From: ${word("<boss@client.ru>")}`],
    [`From: ${word("Boss <boss@client.ru>")}`],
    [`From: x <${word("boss@client.ru")}>`],
    [`From: ${word("<boss@client.ru>")} (boss@client.ru)`],
    ["From: x@evil.com", "From: boss@client.ru"],
  ]) {
    assert.equal(senderAddress(await parse(...headers)), "", headers.join(" | "));
  }
  // А обычный закодированный отправитель остаётся
  assert.equal(
    senderAddress(await parse(`From: ${word("Иван Петров")} <IVAN@Corp.RU>`)),
    "ivan@corp.ru",
  );
});

test("the shown sender never names another domain than the real address", async () => {
  for (const from of [
    '"boss@client.ru"@evil.com',
    "boss@client.ru+evil.com",
    "boss@client.ru.",
    "boss@client.ru.евил.com",
  ]) {
    assert.equal(senderLine(await parse(`From: ${from}`)), "", from);
  }
  assert.equal(senderLine(await parse("From: ivan@клиент.рф")), "ivan@клиент.рф");
});

test("the domain is what follows the last @ even when the local part has one", () => {
  assert.equal(senderDomain("boss@client.ru@evil.com"), "evil.com");
});

test("a Message-ID with nothing inside the brackets is no Message-ID", async () => {
  for (const id of ["<>", "< >"]) {
    const mail = await parse("From: a@b.ru", `Message-ID: ${id}`);
    assert.equal(inboundEnvelope(mail).messageId, undefined, id);
  }
});

test("a hostile From line is rejected at once", async () => {
  const mail = await parse(`From: ${"a".repeat(900000)} <x@evil.com>`);
  const started = Date.now();
  assert.equal(senderAddress(mail), "");
  assert.ok(Date.now() - started < 200);
});
