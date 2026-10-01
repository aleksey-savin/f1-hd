// node --test services/reportSnapshot.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSnapshot,
  cardFromSnapshot,
  matchesStoredTotals,
  pinToStored,
} = require("./reportSnapshot");

// Работа «Кооператива» из разбора 01.10.2026: пн 6 июля, 17:18–18:18 по
// Владивостоку, график до 18:00, ставка вне графика 2 500 ₽/ч
const WORK = {
  _id: "w1",
  description: "Настройка rtsp потока",
  startedAt: new Date("2026-07-06T07:18:00.000Z"),
  finishedAt: new Date("2026-07-06T08:18:00.000Z"),
};

// Что вернул `priceWorks`, пока период тарификации услуги был 60 минут
const PRICED_AT_60 = {
  tariff: {
    type: "hourPackage",
    tariffingPeriod: 60,
    hourPackages: [{ _id: "p1", hours: 24, pricePerHour: 916.65 }],
    fixedPrice: 22000,
    pricePerHour: 0,
    pricePerHourNonWorking: 2500,
  },
  packageBasis: { hours: 24, pricePerHour: 916.65, mode: "package" },
  workingTimeMinutes: 60,
  overtimeMinutes: 60,
  price: 21999.6,
  additionalPrice: 2500,
  total: 24499.6,
  worktimeWorks: [{ workId: "w1", minutes: 60 }],
  overtimeWorks: [{ workId: "w1", minutes: 60, cost: 2500 }],
};

const AT = new Date("2026-10-01T02:46:00.000Z");

const snapshotAt60 = () =>
  buildSnapshot({
    priced: PRICED_AT_60,
    works: [WORK],
    zone: "Asia/Vladivostok",
    at: AT,
  });

test("снимок запоминает условия услуги на момент формирования", () => {
  const snapshot = snapshotAt60();
  assert.equal(snapshot.at, AT);
  assert.equal(snapshot.zone, "Asia/Vladivostok");
  assert.deepEqual(snapshot.terms, {
    tariffType: "hourPackage",
    tariffingPeriod: 60,
    hourPackages: [{ hours: 24, pricePerHour: 916.65 }],
    packageBasis: { hours: 24, pricePerHour: 916.65, mode: "package" },
    fixedPrice: 22000,
    pricePerHour: 0,
    pricePerHourNonWorking: 2500,
  });
});

test("снимок запоминает суммы и разбивку по работам вместе со временем работы", () => {
  const snapshot = snapshotAt60();
  assert.equal(snapshot.price, 21999.6);
  assert.equal(snapshot.additionalPrice, 2500);
  assert.equal(snapshot.total, 24499.6);
  assert.equal(snapshot.workingTimeMinutes, 60);
  assert.equal(snapshot.overtimeMinutes, 60);
  assert.deepEqual(snapshot.overtimeWorks, [
    {
      work: "w1",
      startedAt: WORK.startedAt,
      finishedAt: WORK.finishedAt,
      minutes: 60,
      cost: 2500,
    },
  ]);
  assert.deepEqual(snapshot.worktimeWorks, [
    {
      work: "w1",
      startedAt: WORK.startedAt,
      finishedAt: WORK.finishedAt,
      minutes: 60,
    },
  ]);
});

test("карточка из снимка показывает то, что было сформировано, а не нынешние условия", () => {
  // Услугу после формирования поправили: период 15 минут дал бы 30 мин и 1 250 ₽
  const card = cardFromSnapshot(snapshotAt60(), [WORK], null);

  assert.deepEqual(card.calc, {
    workingTimeMinutes: 60,
    overtimeMinutes: 60,
    price: 21999.6,
    additionalPrice: 2500,
    total: 24499.6,
  });
  assert.equal(card.terms.type, "hourPackage");
  assert.equal(card.terms.tariffingPeriod, 60);
  assert.equal(card.terms.pricePerHourNonWorking, 2500);
  assert.deepEqual(card.terms.packageBasis, {
    hours: 24,
    pricePerHour: 916.65,
    mode: "package",
  });
  assert.equal(card.overtimeWorks[0].billedMinutes, 60);
  assert.equal(card.overtimeWorks[0].cost, 2500);
  assert.equal(card.worktimeWorks[0].billedMinutes, 60);
  // Текст работы — из самой работы: заморожены цифры, а не описание
  assert.equal(card.overtimeWorks[0].description, "Настройка rtsp потока");
});

