// node --test src/util/chronicle-dialog.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GAP,
  chronicleRows,
  commentMarker,
  commentSide,
  isEmailComment,
} from "./chronicle-dialog.js";

const tz = "Europe/Moscow";
// 26.09.2026 14:00 по Москве
const now = new Date("2026-09-26T11:00:00Z");

const marina = { _id: "u-marina", firstName: "Марина", lastName: "Соколова", isEndUser: true };
const lebedev = { _id: "u-lebedev", firstName: "Игорь", lastName: "Лебедев", isEndUser: false };
const smirnov = { _id: "u-smirnov", firstName: "Олег", lastName: "Смирнов", isEndUser: false };
const service = { _id: "u-service", firstName: "Служебная", lastName: "учётка", isEndUser: true };

const staffViewer = { id: "u-lebedev", isClient: false };
const clientViewer = { id: "u-marina", isClient: true };

const comment = (id, at, createdBy, extra = {}) => ({
  _id: id,
  createdAt: at,
  createdBy,
  content: `текст ${id}`,
  ...extra,
});

test("staff: the team on the right, the applicant, other clients and unknown senders on the left", () => {
  const ctx = { viewer: staffViewer, applicantId: "u-marina" };
  assert.equal(commentSide(comment("c1", now, lebedev), ctx), "out");
  assert.equal(commentSide(comment("c2", now, smirnov), ctx), "out");
  assert.equal(commentSide(comment("c3", now, marina), ctx), "in");
  // Зеркало неопознанного собеседника — от служебной учётки, но слева
  assert.equal(
    commentSide(comment("c4", now, service, { channel: { network: "telegram", direction: "in", authorName: "Андрей · Telegram" } }), ctx),
    "in",
  );
  // Ответ с корпоративного телефона — команда, хоть автор и служебный
  assert.equal(
    commentSide(comment("c5", now, service, { channel: { network: "telegram", direction: "out", authorName: "F1Lab Поддержка · с телефона" } }), ctx),
    "out",
  );
  // Старый снимок автора без признака: заявитель — слева, прочие — справа
  assert.equal(commentSide(comment("c6", now, { _id: "u-marina", firstName: "Марина" }), ctx), "in");
  assert.equal(commentSide(comment("c7", now, { _id: "u-old-engineer", firstName: "Пётр" }), ctx), "out");
  assert.equal(commentSide(comment("c8", now, "u-marina"), ctx), "in");
  // Автор удалён — слева
  assert.equal(commentSide(comment("c9", now, null), ctx), "in");
});

test("письмо от незарегистрированного отправителя: автор — служебная учётка (Preferences.defaultApplicant), но сторона клиентская для любого смотрящего", () => {
  const unregistered = {
    _id: "u-default-applicant",
    firstName: "Служба",
    lastName: "поддержки",
    isEndUser: false,
    isServiceAccount: true,
  };
  const mail = comment("c1", now, unregistered, { source: "email" });
  assert.equal(
    commentSide(mail, { viewer: staffViewer, applicantId: "u-marina" }),
    "in",
  );
  assert.equal(
    commentSide(mail, { viewer: clientViewer, applicantId: "u-marina" }),
    "in",
  );
  // С блоком канала — это не письмо, а «с телефона»: обычные правила канала,
  // не оговорка про служебную учётку
  const fromPhone = comment("c2", now, unregistered, {
    channel: { network: "telegram", direction: "out", authorName: "F1Lab Поддержка · с телефона" },
  });
  assert.equal(
    commentSide(fromPhone, { viewer: staffViewer, applicantId: "u-marina" }),
    "out",
  );
});

test("client: only their own messages on the right, the team on the left", () => {
  const ctx = { viewer: clientViewer, applicantId: "u-marina" };
  assert.equal(commentSide(comment("c1", now, marina), ctx), "out");
  assert.equal(commentSide(comment("c2", now, { _id: "u-marina" }), ctx), "out");
  assert.equal(commentSide(comment("c3", now, lebedev), ctx), "in");
  // Её сообщение из Telegram (собеседник связан с ней) — её
  assert.equal(commentSide(comment("c4", now, marina, { channel: { network: "telegram", direction: "in" } }), ctx), "out");
  // Ответ команды мессенджером — чужой
  assert.equal(commentSide(comment("c5", now, lebedev, { channel: { network: "telegram", direction: "out", status: "read" } }), ctx), "in");
  assert.equal(commentSide(comment("c6", now, { _id: "u-colleague", isEndUser: true }), ctx), "in");
});

test("markers: messenger block and «письмо» for staff; the client sees them only on own messages and without delivery status", () => {
  const reply = comment("c1", now, lebedev, { channel: { network: "telegram", direction: "out", status: "read" } });
  assert.deepEqual(commentMarker(reply, { viewer: staffViewer, side: "out" }), {
    channel: { network: "telegram", direction: "out", status: "read" },
  });
  assert.equal(commentMarker(reply, { viewer: clientViewer, side: "in" }), null);

  const mail = comment("c2", now, marina, { source: "email" });
  assert.deepEqual(commentMarker(mail, { viewer: staffViewer, side: "in" }), {
    channel: { network: "mail", direction: "in" },
    label: "письмо",
  });
  assert.deepEqual(commentMarker(mail, { viewer: clientViewer, side: "out" }), {
    channel: { network: "mail", direction: "in" },
    label: "письмо",
  });
  // Старое письмо узнаётся по отрезанной цитате
  assert.equal(isEmailComment(comment("c3", now, marina, { quotedText: "> Добрый день" })), true);
  assert.equal(isEmailComment(comment("c4", now, marina)), false);

  const own = comment("c5", now, marina, { channel: { network: "telegram", direction: "in", status: "delivered" } });
  assert.deepEqual(commentMarker(own, { viewer: clientViewer, side: "out" }), {
    channel: { network: "telegram", direction: "in" },
  });
  assert.equal(commentMarker(comment("c6", now, lebedev), { viewer: staffViewer, side: "out" }), null);
});

