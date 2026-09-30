// node --test services/messaging/rules.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  nextAwaiting,
  decideAttach,
  advanceStatus,
  commentContent,
  previewOf,
  identityName,
  backoffMs,
  signReply,
  DECISION_WINDOW_MS,
} = require("./rules");

const at = (hhmm) => new Date(`2026-09-24T${hhmm}:00.000Z`);

test("a client message starts waiting only when nobody is waiting yet", () => {
  const client = { direction: "in", origin: "client", sentAt: at("10:30") };
  assert.deepEqual(nextAwaiting({ awaitingSince: null }, client), { awaitingSince: at("10:30") });
  // ждём с первого неотвеченного, а не с последнего
  assert.equal(nextAwaiting({ awaitingSince: at("10:00") }, client), null);
});

test("a late client message older than a newer reply does not start waiting", () => {
  const conv = { awaitingSince: null, lastMessage: { at: at("10:40"), direction: "out" } };
  // сообщение клиента, отправленное до нашего ответа, но доехавшее позже
  const late = { direction: "in", origin: "client", sentAt: at("10:30") };
  assert.equal(nextAwaiting(conv, late), null);
  // сообщение клиента новее последнего ответа — вопрос открывается как обычно
  const newer = { direction: "in", origin: "client", sentAt: at("10:50") };
  assert.deepEqual(nextAwaiting(conv, newer), { awaitingSince: at("10:50") });
  // последний исходящий не найден (диалог только начался) — обычное поведение
  assert.deepEqual(nextAwaiting({ awaitingSince: null }, late), { awaitingSince: at("10:30") });
});

test("any newer answer clears waiting; a late older one does not", () => {
  const conv = { awaitingSince: at("10:30") };
  for (const origin of ["hd", "device"]) {
    assert.deepEqual(nextAwaiting(conv, { direction: "out", origin, sentAt: at("10:40") }), { awaitingSince: null });
  }
  // сотрудник ответил в группе со своего аккаунта
  assert.deepEqual(nextAwaiting(conv, { direction: "in", origin: "staff", sentAt: at("10:40") }), { awaitingSince: null });
  // ответ, посланный раньше вопроса, но доехавший позже, вопрос не закрывает
  assert.equal(nextAwaiting(conv, { direction: "out", origin: "device", sentAt: at("10:20") }), null);
});

test("history and system lines never touch waiting", () => {
  assert.equal(nextAwaiting({ awaitingSince: null }, { direction: "in", origin: "client", sentAt: at("10:30"), imported: true }), null);
  assert.equal(nextAwaiting({ awaitingSince: at("10:00") }, { direction: "system", origin: "system", sentAt: at("10:30") }), null);
});

const direct = (binding = {}, extra = {}) => ({ kind: "direct", binding: { ticketId: null, endedAt: null, ...binding }, decision: { ticketId: null }, ...extra });
const ticket = (num, isClosed = false) => ({ _id: `t${num}`, num, isClosed });
const clientMsg = (hhmm = "10:30", extra = {}) => ({ direction: "in", origin: "client", sentAt: at(hhmm), ...extra });

test("a bound direct chat feeds its open ticket, both ways except HD-sent", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: ticket(56812) }), {
    mode: "bound",
    ticketId: "t56812",
    ticketNum: 56812,
  });
  // ответ с телефона тоже попадает в заявку
  assert.equal(decideAttach({ conversation: conv, message: { direction: "out", origin: "device", sentAt: at("10:40") }, boundTicket: ticket(56812) }).mode, "bound");
  // ответ из HD в заявку кладёт отправка, не приём
  assert.equal(decideAttach({ conversation: conv, message: { direction: "out", origin: "hd", sentAt: at("10:40") }, boundTicket: ticket(56812) }).mode, null);
});

test("a bound ticket that is closed ends the binding and asks the client's question", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: ticket(56812, true) }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    endBinding: "closed",
    decision: { ticketId: "t56812", ticketNum: 56812 },
  });
  // удалённая заявка: привязка кончается, спрашивать не о чем
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg(), boundTicket: null }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    endBinding: "deleted",
  });
});

