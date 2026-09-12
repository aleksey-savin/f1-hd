// node --test services/inAppNotifications.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTicketItems,
  buildCommentItems,
  buildWorksItems,
  inAppAllowed,
  excerpt,
} = require("./inAppNotifications");

const allOn = {
  newTicket: true,
  respStateUpdate: true,
  ticketStateUpdate: true,
  ticketDeadlineUpdate: true,
  ticketNewComment: true,
  scheduledWorks: true,
};
const prefs = { notify: { personal: allOn } };

const user = (id, extra = {}) => ({
  _id: id,
  firstName: `Имя-${id}`,
  lastName: `Фамилия-${id}`,
  ...extra,
});
const usersOf = (...list) => new Map(list.map((u) => [String(u._id), u]));
const ticket = (extra = {}) => ({
  _id: "t1",
  num: 51713,
  title: "Не печатает принтер",
  applicantId: "a1",
  responsibles: [],
  updatedBy: "x1",
  isClosed: false,
  ...extra,
});
const ids = (items) => items.map((item) => String(item.userId)).sort();

test("«принята в работу» — заявителю, категория ticketStateUpdate", () => {
  const { items } = buildTicketItems({
    lastAction: "take ticket to work",
    ticket: ticket({ updatedBy: "r1", responsibles: [{ _id: "r1" }] }),
    usersById: usersOf(user("a1"), user("r1")),
    prefs,
  });
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(String(item.userId), "a1");
  assert.equal(item.category, "ticketStateUpdate");
  assert.equal(item.kind, "taken");
  assert.equal(item.title, "Заявка принята в работу");
  assert.equal(item.link, "/tickets/51713");
  assert.equal(item.ticketNum, 51713);
  assert.equal(item.ticketTitle, "Не печатает принтер");
  assert.equal(String(item.ticketId), "t1");
  assert.deepEqual(item.actor, { _id: "r1", firstName: "Имя-r1", lastName: "Фамилия-r1" });
  assert.equal(item.readAt, null);
});

test("автор события уведомление не получает", () => {
  const { items } = buildTicketItems({
    lastAction: "take ticket to work",
    ticket: ticket({ updatedBy: "a1" }),
    usersById: usersOf(user("a1")),
    prefs,
  });
  assert.deepEqual(items, []);
});

test("«обработана»: только ещё не уведомлённые ответственные, защёлка возвращается", () => {
  const t = ticket({
    updatedBy: "m1",
    responsibles: [{ _id: "r1", isNotified: { inApp: true } }, { _id: "r2" }],
  });
  const { items, consideredResponsibleIds } = buildTicketItems({
    lastAction: "process ticket",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1"), user("r2"), user("m1")),
    prefs,
  });
  assert.deepEqual(ids(items), ["r2"]);
  assert.equal(items[0].category, "respStateUpdate");
  assert.equal(items[0].kind, "processed");
  assert.equal(items[0].title, "Вы назначены ответственным");
  assert.deepEqual(consideredResponsibleIds, ["r2"]);
});

test("«обработана» по закрытой заявке молчит", () => {
  const { items } = buildTicketItems({
    lastAction: "process ticket",
    ticket: ticket({ isClosed: true, updatedBy: "m1", responsibles: [{ _id: "r2" }] }),
    usersById: usersOf(user("a1"), user("r2"), user("m1")),
    prefs,
  });
  assert.deepEqual(items, []);
});

test("отказ — менеджерам и оставшимся ответственным, заявителю нет; причина в тексте", () => {
  const t = ticket({
    updatedBy: "r1",
    responsibles: [{ _id: "r2" }],
    rejected: [{ by: "r1", reason: "Не моя зона" }],
  });
  const { items } = buildTicketItems({
    lastAction: "reject ticket",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1"), user("r2")),
    managers: [user("m1"), user("r1")],
    prefs,
  });
  assert.deepEqual(ids(items), ["m1", "r2"]);
  assert.ok(items.every((i) => i.category === "respStateUpdate" && i.kind === "rejected"));
  assert.match(items[0].text, /Не моя зона/);
});