test("rows: oldest first, a day label per day, events between messages by time", () => {
  const rows = chronicleRows({
    comments: [
      comment("c2", "2026-09-26T07:46:00Z", lebedev),
      comment("c1", "2026-09-25T06:40:00Z", marina),
    ],
    events: [{ _id: "e1", kind: "taken", createdAt: "2026-09-26T07:45:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  });
  assert.deepEqual(
    rows.map((row) => (row.type === "day" ? `day:${row.label}` : row.key)),
    ["day:Вчера", "c-c1", "day:Сегодня", "e-e1", "c-c2"],
  );
  assert.equal(
    chronicleRows({ comments: [], events: [], viewer: staffViewer, now, timeZone: tz }).length,
    0,
  );
});

test("«Новые»: above the first unread message of someone else, with the count; own messages and events never count", () => {
  const input = {
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T08:00:00Z", lebedev),
      comment("c3", "2026-09-26T09:00:00Z", marina),
      comment("c4", "2026-09-26T10:00:00Z", smirnov),
    ],
    events: [{ _id: "e1", kind: "workAdded", createdAt: "2026-09-26T08:30:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    seenAt: "2026-09-26T07:00:00Z",
    now,
    timeZone: tz,
  };
  const keys = chronicleRows(input).map((row) => row.key);
  assert.deepEqual(keys, ["d-2026-09-26", "c-c1", "c-c2", "e-e1", "new", "c-c3", "c-c4"]);
  assert.equal(chronicleRows(input).find((row) => row.type === "new").count, 2);
  // Первый визит — черты нет
  assert.equal(chronicleRows({ ...input, seenAt: null }).some((row) => row.type === "new"), false);
  // Метка дня остаётся и над чертой
  const nextDay = chronicleRows({
    ...input,
    comments: [comment("c1", "2026-09-25T06:00:00Z", lebedev), comment("c2", "2026-09-26T08:00:00Z", marina)],
    events: [],
    seenAt: "2026-09-25T07:00:00Z",
  }).map((row) => row.key);
  assert.deepEqual(nextDay, ["d-2026-09-25", "c-c1", "d-2026-09-26", "new", "c-c2"]);
});

test("names: staff sees colleagues and unknown senders by name, the applicant and own messages unlabeled; runs are grouped", () => {
  const rows = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", lebedev),
      comment("c3", "2026-09-26T06:02:00Z", smirnov),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
      comment("c5", "2026-09-26T06:04:00Z", service, {
        channel: { network: "telegram", direction: "in", authorName: "Андрей · Telegram" },
      }),
      comment("c6", "2026-09-26T06:05:00Z", service, {
        channel: { network: "telegram", direction: "out", authorName: "F1Lab Поддержка · с телефона" },
      }),
    ],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    rows.map((row) => [row.key, row.side, row.showName]),
    [
      ["c-c1", "in", false],
      ["c-c2", "out", false],
      ["c-c3", "out", true],
      ["c-c4", "out", false],
      ["c-c5", "in", true],
      ["c-c6", "out", true],
    ],
  );

  const client = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", lebedev),
      comment("c3", "2026-09-26T06:02:00Z", lebedev),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
    ],
    viewer: clientViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    client.map((row) => [row.key, row.side, row.showName]),
    [
      ["c-c1", "out", false],
      ["c-c2", "in", true],
      ["c-c3", "in", false],
      ["c-c4", "in", true],
    ],
  );
});

test("gaps: 6 after a label or an event, 4 for the same author, 8 for the same side, 12 on a side switch", () => {
  const rows = chronicleRows({
    comments: [
      comment("c1", "2026-09-26T06:00:00Z", marina),
      comment("c2", "2026-09-26T06:01:00Z", marina),
      comment("c3", "2026-09-26T06:02:00Z", lebedev),
      comment("c4", "2026-09-26T06:03:00Z", smirnov),
      comment("c5", "2026-09-26T06:05:00Z", marina),
    ],
    events: [{ _id: "e1", kind: "taken", createdAt: "2026-09-26T06:04:00Z" }],
    viewer: staffViewer,
    applicantId: "u-marina",
    now,
    timeZone: tz,
  }).filter((row) => row.type === "comment");
  assert.deepEqual(
    rows.map((row) => row.gap),
    [GAP.afterLabel, GAP.sameAuthor, GAP.sideSwitch, GAP.sameSide, GAP.afterLabel],
  );
  assert.deepEqual(GAP, { afterLabel: 6, sameAuthor: 4, sameSide: 8, sideSwitch: 12 });
});
