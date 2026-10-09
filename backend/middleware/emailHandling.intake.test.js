// node --test middleware/emailHandling.intake.test.js
require("module-alias/register");
const Module = require("node:module");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

/**
 * Что сбор писем пишет в журнал сервера о самом письме: отправитель, которого
 * разбор From не принял (итоговый разбор W1, I-2), и пределы на то, что пишет сам
 * отправитель (M-4).
 *
 * Прогон настоящий: `handleNewEmails` идёт по поддельному IMAP-соединению, письма
 * разбирает настоящий mailparser, настоящие `inboundEnvelope`, `planReply`, поиск по
 * номеру (services/callerIdentityService) и `canAccessTicket`. Подменены только границы:
 * настройки, соединение, модели, журнал и сборка прав отправителя (buildAuthContext ходит
 * в роли организации и better-auth — их в тесте нет). Модель заявок подменена в
 * require.cache до загрузки обработчика — models/ticket.js на верхнем уровне зовёт
 * initCounter(), и без базы в выводе остаётся «Failed to initialize counter» (тот же
 * приём, что в emailHandling.secrets.test.js); заявка из заглушки запоминается в
 * `created`, чтобы видеть, что письмо всё равно стало заявкой.
 */

const created = [];
class TicketStub {
  constructor(fields) {
    Object.assign(this, fields);
  }
  async save() {
    this._id = new mongoose.Types.ObjectId();
    this.num = 9000 + created.length;
    created.push(this);
  }
}
// Повторов в базе нет и заявки с номером из темы нет — тесты меняют это по месту
TicketStub.exists = async () => null;
TicketStub.findOne = async () => null;
TicketStub.updateOne = async () => ({ acknowledged: true });

const ticketModel = require.resolve("@/models/ticket");
const ticketStub = new Module(ticketModel);
ticketStub.filename = ticketModel;
ticketStub.loaded = true;
ticketStub.exports = { Ticket: TicketStub };
require.cache[ticketModel] = ticketStub;

// Соединение с ящиком: обработчик забрал `connectMailbox` при загрузке, поэтому
// подмена — одна функция, которая отдаёт то соединение, что задал тест
let currentConnection = null;
const imapConnect = require.resolve("@/services/mail/imapConnect");
const imapConnectStub = new Module(imapConnect);
imapConnectStub.filename = imapConnect;
imapConnectStub.loaded = true;
imapConnectStub.exports = { connectMailbox: async () => currentConnection };
require.cache[imapConnect] = imapConnectStub;

// Права отправителя: тест отдаёт `req.auth` в форме buildAuthContext
// (services/authContext), а видимость заявки по нему считает настоящий
// canAccessTicket. Заданной функции нет — сборка падает, как при сбое базы
let currentAuthOf = null;
const authContext = require.resolve("@/services/authContext");
const authContextStub = new Module(authContext);
authContextStub.filename = authContext;
authContextStub.loaded = true;
authContextStub.exports = {
  buildAuthContext: async (user) => {
    if (!currentAuthOf) throw new Error("права отправителя не заданы");
    return currentAuthOf(user);
  },
  isDeniedAccount: require("@/services/accountDenial").isDeniedAccount,
};
require.cache[authContext] = authContextStub;

const Comment = require("@/models/comment");
const MongoCompany = require("@/models/company");
const MongoUser = require("@/models/user");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");
const TicketRead = require("@/models/ticketRead");
const logger = require("@/utils/logger");
const { handleNewEmails } = require("./emailHandling");

const MAILBOX = "support@example.ru";
const MAX_LOGGED = 300;
const REFUSED_FROM = "Sender address not accepted: the From header was refused";
const REROUTED = "Reply to ticket 77 is filed as a new ticket";
const SKIPPED = "Skipped an already imported e-mail";

const companyId = new mongoose.Types.ObjectId();
const prefs = {
  mailbox: {
    isActive: true,
    address: MAILBOX,
    host: "127.0.0.1",
    port: 1993,
    security: "ssl",
    password: "imap-pass",
  },
  defaultApplicant: { _id: new mongoose.Types.ObjectId() },
  deadline: 24,
};

