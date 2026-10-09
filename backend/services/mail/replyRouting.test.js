// node --test services/mail/replyRouting.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseAuthResults,
  isTicketParticipant,
  routeReply,
  rerouteNote,
  withRerouteNote,
  rejectedAutoReplyEvent,
  planReply,
} = require("./replyRouting");
const { classify } = require("../ticketEvents");

// Заголовок так, как его отдаёт mailparser: свёрнутые строки уже склеены
const MX = "mx.f1lab.ru";

test("auth: a DMARC failure fails whatever else passed", () => {
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom=evil.com; dkim=pass header.d=evil.com; dmarc=fail (p=REJECT sp=REJECT dis=REJECT) header.from=client.ru`,
    ),
    "fail",
  );
});

test("auth: an SPF failure fails unless DKIM passed", () => {
  assert.equal(
    parseAuthResults(`${MX}; spf=fail smtp.mailfrom=client.ru; dkim=none`),
    "fail",
  );
  assert.equal(
    parseAuthResults(
      `${MX}; spf=fail smtp.mailfrom=client.ru; dkim=pass header.d=client.ru`,
    ),
    "pass",
  );
});

test("auth: DMARC or DKIM pass is a pass, SPF alone is not", () => {
  assert.equal(parseAuthResults(`${MX}; dmarc=pass header.from=client.ru`), "pass");
  assert.equal(parseAuthResults(`${MX}; dkim=pass header.d=client.ru`), "pass");
  assert.equal(parseAuthResults(`${MX}; spf=pass smtp.mailfrom=client.ru`), "none");
});

test("auth: soft and neutral results decide nothing", () => {
  for (const header of [
    `${MX}; spf=softfail smtp.mailfrom=client.ru; dkim=none; dmarc=none`,
    `${MX}; spf=neutral smtp.mailfrom=client.ru`,
    `${MX}; spf=temperror; dkim=permerror`,
    `${MX}; dmarc=bestguesspass header.from=client.ru`,
  ]) {
    assert.equal(parseAuthResults(header), "none", header);
  }
});

test("auth: a missing or unparseable header is none", () => {
  for (const value of [undefined, null, "", "garbage", `${MX}; none`, 42, {}, []]) {
    assert.equal(parseAuthResults(value), "none", String(value));
  }
});

test("auth: only the topmost header counts", () => {
  // Верхний ставит наш сервер; нижние приехали вместе с письмом
  assert.equal(
    parseAuthResults([
      `${MX}; dmarc=fail header.from=client.ru`,
      "evil.com; dmarc=pass",
    ]),
    "fail",
  );
  assert.equal(
    parseAuthResults([
      `${MX}; dmarc=pass header.from=client.ru`,
      "evil.com; dmarc=fail",
    ]),
    "pass",
  );
});

test("auth: case, method versions and comments", () => {
  assert.equal(
    parseAuthResults(`${MX}; SPF=Fail smtp.mailfrom=client.ru; DKIM=None`),
    "fail",
  );
  assert.equal(parseAuthResults(`${MX}; dkim/1=pass header.d=client.ru`), "pass");
  assert.equal(
    parseAuthResults(`${MX}; (проверено) dmarc=fail header.from=client.ru`),
    "fail",
  );
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass (${MX}: domain of a@client.ru designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@client.ru; dkim=pass header.i=@client.ru; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=client.ru`,
    ),
    "fail",
  );
});

