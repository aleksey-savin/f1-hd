// node --test src/util/conversation-thread.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  changesQuery,
  defaultDraftMessageIds,
  hasNewInbound,
  mergeMessages,
  nextCursor,
  threadRows,
} from "./conversation-thread.js";

const tz = "Europe/Moscow";
const now = new Date("2026-09-25T08:00:00Z");

const msg = (id, seq, extra = {}) => ({
  id,
  seq,
  direction: "in",
  sentAt: "2026-09-25T06:58:00Z",
  author: { name: "Соколова Марина", userId: "u-marina", isStaff: false },
  ticket: null,
  deletedAt: null,
  status: "received",
  ...extra,
});

test("mergeMessages: замена по id, новые по месту, порядок по seq", () => {
  const current = [msg("a", 1), msg("b", 2)];
  const merged = mergeMessages(current, [
    msg("c", 3),
    { ...msg("a", 1), status: "read" },
    msg("z", 0),
  ]);
  assert.deepEqual(
    merged.map((message) => message.id),
    ["z", "a", "b", "c"],
  );
  assert.equal(merged.find((message) => message.id === "a").status, "read");
  // Пустая порция не пересобирает ленту — ссылка та же
  assert.equal(mergeMessages(current, []), current);
});

test("nextCursor: полная страница дочитывается с afterId, неполная — от метки сервера", () => {
  assert.deepEqual(
    nextCursor({ items: [], serverTime: "2026-09-25T08:00:05Z", afterId: "m9", hasMore: true }),
    { since: "2026-09-25T08:00:05Z", afterId: "m9", drain: true },
  );
  assert.deepEqual(
    nextCursor({ items: [], serverTime: "2026-09-25T08:00:07Z", hasMore: false }),
    { since: "2026-09-25T08:00:07Z", afterId: null, drain: false },
  );
});

test("changesQuery: afterId только когда он есть", () => {
  assert.equal(
    changesQuery({ since: "2026-09-25T08:00:05.000Z", afterId: "m9" }),
    "changedSince=2026-09-25T08%3A00%3A05.000Z&limit=200&afterId=m9",
  );
  assert.equal(
    changesQuery({ since: "2026-09-25T08:00:05.000Z", afterId: null }, 50),
    "changedSince=2026-09-25T08%3A00%3A05.000Z&limit=50",
  );
});

test("hasNewInbound: только новое входящее, не правка известного", () => {
  const known = new Set(["a"]);
  assert.equal(hasNewInbound([msg("a", 1)], known), false);
  assert.equal(hasNewInbound([msg("b", 2, { direction: "out" })], known), false);
  assert.equal(hasNewInbound([msg("c", 3)], known), true);
});

test("threadRows: метки дней и отступы как на канве A1", () => {
  const rows = threadRows(
    [
      msg("m1", 1, { sentAt: "2026-09-24T06:58:00Z" }),
      msg("m2", 2),
      msg("r1", 3, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("s1", 4, { direction: "system", event: { kind: "ticketCreated" } }),
      msg("r2", 5, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("r3", 6, { direction: "out", author: { name: "Лебедев Игорь", userId: "u-igor" } }),
      msg("r4", 7, { direction: "out", author: { name: "Орлова Анна", userId: "u-anna" } }),
      msg("m3", 8),
      msg("m4", 9),
    ],
    { timeZone: tz, now },
  );
  assert.deepEqual(
    rows.map((row) =>
      row.type === "message"
        ? `${row.key}:${row.gap}${row.showAuthor ? "+author" : ""}`
        : row.type === "day"
          ? `day:${row.label}`
          : `sys:${row.key}`,
    ),
    [
      "day:Вчера",
      "m1:6",
      "day:Сегодня",
      "m2:6",
      "r1:12+author",
      "sys:s1",
      "r2:6+author",
      "r3:4",
      "r4:4+author",
      "m3:12",
      "m4:4",
    ],
  );
});

test("threadRows: в группе имя над входящим при смене автора, в личном — никогда", () => {
  const group = threadRows(
    [
      msg("g1", 1, { author: { name: "Смирнов Олег", userId: "u-oleg" } }),
      msg("g2", 2, { author: { name: "Смирнов Олег", userId: "u-oleg" } }),
      msg("g3", 3, { author: { name: "Костя", userId: null } }),
    ],
    { kind: "group", timeZone: tz, now },
  ).filter((row) => row.type === "message");
  assert.deepEqual(
    group.map((row) => row.showName),
    [true, false, true],
  );
  const direct = threadRows([msg("d1", 1), msg("d2", 2)], { kind: "direct", timeZone: tz, now }).filter(
    (row) => row.type === "message",
  );
  assert.deepEqual(
    direct.map((row) => row.showName),
    [false, false],
  );
});

test("defaultDraftMessageIds: хвост до первого сообщения в заявке, без системных и удалённых", () => {
  const messages = [
    msg("old", 1, { ticket: { id: "t1", num: 56700 } }),
    msg("a", 2),
    msg("sys", 3, { direction: "system" }),
    msg("b", 4, { direction: "out" }),
    msg("gone", 5, { deletedAt: "2026-09-25T07:00:00Z" }),
    msg("c", 6),
  ];
  assert.deepEqual(defaultDraftMessageIds(messages), ["a", "b", "c"]);
  assert.deepEqual(defaultDraftMessageIds(messages, { limit: 2 }), ["b", "c"]);
  assert.deepEqual(defaultDraftMessageIds([]), []);
});