// Письмо как его отдаёт IMAP: заголовки и тело одной строкой. Тема и тело —
// ASCII: тест о заголовках From и Authentication-Results, а не о кодировках тела
const rawMail = ({
  from,
  subject = "Printer is broken",
  messageId,
  extra = [],
  body = "The printer on the second floor does not print.",
}) =>
  [
    ...(from === undefined ? [] : [`From: ${from}`]),
    `To: ${MAILBOX}`,
    `Subject: ${subject}`,
    ...(messageId ? [`Message-ID: ${messageId}`] : []),
    ...extra,
    "Date: Thu, 01 Oct 2026 10:00:00 +0300",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "",
  ].join("\r\n");

// IMAP-соединение: письма без вложений, пометки «прочитано» запоминаются в `flags`
const fakeConnection = (mails, flags) => ({
  on() {},
  openBox: async () => {},
  search: async () =>
    mails.map((body, index) => ({
      attributes: { uid: 100 + index, struct: [] },
      parts: [{ which: "", body }],
    })),
  addFlags: async (uid, flag) => {
    flags.push([uid, flag]);
  },
  end() {},
});

// Что в этом тесте отвечают модели сверх «никого и ничего нет, остальное — по
// умолчанию». Сбрасывается в начале каждого прогона; задаёт prepare().
// Ответ `undefined` — «не знаю», запрос получает ответ по умолчанию; `null` —
// «такого нет».
const world = {};
const answer = (hook, ...args) => world[hook]?.(...args);

const defaultApplicantDoc = () => ({
  _id: prefs.defaultApplicant._id,
  firstName: "Почта",
  lastName: "Служебная",
  company: { _id: companyId },
});
const defaultCompanyDoc = () => ({ _id: companyId, alias: "Компания по умолчанию" });

/**
 * Один заход крона по письмам. Возвращает журнал, созданные заявки и пометки.
 * `prepare(ctx)` — подмены сверх общих (повтор в базе, сбой базы, заявка по номеру,
 * ответы моделей через `world`, права отправителя через `currentAuthOf`).
 */
const runIntake = async (t, mails, prepare = () => {}) => {
  created.length = 0;
  for (const key of Object.keys(world)) delete world[key];
  currentAuthOf = null;
  const flags = [];
  const log = [];
  currentConnection = fakeConnection(mails, flags);
  t.after(() => {
    currentConnection = null;
    currentAuthOf = null;
  });

  t.mock.method(logger, "log", (level, message, meta) => {
    log.push({ level, message, meta });
  });
  t.mock.method(Preferences, "findOne", async () => prefs);
  t.mock.method(Preferences, "updateOne", async () => ({ acknowledged: true }));
  t.mock.method(Comment, "findOne", () => ({ lean: async () => null }));
  t.mock.method(MongoUser, "findById", async (id) => {
    const found = answer("userById", id);
    return found === undefined ? defaultApplicantDoc() : found;
  });
  // Запрос Mongoose: и await, и .select(), как зовёт isCloudTelephonySender
  t.mock.method(MongoUser, "findOne", (filter) => {
    const found = answer("userFindOne", filter) ?? null;
    return Object.assign(Promise.resolve(found), {
      select: () => Promise.resolve(found),
    });
  });
  // Люди по номеру: find(...).select().limit().lean() (findUsersByPhone)
  t.mock.method(MongoUser, "find", (filter) => {
    const rows = answer("usersByPhone", filter?.phone) ?? [];
    const query = { select: () => query, limit: () => query, lean: async () => rows };
    return query;
  });
  t.mock.method(MongoCompany, "findById", async (id) => {
    const found = answer("companyById", id);
    return found === undefined ? defaultCompanyDoc() : found;
  });
  // Компания по домену отправителя
  t.mock.method(MongoCompany, "findOne", async (filter) => answer("companyFindOne", filter) ?? null);
  // Компания по номеру: find(...).limit() (findCompanyByPhone)
  t.mock.method(MongoCompany, "find", (filter) => ({
    limit: async () => answer("companiesByPhone", filter?.phones) ?? [],
  }));
  t.mock.method(TicketLog.prototype, "save", async function save() {
    return this;
  });
  prepare(t);

  await handleNewEmails();
  return { log, flags };
};

const refusedLines = (log) => log.filter((entry) => entry.message === REFUSED_FROM);

// Что отправитель пишет сам, в журнале не длиннее предела — в какой бы строке оно ни было
const assertBounded = (log) => {
  for (const { message, meta } of log) {
    for (const key of ["emailFrom", "emailSubject", "authResults"]) {
      const value = meta?.[key];
      if (typeof value === "string") {
        assert.ok(
          value.length <= MAX_LOGGED,
          `«${message}»: ${key} на ${value.length} знаков, предел ${MAX_LOGGED}`,
        );
      }
    }
  }
};

