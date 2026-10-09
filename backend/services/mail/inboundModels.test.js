// node --test services/mail/inboundModels.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Types } = mongoose;

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// десять секунд в буфере до первого подключения
mongoose.set("bufferCommands", false);

// Настоящие модели, без базы: документы собираются в памяти (как
// services/phoneSetters.test.js)
const { Ticket } = require("@/models/ticket");
const Comment = require("@/models/comment");
const User = require("@/models/user");
const { canAccessTicket } = require("@/services/ticketAccess");
const { isTicketParticipant } = require("./replyRouting");

// `req.auth` в форме buildAuthContext (services/authContext), но без базы:
// ярус заявок читается через can(), скоуп компании берётся из снимка в legacy.
// `companies` — роль «Видеть заявки своих компаний» (ticket.readCompanies)
const authOf = (user, { companies = false } = {}) => ({
  userId: String(user._id),
  isAdmin: false,
  isEndUser: user.isEndUser !== false,
  can: (request) =>
    companies && Array.isArray(request.ticket) && request.ticket.join() === "readCompanies",
  legacy: { ...user.toObject(), userId: String(user._id) },
});

// Участник письмом так, как решает обработчик писем (middleware/emailHandling):
// видимость заявки в интерфейсе считает canAccessTicket, а isTicketParticipant
// добавляет отказ учётке. Правило одно для клиента и сотрудника
const participates = (ticket, user, scope) =>
  isTicketParticipant(ticket, user, {
    inScope: canAccessTicket(ticket, authOf(user, scope)),
  });

const hasSparseMessageIdIndex = (model) =>
  model.schema
    .indexes()
    .some(
      ([fields, options]) =>
        Object.keys(fields).join() === "emailMessageId" &&
        options.sparse === true,
    );

test("tickets and comments keep their e-mail's Message-ID under a sparse index", () => {
  for (const model of [Ticket, Comment]) {
    assert.equal(
      model.schema.path("emailMessageId")?.instance,
      "String",
      model.modelName,
    );
    assert.equal(hasSparseMessageIdIndex(model), true, model.modelName);
  }
  assert.equal(new Comment({ emailMessageId: "<a@x>" }).emailMessageId, "<a@x>");
});

test("a document not made from e-mail has no Message-ID at all", () => {
  // Пустое значение попало бы в разреженный индекс и совпало с любым другим
  assert.equal(Object.hasOwn(new Ticket({}).toObject(), "emailMessageId"), false);
  assert.equal(
    Object.hasOwn(
      new Comment({ emailMessageId: undefined }).toObject(),
      "emailMessageId",
    ),
    false,
  );
});

test("reply routing reads real Mongoose documents", () => {
  const company = { _id: new Types.ObjectId(), alias: "Клиент" };
  const applicant = new User({ email: "ivan@client.ru", isEndUser: true, company });
  const colleague = new User({ email: "olga@client.ru", isEndUser: true, company });
  const outsider = new User({
    email: "x@other.ru",
    isEndUser: true,
    company: { _id: new Types.ObjectId() },
  });
  const loner = new User({ email: "y@other.ru", isEndUser: true });
  const ticket = new Ticket({ applicantId: applicant._id, company });

  assert.equal(participates(ticket, applicant), true);
  // Коллега из компании заявки с обычной ролью видит только свои заявки —
  // письмом в чужую не пишет (решение владельца 2026-10-03)
  assert.equal(participates(ticket, colleague), false);
  // С ролью «Видеть заявки своих компаний» заявка ему видна — и письмо входит
  assert.equal(participates(ticket, colleague, { companies: true }), true);
  assert.equal(participates(ticket, outsider), false);
  // Роль на всю компанию — про СВОЮ компанию: чужую заявку она не открывает
  assert.equal(participates(ticket, outsider, { companies: true }), false);
  // Незаполненные вложенные пути Mongoose отдаёт пустым объектом — это не
  // «совпадение пустых компаний»
  for (const scope of [undefined, { companies: true }]) {
    assert.equal(participates(new Ticket({}), loner, scope), false);
  }
  // Старая заявка: заявитель только в снимке applicant — заявка ему видна
  // (services/ticketScope пускает снимок и в списке, и в карточке)
  assert.equal(
    participates(new Ticket({ applicant: { _id: outsider._id } }), outsider),
    true,
  );
  // Автор, не заявитель, — тоже свой: ему заявка видна
  assert.equal(
    participates(
      new Ticket({ company, applicantId: applicant._id, createdBy: outsider._id }),
      outsider,
    ),
    true,
  );
});