test("правка времени работы после формирования строку отчёта не меняет", () => {
  const moved = {
    ...WORK,
    startedAt: new Date("2026-07-06T01:00:00.000Z"),
    finishedAt: new Date("2026-07-06T02:00:00.000Z"),
  };
  const card = cardFromSnapshot(snapshotAt60(), [moved], null);
  assert.deepEqual(card.overtimeWorks[0].startedAt, WORK.startedAt);
  assert.deepEqual(card.overtimeWorks[0].finishedAt, WORK.finishedAt);
  assert.equal(card.overtimeWorks[0].billedMinutes, 60);
});

test("удалённая работа остаётся строкой отчёта: сумма таблицы обязана сходиться с итогом", () => {
  const card = cardFromSnapshot(snapshotAt60(), [], null);
  assert.equal(card.overtimeWorks.length, 1);
  assert.equal(card.overtimeWorks[0].cost, 2500);
  assert.equal(card.overtimeWorks[0].billedMinutes, 60);
  assert.equal(card.overtimeWorks[0].description, "Работа удалена");
  assert.deepEqual(card.overtimeWorks[0].tickets, []);
});

test("подразделение строки берётся по работе, как у живого расчёта", () => {
  const subdivisionOf = (work) =>
    work._id === "w1" ? { _id: "s1", name: "Филиал «Север»" } : null;
  const card = cardFromSnapshot(snapshotAt60(), [WORK], subdivisionOf);
  assert.deepEqual(card.overtimeWorks[0].subdivision, {
    _id: "s1",
    name: "Филиал «Север»",
  });
});

test("снимок годится для старого отчёта, только если сходится с сохранёнными суммами", () => {
  const snapshot = snapshotAt60();
  assert.equal(
    matchesStoredTotals(snapshot, { price: 21999.6, additionalPrice: 2500 }),
    true,
  );
  // Копеечный шум двоичной арифметики расхождением не считается
  assert.equal(
    matchesStoredTotals(snapshot, {
      price: 21999.600000000002,
      additionalPrice: 2500,
    }),
    true,
  );
  // Отчёт сформирован при одних условиях, а сейчас считается по другим
  assert.equal(
    matchesStoredTotals(snapshot, { price: 21999.6, additionalPrice: 1250 }),
    false,
  );
});

test("старый отчёт, не сошедшийся с нынешним расчётом, держит сохранённые суммы", () => {
  // Отчёт сформирован давно: тогда пакет стоил 25 300,08 ₽, сверх тарифа вышло
  // 4 166,67 ₽. Сегодня по тем же работам получается другое — цены подняли
  const today = snapshotAt60();
  const pinned = pinToStored(today, { price: 25300.08, additionalPrice: 4166.67 });

  assert.equal(pinned.price, 25300.08);
  assert.equal(pinned.additionalPrice, 4166.67);
  assert.equal(pinned.total, 29466.75);
  // Помечен: разбивка и условия восстановлены, а не сняты при формировании
  assert.equal(pinned.legacy, true);
  // Разбивка по работам остаётся сегодняшней — другой взять неоткуда
  assert.deepEqual(pinned.overtimeWorks, today.overtimeWorks);
  // Исходный снимок не испорчен
  assert.equal(today.price, 21999.6);
  assert.equal(today.legacy, undefined);
});

test("карточка говорит, что расчёт старого отчёта восстановлен, и когда", () => {
  const pinned = pinToStored(snapshotAt60(), { price: 25300.08, additionalPrice: 0 });
  const card = cardFromSnapshot(pinned, [WORK], null);
  assert.equal(card.calc.price, 25300.08);
  assert.equal(card.calc.total, 25300.08);
  assert.equal(card.legacyCalc, true);
  assert.equal(card.frozenAt, AT);

  // У обычного снимка пометки нет
  assert.equal(cardFromSnapshot(snapshotAt60(), [WORK], null).legacyCalc, false);
});