// Весь заголовок From одним закодированным словом (RFC 2047) — частый вид у PHP
// mb_encode_mimeheader и 1С. Текст: «Иван» <ivan@client.ru>. Разбор адреса такой
// заголовок не принимает (services/mail/inbound): сервер проверял отправителя по
// строке, где адреса нет открытым текстом
const ENCODED_FROM = "=?UTF-8?B?0JjQstCw0L0gPGl2YW5AY2xpZW50LnJ1Pg==?=";

test("From, который разбор не принял: в журнале одна строка с его текстом, Message-ID и ящиком, заявка идёт без отправителя", async (t) => {
  const { log, flags } = await runIntake(t, [
    rawMail({ from: ENCODED_FROM, messageId: "<refused-1@mailer.example>" }),
  ]);

  const lines = refusedLines(log);
  assert.equal(lines.length, 1, "строк о непринятом From должно быть ровно одна");
  assert.equal(lines[0].level, "warn");
  assert.equal(lines[0].meta.emailFrom, '"Иван" <ivan@client.ru>');
  assert.equal(lines[0].meta.messageIdHeader, "<refused-1@mailer.example>");
  assert.equal(lines[0].meta.emailAccount, MAILBOX);

  // Карточка остаётся пустой (решение владельца): отправитель в заявку не пишется,
  // опознания нет — заявка от инициатора по умолчанию
  assert.equal(created.length, 1);
  assert.equal(created[0].realSender, "");
  assert.deepEqual(flags, [[100, "\\Seen"]]);
});

test("текст непринятого From в журнале — не длиннее 300 знаков", async (t) => {
  // Два разных адреса в строке: разбор отказывает, а текст у mailparser — весь
  const long = `${"Я".repeat(500)} info@client.ru <noreply@client.ru>`;
  // Тема — тоже текст отправителя и тоже едет в эту строку журнала
  const { log } = await runIntake(t, [
    rawMail({
      from: long,
      subject: "Тема ".repeat(200),
      messageId: "<refused-2@mailer.example>",
    }),
  ]);

  const lines = refusedLines(log);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].meta.emailFrom.length, MAX_LOGGED);
  assert.equal(lines[0].meta.emailSubject.length, MAX_LOGGED);
  assert.ok(lines[0].meta.emailFrom.startsWith('"ЯЯЯЯ'), "обрезан не с начала");
  assertBounded(log);
});

test("письмо без заголовка From и письмо с двумя From тоже оставляют строку", async (t) => {
  const { log } = await runIntake(t, [
    rawMail({ from: undefined, messageId: "<refused-3@mailer.example>" }),
    rawMail({
      from: "a@client.ru",
      extra: ["From: b@client.ru"],
      messageId: "<refused-4@mailer.example>",
    }),
  ]);

  const lines = refusedLines(log);
  assert.deepEqual(
    lines.map((entry) => entry.meta.messageIdHeader),
    ["<refused-3@mailer.example>", "<refused-4@mailer.example>"],
  );
  // Без From текста нет вовсе — строка остаётся, чтобы пометить письмо
  assert.equal(lines[0].meta.emailFrom, undefined);
  assert.equal(lines[1].meta.emailFrom, "b@client.ru");
  assert.equal(created.length, 2);
});

test("контроль стенда: принятый From такой строки не даёт, а заявка получает отправителя", async (t) => {
  const { log } = await runIntake(t, [
    rawMail({
      from: "Ivan <ivan@client.ru>",
      messageId: "<accepted-1@mailer.example>",
    }),
  ]);

  assert.equal(refusedLines(log).length, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].realSender, "Ivan <ivan@client.ru>");
  assert.ok(log.some((entry) => entry.message === `Created ticket ${created[0].num}`));
});

test("строка о непринятом From пишется до всего, что может упасть: сбой базы её не отменяет", async (t) => {
  const { log, flags } = await runIntake(
    t,
    [rawMail({ from: ENCODED_FROM, messageId: "<refused-5@mailer.example>" })],
    (ctx) => {
      ctx.mock.method(TicketStub, "exists", async () => {
        throw new Error("база недоступна");
      });
    },
  );

  // Письмо не обработано (повторится на следующем заходе), но след есть
  assert.equal(refusedLines(log).length, 1);
  assert.ok(log.some((entry) => entry.message === "Failed to process email 1"));
  assert.equal(created.length, 0);
  assert.deepEqual(flags, []);
});

