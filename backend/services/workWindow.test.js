// node --test services/workWindow.test.js
require("module-alias/register");

const { test } = require("node:test");
const assert = require("node:assert/strict");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const {
  windowMinutes,
  instantOf,
  buildWindows,
  subtractWindows,
  intersectWindows,
  shiftDayKey,
  dayNameOfKey,
} = require("@/services/workWindow");

const ZONE = "Asia/Vladivostok";

test("обычное окно разбирается в минуты от полуночи", () => {
  assert.deepEqual(windowMinutes("09:00", "18:00"), {
    start: 540,
    end: 1080,
    length: 540,
  });
});

test("окно через полночь продолжается в следующие сутки", () => {
  assert.deepEqual(windowMinutes("22:00", "06:00"), {
    start: 1320,
    end: 1800,
    length: 480,
  });
  assert.deepEqual(windowMinutes("16:00", "01:00"), {
    start: 960,
    end: 1500,
    length: 540,
  });
});

test("конец в «00:00» — это полночь конца суток, а не ноль минут", () => {
  // Прежний разбор отправлял такой день в ветку «битое время» и молча обнулял
  // норму: 0 <= start всегда истинно.
  assert.deepEqual(windowMinutes("09:00", "00:00"), {
    start: 540,
    end: 1440,
    length: 900,
  });
});

test("нулевое окно остаётся нулевым, а не становится сутками", () => {
  // В проде есть тариф со всеми семью днями 00:00–00:00 — это «окна нет, всё
  // переработка». Прочитать его как 24 часа значит перевернуть счёт клиенту.
  assert.equal(windowMinutes("00:00", "00:00"), null);
  assert.equal(windowMinutes("09:00", "09:00"), null);
});

test("неразбираемое время окна не даёт", () => {
  assert.equal(windowMinutes("", ""), null);
  assert.equal(windowMinutes("aa:bb", "18:00"), null);
  assert.equal(windowMinutes(null, "18:00"), null);
});

test("instantOf совпадает с прямым разбором настенного времени", () => {
  assert.equal(
    instantOf("2026-06-01", 540, ZONE),
    dayjs.tz("2026-06-01 09:00", ZONE).valueOf(),
  );
});

test("instantOf переносит смещение за сутки на следующий день", () => {
  assert.equal(
    instantOf("2026-06-01", 1800, ZONE),
    dayjs.tz("2026-06-02 06:00", ZONE).valueOf(),
  );
});

test("instantOf не наследует замороженное смещение на переходе через DST", () => {
  // Страховка от дрейфа dayjs: cursor.hour() держит смещение первого дня, и
  // после перехода каждый следующий день цикла уезжает на час навсегда.
  const berlin = "Europe/Berlin";
  assert.equal(
    instantOf("2026-03-30", 540, berlin),
    dayjs.tz("2026-03-30 09:00", berlin).valueOf(),
  );
  const springDayLength =
    instantOf("2026-03-30", 0, berlin) - instantOf("2026-03-29", 0, berlin);
  assert.equal(springDayLength, 23 * 60 * 60 * 1000);
});

test("ключ даты сдвигается через границу месяца и года", () => {
  assert.equal(shiftDayKey("2026-05-31", 1), "2026-06-01");
  assert.equal(shiftDayKey("2026-01-01", -1), "2025-12-31");
});

test("имя дня недели берётся по календарю, а не по поясу", () => {
  assert.equal(dayNameOfKey("2026-06-01"), "Monday");
  assert.equal(dayNameOfKey("2026-06-07"), "Sunday");
});

// --- объединение и вычитание окон -----------------------------------------

const planner = (byKey) => (key) => byKey[key] || null;

test("окна соседних дней собираются в порядке и без пересечений", () => {
  const windows = buildWindows(
    planner({
      "2026-06-01": { start: 540, end: 1080 },
      "2026-06-02": { start: 540, end: 1080 },
    }),
    "2026-06-01",
    "2026-06-02",
    ZONE,
  );

  assert.equal(windows.length, 2);
  assert.equal(windows[0].from, dayjs.tz("2026-06-01 09:00", ZONE).valueOf());
  assert.equal(windows[1].to, dayjs.tz("2026-06-02 18:00", ZONE).valueOf());
});

test("пересекающиеся окна старых данных сливаются, минута не двоится", () => {
  // 16:00–01:00 рядом с 00:00–08:00 дают час пересечения; побеждает более
  // раннее начало, сосед подрезается с головы.
  const windows = buildWindows(
    planner({
      "2026-06-01": { start: 960, end: 1500 },
      "2026-06-02": { start: 0, end: 480 },
    }),
    "2026-06-01",
    "2026-06-02",
    ZONE,
  );

  assert.equal(windows.length, 1);
  assert.equal(windows[0].from, dayjs.tz("2026-06-01 16:00", ZONE).valueOf());
  assert.equal(windows[0].to, dayjs.tz("2026-06-02 08:00", ZONE).valueOf());
});

test("день без окна в набор не попадает", () => {
  const windows = buildWindows(
    planner({ "2026-06-01": { start: null, end: null } }),
    "2026-06-01",
    "2026-06-01",
    ZONE,
  );
  assert.deepEqual(windows, []);
});

test("вычитание оставляет непокрытые куски", () => {
  assert.deepEqual(subtractWindows([0, 100], [{ from: 20, to: 40 }]), [
    [0, 20],
    [40, 100],
  ]);
  assert.deepEqual(subtractWindows([0, 100], [{ from: 0, to: 100 }]), []);
  assert.deepEqual(subtractWindows([0, 100], []), [[0, 100]]);
});

test("смежные окна не оставляют щели", () => {
  assert.deepEqual(
    subtractWindows([0, 100], [
      { from: 0, to: 50 },
      { from: 50, to: 100 },
    ]),
    [],
  );
});

test("пересечение — зеркало вычитания", () => {
  const interval = [0, 100];
  const windows = [
    { from: 20, to: 40 },
    { from: 60, to: 80 },
  ];
  const covered = intersectWindows(interval, windows);
  const uncovered = subtractWindows(interval, windows);
  const sum = (chunks) =>
    chunks.reduce((total, [from, to]) => total + (to - from), 0);

  assert.equal(sum(covered) + sum(uncovered), 100);
});
