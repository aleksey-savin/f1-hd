// node --test src/util/conversation-format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boundSinceLabel,
  composerPlaceholder,
  counterpartHandle,
  dayLabel,
  emptyListText,
  formatFileSize,
  handleLabel,
  lastMessagePrefix,
  linkAdvice,
  listTimeLabel,
  networkLabel,
  newCounterpartNote,
  phoneComposerHint,
  QUEUES,
  rowMeta,
  shortPersonName,
  splitPersonName,
  systemLineParts,
  voiceDuration,
  waitLabel,
} from "./conversation-format.js";

const tz = "Europe/Moscow";
// 25.09.2026 11:00 по Москве
const now = new Date("2026-09-25T08:00:00Z");

test("очереди — в порядке канвы, точка только у «Ждут ответа»", () => {
  assert.deepEqual(
    QUEUES.map((queue) => queue.label),
    ["Ждут ответа", "Мои", "Без заявки", "Все"],
  );
  assert.deepEqual(
    QUEUES.map((queue) => queue.dot),
    ["warning", "none", "none", "none"],
  );
});

test("waitLabel: минуты, часы с минутами, сутки с часами", () => {
  assert.equal(waitLabel(new Date(now.getTime() - 12 * 60_000), now), "12 мин");
  assert.equal(waitLabel(new Date(now.getTime() - 74 * 60_000), now), "1 ч 14 мин");
  assert.equal(waitLabel(new Date(now.getTime() - 60 * 60_000), now), "1 ч");
  assert.equal(waitLabel(new Date(now.getTime() - 25 * 3_600_000), now), "1 д 1 ч");
  assert.equal(waitLabel(new Date(now.getTime() - 30_000), now), "1 мин");
  assert.equal(waitLabel(null, now), "");
});

test("listTimeLabel: сегодня — время, вчера — слово, неделя — день, раньше — дата", () => {
  assert.equal(listTimeLabel("2026-09-25T07:42:00Z", { now, timeZone: tz }), "10:42");
  assert.equal(listTimeLabel("2026-09-24T07:42:00Z", { now, timeZone: tz }), "вчера");
  assert.equal(listTimeLabel("2026-09-21T09:00:00Z", { now, timeZone: tz }), "пн");
  assert.equal(listTimeLabel("2026-09-12T07:42:00Z", { now, timeZone: tz }), "12.09");
  assert.equal(listTimeLabel(null, { now, timeZone: tz }), "");
});

test("dayLabel: «Сегодня», «Вчера», «27 июля»", () => {
  assert.equal(dayLabel("2026-09-25T06:58:00Z", { now, timeZone: tz }), "Сегодня");
  assert.equal(dayLabel("2026-09-24T06:58:00Z", { now, timeZone: tz }), "Вчера");
  assert.equal(dayLabel("2026-07-27T06:58:00Z", { now, timeZone: tz }), "27 июля");
});

test("lastMessagePrefix: «Вы», «с телефона», коллега, автор в группе", () => {
  const myName = "Лебедев Игорь";
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "hd", authorName: "Лебедев Игорь" }, { kind: "direct", myName }),
    "Вы",
  );
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "hd", authorName: "Орлова Анна" }, { kind: "direct", myName }),
    "Орлова Анна",
  );
  assert.equal(
    lastMessagePrefix({ direction: "out", origin: "device", authorName: "F1Lab Поддержка · с телефона" }, { kind: "direct", myName }),
    "с телефона",
  );
  assert.equal(
    lastMessagePrefix({ direction: "in", origin: "client", authorName: "Смирнов Олег" }, { kind: "group", myName }),
    "Смирнов Олег",
  );
  assert.equal(
    lastMessagePrefix({ direction: "in", origin: "client", authorName: "Соколова Марина" }, { kind: "direct", myName }),
    "",
  );
  assert.equal(lastMessagePrefix(null, { kind: "direct", myName }), "");
});

test("rowMeta: заявка, «без заявки», неизвестный собеседник, форма", () => {
  const company = { id: "c1", alias: "ТД Восток" };
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "telegram", company, ticket: { num: 56812 }, unknown: false }),
    [
      { text: "ТД Восток", tone: "muted" },
      { text: "№56812", tone: "muted" },
    ],
  );
  assert.deepEqual(
    rowMeta({ kind: "group", network: "telegram", company, ticket: null, unknown: false }),
    [
      { text: "ТД Восток", tone: "muted" },
      { text: "без заявки", tone: "faint" },
    ],
  );
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "telegram", company: null, ticket: null, unknown: true }),
    [{ text: "неизвестный контакт", tone: "faint" }],
  );
  assert.deepEqual(
    rowMeta({ kind: "direct", network: "whatsapp", company: null, ticket: null, unknown: true }),
    [{ text: "неизвестный номер", tone: "faint" }],
  );
  // Форма сайта: вместо компании — «Форма с сайта», неопознанность не выпячиваем
  assert.deepEqual(
    rowMeta({ kind: "form", network: "site", company: null, ticket: null, unknown: true }),
    [
      { text: "Форма с сайта", tone: "muted" },
      { text: "без заявки", tone: "faint" },
    ],
  );
});