test("текст From и Authentication-Results в строках о письме — не длиннее 300 знаков", async (t) => {
  // Принятый адрес в кавычках-имени на 500 знаков: имя разбор отбрасывает, а текст
  // From у mailparser — весь. Authentication-Results без нашего принимающего
  // сервера — собственный заголовок отправителя, любой длины
  const from = `"${"Я".repeat(500)}" <ivan@client.ru>`;
  const authResults = `mx.client.ru; ${"x-pad=none; ".repeat(400)}`;
  const { log } = await runIntake(t, [
    // Ответ в №77, которого нет: строка «заведён новой заявкой» несёт оба заголовка
    rawMail({
      from,
      subject: "[F1-HD-77] Re: Printer is broken",
      messageId: "<reply-1@mailer.example>",
      extra: [`Authentication-Results: ${authResults}`],
    }),
    // Повтор письма: строка «уже заведено» несёт текст From
    rawMail({
      from,
      messageId: "<repeat-1@mailer.example>",
    }),
  ], (ctx) => {
    ctx.mock.method(TicketStub, "exists", async (filter) =>
      filter.emailMessageId === "<repeat-1@mailer.example>"
        ? { _id: new mongoose.Types.ObjectId() }
        : null,
    );
  });

  const rerouted = log.find((entry) => entry.message === REROUTED);
  assert.ok(rerouted, "строки о перенаправленном ответе нет");
  assert.equal(rerouted.meta.emailFrom.length, MAX_LOGGED);
  assert.equal(rerouted.meta.authResults.length, MAX_LOGGED);
  assert.ok(authResults.startsWith(rerouted.meta.authResults), "обрезан не с начала");

  const skipped = log.find((entry) => entry.message === SKIPPED);
  assert.ok(skipped, "строки о повторе нет");
  assert.equal(skipped.meta.emailFrom.length, MAX_LOGGED);

  assert.equal(refusedLines(log).length, 0, "From принят, строки о нём быть не должно");
  assertBounded(log);
});

test("короткие текст From и Authentication-Results в журнале остаются как есть", async (t) => {
  const { log } = await runIntake(t, [
    rawMail({
      from: "Ivan <ivan@client.ru>",
      subject: "[F1-HD-77] Re: Printer is broken",
      messageId: "<reply-2@mailer.example>",
      extra: ["Authentication-Results: mx.client.ru; dkim=none"],
    }),
  ]);

  const rerouted = log.find((entry) => entry.message === REROUTED);
  assert.ok(rerouted);
  assert.equal(rerouted.meta.emailFrom, '"Ivan" <ivan@client.ru>');
  assert.equal(rerouted.meta.authResults, "mx.client.ru; dkim=none");
});

// ---------------------------------------------------------------------------
// Опознание по номеру телефона (решение владельца 2026-10-03): номер из письма
// опознаёт заявителя и компанию ТОЛЬКО в письме с аккаунта облачной телефонии.
// В обычном письме номер пишет кто угодно — по номеру клиента посторонний
// открывал заявку от его имени, и бот пересылал текст клиенту.
// ---------------------------------------------------------------------------

const oid = () => new mongoose.Types.ObjectId();

const CLIENT_PHONE = "79145550142";
// Номер клиента в тексте письма — как его пишут (+7 …); из него выходит цифрами с кодом страны
const CLIENT_BODY = "Please call back: +7 914 555-01-42";
const TELEPHONY = "calls@mango.example";

const clientId = oid();
const clientCompanyId = oid();
const clientCompany = { _id: clientCompanyId, alias: "Клиент" };
const client = {
  _id: clientId,
  firstName: "Иван",
  lastName: "Клиентов",
  email: "ivan@client.ru",
  isEndUser: true,
  company: { _id: clientCompanyId },
};
// Аккаунт телефонии — обычная учётка с флагом isCloudTelephony
const telephonyAccount = {
  _id: oid(),
  firstName: "Облачная",
  lastName: "Телефония",
  email: TELEPHONY,
  isEndUser: true,
  isCloudTelephony: true,
};