test("after a closure the next client message asks once, within the window", () => {
  const endedAt = at("09:00");
  const conv = direct({ ticketId: "t56812", ticketNum: 56812, endedAt, endReason: "closed" });
  assert.deepEqual(decideAttach({ conversation: conv, message: clientMsg("10:30") }).decision, { ticketId: "t56812", ticketNum: 56812 });
  // вопрос уже задан — второй раз не задаём
  const asked = { ...conv, decision: { ticketId: "t56812" } };
  assert.equal(decideAttach({ conversation: asked, message: clientMsg("10:31") }).decision, undefined);
  // после окна — обычное непривязанное сообщение
  const late = clientMsg("10:30", { sentAt: new Date(endedAt.getTime() + DECISION_WINDOW_MS + 1000) });
  assert.equal(decideAttach({ conversation: conv, message: late }).decision, undefined);
  // отвязали руками — не спрашиваем
  const manual = direct({ ticketId: "t56812", ticketNum: 56812, endedAt, endReason: "manual" });
  assert.equal(decideAttach({ conversation: manual, message: clientMsg() }).decision, undefined);
});

test("groups attach only a quote-reply to an open ticket's message", () => {
  const group = { kind: "group", binding: {}, decision: {} };
  assert.deepEqual(decideAttach({ conversation: group, message: clientMsg(), replyToTicket: ticket(56801) }), {
    mode: "reply",
    ticketId: "t56801",
    ticketNum: 56801,
  });
  assert.deepEqual(decideAttach({ conversation: group, message: clientMsg(), replyToTicket: ticket(56801, true) }), {
    mode: null,
    ticketId: null,
    ticketNum: null,
    suggestTicketId: "t56801",
  });
  assert.equal(decideAttach({ conversation: group, message: clientMsg() }).mode, null);
});

test("history is never attached", () => {
  const conv = direct({ ticketId: "t56812", ticketNum: 56812 });
  assert.equal(decideAttach({ conversation: conv, message: clientMsg("10:30", { imported: true }), boundTicket: ticket(56812) }).mode, null);
});

test("delivery status only moves forward; failed only before delivery", () => {
  assert.equal(advanceStatus("queued", "sent"), "sent");
  assert.equal(advanceStatus("read", "delivered"), "read");
  assert.equal(advanceStatus("sent", "failed"), "failed");
  assert.equal(advanceStatus("delivered", "failed"), "delivered");
  // повтор после сбоя удался
  assert.equal(advanceStatus("failed", "sent"), "sent");
  assert.equal(advanceStatus("sent", "bogus"), "sent");
});

test("a message without text becomes a readable comment", () => {
  assert.equal(commentContent({ kind: "text", text: "  Оранжевый мигает  " }), "Оранжевый мигает");
  assert.equal(commentContent({ kind: "photo", text: "", attachments: [{}] }), "Фото");
  assert.equal(commentContent({ kind: "voice", attachments: [{ durationSec: 14 }] }), "Голосовое 0:14");
  assert.equal(commentContent({ kind: "voice", attachments: [{ durationSec: 75 }] }), "Голосовое 1:15");
  assert.equal(commentContent({ kind: "document", attachments: [{ originalName: "акт.pdf" }] }), "Файл «акт.pdf»");
  assert.equal(
    commentContent({ kind: "form", form: { fields: [{ label: "Имя", value: "Елена" }, { label: "Сообщение", value: "Нужна поддержка" }] } }),
    "Имя: Елена\nСообщение: Нужна поддержка",
  );
  assert.equal(commentContent({ kind: "sticker" }), "Стикер");
  assert.equal(commentContent({}), "Сообщение");
});

test("preview is one line of at most 140 characters", () => {
  assert.equal(previewOf({ text: "a\n\nb   c" }), "a b c");
  assert.equal(previewOf({ text: "x".repeat(300) }).length, 140);
});

test("an identity is named by its name, then @username, then phone", () => {
  assert.equal(identityName({ firstName: "Марина", lastName: "Соколова" }), "Марина Соколова");
  assert.equal(identityName({ displayName: "Андрей", phone: "79142073318" }), "Андрей");
  assert.equal(identityName({ username: "kostya_it" }), "@kostya_it");
  assert.equal(identityName({ phone: "79142073318", externalId: "x" }), "+7 (914) 207-33-18");
  assert.equal(identityName({ phone: "375291234567" }), "+375291234567");
  assert.equal(identityName(null), "");
});

test("backoff grows 30 s → 30 min", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [30_000, 120_000, 480_000, 1_800_000, 1_800_000, 1_800_000]);
});

test("a signature is the first name and the organisation — never contacts", () => {
  assert.equal(signReply("Будем в 14:00.", { firstName: "Игорь", organization: "F1Lab" }), "Будем в 14:00.\n\n— Игорь, F1Lab");
  assert.equal(signReply("Будем.", { firstName: "Игорь", organization: "" }), "Будем.\n\n— Игорь");
  assert.equal(signReply("Будем.", { firstName: "", organization: "F1Lab" }), "Будем.\n\n— F1Lab");
  assert.equal(signReply("Будем.", {}), "Будем.");
});
