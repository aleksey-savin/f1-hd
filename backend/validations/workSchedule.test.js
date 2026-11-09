// node --test validations/workSchedule.test.js
require("module-alias/register");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isWeekSchedule } = require("./workSchedule");

const mixed = () => w("09:00", "19:00", { intervals: [
  { start: "09:00", end: "11:00", place: "remote" },
  { start: "11:00", end: "19:00", place: "office" },
] });

test("места работы покрывают смену без разрывов и пересечений", () => {
  assert.equal(isWeekSchedule(week({ Monday: mixed() })), true);
  for (const [start, end] of [["12:00", "19:00"], ["10:00", "19:00"], ["11:00", "18:00"]]) {
    const day = mixed();
    day.intervals[1] = { start, end, place: "office" };
    assert.throws(() => isWeekSchedule(week({ Monday: day })), /интервал/i);
  }
});

test("неизвестное место, пустые и битые интервалы отвергаются", () => {
  for (const intervals of [[], null, {}, [{ start: "09:00", end: "19:00", place: "lunch" }], [{ start: "9:00", end: "19:00", place: "office" }]]) {
    assert.throws(() => isWeekSchedule(week({ Monday: w("09:00", "19:00", { intervals }) })), /интервал|место/i);
  }
});

test("интервалы ночной смены и суток принимаются в порядке времени смены", () => {
  assert.equal(isWeekSchedule(week({ Monday: w("22:00", "06:00", { intervals: [
    { start: "22:00", end: "01:00", place: "office" },
    { start: "01:00", end: "06:00", place: "remote" },
  ] }) })), true);
  assert.equal(isWeekSchedule(week({ Monday: { isWorking: true, is24hours: true, intervals: [
    { start: "00:00", end: "12:00", place: "office" },
    { start: "12:00", end: "00:00", place: "remote" },
  ] } })), true);
});

test("модель пользователя сохраняет интервалы и не дописывает их старым графикам", () => {
  const User = require("../models/user");
  const user = new User({ workSchedules: [{ schedule: week({ Monday: mixed() }) }] });
  const schedule = user.toObject().workSchedules[0].schedule;
  assert.deepEqual(schedule.Monday.intervals, mixed().intervals);
  assert.equal(schedule.Tuesday.intervals, undefined);
});

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const off = {
  isWorking: false,
  is24hours: false,
  start: "09:00",
  end: "18:00",
  breakMinutes: 0,
};
const w = (start, end, over = {}) => ({
  isWorking: true,
  is24hours: false,
  start,
  end,
  breakMinutes: 0,
  ...over,
});
const week = (byDay) =>
  Object.fromEntries(DAYS.map((name) => [name, byDay[name] || off]));
const every = (day) => Object.fromEntries(DAYS.map((name) => [name, day]));

const rejects = (schedule, part) =>
  assert.throws(() => isWeekSchedule(schedule), (error) => {
    assert.match(error.message, part);
    return true;
  });

test("обычное окно принимается", () => {
  assert.equal(isWeekSchedule(every(w("09:00", "18:00"))), true);
});

test("смена через полночь принимается", () => {
  assert.equal(isWeekSchedule(every(w("22:00", "06:00"))), true);
  assert.equal(isWeekSchedule(every(w("16:00", "01:00"))), true);
});

test("нулевое окно отвергается — для суток есть флаг", () => {
  rejects(every(w("09:00", "09:00")), /нулевое окно/);
});

test("круглосуточный день не требует времени", () => {
  assert.equal(
    isWeekSchedule(every({ isWorking: true, is24hours: true, breakMinutes: 0 })),
    true,
  );
});

test("некорректное время отвергается", () => {
  rejects(every(w("9:00", "18:00")), /некорректное время/);
  rejects(every(w("24:00", "06:00")), /некорректное время/);
});

test("подряд идущие ночные смены не считаются пересечением", () => {
  assert.equal(isWeekSchedule(every(w("16:00", "08:00"))), true);
});

test("хвост смены не может залезать на следующую", () => {
  rejects(
    week({ Monday: w("16:00", "01:00"), Tuesday: w("00:00", "08:00") }),
    /заходит на смену/,
  );
});

test("проверка соседства циклическая: воскресенье и понедельник", () => {
  rejects(
    week({ Sunday: w("20:00", "10:00"), Monday: w("09:00", "18:00") }),
    /«Sunday».*«Monday»/,
  );
});

test("перерыв вне диапазона отвергается", () => {
  rejects(every(w("09:00", "18:00", { breakMinutes: 600 })), /перерыв/);
});

test("день без флага рабочести отвергается", () => {
  rejects(week({ Monday: { is24hours: false } }), /не указано, рабочий ли он/);
});

// --- график компании и тарифа: неполная неделя допустима -------------------

const { isPartialWeekSchedule } = require("./workSchedule");

test("у компании неполная неделя проходит: 29 из 33 хранят её именно так", () => {
  assert.equal(
    isPartialWeekSchedule({ Monday: w("09:00", "18:00") }),
    true,
  );
  // а строгая проверка на том же объекте — падает
  rejects({ Monday: w("09:00", "18:00") }, /В графике нет дня/);
});

test("неполная неделя всё равно проверяется по форме дней", () => {
  assert.throws(
    () => isPartialWeekSchedule({ Monday: w("09:00", "09:00") }),
    /нулевое окно/,
  );
});

test("пересечение ловится и в неполной неделе", () => {
  assert.throws(
    () =>
      isPartialWeekSchedule({
        Monday: w("16:00", "01:00"),
        Tuesday: w("00:00", "08:00"),
      }),
    /заходит на смену/,
  );
});