// Справочник: номер клиента ведёт к нему и к его компании
const knowClientByPhone = () => {
  world.usersByPhone = (phone) => (phone === CLIENT_PHONE ? [client] : []);
  world.userById = (id) => (String(id) === String(clientId) ? client : undefined);
  world.companyById = (id) =>
    String(id) === String(clientCompanyId) ? clientCompany : undefined;
  world.companiesByPhone = (phone) => (phone === CLIENT_PHONE ? [clientCompany] : []);
};

// Учётки по адресу: точный адрес (отправитель, заявитель) и выражение без учёта
// регистра (isCloudTelephonySender). `lookups.telephony` считает проверки
// «телефония ли»; при совпадении адресов берётся первая учётка списка
const knowAccounts = (accounts, lookups = { telephony: 0 }) => {
  world.userFindOne = (filter) => {
    if (filter.email instanceof RegExp) {
      lookups.telephony += 1;
      return accounts.find((account) => filter.email.test(account.email)) ?? null;
    }
    return accounts.find((account) => account.email === filter.email) ?? null;
  };
  return lookups;
};

// В общем prefs настроек распознавания нет — ни один прежний тест их не включает
const setPrefs = (t, extra) => {
  Object.assign(prefs, extra);
  t.after(() => {
    for (const key of Object.keys(extra)) delete prefs[key];
  });
};
const IDENTIFY_ALL = { identifyApplicant: true, identifyCompany: true, checkPhoneNumber: true };

const assertDefaultApplicantAndCompany = (ticket) => {
  assert.equal(String(ticket.applicantId), String(prefs.defaultApplicant._id));
  assert.equal(String(ticket.company._id), String(companyId));
};

test("обычное письмо: номер клиента в тексте не опознаёт ни заявителя, ни компанию", async (t) => {
  const lookups = { telephony: 0 };
  await runIntake(
    t,
    [
      rawMail({
        from: "Stranger <stranger@evil.example>",
        body: CLIENT_BODY,
        messageId: "<phone-1@evil.example>",
      }),
    ],
    (ctx) => {
      setPrefs(ctx, IDENTIFY_ALL);
      knowClientByPhone();
      knowAccounts([client, telephonyAccount], lookups);
    },
  );

  assert.equal(created.length, 1);
  // Заявка от инициатора и компании по умолчанию: номер в обычном письме пишет кто угодно
  assertDefaultApplicantAndCompany(created[0]);
  assert.equal(created[0].source, "Почта");
  assert.equal(lookups.telephony, 1, "«телефония ли» считается один раз на письмо");
});

test("то же тело из аккаунта телефонии: заявитель и компания опознаны по номеру", async (t) => {
  const lookups = { telephony: 0 };
  await runIntake(
    t,
    [
      rawMail({
        from: `Mango <${TELEPHONY}>`,
        body: CLIENT_BODY,
        messageId: "<phone-2@mango.example>",
      }),
    ],
    (ctx) => {
      setPrefs(ctx, IDENTIFY_ALL);
      knowClientByPhone();
      knowAccounts([client, telephonyAccount], lookups);
    },
  );

  assert.equal(created.length, 1);
  assert.equal(String(created[0].applicantId), String(clientId));
  assert.equal(String(created[0].company._id), String(clientCompanyId));
  assert.equal(created[0].source, "Облачная телефония");
  // Один раз на письмо: источник заявки и опознание по номеру берут один ответ
  assert.equal(lookups.telephony, 1);
});

test("письмо телефонии, не прошедшее проверку отправителя, по номеру никого не опознаёт", async (t) => {
  // Адрес телефонии при проваленной проверке мог подделать кто угодно: признаку
  // «это телефония» верить нельзя, а с ним и номеру — ни для заявителя, ни для
  // компании
  await runIntake(
    t,
    [
      rawMail({
        from: `Mango <${TELEPHONY}>`,
        body: CLIENT_BODY,
        messageId: "<phone-3@mango.example>",
        extra: ["Authentication-Results: mx.f1lab.ru; dmarc=fail header.from=mango.example"],
      }),
    ],
    (ctx) => {
      setPrefs(ctx, IDENTIFY_ALL);
      knowClientByPhone();
      knowAccounts([client, telephonyAccount]);
    },
  );

  assert.equal(created.length, 1);
  assertDefaultApplicantAndCompany(created[0]);
});

