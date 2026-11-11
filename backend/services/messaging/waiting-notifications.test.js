require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;
const { createWaitingNotifier } = require("./waiting-notifications");

const since = new Date("2026-11-12T01:00:00Z");
const at = (seconds) => new Date(+since + seconds * 1000);
const id = (n) => n.toString(16).padStart(24, "0");
const expression = (value, doc) => {
  if (typeof value === "string" && value.startsWith("$")) return doc[value.slice(1)];
  if (value?.$ifNull) return expression(value.$ifNull[0], doc) ?? value.$ifNull[1];
  if (value?.$ne) return +expression(value.$ne[0], doc) !== +expression(value.$ne[1], doc);
  return value;
};
const matches = (filter, doc) => {
  const { $expr, ...plain } = filter;
  return sift(plain)(doc) && (!$expr || expression($expr, doc));
};
const query = (values) => ({
  select() { return this; },
  sort(order) { const [key, direction] = Object.entries(order)[0]; values.sort((a, b) => (+a[key] - +b[key]) * direction); return this; },
  limit(count) { values = values.slice(0, count); return this; },
  lean: async () => structuredClone(values),
  then(resolve, reject) { return Promise.resolve(values).then(resolve, reject); },
});
const person = (n, extra = {}) => ({
  _id: id(n), isEndUser: false, firstName: `Сотрудник ${n}`, lastName: "Тест",
  telegramBot: { isActive: true, chatId: `tg-${n}` },
  notify: { byTelegram: { ticketNewComment: true } },
  readConversation: true, ...extra,
});

const fixture = () => {
  const conversation = { _id: id(1), channelId: id(2), network: "telegram", kind: "direct", assigneeId: id(3), companyId: id(8), hidden: false, awaitingSince: since, lastMessage: { authorName: "Клиент <Иван>" } };
  const messages = [{ _id: id(4), conversationId: id(1), direction: "in", origin: "client", text: "Принтер <не работает>", ticketId: id(5), sentAt: since }];
  const tickets = [{ _id: id(5), num: 42, title: "Принтер", isClosed: false, responsibles: [{ _id: id(6) }] }];
  const users = [person(3), person(6, { readConversation: false })];
  const prefs = { modules: { messaging: { isActive: true } }, notify: { personal: { ticketNewComment: true }, byTelegram: { isActive: true, sendToGroup: true, chatId: "team", messageThreadId: "17" } } };
  const notices = new Map();
  let failCheckpoint = false;
  const Conversation = {
    find: (filter) => query([conversation].filter((doc) => matches(filter, doc))),
    exists: async (filter) => matches(filter, conversation) ? { _id: conversation._id } : null,
    updateOne: async (filter, change) => {
      if (failCheckpoint) { failCheckpoint = false; throw new Error("checkpoint failed"); }
      if (!matches(filter, conversation)) return { matchedCount: 0 };
      Object.assign(conversation, change.$set); return { matchedCount: 1 };
    },
  };
  const notifier = createWaitingNotifier({
    Conversation,
    Message: {
      findOne: (filter) => {
        const q = query(messages.filter((doc) => sift(filter)(doc)));
        q.lean = async () => messages.filter((doc) => sift(filter)(doc)).sort((a, b) => +b.sentAt - +a.sentAt)[0] || null;
        return q;
      },
      distinct: async (field, filter) => [...new Set(messages.filter((doc) => sift(filter)(doc)).map((doc) => doc[field]).filter(Boolean))],
    },
    Ticket: { find: (filter) => query(tickets.filter((doc) => sift(filter)(doc))) },
    User: { find: (filter) => query(users.filter((doc) => sift(filter)(doc))) },
    Preferences: { findOne: () => ({ select() { return this; }, lean: async () => prefs }) },
    Notification: { updateOne: async (filter, change) => { if (!notices.has(filter._id)) notices.set(filter._id, structuredClone(change.$setOnInsert)); } },
    authFor: async (user) => ({
      userId: user._id, isEndUser: false, isAdmin: false,
      legacy: { responsibleForCompanies: (user.companyIds || []).map((id) => ({ id })) },
      can: (request) => Boolean(((request.conversation?.includes("read") || (request.conversation?.includes("readAll") && !user.ownOnly)) && user.readConversation) || (request.ticket?.includes("readCompanies") && user.companyIds?.length)),
    }),
    fallbackRecipients: async () => users,
    baseUrl: "https://hd.example.test",
  });
  return { notifier, conversation, messages, tickets, users, prefs, notices, failCheckpoint: () => { failCheckpoint = true; } };
};