// Индекс на поле один и он разреженный: лишний `index: true` на самом поле дал бы
// второй, неразреженный (null у каждого документа)
test("exactly one index on emailMessageId per model, and it is sparse", () => {
  for (const model of [Ticket, Comment]) {
    const onField = model.schema
      .indexes()
      .filter(([fields]) => Object.hasOwn(fields, "emailMessageId"));
    assert.equal(onField.length, 1, model.modelName);
    assert.deepEqual(onField[0][0], { emailMessageId: 1 }, model.modelName);
    assert.equal(onField[0][1].sparse, true, model.modelName);
  }
});

// C6 передаёт `emailMessageId: email.messageId`; у письма без годного id это undefined
test("an explicit undefined id leaves the field absent on a ticket too", () => {
  assert.equal(
    Object.hasOwn(new Ticket({ emailMessageId: undefined }).toObject(), "emailMessageId"),
    false,
  );
});

test("reply routing on real documents: denial gates, scope, responsibles", () => {
  const company = { _id: new Types.ObjectId(), alias: "Клиент" };
  const applicant = new User({ email: "ivan@client.ru", isEndUser: true, company });
  const ticket = new Ticket({ applicantId: applicant._id, company });
  const owns = (account) => new Ticket({ applicantId: account._id, company });

  // Отключённая учётка, учётка с выключенной компанией и служебная — не
  // участники, даже будучи заявителем: заявка им видна (canAccessTicket), а
  // писать письмом нельзя — отказывает именно учётка
  const banned = new User({ email: "b@client.ru", isEndUser: true, company, banned: true });
  const dormant = new User({
    email: "d@client.ru",
    isEndUser: true,
    company: { ...company, isActive: false },
  });
  const service = new User({ email: "s@client.ru", isEndUser: true, company, isServiceAccount: true });
  for (const account of [banned, dormant, service]) {
    assert.equal(canAccessTicket(owns(account), authOf(account)), true, account.email);
    assert.equal(participates(owns(account), account), false, account.email);
  }
  const expired = new User({
    email: "e@client.ru",
    isEndUser: true,
    company,
    banned: true,
    banExpires: new Date(Date.now() - 60_000),
  });
  assert.equal(participates(owns(expired), expired), true);

  // Сотрудник — участник, только если заявка видна ему в интерфейсе
  const staff = new User({ email: "s@hd.ru", isEndUser: false });
  assert.equal(participates(ticket, staff), false);
  const lead = new User({
    email: "l@hd.ru",
    isEndUser: false,
    responsibleForCompanies: [{ id: company._id, alias: "Клиент" }],
  });
  assert.equal(participates(ticket, lead), false);
  assert.equal(participates(ticket, lead, { companies: true }), true);
  // Учётка без признака по умолчанию клиентская
  assert.equal(new User({ email: "n@x.ru" }).isEndUser, true);

  // Ответственный — встроенный поддокумент с ObjectId в _id; компания у него чужая
  const responsible = new User({
    email: "r@other.ru",
    isEndUser: true,
    company: { _id: new Types.ObjectId() },
  });
  const withResponsible = new Ticket({ company, responsibles: [{ _id: responsible._id }] });
  assert.equal(participates(withResponsible, responsible), true);
});

// Message-ID письма не должен уезжать в карточку заявки: её видят и клиенты.
// По умолчанию поле не читается, нужное место просит его явно
// (`.select("+emailMessageId")`). Поиск повторов
// (services/mail/inbound#findImportedMessage) фильтрует по полю и берёт свою
// проекцию — ему это не мешает
test("the Message-ID is left out of default reads of tickets and comments", () => {
  for (const model of [Ticket, Comment]) {
    assert.equal(
      model.schema.path("emailMessageId").options.select,
      false,
      model.modelName,
    );
  }
});