test("с выключенным «искать номер» и телефония по номеру не опознаёт", async (t) => {
  await runIntake(
    t,
    [
      rawMail({
        from: `Mango <${TELEPHONY}>`,
        body: CLIENT_BODY,
        messageId: "<phone-4@mango.example>",
      }),
    ],
    (ctx) => {
      setPrefs(ctx, { ...IDENTIFY_ALL, checkPhoneNumber: false });
      knowClientByPhone();
      knowAccounts([client, telephonyAccount]);
    },
  );

  assert.equal(created.length, 1);
  // Заявитель — сама учётка телефонии (по адресу), а не клиент из номера
  assert.equal(String(created[0].applicantId), String(telephonyAccount._id));
  assert.notEqual(String(created[0].company._id), String(clientCompanyId));
});

test("компания по номеру не зависит от опознания заявителя: оно выключено — компания всё равно по номеру", async (t) => {
  await runIntake(
    t,
    [
      rawMail({
        from: `Mango <${TELEPHONY}>`,
        body: CLIENT_BODY,
        messageId: "<phone-5@mango.example>",
      }),
    ],
    (ctx) => {
      setPrefs(ctx, { ...IDENTIFY_ALL, identifyApplicant: false });
      knowClientByPhone();
      knowAccounts([client, telephonyAccount]);
    },
  );

  assert.equal(created.length, 1);
  assert.equal(String(created[0].applicantId), String(prefs.defaultApplicant._id));
  assert.equal(String(created[0].company._id), String(clientCompanyId));
});

test("контроль стенда: клиент пишет со своего адреса — заявитель опознан по адресу, а не по номеру в тексте", async (t) => {
  // Номер в теле — чужой: по нему никто не найдётся, а по адресу заявитель есть
  await runIntake(
    t,
    [
      rawMail({
        from: "Ivan <ivan@client.ru>",
        body: "Please call back: +7 914 555-99-99",
        messageId: "<phone-6@client.ru>",
      }),
    ],
    (ctx) => {
      setPrefs(ctx, IDENTIFY_ALL);
      knowClientByPhone();
      knowAccounts([client, telephonyAccount]);
    },
  );

  assert.equal(created.length, 1);
  assert.equal(String(created[0].applicantId), String(clientId));
});

// ---------------------------------------------------------------------------
// Ответ письмом в заявку (решение владельца 2026-10-03): правило ОДНО для всех —
// комментарием становится ответ того, кому заявка видна в интерфейсе
// (canAccessTicket), кроме отключённых и служебных учёток. Клиенту компания
// заявки сама по себе доступа не даёт: рядовой клиент не пишет в заявки коллег.
// ---------------------------------------------------------------------------

const colleague = {
  _id: oid(),
  email: "olga@client.ru",
  isEndUser: true,
  company: { _id: clientCompanyId },
};
const otherCompanyClient = {
  _id: oid(),
  email: "pyotr@other.example",
  isEndUser: true,
  company: { _id: oid() },
};
// Заявитель только в снимке `applicant` старой заявки (до applicantId)
const legacyApplicant = {
  _id: oid(),
  email: "old@client.ru",
  isEndUser: true,
  company: { _id: clientCompanyId },
};
// Завёл заявку за коллегу (createdBy), заявителем не является
const officeManager = {
  _id: oid(),
  email: "office@client.ru",
  isEndUser: true,
  company: { _id: clientCompanyId },
};
const staffResponsible = {
  _id: oid(),
  email: "tech@hd.example",
  isEndUser: false,
  company: { _id: companyId },
};
const staffOutsider = {
  _id: oid(),
  email: "contractor@hd.example",
  isEndUser: false,
  company: { _id: companyId },
};

const TICKET_NUM = 77;
const NOT_PARTICIPANT = `<p>Письмо пришло ответом на заявку №${TICKET_NUM}, но отправитель в ней не участвует</p>`;

// `req.auth` в форме buildAuthContext, но без базы. `companies` — роль
// «Видеть заявки своих компаний»: клиенту открывает все заявки его компании
const authOf = (user, { companies = false } = {}) => ({
  userId: String(user._id),
  isAdmin: false,
  isEndUser: user.isEndUser !== false,
  can: (request) => companies && request.ticket?.join?.() === "readCompanies",
  legacy: { ...user, userId: String(user._id) },
});

// Заявка №77 клиента: заявитель — client, у неё один сотрудник-ответственный
const replyTicket = (fields = {}) => ({
  _id: oid(),
  num: TICKET_NUM,
  isClosed: false,
  applicantId: clientId,
  createdBy: clientId,
  responsibles: [{ _id: staffResponsible._id }],
  company: { _id: clientCompanyId, alias: "Клиент" },
  ...fields,
});

