// node --test services/financeTracking.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TRACKED_FILTER,
  tracksFinances,
  workTimeModeFor,
  withoutUntracked,
} = require("./financeTracking");

test("учёт ведётся, пока его явно не выключили", () => {
  // Поле появилось 2026-09-21: у всех прежних сотрудников его нет, и выкатка
  // не должна никого убрать из отчётов
  assert.equal(tracksFinances({}), true);
  assert.equal(tracksFinances({ trackFinances: true }), true);
  assert.equal(tracksFinances({ trackFinances: false }), false);
  assert.equal(tracksFinances(null), true);
  // Тот же смысл у фильтра выборки: «нет поля» — это «ведётся»
  assert.deepEqual(TRACKED_FILTER, { trackFinances: { $ne: false } });
});

test("без финансового учёта режима «по графику» нет", () => {
  // Норма и переработки считаются только по графику — без учёта он ни на что
  // не влияет, и человек переходит на свободный режим
  assert.equal(workTimeModeFor("scheduled", { trackFinances: false }), "free");
  // Остальные режимы учёта не касаются
  assert.equal(workTimeModeFor("free", { trackFinances: false }), "free");
  assert.equal(workTimeModeFor("none", { trackFinances: false }), "none");
  // С учётом режим остаётся каким задан
  assert.equal(workTimeModeFor("scheduled", { trackFinances: true }), "scheduled");
  assert.equal(workTimeModeFor("scheduled", {}), "scheduled");
});

test("работы людей без учёта в отчёт по сотрудникам не идут", () => {
  const works = [
    { _id: 1, finishedBy: { _id: "a" } },
    { _id: 2, finishedBy: { _id: "b" } },
    { _id: 3, finishedBy: null },
    { _id: 4 },
  ];
  // Исполнитель без учёта выпадает вместе со своими работами — иначе он
  // вернулся бы в отчёт строкой «исполнитель работ периода»
  assert.deepEqual(
    withoutUntracked(works, new Set(["b"])).map((work) => work._id),
    [1, 3, 4],
  );
  assert.equal(withoutUntracked(works, new Set()).length, 4);
});
