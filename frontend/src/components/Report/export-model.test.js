// node --test src/components/Report/export-model.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExportModel,
  exportFileBase,
  extraAvailability,
  wallClockAsUtc,
} from "./export-model.ts";
import { sampleFormatters, sampleReport } from "./export-fixture.js";

const fmt = sampleFormatters;
const report = sampleReport;

const tileOf = (model, label) =>
  model.tiles.find((tile) => tile.label === label)?.value;

test("полный отчёт: период стоит в заголовке, а не пустой строкой", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.equal(model.kicker, "Отчёт об оказанных услугах");
  assert.equal(model.title, "Абонентское обслуживание · август 2026");
  assert.deepEqual(model.facts, [
    { label: "Заказчик", value: "ООО «Альфа-Строй»" },
    { label: "Исполнитель", value: "ИТ-Сервис" },
    { label: "Период", value: "август 2026" },
    { label: "Согласование", value: "Согласован <2026-09-03> · Иванов Сергей" },
  ]);
});

test("полный отчёт: цифры рублями, итог выделен", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.equal(tileOf(model, "Работ"), "5");
  assert.equal(tileOf(model, "В рабочее время"), "03:30");
  assert.equal(tileOf(model, "В нерабочее время"), "12:30");
  assert.equal(tileOf(model, "В тарифе"), "120\u00a0000\u00a0₽");
  assert.equal(tileOf(model, "Сверх тарифа"), "15\u00a0631\u00a0₽");
  assert.equal(tileOf(model, "Итого к оплате"), "135\u00a0631\u00a0₽");
  assert.equal(model.tiles.at(-1).strong, true);
});

test("полный отчёт: две таблицы с подытогами, сверх тарифа — первой", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.deepEqual(
    model.tables.map((table) => [table.title, table.hint, table.withCost]),
    [
      ["Работы в нерабочее время", "оплачиваются сверх тарифа", true],
      ["Работы в рабочее время", "входят в тариф", false],
    ],
  );
  const [overtime, worktime] = model.tables;
  assert.equal(overtime.totalLabel, "Итого сверх тарифа · 3 работы");
  assert.equal(overtime.totalMinutes, 750);
  assert.equal(overtime.totalCost, 15631.25);
  assert.equal(worktime.totalLabel, "Итого в тарифе · 2 работы");
  assert.equal(worktime.totalMinutes, 210);
  assert.equal(worktime.totalCost, null);
  assert.equal(model.note, null);
});

test("строка таблицы собрана из работы: заявка, люди, подразделение, время", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.deepEqual(model.tables[0].rows[0], {
    startedAt: "2026-08-15T00:30:00.000Z",
    tickets: "51713",
    description: "Работа",
    initiator: "Петрова Анна",
    subdivision: "Филиал «Север»",
    executor: "Орлов Дмитрий",
    minutes: 240,
    cost: 5002,
  });
});

test("условия расчёта: ставка — как в услуге, с копейками; пояс назван", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.deepEqual(model.terms, [
    { text: "фиксированная оплата", value: "120\u00a0000\u00a0₽" },
    { text: "период тарификации", value: "30 минут" },
    { text: "в нерабочее время", value: "1\u00a0250,50\u00a0₽ / час" },
    { text: "время в отчёте —", value: "Владивосток (UTC+10)" },
  ]);
});

test("только сверх тарифа: одна таблица, к оплате — только доплата", () => {
  const model = buildExportModel(report, "extra", fmt);
  assert.equal(model.kicker, "Отчёт о работах сверх тарифа");
  assert.deepEqual(
    model.tables.map((table) => table.title),
    ["Работы в нерабочее время"],
  );
  assert.deepEqual(model.tiles, [
    { label: "Работ сверх тарифа", value: "3" },
    { label: "Время", value: "12:30" },
    { label: "Ставка в нерабочее время", value: "1\u00a0250,50\u00a0₽ / час" },
    {
      label: "К оплате сверх тарифа",
      value: "15\u00a0631\u00a0₽",
      strong: true,
    },
  ]);
  // Суммы договора в этом отчёте нет нигде
  assert.equal(JSON.stringify(model).includes("120"), false);
});

test("только сверх тарифа: сказано, что осталось за кадром", () => {
  const model = buildExportModel(report, "extra", fmt);
  assert.equal(
    model.note,
    "Работы в рабочее время (2 работы, 03:30) входят в тариф и в этот отчёт не включены.",
  );
  assert.equal(
    model.footer,
    "Альфа-Строй · Абонентское обслуживание · август 2026 · работы сверх тарифа",
  );
});

test("без работ сверх тарифа полный отчёт не показывает нули", () => {
  const quiet = {
    ...report,
    overtimeWorks: [],
    calc: {
      ...report.calc,
      overtimeMinutes: 0,
      additionalPrice: 0,
      total: 120000,
    },
  };
  const model = buildExportModel(quiet, "full", fmt);
  assert.equal(tileOf(model, "В нерабочее время"), undefined);
  assert.equal(tileOf(model, "Сверх тарифа"), undefined);
  assert.deepEqual(
    model.tables.map((table) => table.title),
    ["Работы в рабочее время"],
  );
  assert.equal(extraAvailability(quiet), "empty");
});

