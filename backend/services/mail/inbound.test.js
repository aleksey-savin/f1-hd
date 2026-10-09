// node --test services/mail/inbound.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");

const {
  senderAddress,
  senderLine,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  inboundEnvelope,
  findImportedMessage,
} = require("./inbound");

// Письмо так, как его забирает IMAP: заголовки, пустая строка, тело
const parse = (...headers) =>
  simpleParser(`${headers.join("\r\n")}\r\n\r\nТекст письма\r\n`);

// Закодированное слово RFC 2047: base64 («B») и quoted-printable («Q»)
const word = (text) => `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
const qword = (text) => `=?UTF-8?Q?${text}?=`;

// Как адрес из realSender достаёт фронт: первое похожее на адрес в строке
// (frontend/src/util/mail-sender.js, ADDRESS_RE)
const FRONTEND_ADDRESS_RE = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/;

test("the sender is the From address, never its display name", async () => {
  assert.equal(
    senderAddress(await parse('From: "boss@client.ru" <Attacker@Evil.COM>')),
    "attacker@evil.com",
  );
  // Имя закодировано и само похоже на отправителя: «Иван <boss@client.ru>»
  const encodedName = Buffer.from("Иван <boss@client.ru>").toString("base64");
  assert.equal(
    senderAddress(await parse(`From: =?UTF-8?B?${encodedName}?= <a@evil.com>`)),
    "a@evil.com",
  );
  // Несколько ящиков в From — отправитель неизвестен (раньше здесь ждали первого,
  // ivan@corp.ru). RFC 5322 (п. 3.6.2) требует в таком письме заголовок Sender, а
  // принимающий сервер мог проверить не тот ящик, который выбрали бы мы: «первый
  // побеждает» оставляло подмену открытой
  assert.equal(senderAddress(await parse("From: Ivan <IVAN@Corp.RU>, second@x.ru")), "");
  assert.equal(senderAddress(await parse("From: ivan@corp.ru")), "ivan@corp.ru");
});

test("a From with several mailboxes names nobody, in any order", async () => {
  for (const from of [
    "From: Ivan <IVAN@Corp.RU>, second@x.ru",
    "From: second@x.ru, Ivan <IVAN@Corp.RU>",
    "From: a@x.ru, b@y.ru, c@z.ru",
    "From: boss@client.ru, x@evil.com",
    // группа и ящик — это тоже два
    "From: team: a@x.ru;, b@y.ru",
    // второй ящик без адреса в тексте (закодированное слово): в тексте адрес один,
    // но mailparser насчитал два ящика, и проверен мог быть второй
    `From: ivan@corp.ru, ${word("Иван")}`,
    `From: ivan@corp.ru, ${word("<boss@client.ru>")}`,
  ]) {
    const mail = await parse(from);
    assert.deepEqual(
      [senderAddress(mail), senderLine(mail), inboundEnvelope(mail).fromAddress],
      ["", "", ""],
      from,
    );
  }
});

test("no usable From means no sender", async () => {
  for (const from of [
    "From: <>",
    "From: undisclosed-recipients:;",
    "From: not an address",
    "Subject: no sender at all",
  ]) {
    assert.equal(senderAddress(await parse(from)), "", from);
  }
  assert.equal(senderAddress(undefined), "");
});

test("the sender needs exactly one From header line to be checked against", () => {
  const from = { value: [{ address: "Ivan@Corp.RU", name: "" }] };
  const line = (text) => ({ key: "from", line: text });
  // Ровно одна строка From: адрес сверяется с ней и признаётся
  assert.equal(
    senderAddress({ from, headerLines: [line("From: Ivan@Corp.RU")] }),
    "ivan@corp.ru",
  );
  // Строк нет (объект собран не simpleParser'ом) — сверить не с чем: fail closed
  assert.equal(senderAddress({ from }), "");
  assert.equal(senderAddress({ from, headerLines: [] }), "");
  assert.equal(
    senderAddress({ from, headerLines: [{ key: "to", line: "To: Ivan@Corp.RU" }] }),
    "",
  );
  // Две строки From, даже одинаковые, — письмо невалидно (RFC 5322, п. 3.6)
  assert.equal(
    senderAddress({ from, headerLines: [line("From: Ivan@Corp.RU"), line("From: Ivan@Corp.RU")] }),
    "",
  );
});

test("the address and the one written in the header are compared as text, apart from a domain's punycode form", () => {
  const line = (text) => ({ key: "from", line: text });
  // Домен xn-- записан в заголовке как punycode, а mailparser отдаёт юникод
  const idn = { value: [{ address: "ivan@омкии.рф", name: "" }] };
  assert.equal(
    senderAddress({ from: idn, headerLines: [line("From: ivan@xn--h1aaehj.xn--p1ai")] }),
    "ivan@омкии.рф",
  );
  // Домен с xn--, который не переводится в юникод (domainToUnicode отдаёт ""): два
  // разных такие домена не должны сравняться, как равные пустой строке
  const bad = { value: [{ address: "boss@xn--a-b.client.ru", name: "" }] };
  assert.equal(
    senderAddress({ from: bad, headerLines: [line("From: boss@xn--c-d.evil.com")] }),
    "",
  );
  assert.equal(
    senderAddress({ from: bad, headerLines: [line("From: boss@xn--a-b.client.ru")] }),
    "boss@xn--a-b.client.ru",
  );
  // Остальное сравнивается как есть: домен с числовой меткой — ровно как написан
  const numeric = { value: [{ address: "boss@client.ru.1", name: "" }] };
  assert.equal(senderAddress({ from: numeric, headerLines: [line("From: boss@evil.com.2")] }), "");
  assert.equal(
    senderAddress({ from: numeric, headerLines: [line("From: boss@client.ru.1")] }),
    "boss@client.ru.1",
  );
});

test("an address a strict reader of the header would not see is nobody's address", async () => {
  // Каждая из этих строк mailparser разворачивает в boss@client.ru, а принимающий
  // сервер в заголовке такого адреса открытым текстом не видит
  for (const headers of [
    // закодированное слово: Q, а не только base64
    [`From: x <${qword("boss@client.ru")}>`],
    [`From: ${qword("boss@client.ru")}`],
    [`From: ${qword("<boss@client.ru>")}`],
    // пробел внутри слова: mailparser его декодирует, строгий разбор — нет
    ["From: x <=?UTF-8?B?Ym9zc0BjbGllbnQucnU= ?=>"],
    ["From: x <=?UTF-8?Q? boss@client.ru ?=>"],
    // вся строка — комментарий, вложенные скобки (RFC 5322, п. 3.2.2): адреса в ней нет
    ["From: (c (d) boss@client.ru (e))"],
    ["From: (a (b (c (d) boss@client.ru (e)) f) g)"],
    [`From: ${word("<boss@client.ru>")} (c (d) boss@client.ru (e))`],
    // адрес только в кавычках или только в комментарии
    ['From: "boss@client.ru"'],
    ["From: (boss@client.ru)"],
    // кавычка или скобка не закрыта либо лишняя
    ["From: (a boss@client.ru"],
    ["From: ) boss@client.ru"],
    // незакрытое после адреса: строгий сервер получит неразборчивый заголовок, а
    // mailparser адрес достаёт
    ["From: boss@client.ru (unclosed"],
    ['From: boss@client.ru "unclosed'],
    // слово посреди адреса: без него в заголовке написан не boss@client.ru
    ["From: bo=?UTF-8?Q??=ss@client.ru"],
    // адрес в имени без кавычек, настоящий — в скобках: первым написан не тот
    ["From: boss@client.ru <x@evil.com>"],
    // слово вплотную к адресу (RFC 2047, п. 5: слово отделяется пробелом): mailparser
    // его разворачивает, и адрес получается другим, чем записан — домен в заголовке
    // тогда «client.ru=?UTF-8?Q??=», а не client.ru
    ["From: boss@client.ru=?UTF-8?Q??="],
    ["From: =?UTF-8?Q??=boss@client.ru"],
    [`From: boss@client.ru${qword("<boss@client.ru>")}`],
    // адрес в слове, а рядом по-другому записанный домен: сравнение через IDNA
    // (url.domainToASCII) приводит полноширинные буквы к обычным, и
    // «ｃｌｉｅｎｔ.ｒｕ» сошёлся бы с client.ru; домены сравниваются как написаны
    [`From: x <${qword("boss@client.ru")}> boss@ｃｌｉｅｎｔ.ｒｕ`],
    // у знака Кельвина нижний регистр — обычная «k»: в сохранённом адресе была бы
    // другая запись домена, чем в заголовке
    ["From: boss@\u212Aontur.ru"],
    // пустое имя ящика или две «@» — адреса, которого сервер не прочёл бы; лишняя
    // «@» в конце слова mailparser отбрасывает, а слово с ней — не адрес
    ["From: @@client.ru"],
    ["From: a@b@client.ru"],
    ["From: boss@client.ru@"],
    ["From: boss@client.ru@ x@evil.com"],
    // адресом решает первое слово с «@», а не первое из подходящих
    ["From: x@ boss@client.ru"],
    // пустой ящик или пустой домен: адреса, которого сервер не прочёл бы
    ["From: @client.ru"],
    ["From: boss@"],
    // кавычки посреди слова: mailparser склеивает «bo» и «ss», строгий разбор — нет
    ['From: bo""ss@client.ru'],
    // управляющие знаки в имени: сервер на C обрезает заголовок по «\0», остальные
    // знаки делят и режут по-разному, а mailparser читает всё как обычный текст
    ["From: Ivan\u0000 <boss@client.ru>"],
    ["From: Ivan\u000b <boss@client.ru>"],
    ["From: Ivan\f <boss@client.ru>"],
    ["From: Ivan\u007f <boss@client.ru>"],
    ["From: Ivan\r <boss@client.ru>"],
    ["From: Iv\u0001an <boss@client.ru>"],
    // пустые, непарные или лишние угловые скобки и второй адрес рядом: mailparser
    // берёт один адрес и отбрасывает остальное, а сервер мог прочесть другой
    ["From: <> boss@client.ru"],
    ["From: boss@client.ru <>"],
    ["From: =?UTF-8?Q??=<>boss@client.ru"],
    ["From: <boss@client.ru"],
    ["From: <<boss@client.ru>>"],
    ["From: <<boss@client.ru>"],
    ["From: <boss@client.ru>>"],
    ["From: <boss@client.ru><x@evil.com>"],
    ["From: boss@client.ru x@evil.com"],
    ["From: Ivan <ivan@corp.ru> <x@evil.com>"],
    // слово с адресом внутри вплотную к кавычкам или скобкам, и тот же адрес рядом
    [`From: ${qword("boss@client.ru")}"" boss@client.ru`],
    [`From: ${qword("boss@client.ru")}() boss@client.ru`],
    // строка заголовка начинается не с «From»: в начале письма сервер такую строку
    // читает как продолжение или тело, а mailsplit — как заголовок
    [" From: boss@client.ru"],
    ["\tFrom: boss@client.ru"],
    // второй From с невидимым знаком в имени поля: mailparser его не считает
    ["From\u0000: x@evil.com", "From: boss@client.ru"],
    ["\u0000From: x@evil.com", "From: boss@client.ru"],
    // управляющие знаки и пробелы не из RFC 5322 (там пробел и табуляция): JS и
    // mailparser их обрезают и читают как разделители, строгий сервер — частью слова
    ["From:\u0000 boss@client.ru"],
    ["From: boss@client.ru\u000b"],
    ["From: boss@client.ru\f"],
    ["From: \u00a0boss@client.ru"],
    ["From: \uFEFFboss@client.ru"],
    // одиночный «\r» mailparser читает как перенос строки, mailsplit и сервер — нет
    ["From: boss@client.ru\r x"],
    ["From: boss@client.ru\rx"],
    // две строки From: любая из них, и первая и последняя, — подделка
    ["From: boss@client.ru", "From: x@evil.com"],
    ["From: x@evil.com", "from: boss@client.ru"],
    ["From: boss@client.ru", "From: boss@client.ru"],
  ]) {
    assert.equal(senderAddress(await parse(...headers)), "", headers.join(" | "));
  }
});

test("headers a strict reader reads the same way keep their sender", async () => {
  for (const [headers, expected] of [
    // комментарий с вложенными скобками перед адресом — адрес снаружи
    [["From: (x (y)) ivan@corp.ru"], "ivan@corp.ru"],
    [["From: <ivan@corp.ru>"], "ivan@corp.ru"],
    // имя без кавычек, повторяющее адрес, и комментарий после адреса
    [["From: ivan@corp.ru <IVAN@Corp.RU>"], "ivan@corp.ru"],
    [["From: Ivan <ivan@corp.ru> (Corp)"], "ivan@corp.ru"],
    [['From: "Ivan (the boss)" <IVAN@Corp.RU>'], "ivan@corp.ru"],
    [['From: "Iv\\"an" <ivan@corp.ru>'], "ivan@corp.ru"],
    [['From: ivan@corp.ru (say "hi")'], "ivan@corp.ru"],
    [["From: Ivan\r\n\t<ivan@corp.ru>"], "ivan@corp.ru"],
    [["From: Ivan\n <ivan@corp.ru>"], "ivan@corp.ru"],
    [["FROM: ivan@corp.ru"], "ivan@corp.ru"],
    // пробел или табуляция перед двоеточием допустимы (RFC 5322, п. 4.5.4); другие
    // поля со словом From в имени — не From
    [["To: a@b.ru", "From\t: ivan@corp.ru"], "ivan@corp.ru"],
    [["Resent-From: z@z.ru", "X-From: y@y.ru", "From: ivan@corp.ru"], "ivan@corp.ru"],
    // имя из нескольких закодированных слов, в разных кодировках
    [[`From: ${word("Иван")}\r\n ${word("Петров")} <ivan@corp.ru>`], "ivan@corp.ru"],
    [["From: =?koi8-r?Q?=E9=D7=C1=CE?= <ivan@corp.ru>"], "ivan@corp.ru"],
    // слово вплотную к «<» и слова подряд без пробела: адрес рядом ни при чём
    [[`From: ${word("Иван")}<ivan@corp.ru>`], "ivan@corp.ru"],
    [[`From: ${word("Ив")}${word("ан")} <ivan@corp.ru>`], "ivan@corp.ru"],
    // заглавные кириллические буквы в адресе: нижний регистр остаётся кириллицей
    [["From: Иван@Клиент.РФ"], "иван@клиент.рф"],
    // точка и прочая пунктуация в слове — небрежность, а не подвох
    [["From: =?UTF-8?Q?J._Smith?= <j.smith@corp.ru>"], "j.smith@corp.ru"],
    // буква с диакритикой в адресе: нижний регистр остаётся буквой, а не ASCII
    [["From: Müller@Corp.DE"], "müller@corp.de"],
    // другое поле, имя которого только начинается с «From», — не второй From
    [["From: ivan@corp.ru", "From-Id: 1"], "ivan@corp.ru"],
    // домен как punycode в заголовке: mailparser отдаёт юникод, адрес тот же
    [["From: ivan@xn--h1aaehj.xn--p1ai"], "ivan@омкии.рф"],
    [["From: ivan@клиент.рф"], "ivan@клиент.рф"],
  ]) {
    assert.equal(senderAddress(await parse(...headers)), expected, headers.join(" | "));
  }
});

test("a From line over 4096 characters names nobody", async () => {
  // Строка заголовка целиком, с «From: »: ровно предел проходит, на знак больше — нет
  const header = (length) => {
    const tail = " <ivan@corp.ru>";
    return `From: ${"a".repeat(length - "From: ".length - tail.length)}${tail}`;
  };
  assert.equal(header(4096).length, 4096);
  assert.equal(senderAddress(await parse(header(4096))), "ivan@corp.ru");
  assert.equal(senderAddress(await parse(header(4097))), "");
});

test("an address over 254 characters names nobody", async () => {
  const address = (length) => `${"a".repeat(length - "@corp.ru".length)}@corp.ru`;
  assert.equal(address(254).length, 254);
  assert.equal(senderAddress(await parse(`From: ${address(254)}`)), address(254));
  const tooLong = await parse(`From: ${address(255)}`);
  assert.equal(senderAddress(tooLong), "");
  assert.equal(senderLine(tooLong), "");
});

test("realSender: «Name <address>» from the parsed From, and the address wins", async () => {
  const cases = [
    ['From: "Иван Петров" <IVAN@Corp.RU>', "Иван Петров <ivan@corp.ru>"],
    ["From: ivan@corp.ru", "ivan@corp.ru"],
    [
      "From: MAILER-DAEMON@mx.example.com (Mail Delivery System)",
      "Mail Delivery System <mailer-daemon@mx.example.com>",
    ],
    // Имя с адресом внутри отбрасывается: фронт показал бы его вместо
    // настоящего
    ['From: "boss@client.ru" <x@evil.com>', "x@evil.com"],
    [
      `From: =?UTF-8?B?${Buffer.from("Иван <boss@client.ru>").toString("base64")}?= <a@evil.com>`,
      "a@evil.com",
    ],
  ];
  for (const [from, expected] of cases) {
    const mail = await parse(from);
    assert.equal(senderLine(mail), expected, from);
    assert.equal(
      senderLine(mail).match(FRONTEND_ADDRESS_RE)[0].toLowerCase(),
      senderAddress(mail),
      from,
    );
  }
  // Адреса нет — показывать нечего
  assert.equal(senderLine(await parse("From: <>")), "");
  assert.equal(senderLine(undefined), "");
});

test("realSender: a plus tag or an apostrophe keeps the sender, a domain the frontend reads differently drops it", async () => {
  assert.equal(senderLine(await parse("From: ivan+tag@corp.ru")), "ivan+tag@corp.ru");
  assert.equal(senderLine(await parse("From: o'brien@corp.ru")), "o'brien@corp.ru");
  // Фронт прочёл бы здесь boss@client.ru, настоящий же домен — другой
  for (const from of ["boss@client.ru!evil.com", "boss@client.ru+evil.com"]) {
    assert.equal(senderLine(await parse(`From: ${from}`)), "", from);
  }
});

test("realSender: whitespace inside the name is collapsed to single spaces", async () => {
  // mailparser отдаёт имя как написано: с повторными пробелами и табуляцией
  assert.equal(
    senderLine(await parse('From: "Ivan   \t Petrov" <ivan@corp.ru>')),
    "Ivan Petrov <ivan@corp.ru>",
  );
});

test("a display name over 200 characters is dropped, the address stays", async () => {
  const name = (length) => "Н".repeat(length);
  const kept = await parse(`From: "${name(200)}" <ivan@corp.ru>`);
  assert.equal(senderLine(kept), `${name(200)} <ivan@corp.ru>`);
  const dropped = await parse(`From: "${name(201)}" <ivan@corp.ru>`);
  assert.equal(senderLine(dropped), "ivan@corp.ru");
  // Пропадает только имя: адрес тот же
  assert.equal(senderAddress(dropped), "ivan@corp.ru");
});

test("the applicant is identified only when allowed and the sender check didn't fail", () => {
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "none" }), true);
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "pass" }), true);
  // Подделка не должна открыть заявку от имени клиента и слать ему уведомления
  assert.equal(mayIdentifyApplicant({ identifyApplicant: true, authVerdict: "fail" }), false);
  assert.equal(mayIdentifyApplicant({ identifyApplicant: false, authVerdict: "pass" }), false);
  assert.equal(
    mayIdentifyApplicant({ identifyApplicant: undefined, authVerdict: "none" }),
    false,
  );
});

test("the domain is what follows the last @", () => {
  assert.equal(senderDomain("ivan@corp.ru"), "corp.ru");
  assert.equal(senderDomain("IVAN@Corp.RU"), "corp.ru");
  assert.equal(senderDomain("user@"), "");
  assert.equal(senderDomain(""), "");
  assert.equal(senderDomain(undefined), "");
});

test("a domain over 253 characters is no domain, and no company matches that", () => {
  const domain = (length) => `${"b".repeat(length - ".ru".length)}.ru`;
  assert.equal(domain(253).length, 253);
  assert.equal(senderDomain(`ivan@${domain(253)}`), domain(253));
  assert.equal(senderDomain(`ivan@${domain(254)}`), "");
  // Такой домен даёт условие, под которое не подходит ни одна компания, а не
  // регулярное выражение в сотню килобайт
  assert.deepEqual(companyDomainFilter(senderDomain(`ivan@${domain(254)}`)), {
    emailDomains: { $in: [] },
  });
});

test("company domains match whole and case-insensitively", () => {
  const { emailDomains } = companyDomainFilter("client.ru");
  for (const stored of ["client.ru", "Client.RU", "CLIENT.RU"]) {
    assert.equal(emailDomains.test(stored), true, stored);
  }
  for (const stored of ["sub.client.ru", "client.ru.evil.com", "clientXru", "client.rus"]) {
    assert.equal(emailDomains.test(stored), false, stored);
  }
});

test("a domain is taken literally, and an empty one matches nothing", () => {
  assert.equal(companyDomainFilter("a+b.ru").emailDomains.test("a+b.ru"), true);
  assert.equal(companyDomainFilter("a+b.ru").emailDomains.test("aab.ru"), false);
  assert.deepEqual(companyDomainFilter(""), { emailDomains: { $in: [] } });
});

test("the envelope: sender, Message-ID and the topmost Authentication-Results", async () => {
  const mail = await parse(
    "Authentication-Results: mx.f1lab.ru;",
    "\tspf=pass smtp.mailfrom=evil.com;",
    "\tdmarc=fail (p=REJECT) header.from=client.ru",
    "Authentication-Results: evil.com; dmarc=pass header.from=client.ru",
    'From: "boss@client.ru" <Attacker@Evil.COM>',
    "Subject: Re: [F1-HD-45926] x",
    "Message-ID: <abc.123@evil.com>",
  );
  assert.deepEqual(inboundEnvelope(mail), {
    fromAddress: "attacker@evil.com",
    realSender: "attacker@evil.com",
    messageId: "<abc.123@evil.com>",
    authResults:
      "mx.f1lab.ru; spf=pass smtp.mailfrom=evil.com; dmarc=fail (p=REJECT) header.from=client.ru",
  });
});

test("the envelope: a single header, and neither Message-ID nor results", async () => {
  assert.deepEqual(
    inboundEnvelope(
      await parse(
        "Authentication-Results: mx.f1lab.ru; dkim=pass header.d=client.ru",
        "From: ivan@client.ru",
        "Subject: x",
      ),
    ),
    {
      fromAddress: "ivan@client.ru",
      realSender: "ivan@client.ru",
      messageId: undefined,
      authResults: "mx.f1lab.ru; dkim=pass header.d=client.ru",
    },
  );
  assert.deepEqual(
    inboundEnvelope(await parse('From: "Иван" <ivan@client.ru>', "Subject: x")),
    {
      fromAddress: "ivan@client.ru",
      realSender: "Иван <ivan@client.ru>",
      messageId: undefined,
      authResults: "",
    },
  );
});

test("the envelope: a Message-ID of nothing but brackets, or over 998 characters, is no Message-ID", async () => {
  const id = (length) => `<${"a".repeat(length - 2)}>`;
  for (const [value, expected] of [
    // mailparser не отдаёт пустую строку: «<>» приходит как есть, и все такие
    // письма совпали бы между собой
    ["<>", undefined],
    ["< >", undefined],
    ["<<>>", undefined],
    ["<\t>", undefined],
    ["<a@x>", "<a@x>"],
    [id(998), id(998)],
    [id(999), undefined],
  ]) {
    const mail = await parse("From: a@b.ru", `Message-ID: ${value}`);
    assert.equal(
      inboundEnvelope(mail).messageId,
      expected,
      value.length > 40 ? `${value.length} characters` : value,
    );
  }
});

test("the envelope: the Message-ID is taken without surrounding whitespace", () => {
  assert.equal(inboundEnvelope({ messageId: "  <a@x>\r\n" }).messageId, "<a@x>");
  assert.equal(inboundEnvelope({ messageId: "  " }).messageId, undefined);
  assert.equal(inboundEnvelope({ messageId: 42 }).messageId, undefined);
});

test("the envelope: a sender that cannot be named leaves both address fields empty", async () => {
  const mail = await parse("From: x@evil.com", "From: boss@client.ru", "Message-ID: <a@x>");
  assert.deepEqual(inboundEnvelope(mail), {
    fromAddress: "",
    realSender: "",
    messageId: "<a@x>",
    authResults: "",
  });
});

// Модели с тем, что читает поиск повтора; calls — какие запросы ушли
const fakeModels = ({ tickets = {}, comments = {} } = {}) => {
  const calls = [];
  return {
    calls,
    Ticket: {
      exists: async (filter) => {
        calls.push(["Ticket.exists", filter]);
        return tickets[filter.emailMessageId] || null;
      },
    },
    Comment: {
      findOne: (filter, projection) => ({
        lean: async () => {
          calls.push(["Comment.findOne", filter, projection]);
          return comments[filter.emailMessageId] || null;
        },
      }),
    },
  };
};

test("repeats: without a Message-ID nothing is a repeat and nothing is queried", async () => {
  const models = fakeModels();
  assert.equal(await findImportedMessage(undefined, models), null);
  assert.equal(await findImportedMessage("", models), null);
  assert.deepEqual(models.calls, []);
});

test("repeats: an e-mail that became a ticket", async () => {
  const models = fakeModels({ tickets: { "<a@x>": { _id: "t-1" } } });
  assert.deepEqual(await findImportedMessage("<a@x>", models), { ticketId: "t-1" });
  assert.deepEqual(models.calls, [["Ticket.exists", { emailMessageId: "<a@x>" }]]);
});

test("repeats: an e-mail that became a comment names the comment and its ticket", async () => {
  const models = fakeModels({
    comments: { "<b@x>": { _id: "c-1", ticketId: "t-2" } },
  });
  assert.deepEqual(await findImportedMessage("<b@x>", models), {
    ticketId: "t-2",
    commentId: "c-1",
  });
  assert.deepEqual(models.calls, [
    ["Ticket.exists", { emailMessageId: "<b@x>" }],
    ["Comment.findOne", { emailMessageId: "<b@x>" }, { _id: 1, ticketId: 1 }],
  ]);
});

test("repeats: an e-mail seen for the first time", async () => {
  assert.equal(await findImportedMessage("<new@x>", fakeModels()), null);
});

test("repeats: only a non-blank string is looked up", async () => {
  const models = fakeModels({ tickets: { "<a@x>": { _id: "t-1" } } });
  // Объект вроде { $ne: null } дошёл бы до запроса и совпал с любой заявкой
  for (const value of [null, 0, 42, true, {}, { $ne: null }, ["<a@x>"], " ", "\t\n"]) {
    assert.equal(await findImportedMessage(value, models), null, JSON.stringify(value));
  }
  assert.deepEqual(models.calls, []);
});

test("hostile From lines at the size limit are read quickly", async () => {
  const from = { value: [{ address: "x@evil.com", name: "" }] };
  const started = Date.now();
  for (const filler of ['"', "(", "a@", "=?", "<", "a", "\\", " <"]) {
    const line = `From: ${filler.repeat(4096)}`.slice(0, 4096);
    assert.equal(senderAddress({ from, headerLines: [{ key: "from", line }] }), "", filler);
  }
  // С запасом: на разборе таких строк уходят миллисекунды, а не секунды
  assert.ok(Date.now() - started < 250, `took ${Date.now() - started} ms`);
});
