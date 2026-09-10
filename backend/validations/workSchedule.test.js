// node --test validations/workSchedule.test.js
require("module-alias/register");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isWeekSchedule } = require("./workSchedule");

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