test("first unanswered message gives one personal alert at two minutes, independent of later messages and reads", async () => {
  const f = fixture();
  await f.notifier.run(at(119)); assert.equal(f.notices.size, 0);
  f.conversation.seenAt = at(119);
  f.messages.push({ ...f.messages[0], _id: id(7), sentAt: at(110), text: "И ещё вопрос" });
  await f.notifier.run(at(120));
  assert.equal(f.notices.size, 1);
  const notice = [...f.notices.values()][0];
  assert.equal(notice.to.chatId, "tg-3");
  assert.match(notice.text, /И ещё вопрос/);
  assert.match(notice.replyMarkup.inline_keyboard[0][0].url, /\/conversations\//);
  await f.notifier.run(at(121)); assert.equal(f.notices.size, 1);
});

test("a ten-minute wait escalates once to the configured forum topic", async () => {
  const f = fixture();
  await f.notifier.run(at(599)); assert.equal(f.notices.size, 1);
  await Promise.all([f.notifier.run(at(600)), f.notifier.run(at(600))]);
  const group = [...f.notices.values()].filter((notice) => notice.to.globalChat);
  assert.equal(group.length, 1);
  assert.equal(group[0].to.chatId, "team");
  assert.equal(group[0].to.messageThreadId, "17");
  assert.match(group[0].text, /10 мин/);
});

test("replying or marking handled before the delay prevents both stages", async () => {
  const f = fixture();
  f.conversation.awaitingSince = null;
  await f.notifier.run(at(120)); await f.notifier.run(at(600));
  assert.equal(f.notices.size, 0);
});

test("without an assignee, only responsibles of the waiting messages receive an accessible ticket link", async () => {
  const f = fixture();
  f.conversation.assigneeId = null;
  f.conversation.ticketBindings = [{ ticketId: id(9), endedAt: null }];
  f.tickets.push({ _id: id(9), num: 99, responsibles: [{ _id: id(3) }] });
  await f.notifier.run(at(120));
  assert.equal(f.notices.size, 1);
  const notice = [...f.notices.values()][0];
  assert.equal(notice.to.chatId, "tg-6");
  assert.equal(notice.replyMarkup.inline_keyboard[0][0].url, "https://hd.example.test/tickets/42");
  assert.equal(String(notice.ticketId), id(5));
});

test("each ticket-only recipient sees only the message from their accessible ticket", async () => {
  const f = fixture(); f.conversation.assigneeId = null;
  f.messages[0].text = "Только для заявки 42";
  f.messages.push({ ...f.messages[0], _id: id(10), ticketId: id(11), text: "Секрет другой заявки", sentAt: at(100) });
  f.tickets.push({ _id: id(11), num: 77, title: "Другая заявка", responsibles: [{ _id: id(12) }] });
  f.users.push(person(12, { readConversation: false }));
  await f.notifier.run(at(120));
  assert.equal(f.notices.size, 2);
  const notices = [...f.notices.values()];
  const first = notices.find((notice) => notice.to.chatId === "tg-6");
  const second = notices.find((notice) => notice.to.chatId === "tg-12");
  assert.match(first.text, /Только для заявки 42/);
  assert.equal(first.text.includes("Секрет другой заявки"), false);
  assert.match(second.text, /Секрет другой заявки/);
  assert.equal(second.text.includes("Только для заявки 42"), false);
  await f.notifier.run(at(600));
  const group = [...f.notices.values()].find((notice) => notice.to.globalChat);
  assert.match(group.text, /Заявка #77/);
  assert.equal(group.replyMarkup.inline_keyboard[0][0].url, "https://hd.example.test/tickets/77");
});

test("assignee without an active subscribed Telegram destination does not block ticket responsibles", async () => {
  for (const change of [
    (user) => { user.telegramBot.isActive = false; },
    (user) => { user.telegramBot.chatId = ""; },
    (user) => { user.notify.byTelegram.ticketNewComment = false; },
  ]) {
    const f = fixture(); change(f.users[0]);
    await f.notifier.run(at(120));
    assert.deepEqual([...f.notices.values()].map((notice) => notice.to.chatId), ["tg-6"]);
  }
});

test("unavailable or unauthorized assignee falls back to ticket responsibles", async () => {
  for (const patch of [{ deletedAt: at(0) }, { banned: true }, { isServiceAccount: true }, { isEndUser: true }, { readConversation: false }]) {
    const f = fixture(); Object.assign(f.users[0], patch);
    await f.notifier.run(at(120));
    assert.deepEqual([...f.notices.values()].map((notice) => notice.to.chatId), ["tg-6"]);
  }
});

test("unbound waits use the existing fallback audience without disclosing inaccessible conversations", async () => {
  const f = fixture(); f.conversation.assigneeId = null; f.messages[0].ticketId = null;
  f.users[0].companyIds = [id(8)];
  f.users[0].readConversation = false;
  await f.notifier.run(at(120)); assert.equal(f.notices.size, 0);
  f.users[0].readConversation = true;
  // This becomes a new waiting period; the considered previous audience is not replayed.
  f.conversation.awaitingSince = at(1); f.messages[0].sentAt = at(1);
  await f.notifier.run(at(121)); assert.equal(f.notices.size, 1);
});

test("disabled module and Telegram stay silent; personal and group switches remain independent", async () => {
  for (const disable of [f => { f.prefs.modules.messaging.isActive = false; }, f => { f.prefs.notify.byTelegram.isActive = false; }, f => { f.conversation.hidden = true; }]) {
    const f = fixture(); disable(f); await f.notifier.run(at(600)); assert.equal(f.notices.size, 0);
  }
  const f = fixture(); f.users.forEach((user) => { user.notify.byTelegram.ticketNewComment = false; });
  await f.notifier.run(at(600));
  assert.deepEqual([...f.notices.values()].map((notice) => notice.to.chatId), ["team"]);
  const g = fixture(); g.prefs.notify.byTelegram.sendToGroup = false;
  await g.notifier.run(at(600));
  assert.deepEqual([...g.notices.values()].map((notice) => notice.to.chatId), ["tg-3"]);
});

test("a crash after enqueue before checkpoint converges without a duplicate after restart", async () => {
  const f = fixture(); f.failCheckpoint();
  await assert.rejects(f.notifier.run(at(120)), /checkpoint failed/);
  assert.equal(f.notices.size, 1);
  await f.notifier.run(at(120)); assert.equal(f.notices.size, 1);
  f.conversation.awaitingSince = at(121); f.messages[0].sentAt = at(121);
  await f.notifier.run(at(241)); assert.equal(f.notices.size, 2);
});

test("queued reminders are cancelled for answered, hidden, deleted or superseded waits and disabled module", async () => {
  for (const change of [f => { f.conversation.awaitingSince = null; }, f => { f.conversation.hidden = true; }, f => { f.conversation.awaitingSince = at(1); }, f => { f.conversation._id = id(99); }, f => { f.prefs.modules.messaging.isActive = false; }]) {
    const f = fixture(); await f.notifier.run(at(120));
    const notice = [...f.notices.values()][0];
    assert.equal(await f.notifier.isCurrent(notice), true);
    change(f); assert.equal(await f.notifier.isCurrent(notice), false);
    assert.equal(await f.notifier.isCurrent({ to: { chatId: "ordinary" } }), true);
  }
});

test("the alert escapes client text and ignores imported, deleted and staff messages", async () => {
  const f = fixture();
  for (const extra of [{ imported: true }, { deletedAt: at(10) }, { origin: "staff" }]) {
    f.messages.push({ ...f.messages[0], _id: id(10 + f.messages.length), sentAt: at(100), text: "Лишняя реплика", ...extra });
  }
  await f.notifier.run(at(120));
  const notice = [...f.notices.values()][0];
  assert.match(notice.text, /&lt;не работает&gt;/);
  assert.equal(notice.text.includes("Лишняя реплика"), false);
  assert.equal(notice.text.includes("<Иван>"), false);
});

test('own inbox reader reminder cannot expose latest foreign or free preview and name',async()=>{
 const f=fixture();
 f.users[0].ownOnly=true;
 f.tickets[0].responsibles=[{_id:id(3)}];
 f.messages[0].text='Своя заявка';
 f.messages.push({...f.messages[0],_id:id(10),ticketId:null,text:'Чужое свободное сообщение',sentAt:at(100)});
 f.conversation.lastMessage.authorName='Секретное имя';
 await f.notifier.run(at(120));
 const notice=[...f.notices.values()][0];
 assert.ok(notice);
 assert.match(notice.text,/Своя заявка/);
 assert.doesNotMatch(notice.text,/Чужое|Секретное/);
 assert.match(notice.replyMarkup.inline_keyboard[0][0].url,/conversations/);
});
test('own inbox reader cannot receive unresolved-message fallback',async()=>{
 const f=fixture(); f.users[0].ownOnly=true; f.messages[0].ticketId=null;
 await f.notifier.run(at(120));
 assert.equal(f.notices.size,0);
});