// Один заход с ответом `sender` на №77. Возвращает комментарии, что дошли до
// сохранения, и то, что сделал обработчик
const runReply = async (
  t,
  sender,
  { companies = false, authFails = false, ticket: ticketFields } = {},
) => {
  const ticket = replyTicket(ticketFields);
  const saved = [];
  const { log } = await runIntake(
    t,
    [
      rawMail({
        from: `Sender <${sender.email}>`,
        subject: `[F1-HD-${TICKET_NUM}] Re: Printer is broken`,
        messageId: `<reply-${sender._id}@mailer.example>`,
      }),
    ],
    (ctx) => {
      knowAccounts([
        sender,
        client,
        colleague,
        otherCompanyClient,
        staffResponsible,
        staffOutsider,
      ]);
      ctx.mock.method(TicketStub, "findOne", async (filter) =>
        filter.num === TICKET_NUM ? ticket : null,
      );
      ctx.mock.method(Comment.prototype, "save", async function save() {
        saved.push(this);
        return this;
      });
      ctx.mock.method(TicketRead, "bulkWrite", async () => ({}));
      currentAuthOf = authFails
        ? () => {
            throw new Error("роли организации недоступны");
          }
        : (user) => authOf(user, { companies });
    },
  );
  return { ticket, saved, log };
};

const assertCommented = ({ ticket, saved }, sender) => {
  assert.equal(created.length, 0, "новой заявки быть не должно");
  assert.equal(saved.length, 1, "комментарий в №77 должен лечь");
  assert.equal(String(saved[0].ticketId), String(ticket._id));
  assert.equal(String(saved[0].createdBy), String(sender._id));
};

const assertFiledAsNewTicket = ({ saved }) => {
  // В №77 не пишется ничего; ответ — обычная новая заявка с причиной первой строкой
  assert.equal(saved.length, 0, "в №77 писать нельзя");
  assert.equal(created.length, 1);
  assert.ok(
    created[0].description.startsWith(NOT_PARTICIPANT),
    `первая строка описания: ${created[0].description.slice(0, 120)}`,
  );
};

const REPLY_SCENARIOS = [
  ["заявитель-клиент", client, {}, true],
  [
    "заявитель только в снимке applicant у старой заявки",
    legacyApplicant,
    { ticket: { applicantId: undefined, applicant: { _id: legacyApplicant._id }, createdBy: oid() } },
    true,
  ],
  [
    "автор заявки, не заявитель",
    officeManager,
    { ticket: { createdBy: officeManager._id } },
    true,
  ],
  ["коллега из компании заявки с обычной ролью", colleague, {}, false],
  ["коллега с правом «Видеть заявки своих компаний»", colleague, { companies: true }, true],
  ["клиент другой компании, даже с правом на всю свою компанию", otherCompanyClient, { companies: true }, false],
  ["сотрудник из ответственных", staffResponsible, {}, true],
  ["сотрудник, которому заявка не видна", staffOutsider, {}, false],
  ["отключённый заявитель", { ...client, banned: true }, {}, false],
  ["заявитель из выключенной компании", { ...client, company: { _id: clientCompanyId, isActive: false } }, {}, false],
  ["служебная учётка заявителя", { ...client, isServiceAccount: true }, {}, false],
];

for (const [name, sender, options, commented] of REPLY_SCENARIOS) {
  test(`ответ в №77: ${name} — ${commented ? "комментарий" : "новая заявка"}`, async (t) => {
    const outcome = await runReply(t, sender, options);
    if (commented) assertCommented(outcome, sender);
    else assertFiledAsNewTicket(outcome);
  });
}

for (const [name, sender] of [
  ["заявитель", client],
  ["коллега из компании заявки", colleague],
]) {
  test(`ответ клиента (${name}): права не собрались — отказ, а не пропуск, ответ уходит новой заявкой`, async (t) => {
    // Раньше права считались только сотруднику, а клиент проходил по связям с
    // заявкой и сбоя не видел; теперь правило общее
    const outcome = await runReply(t, sender, { authFails: true });
    assertFiledAsNewTicket(outcome);
    const warning = outcome.log.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "Could not resolve the e-mail sender's ticket access",
    );
    assert.ok(warning, "сбой сборки прав должен быть в журнале");
    assert.equal(warning.meta.ticketNum, TICKET_NUM);
  });
}