test("у почасовой услуги деления на тариф и сверх тарифа нет", () => {
  const hourly = {
    ...report,
    terms: { type: "hourly", tariffingPeriod: 15, pricePerHour: 1000 },
    overtimeWorks: [],
    calc: {
      workingTimeMinutes: 210,
      overtimeMinutes: 0,
      price: 3500,
      additionalPrice: 0,
      total: 3500,
    },
  };
  assert.equal(extraAvailability(hourly), "none");
  const model = buildExportModel(hourly, "full", fmt);
  assert.deepEqual(
    model.tables.map((table) => [table.title, table.sheet]),
    [["Работы", "Работы"]],
  );
  assert.equal(tileOf(model, "В тарифе"), undefined);
  assert.equal(tileOf(model, "Итого к оплате"), "3\u00a0500\u00a0₽");
  assert.deepEqual(model.terms[0], {
    text: "почасовая оплата",
    value: "1\u00a0000\u00a0₽ / час",
  });
});

test("работы сверх тарифа есть — второй вариант экспорта доступен", () => {
  assert.equal(extraAvailability(report), "ok");
});

test("согласование называет состояние отчёта словами", () => {
  const factOf = (over) =>
    buildExportModel({ ...report, ...over }, "full", fmt).facts.find(
      (fact) => fact.label === "Согласование",
    ).value;

  assert.equal(
    factOf({ status: "preview", timeline: [] }),
    "Отчёт ещё не сформирован",
  );
  assert.equal(
    factOf({ approval: { required: false }, timeline: [] }),
    "Не требуется",
  );
  assert.equal(
    factOf({
      status: "pendingApproval",
      approval: { required: true, deadlineAt: "2026-10-08T13:59:59.000Z" },
      timeline: [],
    }),
    "На согласовании · ответ до <2026-10-08>",
  );
  assert.equal(
    factOf({ status: "declined", timeline: [] }),
    "Отклонён клиентом",
  );
  assert.equal(
    factOf({
      approval: { required: true, autoApprovedAt: "2026-09-08T14:00:00.000Z" },
      timeline: [],
    }),
    "Согласован по сроку <2026-09-08>",
  );
});

test("руководителю филиала суммы договора в экспорт не попадают", () => {
  // Сервер не отдаёт ни цену, ни итог — в отчёте им неоткуда взяться
  const restricted = {
    ...report,
    contractor: null,
    terms: {
      type: "fixedPrice",
      tariffingPeriod: 30,
      pricePerHourNonWorking: 1250.5,
    },
    calc: {
      workingTimeMinutes: 210,
      overtimeMinutes: 750,
      additionalPrice: 15631.25,
    },
  };
  const model = buildExportModel(restricted, "full", fmt);
  assert.equal(tileOf(model, "В тарифе"), undefined);
  assert.equal(tileOf(model, "Итого к оплате"), undefined);
  assert.equal(tileOf(model, "Сверх тарифа"), "15\u00a0631\u00a0₽");
  assert.deepEqual(model.terms[0], { text: "фиксированная оплата" });
  assert.equal(
    model.facts.some((fact) => fact.label === "Исполнитель"),
    false,
  );
});

test("сводка для Excel: строки по времени и итог числами", () => {
  const model = buildExportModel(report, "full", fmt);
  assert.deepEqual(model.summary, [
    {
      label: "В рабочее время (в тарифе)",
      count: 2,
      minutes: 210,
      amount: 120000,
    },
    {
      label: "В нерабочее время (сверх тарифа)",
      count: 3,
      minutes: 750,
      amount: 15631.25,
    },
    {
      label: "Итого к оплате",
      count: 5,
      minutes: 960,
      amount: 135631.25,
      strong: true,
    },
  ]);
});

test("имя файла — латиницей, с месяцем отчёта в поясе организации", () => {
  // periodFrom — 31 июля по UTC: брать месяц из него нельзя
  assert.equal(exportFileBase(report, "full"), "report-alfa-stroy-2026-08");
  assert.equal(
    exportFileBase(report, "extra"),
    "report-alfa-stroy-2026-08-sverh-tarifa",
  );
});

test("время для Excel — настенное время пояса организации", () => {
  // 09:30 UTC во Владивостоке (UTC+10) — это 19:30; Excel поясов не знает
  assert.deepEqual(
    wallClockAsUtc("2026-08-18T09:30:00.000Z", "Asia/Vladivostok"),
    new Date(Date.UTC(2026, 7, 18, 19, 30, 0)),
  );
  // Переход через полночь: 20:00 UTC — уже следующий день
  assert.deepEqual(
    wallClockAsUtc("2026-08-18T20:00:00.000Z", "Asia/Vladivostok"),
    new Date(Date.UTC(2026, 7, 19, 6, 0, 0)),
  );
});
