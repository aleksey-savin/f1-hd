// node --test middleware/emailHandling.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

// Обработчик держит IMAP и базу, чистого шва у него нет: решения проверены в
// services/mail/*.test.js, здесь — что проводка на месте и старый путь
// опознания по тексту From не вернулся
const source = fs.readFileSync(path.join(__dirname, "emailHandling.js"), "utf8");

test("the sender is never read from the From text with its display name", () => {
  // Прежде адрес искали выражением по тексту From, а домен компании —
  // отрезая всё до «@»: «"boss@client.ru" <x@evil.com>» становился boss
  assert.doesNotMatch(source, /email\.from\.(match|replace)\(/);
  assert.doesNotMatch(source, /isCloudTelephonySender\(email\.from\)/);
  // Показ отправителя и строки лога заявки — тоже из разобранного адреса
  assert.doesNotMatch(source, /realSender: email\.from\b/);
  assert.doesNotMatch(source, /\$\{email\.from\}/);
});

test("mail that failed the sender check identifies no applicant", () => {
  assert.match(source, /mayIdentifyApplicant\(\{/);
  assert.doesNotMatch(source, /if \(prefs\.identifyApplicant\) \{/);
});

test("replies go through planReply, repeats through findImportedMessage", () => {
  assert.match(source, /planReply\(\{/);
  assert.match(source, /reply\.action === "logOnly"/);
  assert.match(source, /findImportedMessage\(email\.messageId/);
  assert.match(source, /withRerouteNote\(email\.description, reply\.note\)/);
  // Оба создания помнят Message-ID — иначе повтор не узнать
  assert.equal(source.match(/emailMessageId: email\.messageId/g)?.length, 2);
});

test("everyone writes by mail only into tickets they see in the UI", () => {
  // Правило комментария из интерфейса — одно для клиента и сотрудника (решение
  // владельца 2026-10-03); без него рядовой клиент писал бы письмом в заявки
  // коллег, а сторонний исполнитель — в любую заявку любой компании
  assert.match(source, /canAccessTicket\(ticket, await buildAuthContext\(sender\)\)/);
  assert.match(source, /planReply\(\{[^}]*\binScope,/);
});

test("robot log lines carry an explicit kind", () => {
  // Адрес в тексте строки не решает, каким событием она станет в ленте
  assert.equal(source.match(/kind: "delivery"/g)?.length, 2);
});

test("a skipped repeat is a warning with the sender", () => {
  // Повтором бывает и подмена Message-ID — по журналу её видно
  assert.match(source, /logger\.log\("warn", "Skipped an already imported e-mail"/);
});

test("the module loads with the new services wired in", () => {
  const { handleNewEmails } = require("./emailHandling");
  assert.equal(typeof handleNewEmails, "function");
});

test("only the comment action writes into the tagged ticket, only newTicket opens one", () => {
  // Метка в теме — не пропуск: комментарий в №N пишет только действие comment
  // (участник, письмо не провалило проверку). Прежнее «else if (ticket)» снова
  // пустило бы в №N кого угодно, а все тесты сервисов остались бы зелёными
  assert.match(source, /\} else if \(reply\.action === "comment"\) \{/);
  assert.doesNotMatch(source, /\} else if \(ticket\) \{/);
  // Заявку открывает только newTicket: робот, которого не пустили, — строка в логе
  assert.match(source, /\n {8}if \(reply\.action === "newTicket"\) \{/);
  // Вердикт проверки отправителя доходит до обоих решений как есть
  assert.match(source, /planReply\(\{[^}]*\n\s+authVerdict,\n/);
  assert.match(
    source,
    /mayIdentifyApplicant\(\{\s*identifyApplicant: prefs\.identifyApplicant,\s*authVerdict,\s*\}\)/,
  );
});

test("a repeat is recognised before anything is written and is flagged read", () => {
  assert.match(source, /const imported = await findImportedMessage\(email\.messageId, \{/);
  const dedup = source.indexOf("findImportedMessage(email.messageId");
  assert.ok(dedup < source.indexOf("new Comment("), "дубль ищется до создания комментария");
  assert.ok(dedup < source.indexOf("new Ticket("), "дубль ищется до создания заявки");
  // Не помеченный прочитанным повтор возвращался бы каждые 20 секунд
  const branch = source.slice(dedup, source.indexOf("continue;", dedup));
  assert.match(branch, /await connection\.addFlags\(email\.uid, "\\\\Seen"\);/);
});

test("access is computed for every identified sender, and a failure is a refusal", () => {
  // Сбой сборки прав не роняет письмо в повторы (и в «ядовитое» после трёх):
  // ответ уходит новой заявкой
  assert.match(
    source,
    /let inScope = false;\s*if \(ticket && sender\) \{\s*try \{\s*inScope = canAccessTicket\(ticket, await buildAuthContext\(sender\)\);\s*\} catch \(error\) \{/,
  );
  // Тип учётки обработчик не различает: ветки «права считаются только
  // сотруднику» — после неё клиент проходил бы по связям с заявкой — больше нет
  assert.doesNotMatch(source, /sender\?\.isEndUser\s*===\s*false/);
});

test("phone numbers identify only mail from the cloud-telephony account", () => {
  // Номер в теле обычного письма пишет кто угодно: по номеру клиента посторонний
  // открывал заявку от его имени (решение владельца 2026-10-03). Признак
  // «письмо с аккаунта телефонии» считается один раз на письмо и даёт и источник
  // заявки, и право опознавать по номеру
  assert.equal(source.match(/isCloudTelephonySender\(email\.fromAddress\)/g)?.length, 1);
  assert.match(source, /const source = isTelephony \? "Облачная телефония" : "Почта";/);
  // Состав условия, а не его порядок и вёрстка: поведение держат тесты приёма
  // (emailHandling.intake.test.js)
  const gate = /const identifyByPhone =([\s\S]*?);/.exec(source)?.[1] ?? "";
  for (const part of [
    "prefs.checkPhoneNumber",
    "isTelephony",
    'authVerdict !== "fail"',
    "callerPhones.length",
  ]) {
    assert.ok(gate.includes(part), `в условии опознания по номеру нет «${part}»`);
  }
  // Оба поиска по номеру — компании и заявителя — только за этим признаком;
  // прежнее условие «настройка и номера в письме» без телефонии не вернулось
  assert.equal(source.match(/findByAnyPhone\(/g)?.length, 2);
  assert.equal(source.match(/if \(identifyByPhone\) \{/g)?.length, 2);
  assert.doesNotMatch(source, /prefs\.checkPhoneNumber && callerPhones\.length/);
});

test("an applicant is looked up by address only when the sender has one", () => {
  // Адрес, который разбор From не принял, — пустая строка. Поиск по `email: ""`
  // нашёл бы единственную учётку с пустым адресом (запись в обход схемы), и
  // заявка или ответ ушли бы на неё. Каждый поиск по адресу идёт только после
  // проверки «emailAddress ? …»
  const lookups =
    source.match(/MongoUser\.findOne\(\{\s*email: emailAddress\b/g)?.length ?? 0;
  const guarded =
    source.match(
      /emailAddress\s*\?\s*await MongoUser\.findOne\(\{\s*email: emailAddress\b/g,
    )?.length ?? 0;
  // Их три: заявитель в ветке телефона, заявитель без телефона, отправитель
  // ответа. Нижняя граница — чтобы проверка не опустела после переписывания
  assert.ok(lookups >= 3, `поисков по адресу: ${lookups}`);
  assert.equal(guarded, lookups, "поиск по адресу без проверки emailAddress");
});
