// node --test src/store/lists/supplier-scope.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { companyOptions, scopeTotals, yearOptions } from "./supplier-scope.js";

const supplier = {
  name: "ООО «Ф1 Лаб»",
  purchases: [
    {
      year: 2026,
      companyId: "c1",
      companyName: "Ромашка",
      deviceCount: 3,
      totalSpent: 90000,
      deliveryCount: 2,
      lastPurchaseAt: "2026-06-22T00:00:00.000Z",
    },
    {
      year: 2026,
      companyId: "c2",
      companyName: "Астра",
      deviceCount: 1,
      totalSpent: 9500,
      deliveryCount: 1,
      lastPurchaseAt: "2026-02-11T00:00:00.000Z",
    },
    {
      year: 2025,
      companyId: "c1",
      companyName: "Ромашка",
      deviceCount: 2,
      totalSpent: 40000,
      deliveryCount: 1,
      lastPurchaseAt: "2025-11-30T00:00:00.000Z",
    },
    // Позиция без даты закупки: года у неё нет, в срез года не попадает
    {
      year: null,
      companyId: "c1",
      companyName: "Ромашка",
      deviceCount: 1,
      totalSpent: 500,
      deliveryCount: 0,
      lastPurchaseAt: null,
    },
  ],
};

test("год складывает корзины всех компаний", () => {
  assert.deepEqual(scopeTotals(supplier, { year: 2026, companyId: null }), {
    deviceCount: 4,
    totalSpent: 99500,
    deliveryCount: 3,
    lastPurchaseAt: "2026-06-22T00:00:00.000Z",
  });
});

test("компания сужает срез до своих закупок", () => {
  assert.deepEqual(scopeTotals(supplier, { year: 2026, companyId: "c2" }), {
    deviceCount: 1,
    totalSpent: 9500,
    deliveryCount: 1,
    lastPurchaseAt: "2026-02-11T00:00:00.000Z",
  });
});

test("за всё время считаются и позиции без даты", () => {
  assert.deepEqual(scopeTotals(supplier, { year: null, companyId: null }), {
    deviceCount: 7,
    totalSpent: 140000,
    deliveryCount: 4,
    lastPurchaseAt: "2026-06-22T00:00:00.000Z",
  });
});

test("в пустом году остаётся дата последней закупки", () => {
  const totals = scopeTotals(supplier, { year: 2024, companyId: null });
  assert.equal(totals.deviceCount, 0);
  assert.equal(totals.totalSpent, 0);
  // Именно она говорит, насколько поставщик остыл, — по году её не режем
  assert.equal(totals.lastPurchaseAt, "2026-06-22T00:00:00.000Z");
});

test("дата последней закупки учитывает выбранную компанию", () => {
  assert.equal(
    scopeTotals(supplier, { year: 2024, companyId: "c2" }).lastPurchaseAt,
    "2026-02-11T00:00:00.000Z",
  );
});

test("поставщик без закупок даёт нули", () => {
  assert.deepEqual(
    scopeTotals({ name: "ИП" }, { year: 2026, companyId: null }),
    {
      deviceCount: 0,
      totalSpent: 0,
      deliveryCount: 0,
      lastPurchaseAt: null,
    },
  );
});

test("в опциях компаний — только те, для кого покупали, по алфавиту", () => {
  assert.deepEqual(companyOptions([supplier, { name: "ИП" }]), [
    { value: "c2", label: "Астра" },
    { value: "c1", label: "Ромашка" },
  ]);
});

test("в опциях лет — годы закупок и текущий год, свежие сверху", () => {
  // Года без даты (null) среди опций быть не должно
  assert.deepEqual(yearOptions([supplier], 2026), [
    { value: "2026", label: "2026" },
    { value: "2025", label: "2025" },
  ]);
});

test("текущий год в опциях есть, даже когда в нём ещё не покупали", () => {
  assert.deepEqual(
    yearOptions([supplier], 2027).map((option) => option.value),
    ["2027", "2026", "2025"],
  );
});
