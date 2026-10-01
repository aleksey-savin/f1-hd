// node --test src/components/Report/export-excel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import ExcelJS from "exceljs";

import { fillWorkbook } from "./export-excel.ts";
import { buildExportModel } from "./export-model.ts";
import { sampleFormatters, sampleReport } from "./export-fixture.js";

const bookOf = (report, variant) => {
  const workbook = new ExcelJS.Workbook();
  fillWorkbook(workbook, buildExportModel(report, variant, sampleFormatters), {
    zone: "Asia/Vladivostok",
  });
  return workbook;
};

const names = (workbook) => workbook.worksheets.map((sheet) => sheet.name);

/** Строка листа «Сводка» по подписи в первой колонке. */
const rowByLabel = (sheet, label) => {
  let found = null;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) found = row;
  });
  return found;
};

test("полный отчёт — три листа, только сверх тарифа — два", () => {
  assert.deepEqual(names(bookOf(sampleReport, "full")), [
    "Сводка",
    "Сверх тарифа",
    "В тарифе",
  ]);
  assert.deepEqual(names(bookOf(sampleReport, "extra")), [
    "Сводка",
    "Сверх тарифа",
  ]);
});

test("шапка листа работ закреплена, выделена и держит фильтр", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("Сверх тарифа");
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    "Начало",
    "Заявка",
    "Описание работ",
    "Инициатор",
    "Подразделение",
    "Исполнитель",
    "Время",
    "Стоимость",
  ]);
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.getCell("A1").font.bold, true);
  assert.equal(sheet.getCell("A1").fill.pattern, "solid");
  // Фильтр — только по строкам работ: итог сортироваться не должен
  assert.deepEqual(sheet.autoFilter, "A1:H4");
});

test("время начала — настоящая дата в поясе организации", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("Сверх тарифа");
  // 00:30 UTC во Владивостоке — 10:30
  assert.deepEqual(
    sheet.getCell("A2").value,
    new Date(Date.UTC(2026, 7, 15, 10, 30, 0)),
  );
  assert.equal(sheet.getCell("A2").numFmt, "dd.mm.yyyy hh:mm");
});

test("длительность и стоимость — числа, с которыми Excel может считать", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("Сверх тарифа");
  assert.equal(sheet.getCell("B2").value, 51713);
  assert.equal(sheet.getCell("G2").value, 240 / 1440);
  assert.equal(sheet.getCell("G2").numFmt, "[h]:mm");
  assert.equal(sheet.getCell("H3").value, 3126.25);
  assert.equal(sheet.getCell("H3").numFmt, '#,##0 "₽"');
});

test("итог листа работ — жирной строкой под таблицей", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("Сверх тарифа");
  assert.equal(sheet.getCell("A5").value, "Итого сверх тарифа · 3 работы");
  assert.equal(sheet.getCell("A5").font.bold, true);
  assert.equal(sheet.getCell("G5").value, 750 / 1440);
  assert.equal(sheet.getCell("H5").value, 15631.25);
});

test("у листа «В тарифе» колонки стоимости нет", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("В тарифе");
  assert.equal(sheet.getRow(1).values.includes("Стоимость"), false);
  assert.deepEqual(sheet.autoFilter, "A1:G3");
});

test("сводка: реквизиты с периодом, условия и итог числами", () => {
  const sheet = bookOf(sampleReport, "full").getWorksheet("Сводка");
  assert.equal(sheet.getCell("A1").value, "Отчёт об оказанных услугах");
  assert.equal(sheet.getCell("A1").font.bold, true);
  assert.equal(
    rowByLabel(sheet, "Услуга").getCell(2).value,
    "Абонентское обслуживание",
  );
  assert.equal(rowByLabel(sheet, "Период").getCell(2).value, "август 2026");
  assert.equal(
    rowByLabel(sheet, "Время в отчёте").getCell(2).value,
    "Владивосток (UTC+10)",
  );

  const total = rowByLabel(sheet, "Итого к оплате");
  assert.equal(total.getCell(2).value, 5);
  assert.equal(total.getCell(3).value, 960 / 1440);
  assert.equal(total.getCell(4).value, 135631.25);
  assert.equal(total.getCell(4).numFmt, '#,##0 "₽"');
  assert.equal(total.getCell(1).font.bold, true);
});

test("сводка «только сверх тарифа» суммы договора не содержит", () => {
  const sheet = bookOf(sampleReport, "extra").getWorksheet("Сводка");
  const values = [];
  sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  assert.equal(values.includes(120000), false);
  assert.equal(values.includes(135631.25), false);
  assert.equal(
    rowByLabel(sheet, "К оплате сверх тарифа").getCell(4).value,
    15631.25,
  );
});
