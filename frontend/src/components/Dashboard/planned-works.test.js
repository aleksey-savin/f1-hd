// node --test src/components/Dashboard/planned-works.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { countdownText, splitPlan } from "./planned-works.ts";

// «Сейчас» — понедельник 14.09.2026, 11:40 UTC; день считаем в UTC, чтобы тест
// не зависел от пояса машины
const NOW = new Date("2026-09-14T11:40:00Z");
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const daysAgo = (date) =>
  Math.round(
    (Date.parse(`${dayKey(NOW)}T00:00:00Z`) -
      Date.parse(`${dayKey(date)}T00:00:00Z`)) /
      86400000,
  );

const work = (id, start, finish = null) => ({
  _id: id,
  visitRequired: true,
  planningToStart: start,
  planningToFinish: finish,
  tickets: [{ _id: `t-${id}`, num: 1, title: "Тема" }],
  company: { _id: "c", alias: "Север" },
});

const split = (works) => splitPlan(works, { now: NOW, daysAgo });

test("идущая по плану работа — «сейчас», а не неподтверждённая", () => {
  const { today } = split([
    work("a", "2026-09-14T10:00:00Z", "2026-09-14T12:00:00Z"),
  ]);
  assert.equal(today.length, 1);
  assert.equal(today[0].phase, "now");
  assert.equal(today[0].highlighted, true);
});

test("время вышло — неподтверждённая; без конца плана считаем по началу", () => {
  const { today } = split([
    work("a", "2026-09-14T08:00:00Z", "2026-09-14T09:30:00Z"),
    work("b", "2026-09-14T09:00:00Z"),
  ]);
  assert.deepEqual(
    today.map((item) => item.phase),
    ["unconfirmed", "unconfirmed"],
  );
  assert.equal(today[0].pastDay, false);
});

test("неподтверждённые прошлых дней — до 14 дней, старше не показываем", () => {
  const { today } = split([
    work("old", "2026-08-30T10:00:00Z", "2026-08-30T11:00:00Z"),
    work("fri", "2026-09-11T16:00:00Z", "2026-09-11T17:00:00Z"),
  ]);
  assert.deepEqual(
    today.map((item) => item.work._id),
    ["fri"],
  );
  assert.equal(today[0].pastDay, true);
  assert.equal(today[0].highlighted, false);
});

test("без идущей подсвечена ближайшая сегодняшняя, остальные — нет", () => {
  const { today } = split([
    work("late", "2026-09-14T17:30:00Z"),
    work("next", "2026-09-14T14:00:00Z", "2026-09-14T15:30:00Z"),
  ]);
  assert.deepEqual(
    today.map((item) => [item.work._id, item.phase, item.highlighted]),
    [
      ["next", "soon", true],
      ["late", "later", false],
    ],
  );
});

test("если что-то идёт, ближайшая следующая не подсвечивается", () => {
  const { today } = split([
    work("now", "2026-09-14T11:00:00Z", "2026-09-14T12:30:00Z"),
    work("next", "2026-09-14T14:00:00Z"),
  ]);
  assert.deepEqual(
    today.map((item) => item.highlighted),
    [true, false],
  );
});

test("дальше в плане — с завтра на 14 дней вперёд, по времени", () => {
  const { today, upcoming } = split([
    work("far", "2026-09-29T10:00:00Z"),
    work("thu", "2026-09-17T11:00:00Z"),
    work("tue", "2026-09-15T09:30:00Z"),
    work("today", "2026-09-14T17:30:00Z"),
  ]);
  assert.deepEqual(
    upcoming.map((item) => item.work._id),
    ["tue", "thu"],
  );
  assert.deepEqual(
    today.map((item) => item.work._id),
    ["today"],
  );
});

test("отсчёт: минуты, часы с минутами, ровные часы, «вот-вот»", () => {
  const at = (iso) => countdownText(new Date(iso), NOW);
  assert.equal(at("2026-09-14T11:40:30Z"), "вот-вот");
  assert.equal(at("2026-09-14T12:25:00Z"), "через 45 мин");
  assert.equal(at("2026-09-14T14:00:00Z"), "через 2 ч 20 мин");
  assert.equal(at("2026-09-14T14:40:00Z"), "через 3 ч");
});
