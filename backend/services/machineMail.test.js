const test = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");

const { isMachineMail } = require("./machineMail");

/** Письмо так, как его отдаёт mailparser: заголовки — Map с ключами в нижнем. */
const mail = (entries = {}) => ({ headers: new Map(Object.entries(entries)) });

test("живое письмо роботом не считается", () => {
  assert.equal(isMachineMail(mail()), false);
  assert.equal(
    isMachineMail(
      mail({
        subject: "Re: [F1-HD-57056] Не удаётся сформировать отчёт",
        "return-path": { text: "<olga@clinic.ru>" },
        // Outlook ставит его на обычных письмах — в роботы за это не берём
        "x-auto-response-suppress": "OOF",
      }),
    ),
    false,
  );
});

test("Auto-Submitted: no — это явное «писал человек»", () => {
  assert.equal(isMachineMail(mail({ "auto-submitted": "no" })), false);
});

test("автоответ по RFC 3834", () => {
  assert.equal(isMachineMail(mail({ "auto-submitted": "auto-replied" })), true);
  assert.equal(
    isMachineMail(mail({ "auto-submitted": "auto-generated" })),
    true,
  );
});

test("до-RFC-овские автоответчики", () => {
  assert.equal(isMachineMail(mail({ "x-autoreply": "yes" })), true);
  assert.equal(isMachineMail(mail({ "x-autorespond": "replied" })), true);
});

test("рассылки и автоматика по Precedence", () => {
  for (const value of ["bulk", "junk", "list", "auto_reply"]) {
    assert.equal(isMachineMail(mail({ precedence: value })), true, value);
  }
  // «normal» — обычное письмо
  assert.equal(isMachineMail(mail({ precedence: "normal" })), false);
});

test("письмо из списка рассылки — в том виде, в каком его отдаёт mailparser", async () => {
  // mailparser складывает List-* в один ключ `list`: отдельных «list-id» и
  // «list-unsubscribe» в разобранном письме не бывает
  const listId = await simpleParser(
    "From: news@example.com\r\nList-Id: Новости <news.example.com>\r\nSubject: x\r\n\r\nтекст\r\n",
  );
  assert.equal(isMachineMail(listId), true);
  const unsubscribe = await simpleParser(
    "From: news@example.com\r\nList-Unsubscribe: <mailto:off@example.com>, <https://example.com/off>\r\nSubject: x\r\n\r\nтекст\r\n",
  );
  assert.equal(isMachineMail(unsubscribe), true);
  assert.equal(isMachineMail(mail({ list: { id: { id: "news.example.com" } } })), true);
  assert.equal(
    isMachineMail(mail({ list: { unsubscribe: { mail: "off@example.com" } } })),
    true,
  );
});

test("прочие List-* и живой ответ роботом не делают", async () => {
  assert.equal(isMachineMail(mail({ list: { help: { mail: "help@example.com" } } })), false);
  const human = await simpleParser(
    "From: olga@clinic.ru\r\nSubject: Re: [F1-HD-57056] x\r\n\r\nСпасибо\r\n",
  );
  assert.equal(isMachineMail(human), false);
});

test("отбойник о недоставке: пустой конверт", () => {
  assert.equal(isMachineMail(mail({ "return-path": { text: "<>" } })), true);
  assert.equal(isMachineMail(mail({ "return-path": "<>" })), true);
});

test("письма без заголовков переживают проверку", () => {
  assert.equal(isMachineMail(null), false);
  assert.equal(isMachineMail({}), false);
  assert.equal(isMachineMail({ headers: {} }), false);
});

test("List-Post, Help, Archive, Subscribe, Owner без Id и Unsubscribe — не рассылка", async () => {
  const mail = await simpleParser(
    "From: a@example.com\r\nList-Post: <mailto:list@example.com>\r\nList-Help: <mailto:h@example.com>\r\nList-Archive: <https://example.com/a>\r\nList-Subscribe: <mailto:s@example.com>\r\nList-Owner: <mailto:o@example.com>\r\nSubject: x\r\n\r\nt\r\n",
  );
  assert.equal(isMachineMail(mail), false);
  // пустой List-Id mailparser выбрасывает целиком — ключа list нет
  const empty = await simpleParser("From: a@example.com\r\nList-Id:\r\nSubject: x\r\n\r\nt\r\n");
  assert.equal(isMachineMail(empty), false);
});