test("auth: sender-controlled text cannot hide a DMARC failure", () => {
  // Незакрытые кавычка и скобка в адресе конверта не глотают следующую часть
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom="x(y"@evil.com; dmarc=fail header.from=client.ru`,
    ),
    "fail",
  );
  // «;» в адресе даёт лишнюю часть — разве что ложный pass, fail она не прячет
  assert.equal(
    parseAuthResults(
      `${MX}; spf=pass smtp.mailfrom=x;dmarc=pass@evil.com; dmarc=fail header.from=client.ru`,
    ),
    "fail",
  );
});

const CLIENT_CO = "c-client";
const TICKET = {
  num: 45926,
  isClosed: false,
  applicantId: "u-applicant",
  responsibles: [{ _id: "u-resp", firstName: "Ольга" }],
  company: { _id: CLIENT_CO, alias: "Клиент" },
};
// Клиент чужой компании, если не сказано иное
const user = (id, fields = {}) => ({
  _id: id,
  isEndUser: true,
  company: { _id: "c-other" },
  ...fields,
});
const APPLICANT = user("u-applicant");
const RESPONSIBLE = user("u-resp");
// Коллега из компании заявки: связи с заявкой нет, компания та же
const COLLEAGUE = user("u-colleague", { company: { _id: CLIENT_CO } });
const OUTSIDER = user("u-outsider");
// Сотрудник — явный isEndUser: false
const STAFF = user("u-staff", { isEndUser: false, company: { _id: "c-f1lab" } });
const DAY = 24 * 60 * 60 * 1000;

// Правило одно для всех (решение владельца 2026-10-03): письмом в заявку пишет
// тот, кому она видна в интерфейсе. inScope считает вызывающий —
// canAccessTicket; сама isTicketParticipant связей отправителя с заявкой не
// читает, и тесты это фиксируют: клиента и сотрудника проверяет один ответ.
test("participants: whoever the ticket is visible to in the UI, client or staff alike", () => {
  // Заявитель, ответственный, клиент с ролью на всю компанию, сотрудник с
  // доступом — для правила все они «видят»; клиент другой компании, которому
  // заявка видна по скоупу роли (например, как автору), — тоже
  for (const sender of [APPLICANT, RESPONSIBLE, COLLEAGUE, OUTSIDER, STAFF]) {
    assert.equal(
      isTicketParticipant(TICKET, sender, { inScope: true }),
      true,
      String(sender._id),
    );
  }
});

test("participants: nobody is one unless the ticket is visible to them", () => {
  // Без inScope — как с false. Коллега из компании заявки с обычной ролью
  // видит только свои заявки и в чужую письмом не пишет; сторонний исполнитель
  // тоже; даже заявитель без подтверждения вызывающего — не участник
  for (const sender of [APPLICANT, RESPONSIBLE, COLLEAGUE, OUTSIDER, STAFF]) {
    const name = String(sender._id);
    assert.equal(isTicketParticipant(TICKET, sender), false, name);
    assert.equal(isTicketParticipant(TICKET, sender, {}), false, name);
    assert.equal(isTicketParticipant(TICKET, sender, { inScope: false }), false, name);
    // Только настоящее true: обещание от забытого await «истинно», но не пускает
    assert.equal(
      isTicketParticipant(TICKET, sender, { inScope: Promise.resolve(true) }),
      false,
      name,
    );
    assert.equal(isTicketParticipant(TICKET, sender, { inScope: "yes" }), false, name);
  }
});

test("participants: a colleague from the ticket's company is not one by the company alone", () => {
  // Решение владельца 2026-10-03: клиент не пишет письмом в заявки коллег.
  // Обычная роль «Клиент» видит только свои заявки (services/ticketScope)
  assert.equal(isTicketParticipant(TICKET, COLLEAGUE, { inScope: false }), false);
  // Роль «Видеть заявки своих компаний» открывает заявку компании — и письмо входит
  assert.equal(isTicketParticipant(TICKET, COLLEAGUE, { inScope: true }), true);
});

test("participants: an account without the type flag is a client, and the same rule applies", () => {
  // Сотрудник — только явный isEndUser: false; учётка без признака — клиент
  const flagless = user("u-legacy", { isEndUser: undefined });
  assert.equal(isTicketParticipant(TICKET, flagless), false);
  assert.equal(isTicketParticipant(TICKET, flagless, { inScope: false }), false);
  assert.equal(isTicketParticipant(TICKET, flagless, { inScope: true }), true);
});

test("participants: with nothing to go on nobody is one, even if the caller says «visible»", () => {
  assert.equal(isTicketParticipant(TICKET, null, { inScope: true }), false);
  assert.equal(isTicketParticipant(TICKET, undefined, { inScope: true }), false);
  // Без id отправитель — не учётка
  assert.equal(
    isTicketParticipant(TICKET, { isEndUser: false }, { inScope: true }),
    false,
  );
  assert.equal(isTicketParticipant(TICKET, user(undefined), { inScope: true }), false);
  // Нет заявки — писать некуда
  assert.equal(isTicketParticipant(null, APPLICANT, { inScope: true }), false);
  assert.equal(isTicketParticipant(null, STAFF, { inScope: true }), false);
});

test("participants: a denied account is never one, even when the ticket is visible to it", () => {
  // Основания отказа — те же, что у браузера и Телеграма (services/accountDenial)
  const denials = {
    "banned, no expiry": { banned: true },
    "banned, expiry ahead": {
      banned: true,
      banExpires: new Date(Date.now() + DAY),
    },
    "company switched off": { company: { _id: CLIENT_CO, isActive: false } },
    "service account": { isServiceAccount: true },
  };
  // Компания заявки у всех — чтобы никто не отпадал по другой причине
  const sender = (id, fields = {}) =>
    user(id, { company: { _id: CLIENT_CO }, ...fields });
  const senders = [
    ["applicant", sender("u-applicant")],
    ["responsible", sender("u-resp")],
    ["company member", sender("u-colleague")],
    ["staff", sender("u-staff", { isEndUser: false })],
  ];

  for (const [name, fields] of Object.entries(denials)) {
    for (const [kind, account] of senders) {
      // Без отказа та же учётка с видимой заявкой — участник: отпадает она
      // именно по отказу, а не потому что заявка ей не видна
      assert.equal(isTicketParticipant(TICKET, account, { inScope: true }), true, kind);
      assert.equal(
        isTicketParticipant(TICKET, { ...account, ...fields }, { inScope: true }),
        false,
        `${name}: ${kind}`,
      );
    }
  }
});

test("participants: a ban whose expiry has passed bars nobody", () => {
  const lifted = { banned: true, banExpires: new Date(Date.now() - DAY) };
  assert.equal(
    isTicketParticipant(TICKET, user("u-applicant", lifted), { inScope: true }),
    true,
  );
  assert.equal(
    isTicketParticipant(TICKET, { ...STAFF, ...lifted }, { inScope: true }),
    true,
  );
});

test("route: a reply is a comment when the ticket is visible to the sender and the sender check did not fail", () => {
  assert.equal(
    routeReply({ ticket: TICKET, sender: APPLICANT, authVerdict: "none", inScope: true }),
    "comment",
  );
  // Сервер, который не добавляет Authentication-Results, даёт вердикт «none»:
  // решает одна проверка участника, и ответ участника любого вида — комментарий
  for (const sender of [APPLICANT, RESPONSIBLE, COLLEAGUE, STAFF]) {
    for (const authVerdict of ["none", "pass"]) {
      assert.equal(
        routeReply({ ticket: TICKET, sender, authVerdict, inScope: true }),
        "comment",
        `${sender._id}, ${authVerdict}`,
      );
    }
  }
  assert.equal(
    routeReply({ ticket: TICKET, sender: APPLICANT, authVerdict: "fail", inScope: true }),
    "newTicket",
  );
});

test("route: a reply gets a comment only when the ticket is visible to the sender, client or staff", () => {
  for (const sender of [APPLICANT, RESPONSIBLE, COLLEAGUE, OUTSIDER, STAFF]) {
    for (const authVerdict of ["none", "pass"]) {
      for (const scope of [{}, { inScope: false }]) {
        assert.equal(
          routeReply({ ticket: TICKET, sender, authVerdict, ...scope }),
          "newTicket",
          `${sender._id}, ${authVerdict}, ${JSON.stringify(scope)}`,
        );
      }
    }
  }
  // Видимая заявка не отменяет проверку отправителя — ни клиенту, ни сотруднику
  for (const sender of [APPLICANT, STAFF]) {
    assert.equal(
      routeReply({ ticket: TICKET, sender, authVerdict: "fail", inScope: true }),
      "newTicket",
      String(sender._id),
    );
  }
});

test("route: a denied account gets a new ticket even as the applicant", () => {
  for (const fields of [
    { banned: true },
    { banned: true, banExpires: new Date(Date.now() + DAY) },
    { company: { _id: CLIENT_CO, isActive: false } },
    { isServiceAccount: true },
  ]) {
    // Заявка видна (inScope): отказ решает сам
    assert.equal(
      routeReply({
        ticket: TICKET,
        sender: user("u-applicant", fields),
        authVerdict: "pass",
        inScope: true,
      }),
      "newTicket",
      JSON.stringify(fields),
    );
    assert.equal(
      routeReply({
        ticket: TICKET,
        sender: { ...STAFF, ...fields },
        authVerdict: "pass",
        inScope: true,
      }),
      "newTicket",
      JSON.stringify(fields),
    );
  }
});

test("route: outsiders, unknown senders and missing tickets get a new ticket", () => {
  // Заявка постороннему не видна
  assert.equal(
    routeReply({ ticket: TICKET, sender: OUTSIDER, authVerdict: "pass", inScope: false }),
    "newTicket",
  );
  // Остальное решают не видимость, а отсутствие отправителя и заявки
  assert.equal(
    routeReply({ ticket: TICKET, sender: null, authVerdict: "none", inScope: true }),
    "newTicket",
  );
  assert.equal(
    routeReply({ ticket: null, sender: APPLICANT, authVerdict: "pass", inScope: true }),
    "newTicket",
  );
});

test("note: names the ticket and the reason", () => {
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: null, authVerdict: "fail" }),
    "Письмо пришло ответом на заявку №45926, но такой заявки нет",
  );
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: TICKET, authVerdict: "fail" }),
    "Письмо пришло ответом на заявку №45926, но не прошло проверку отправителя",
  );
  assert.equal(
    rerouteNote({ ticketNum: 45926, ticket: TICKET, authVerdict: "none" }),
    "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
  );
});

test("description: the note is its own paragraph above the mail text", () => {
  const note =
    "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует";
  assert.equal(
    withRerouteNote("Добрый день!\nПринтер снова не печатает", note),
    `<p>${note}</p>\nДобрый день!\nПринтер снова не печатает`,
  );
  assert.equal(withRerouteNote("", note), `<p>${note}</p>`);
  assert.equal(withRerouteNote(undefined, note), `<p>${note}</p>`);
});

test("description: without a note it stays as it came", () => {
  assert.equal(withRerouteNote("Текст", null), "Текст");
  assert.equal(withRerouteNote(undefined, null), undefined);
});

test("plan: a participant's reply is a comment; a robot's reply to a closed ticket is only logged", () => {
  const plan = (ticket, fromMachine) =>
    planReply({
      ticketNum: 45926,
      ticket,
      sender: APPLICANT,
      authVerdict: "none",
      inScope: true,
      fromMachine,
    });
  const closed = { ...TICKET, isClosed: true };
  assert.deepEqual(plan(TICKET, false), { action: "comment", note: null });
  // Открытой заявке всё равно, робот ли ответил (services/machineMail)
  assert.deepEqual(plan(TICKET, true), { action: "comment", note: null });
  assert.deepEqual(plan(closed, false), { action: "comment", note: null });
  assert.deepEqual(plan(closed, true), { action: "autoReplyLog", note: null });
});

test("plan: anything else is a new ticket carrying the note", () => {
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: OUTSIDER,
      authVerdict: "none",
      inScope: false,
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
    },
  );
  // Коллега из компании заявки, которому она не видна в интерфейсе (обычная
  // роль «Клиент»): письмом в заявку не пишет — новая заявка с той же пометкой
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: COLLEAGUE,
      authVerdict: "none",
      inScope: false,
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
    },
  );
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: APPLICANT,
      authVerdict: "fail",
      inScope: true,
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но не прошло проверку отправителя",
    },
  );
  assert.deepEqual(
    planReply({
      ticketNum: 99999,
      ticket: null,
      sender: null,
      authVerdict: "none",
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №99999, но такой заявки нет",
    },
  );
});

test("plan: a robot that isn't let in opens no ticket, only a log line on #N", () => {
  // Отбойник на уведомление, автоответ с пересылки: заявка на каждое письмо
  // была бы мусором
  const robot = (fields) =>
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: OUTSIDER,
      authVerdict: "none",
      fromMachine: true,
      fromAddress: "mailer-daemon@mx.other.ru",
      ...fields,
    });
  const outsiderLine = {
    action: "logOnly",
    note: "автоответ от mailer-daemon@mx.other.ru не принят: отправитель не участвует в заявке",
  };
  assert.deepEqual(robot({}), outsiderLine);
  assert.deepEqual(robot({ ticket: { ...TICKET, isClosed: true } }), outsiderLine);
  assert.deepEqual(robot({ sender: null }), outsiderLine);
  // Коллега из компании заявки без доступа к ней в интерфейсе — тоже не участник
  assert.deepEqual(
    robot({ sender: COLLEAGUE, inScope: false, fromAddress: "olga@client.ru" }),
    {
      action: "logOnly",
      note: "автоответ от olga@client.ru не принят: отправитель не участвует в заявке",
    },
  );
  assert.deepEqual(
    robot({
      sender: APPLICANT,
      authVerdict: "fail",
      inScope: true,
      fromAddress: "ivan@client.ru",
    }),
    {
      action: "logOnly",
      note: "автоответ от ivan@client.ru не принят: не прошёл проверку отправителя",
    },
  );
  // Заявки нет — ни заявки, ни строки в её логе: остаётся журнал сервера
  assert.deepEqual(robot({ ticket: null }), { action: "logOnly", note: null });
});

// Правило одно для клиента и сотрудника: вне своей видимости — как посторонний
for (const [kind, sender, address] of [
  ["staff", STAFF, "contractor@f1lab.ru"],
  ["a client colleague", COLLEAGUE, "olga@client.ru"],
]) {
  test(`plan: ${kind} outside their scope is handled like an outsider`, () => {
    const plan = (fields) =>
      planReply({
        ticketNum: 45926,
        ticket: TICKET,
        sender,
        authVerdict: "none",
        fromMachine: false,
        ...fields,
      });
    const closed = { ...TICKET, isClosed: true };
    const note =
      "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует";

    // Заявка видна — всё, как у любого участника
    assert.deepEqual(plan({ inScope: true }), { action: "comment", note: null });
    assert.deepEqual(plan({ inScope: true, fromMachine: true }), {
      action: "comment",
      note: null,
    });
    assert.deepEqual(plan({ inScope: true, ticket: closed, fromMachine: true }), {
      action: "autoReplyLog",
      note: null,
    });

    // Не видна (или вызывающий не сказал) — новая заявка с пометкой; у робота —
    // только строка в логе №N, открыта заявка или закрыта
    const robot = { fromMachine: true, fromAddress: address };
    const robotLine = {
      action: "logOnly",
      note: `автоответ от ${address} не принят: отправитель не участвует в заявке`,
    };
    for (const scope of [{}, { inScope: false }]) {
      assert.deepEqual(plan(scope), { action: "newTicket", note });
      assert.deepEqual(plan({ ...scope, ...robot }), robotLine);
      assert.deepEqual(plan({ ...scope, ...robot, ticket: closed }), robotLine);
    }
  });
}

test("plan: a denied account's reply is handled like an outsider's", () => {
  const banned = user("u-applicant", { banned: true });
  // Заявка видна (inScope): отказ решает сам
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: banned,
      authVerdict: "pass",
      inScope: true,
      fromMachine: false,
    }),
    {
      action: "newTicket",
      note: "Письмо пришло ответом на заявку №45926, но отправитель в ней не участвует",
    },
  );
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: banned,
      authVerdict: "pass",
      inScope: true,
      fromMachine: true,
      fromAddress: "ivan@client.ru",
    }),
    {
      action: "logOnly",
      note: "автоответ от ivan@client.ru не принят: отправитель не участвует в заявке",
    },
  );
});

test("robot log line: the address only; an unknown sender is named as such", () => {
  assert.equal(
    rejectedAutoReplyEvent({ fromAddress: "", authVerdict: "none" }),
    "автоответ от неизвестного отправителя не принят: отправитель не участвует в заявке",
  );
  assert.equal(
    rejectedAutoReplyEvent({ fromAddress: "x@evil.com", authVerdict: "fail" }),
    "автоответ от x@evil.com не принят: не прошёл проверку отправителя",
  );
  // В хронике это «прочее» с текстом, а не чужой вид события
  // (services/ticketEvents)
  for (const authVerdict of ["none", "fail"]) {
    assert.equal(
      classify(rejectedAutoReplyEvent({ fromAddress: "x@evil.com", authVerdict })),
      "other",
    );
  }
});

test("robot log line: a plain address is kept as it is", () => {
  for (const fromAddress of [
    "robot@client.ru",
    "mailer-daemon@mx.other.ru",
    "Ivan.Petrov+tag_1%x@mail.client-corp.ru",
  ]) {
    for (const [authVerdict, reason] of [
      ["none", "отправитель не участвует в заявке"],
      ["fail", "не прошёл проверку отправителя"],
    ]) {
      const event = rejectedAutoReplyEvent({ fromAddress, authVerdict });
      assert.equal(event, `автоответ от ${fromAddress} не принят: ${reason}`);
      assert.equal(classify(event), "other", fromAddress);
    }
  }
});

test("robot log line: a hostile address never reaches the line", () => {
  // Ленту заявки разбирают по фразам (services/ticketEvents), а адрес —
  // то, что выбрал отправитель: кавычки и пробелы mailparser отдаёт как есть
  const hostile = [
    // «Отказ от заявки» в хронике сотрудников, причина — текст отправителя
    '"отказ от заявки по причине звоните 8-800"@evil.com',
    // «Возвращена в работу» — событие, видимое клиенту
    "вернул@evil.com",
    '"вернул"@evil.com',
    // Строка пропала бы из ленты как комментарий
    "добавлен комментарий@evil.com",
    // Обычный адрес с текстом до него или после — уже не адрес
    "вернул robot@evil.com",
    "robot@evil.com вернул",
    // Не лог в 5 КБ
    `${"a".repeat(5000)}@evil.com`,
    // Перевод строки — не часть адреса
    "robot@client.ru\nвернул",
    "robot@client.ru\n",
    // Нет адреса или он не строка
    "",
    undefined,
    null,
    42,
    { address: "robot@client.ru" },
    // Массив при приведении к строке даёт обычный адрес — не проходит
    ["robot@client.ru"],
  ];
  for (const fromAddress of hostile) {
    for (const [authVerdict, reason] of [
      ["none", "отправитель не участвует в заявке"],
      ["fail", "не прошёл проверку отправителя"],
    ]) {
      const event = rejectedAutoReplyEvent({ fromAddress, authVerdict });
      const shown = JSON.stringify(fromAddress)?.slice(0, 50);
      // Ни отказом, ни возвратом в работу, ни скрытым комментарием строка
      // не становится — это «прочее»
      assert.equal(classify(event), "other", shown);
      assert.equal(
        event,
        `автоответ от неизвестного отправителя не принят: ${reason}`,
        shown,
      );
    }
  }

  // Тем же путём, что идёт из planReply
  assert.deepEqual(
    planReply({
      ticketNum: 45926,
      ticket: TICKET,
      sender: OUTSIDER,
      authVerdict: "none",
      fromMachine: true,
      fromAddress: '"вернул"@evil.com',
    }),
    {
      action: "logOnly",
      note: "автоответ от неизвестного отправителя не принят: отправитель не участвует в заявке",
    },
  );
});

test("robot log line: an address longer than 254 characters is not an address", () => {
  // Локальная часть в 64 знака — предел; длину добирает домен
  const addressOfLength = (length) =>
    `${"a".repeat(64)}@${"b".repeat(length - 65)}`;
  const line = (fromAddress) =>
    rejectedAutoReplyEvent({ fromAddress, authVerdict: "none" });

  assert.equal(addressOfLength(254).length, 254);
  assert.equal(
    line(addressOfLength(254)),
    `автоответ от ${addressOfLength(254)} не принят: отправитель не участвует в заявке`,
  );
  assert.equal(
    line(addressOfLength(255)),
    "автоответ от неизвестного отправителя не принят: отправитель не участвует в заявке",
  );
  // Локальная часть в 65 знаков — тоже нет
  assert.equal(
    line(`${"a".repeat(65)}@evil.com`),
    "автоответ от неизвестного отправителя не принят: отправитель не участвует в заявке",
  );
});

test("participants: ties to the ticket never replace the UI check, for staff or for clients", () => {
  // Учётка с id заявителя, ответственного или человека из компании заявки:
  // связь с заявкой участником не делает — решает видимость в интерфейсе
  const ties = [
    { _id: "u-applicant" },
    { _id: "u-resp" },
    { _id: "u-colleague", company: { _id: CLIENT_CO } },
  ];
  for (const base of [STAFF, user("u-client")]) {
    for (const tie of ties) {
      const account = { ...base, ...tie };
      const name = `${account.isEndUser === false ? "staff" : "client"} ${account._id}`;
      assert.equal(isTicketParticipant(TICKET, account), false, name);
      assert.equal(isTicketParticipant(TICKET, account, { inScope: false }), false, name);
      assert.equal(isTicketParticipant(TICKET, account, { inScope: true }), true, name);
    }
  }
});