test("emptyListText: поиск сильнее очереди, скрытые — своя фраза", () => {
  assert.equal(emptyListText({ queue: "awaiting" }), "Никто не ждёт ответа");
  assert.equal(emptyListText({ queue: "mine" }), "Ваших диалогов нет");
  assert.equal(emptyListText({ queue: "all", hidden: true }), "Скрытых диалогов нет");
  assert.equal(emptyListText({ queue: "awaiting", q: "принтер" }), "Ничего не нашлось");
});

test("имена: короткое для кнопки и разбор для формы пользователя", () => {
  assert.equal(shortPersonName("Соколова Марина"), "Соколова М.");
  assert.equal(shortPersonName("Андрей"), "Андрей");
  assert.equal(shortPersonName(""), "");
  assert.deepEqual(splitPersonName("Андрей Кузнецов"), { firstName: "Андрей", lastName: "Кузнецов" });
  assert.deepEqual(splitPersonName("Андрей"), { firstName: "Андрей", lastName: "" });
  assert.deepEqual(splitPersonName("  "), { firstName: "", lastName: "" });
});

test("boundSinceLabel: сегодня — время, раньше — дата", () => {
  assert.equal(boundSinceLabel("2026-09-25T07:03:00Z", { now, timeZone: tz }), "привязана с 10:03");
  assert.equal(boundSinceLabel("2026-09-12T07:03:00Z", { now, timeZone: tz }), "привязана с 12.09");
  assert.equal(boundSinceLabel(null, { now, timeZone: tz }), "");
});

test("systemLineParts: безлично, с номером заявки отдельной частью", () => {
  const created = { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь" };
  assert.deepEqual(systemLineParts(created), [
    { text: "Создана заявка " },
    { ticket: 56812 },
    { text: " — дальше переписка идёт в неё · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts(created, { compact: true }), [
    { text: "Создана заявка " },
    { ticket: 56812 },
    { text: " — переписка идёт в неё" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "handled", byName: "Лебедев Игорь" }), [
    { text: "Ответ не нужен · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "assigned", targetName: "Орлова Анна", byName: "Лебедев Игорь" }), [
    { text: "Ответственный за диалог — Орлова Анна · Лебедев Игорь" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "assigned", targetName: "", byName: "" }), [
    { text: "Ответственный за диалог снят" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "attached", ticketNum: 7, count: 3, byName: "" }), [
    { text: "3 сообщения добавлены в заявку " },
    { ticket: 7 },
    { text: "" },
  ]);
  // Номера нет — ссылки нет, строка не ломается
  assert.deepEqual(systemLineParts({ kind: "bound", ticketNum: null, byName: "" }), [
    { text: "Диалог привязан к заявке " },
    { text: "" },
    { text: "" },
  ]);
  assert.deepEqual(systemLineParts({ kind: "somethingNew" }), [{ text: "Событие диалога" }]);
});

test("вложения: размер по-русски и длительность голосового", () => {
  assert.equal(formatFileSize(1_887_436), "1,8 МБ");
  assert.equal(formatFileSize(245_760), "240 КБ");
  assert.equal(formatFileSize(0), "");
  assert.equal(voiceDuration(14), "0:14");
  assert.equal(voiceDuration(75), "1:15");
});

test("подписи по сети: номер у WhatsApp, аккаунт у остальных", () => {
  assert.equal(networkLabel("telegram"), "Telegram");
  assert.equal(networkLabel("unknown"), "Мессенджер");
  assert.match(newCounterpartNote("whatsapp"), /этого номера нет/);
  assert.match(newCounterpartNote("telegram"), /этого аккаунта нет/);
  assert.match(linkAdvice("telegram"), /^Свяжите аккаунт с пользователем/);
  assert.equal(counterpartHandle({ username: "m_sokolova", phone: "+7914" }), "@m_sokolova");
  assert.equal(
    counterpartHandle({ username: "", phone: "79145550142" }),
    "+7 (914) 555-01-42",
  );
  assert.equal(handleLabel("@m_sokolova"), "@m_sokolova");
  assert.equal(handleLabel("79145550142"), "+7 (914) 555-01-42");
  assert.equal(handleLabel(""), "");
  assert.equal(counterpartHandle(null), "");
});

test("поле ответа называет канал и заявку", () => {
  assert.equal(
    composerPlaceholder("telegram", 56812),
    "Сообщение в Telegram — попадёт в заявку №56812",
  );
  assert.equal(composerPlaceholder("telegram", null), "Сообщение в Telegram");
  assert.equal(
    phoneComposerHint("telegram", 56812),
    "Ответ уйдёт в Telegram и попадёт в заявку №56812",
  );
  assert.equal(phoneComposerHint("telegram", null), "Ответ уйдёт в Telegram");
});
