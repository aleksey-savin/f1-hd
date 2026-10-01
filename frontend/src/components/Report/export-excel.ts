import type { Workbook, Worksheet } from "exceljs";

import { wallClockAsUtc } from "./export-format.js";
import type { ExportModel, ExportTable } from "./export-model";

/**
 * Книга Excel отчёта по услуге: «Сводка» и по листу на таблицу работ.
 *
 * Значения кладутся настоящими типами — дата, длительность и сумма остаются
 * датой, временем и числом, поэтому в файле их можно сортировать и суммировать.
 * Суммы показаны целыми рублями форматом ячейки, само значение точное.
 *
 * Библиотека — exceljs: шапку надо выделить и закрепить, а `xlsx`
 * (community-сборка), которым пользуются остальные выгрузки, стили и
 * закрепление не пишет. Книгу создаёт вызывающий (`ReportExportMenu` подгружает
 * библиотеку по клику), здесь она только заполняется.
 */

const MONEY = '#,##0 "₽"';
const DURATION = "[h]:mm";
const DATE_TIME = "dd.mm.yyyy hh:mm";
const HEAD_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE3EFE9" },
} as const;
const HEAD_BORDER = {
  bottom: { style: "thin", color: { argb: "FF16191D" } },
} as const;

/** Минуты → доля суток: так Excel хранит длительность. */
const asDuration = (minutes: number) => minutes / 1440;

/** «время в отчёте —» → «Время в отчёте»: подпись строки условий. */
const termLabel = (text: string) => {
  const clean = text.replace(/\s*—\s*$/, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

const headRow = (sheet: Worksheet, rowNumber: number, lastColumn: number) => {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getRow(rowNumber).getCell(column);
    cell.font = { bold: true };
    cell.fill = HEAD_FILL;
    cell.border = HEAD_BORDER;
  }
};

const summarySheet = (workbook: Workbook, model: ExportModel) => {
  const sheet = workbook.addWorksheet("Сводка");
  sheet.columns = [{ width: 36 }, { width: 12 }, { width: 10 }, { width: 16 }];

  let row = 1;
  sheet.getCell(row, 1).value = model.kicker;
  sheet.getCell(row, 1).font = { bold: true, size: 14 };
  sheet.mergeCells(row, 1, row, 4);
  row += 2;

  // Реквизиты; услуга стоит отдельной строкой — в PDF она в заголовке
  const facts = [...model.facts];
  const periodAt = facts.findIndex((fact) => fact.label === "Период");
  facts.splice(periodAt < 0 ? facts.length : periodAt, 0, {
    label: "Услуга",
    value: model.service,
  });
  for (const fact of facts) {
    sheet.getCell(row, 1).value = fact.label;
    sheet.getCell(row, 1).font = { color: { argb: "FF5B646D" } };
    sheet.getCell(row, 2).value = fact.value;
    sheet.mergeCells(row, 2, row, 4);
    row += 1;
  }
  row += 1;

  sheet.getCell(row, 1).value = "Условия расчёта";
  sheet.mergeCells(row, 1, row, 4);
  headRow(sheet, row, 4);
  row += 1;
  for (const term of model.terms) {
    sheet.getCell(row, 1).value = termLabel(term.text);
    if (term.value) {
      sheet.getCell(row, 1).font = { color: { argb: "FF5B646D" } };
      sheet.getCell(row, 2).value = term.value;
      sheet.mergeCells(row, 2, row, 4);
    } else {
      sheet.mergeCells(row, 1, row, 4);
    }
    row += 1;
  }
  row += 1;

  sheet.getRow(row).values = ["Итог", "Работ", "Время", "Сумма"];
  headRow(sheet, row, 4);
  for (const column of [2, 3, 4]) {
    sheet.getCell(row, column).alignment = { horizontal: "right" };
  }
  row += 1;
  for (const line of model.summary) {
    sheet.getCell(row, 1).value = line.label;
    sheet.getCell(row, 2).value = line.count;
    sheet.getCell(row, 3).value = asDuration(line.minutes);
    sheet.getCell(row, 3).numFmt = DURATION;
    if (line.amount != null) {
      sheet.getCell(row, 4).value = line.amount;
      sheet.getCell(row, 4).numFmt = MONEY;
    }
    if (line.strong) {
      for (const column of [1, 2, 3, 4]) {
        sheet.getCell(row, column).font = { bold: true };
      }
    }
    row += 1;
  }
};

const worksSheet = (workbook: Workbook, table: ExportTable, zone: string) => {
  const sheet = workbook.addWorksheet(table.sheet, {
    // Шапка остаётся на месте при прокрутке длинного списка работ
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const head = [
    "Начало",
    "Заявка",
    "Описание работ",
    "Инициатор",
    "Подразделение",
    "Исполнитель",
    "Время",
    ...(table.withCost ? ["Стоимость"] : []),
  ];
  sheet.columns = [
    { width: 17 },
    { width: 10 },
    { width: 60 },
    { width: 24 },
    { width: 22 },
    { width: 22 },
    { width: 9 },
    ...(table.withCost ? [{ width: 13 }] : []),
  ];
  sheet.getRow(1).values = head;
  headRow(sheet, 1, head.length);
  for (const column of table.withCost ? [7, 8] : [7]) {
    sheet.getCell(1, column).alignment = { horizontal: "right" };
  }

  table.rows.forEach((work, index) => {
    const row = sheet.getRow(index + 2);
    row.getCell(1).value = wallClockAsUtc(work.startedAt, zone);
    row.getCell(1).numFmt = DATE_TIME;
    // Одна заявка — числом (сортируется как число), несколько — текстом
    row.getCell(2).value = /^\d+$/.test(work.tickets)
      ? Number(work.tickets)
      : work.tickets;
    row.getCell(3).value = work.description;
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    row.getCell(4).value = work.initiator;
    row.getCell(5).value = work.subdivision;
    row.getCell(6).value = work.executor;
    row.getCell(7).value = asDuration(work.minutes);
    row.getCell(7).numFmt = DURATION;
    if (table.withCost) {
      row.getCell(8).value = work.cost ?? 0;
      row.getCell(8).numFmt = MONEY;
    }
  });

  const lastData = table.rows.length + 1;
  const lastLetter = table.withCost ? "H" : "G";
  // Фильтр — только по строкам работ: итог под таблицей сортироваться не должен
  sheet.autoFilter = `A1:${lastLetter}${lastData}`;

  const total = sheet.getRow(lastData + 1);
  total.getCell(1).value = table.totalLabel;
  total.getCell(7).value = asDuration(table.totalMinutes);
  total.getCell(7).numFmt = DURATION;
  if (table.withCost) {
    total.getCell(8).value = table.totalCost ?? 0;
    total.getCell(8).numFmt = MONEY;
  }
  for (let column = 1; column <= head.length; column += 1) {
    total.getCell(column).font = { bold: true };
  }
};

export const fillWorkbook = (
  workbook: Workbook,
  model: ExportModel,
  options: {
    /** Пояс организации: в нём стоит время начала работ. */
    zone: string;
  },
) => {
  summarySheet(workbook, model);
  for (const table of model.tables) {
    worksSheet(workbook, table, options.zone);
  }
  return workbook;
};