test("присоединение — другим ответственным, без заявителя", () => {
  const t = ticket({ updatedBy: "r2", responsibles: [{ _id: "r1" }, { _id: "r2" }] });
  const { items } = buildTicketItems({
    lastAction: "join responsibles",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1"), user("r2")),
    prefs,
  });
  assert.deepEqual(ids(items), ["r1"]);
  assert.equal(items[0].kind, "joined");
});

test("заявитель, который и ответственный, получает одно уведомление", () => {
  const t = ticket({ updatedBy: "r1", responsibles: [{ _id: "a1" }, { _id: "r1" }], closingComment: "Готово" });
  const { items } = buildTicketItems({
    lastAction: "close ticket",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1")),
    prefs,
  });
  assert.deepEqual(ids(items), ["a1"]);
  assert.equal(items[0].kind, "closed");
  assert.match(items[0].text, /Готово/);
});

test("глобально выключенная категория гасит всё", () => {
  const { items } = buildTicketItems({
    lastAction: "take ticket to work",
    ticket: ticket({ updatedBy: "r1" }),
    usersById: usersOf(user("a1"), user("r1")),
    prefs: { notify: { personal: { ...allOn, ticketStateUpdate: false } } },
  });
  assert.deepEqual(items, []);
});

test("личный выключатель «в приложении» гасит, отсутствие поля — нет", () => {
  const off = user("a1", { notify: { inApp: { ticketStateUpdate: false } } });
  assert.equal(inAppAllowed(off, "ticketStateUpdate", prefs), false);
  assert.equal(inAppAllowed(user("a1", { notify: {} }), "ticketStateUpdate", prefs), true);
  assert.equal(inAppAllowed(user("a1"), "ticketStateUpdate", prefs), true);
});

test("служебные и заблокированные учётки не адресаты; служебный автор — обычный автор", () => {
  const t = ticket({ updatedBy: "bot", responsibles: [{ _id: "r1" }, { _id: "r2" }] });
  const { items } = buildTicketItems({
    lastAction: "close ticket",
    ticket: t,
    usersById: usersOf(
      user("a1", { isServiceAccount: true }),
      user("r1"),
      user("r2", { banned: true }),
      user("bot", { isServiceAccount: true }),
    ),
    prefs,
  });
  assert.deepEqual(ids(items), ["r1"]);
  // Машинная заявка ничем не отличается: автор события — учётка мониторинга
  assert.deepEqual(items[0].actor, { _id: "bot", firstName: "Имя-bot", lastName: "Фамилия-bot" });
});

test("новая заявка: менеджерам и заявителю, назначенным — «вы назначены»; автор исключён", () => {
  const t = ticket({ updatedBy: "a1", responsibles: [{ _id: "r1" }] });
  const { items, consideredResponsibleIds } = buildTicketItems({
    lastAction: "new ticket",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1")),
    managers: [user("m1")],
    prefs,
  });
  const byUser = Object.fromEntries(items.map((i) => [String(i.userId), i]));
  assert.deepEqual(Object.keys(byUser).sort(), ["m1", "r1"]);
  assert.equal(byUser.m1.category, "newTicket");
  assert.equal(byUser.m1.kind, "created");
  assert.equal(byUser.m1.title, "Новая заявка");
  assert.equal(byUser.r1.category, "respStateUpdate");
  assert.equal(byUser.r1.title, "Вы назначены ответственным");
  assert.deepEqual(consideredResponsibleIds, ["r1"]);
});

