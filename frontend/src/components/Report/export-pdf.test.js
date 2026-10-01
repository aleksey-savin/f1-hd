// node --test src/components/Report/export-pdf.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildExportModel } from "./export-model.ts";
import { renderExportHtml } from "./export-pdf.ts";
import { sampleFormatters, sampleReport } from "./export-fixture.js";

const options = {
  fileBase: "report-alfa-stroy-2026-08",
  madeAt: "01.10.2026",
  startLabel: (value) => `[${String(value).slice(0, 16)}]`,
};

const htmlOf = (report, variant) =>
  renderExportHtml(
    buildExportModel(report, variant, sampleFormatters),
    options,
  );

const count = (text, needle) => text.split(needle).length - 1;

test("имя файла при «Сохранить как PDF» берётся из заголовка страницы", () => {
  assert.match(
    htmlOf(sampleReport, "full"),
    /<title>report-alfa-stroy-2026-08<\/title>/,
  );
});

test("шапка называет документ, услугу с периодом и дату формирования", () => {
  const html = htmlOf(sampleReport, "full");
  assert.match(html, /Отчёт об оказанных услугах/);
  assert.match(html, /<h1[^>]*>Абонентское обслуживание · август 2026<\/h1>/);
  assert.match(html, /Сформирован 01\.10\.2026/);
});

test("стоимость — только у таблицы работ сверх тарифа", () => {
  const html = htmlOf(sampleReport, "full");
  assert.equal(count(html, '<table class="works"'), 2);
  assert.equal(count(html, ">Стоимость</th>"), 1);
  assert.match(html, /Итого сверх тарифа · 3 работы/);
  assert.match(html, /Итого в тарифе · 2 работы/);
});

test("время начала работы форматирует вызывающий — в поясе организации", () => {
  assert.match(htmlOf(sampleReport, "full"), /\[2026-08-15T00:30\]/);
});

test("текст из отчёта не становится разметкой", () => {
  const hostile = {
    ...sampleReport,
    overtimeWorks: [
      {
        ...sampleReport.overtimeWorks[0],
        description: "<script>alert(1)</script> & «кавычки»",
      },
    ],
  };
  const html = htmlOf(hostile, "full");
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(
    html,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; «кавычки»/,
  );
});

test("колонтитул страницы: подпись отчёта и номер страницы", () => {
  const quoted = {
    ...sampleReport,
    company: { ...sampleReport.company, alias: 'ООО "Ромашка"' },
  };
  const html = htmlOf(quoted, "full");
  // Кавычки внутри CSS-строки экранированы — иначе правило @page рвётся
  assert.match(html, /@bottom-left\s*\{\s*content: "ООО \\"Ромашка\\" · /);
  assert.match(html, /counter\(page\)/);
});

test("только сверх тарифа: одна таблица и пояснение о невошедших работах", () => {
  const html = htmlOf(sampleReport, "extra");
  assert.equal(count(html, '<table class="works"'), 1);
  assert.match(html, /Отчёт о работах сверх тарифа/);
  assert.match(html, /в этот отчёт не включены/);
});

test("подразделение стоит второй строкой у инициатора", () => {
  assert.match(
    htmlOf(sampleReport, "full"),
    /Петрова Анна<div class="sub">Филиал «Север»<\/div>/,
  );
});
