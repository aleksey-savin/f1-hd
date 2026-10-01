// node --test src/components/Report/period-filter.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { inMonthRange, reportMonthKey } from "./period-filter.ts";

const september = { from: "2026-09-01", to: "2026-09-30" };
const august = { from: "2026-08-01", to: "2026-08-31" };

test("месяц отчёта берётся с сервера, а не из момента начала периода", () => {
  // Сентябрь в поясе организации (UTC+3) начинается 31 августа в 21:00 UTC:
  // по самому моменту отчёт уезжал в август
  const row = { month: "2026-09", periodFrom: "2026-08-31T21:00:00.000Z" };
  assert.equal(reportMonthKey(row), "2026-09");
  assert.equal(inMonthRange(reportMonthKey(row), september), true);
  assert.equal(inMonthRange(reportMonthKey(row), august), false);
});

test("без периода фильтра нет — видно всё", () => {
  assert.equal(inMonthRange("2026-05", { from: "", to: "" }), true);
});

test("период в несколько месяцев включает оба края", () => {
  const range = { from: "2026-07-01", to: "2026-09-30" };
  assert.equal(inMonthRange("2026-07", range), true);
  assert.equal(inMonthRange("2026-09", range), true);
  assert.equal(inMonthRange("2026-06", range), false);
  assert.equal(inMonthRange("2026-10", range), false);
});

test("ответ старого сервера без месяца — по началу периода, как раньше", () => {
  assert.equal(
    reportMonthKey({ periodFrom: "2026-09-01T00:00:00.000Z" }),
    "2026-09",
  );
});