test("срок: заявителю и ответственным, новый срок в тексте", () => {
  const t = ticket({ updatedBy: "m1", responsibles: [{ _id: "r1" }] });
  const { items } = buildTicketItems({
    lastAction: "update deadline",
    ticket: t,
    usersById: usersOf(user("a1"), user("r1"), user("m1")),
    prefs,
    deadlineText: "Новый срок: 15 сентября, 18:00",
  });
  assert.deepEqual(ids(items), ["a1", "r1"]);
  assert.ok(items.every((i) => i.category === "ticketDeadlineUpdate" && i.kind === "deadline"));
  assert.equal(items[0].text, "Новый срок: 15 сентября, 18:00");
});

test("неизвестное событие не даёт уведомлений", () => {
  const { items } = buildTicketItems({
    lastAction: "something else",
    ticket: ticket(),
    usersById: usersOf(user("a1")),
    prefs,
  });
  assert.deepEqual(items, []);
});

test("комментарий — заявителю и ответственным, кроме автора; в закрытой — «Ответ в закрытую заявку»", () => {
  const { items } = buildCommentItems({
    comment: { _id: "c1", content: "<p>Привет, <b>мир</b></p>", createdBy: { _id: "a1" } },
    ticket: ticket({ isClosed: true, responsibles: [{ _id: "r1" }, { _id: "a1" }] }),
    usersById: usersOf(user("a1"), user("r1")),
    prefs,
  });
  assert.deepEqual(ids(items), ["r1"]);
  const [item] = items;
  assert.equal(item.category, "ticketNewComment");
  assert.equal(item.kind, "comment");
  assert.equal(item.title, "Ответ в закрытую заявку");
  assert.equal(item.text, "Привет, мир");
  assert.equal(String(item.commentId), "c1");
  assert.equal(item.actor.firstName, "Имя-a1");
});

test("комментарий в открытой заявке — «Новый комментарий»", () => {
  const { items } = buildCommentItems({
    comment: { _id: "c2", content: "Ок", createdBy: "r1" },
    ticket: ticket({ responsibles: [{ _id: "r1" }] }),
    usersById: usersOf(user("a1"), user("r1")),
    prefs,
  });
  assert.deepEqual(ids(items), ["a1"]);
  assert.equal(items[0].title, "Новый комментарий");
});

test("выдержка — текст без разметки, не длиннее 200 знаков", () => {
  const long = excerpt(`<div>${"а".repeat(300)}</div>`);
  assert.equal(long.length, 201);
  assert.ok(long.endsWith("…"));
  assert.equal(excerpt("<p>Строка   раз</p>\n<p>два</p>"), "Строка раз два");
  assert.equal(excerpt(""), "");
});

test("работы — заявителям и ответственным, кроме автора", () => {
  const { items } = buildWorksItems({
    lastAction: "new scheduled work",
    work: { _id: "w1", executor: user("e1"), visitRequired: true, updatedBy: "m1" },
    ticketNums: [51713, 51714],
    company: "Ромашка",
    recipients: [user("a1"), user("r1"), user("m1"), user("a1")],
    prefs,
    dateText: "15 сентября, 10:00",
  });
  assert.deepEqual(ids(items), ["a1", "r1"]);
  const [item] = items;
  assert.equal(item.category, "scheduledWorks");
  assert.equal(item.kind, "workAdded");
  assert.equal(item.title, "Запланированы работы");
  assert.equal(item.link, "/tickets/51713");
  assert.equal(item.ticketNum, 51713);
  assert.match(item.text, /Ромашка/);
  assert.match(item.text, /15 сентября, 10:00/);
  assert.match(item.text, /Фамилия-e1/);
});

test("изменённые работы — свой вид и подпись", () => {
  const { items } = buildWorksItems({
    lastAction: "scheduled work updated",
    work: { _id: "w1", executor: user("e1"), visitRequired: false, updatedBy: "m1" },
    ticketNums: [51713],
    company: "Ромашка",
    recipients: [user("a1")],
    prefs,
    dateText: "15 сентября, 10:00",
  });
  assert.equal(items[0].kind, "workUpdated");
  assert.equal(items[0].title, "Изменены запланированные работы");
});
