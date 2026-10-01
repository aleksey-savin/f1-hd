import { hhmm, rubles } from "./export-format.js";
import type { ExportModel, ExportTable } from "./export-model";

/**
 * Печатная страница отчёта по услуге — её открывают в новом окне и отдают в
 * печать; «Сохранить как PDF» делает браузер.
 *
 * PDF делается окном печати, а не библиотекой: браузер рисует кириллицу сам и
 * сам разбивает таблицы на страницы, повторяя шапку. Имя файла браузер берёт из
 * `<title>`.
 *
 * Лист — A4 альбомный, монохромный: печатается на любом принтере. Колонтитул
 * (подпись отчёта и номер страницы) задан полями `@page`; браузер, который их
 * не умеет, просто печатает без колонтитула.
 *
 * Весь текст из отчёта экранируется: описание работы пишет человек.
 */

export type ExportHtmlOptions = {
  /** Имя файла без расширения — уходит в `<title>`. */
  fileBase: string;
  /** Дата формирования, уже отформатированная. */
  madeAt: string;
  /** Время начала работы — в поясе организации. */
  startLabel: (value: string) => string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char,
  );

/** Строка для CSS `content`: кавычка внутри порвала бы правило `@page`. */
const cssString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ")}"`;

const tableHtml = (table: ExportTable, options: ExportHtmlOptions) => `
<div class="sec">
  <h2>${escapeHtml(table.title)}</h2>
  ${table.hint ? `<span class="hint">${escapeHtml(table.hint)}</span>` : ""}
</div>
<table class="works">
  <colgroup>
    <col style="width: 30px">
    <col style="width: 150px">
    <col style="width: 64px">
    <col>
    <col style="width: 170px">
    <col style="width: 130px">
    <col style="width: 92px">
    ${table.withCost ? '<col style="width: 96px">' : ""}
  </colgroup>
  <thead>
    <tr>
      <th>№</th>
      <th>Начало</th>
      <th>Заявка</th>
      <th>Описание работ</th>
      <th>Инициатор</th>
      <th>Исполнитель</th>
      <th class="num">Длительность</th>
      ${table.withCost ? '<th class="num">Стоимость</th>' : ""}
    </tr>
  </thead>
  <tbody>
    ${table.rows
      .map(
        (row, index) => `<tr>
      <td class="dim">${index + 1}</td>
      <td>${escapeHtml(options.startLabel(row.startedAt))}</td>
      <td>${escapeHtml(row.tickets)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>${escapeHtml(row.initiator)}${
        row.subdivision
          ? `<div class="sub">${escapeHtml(row.subdivision)}</div>`
          : ""
      }</td>
      <td>${escapeHtml(row.executor)}</td>
      <td class="num">${hhmm(row.minutes)}</td>
      ${table.withCost ? `<td class="num">${rubles(row.cost ?? 0)}</td>` : ""}
    </tr>`,
      )
      .join("\n")}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="6">${escapeHtml(table.totalLabel)}</td>
      <td class="num">${hhmm(table.totalMinutes)}</td>
      ${table.withCost ? `<td class="num">${rubles(table.totalCost ?? 0)}</td>` : ""}
    </tr>
  </tfoot>
</table>`;

export const renderExportHtml = (
  model: ExportModel,
  options: ExportHtmlOptions,
) => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>${escapeHtml(options.fileBase)}</title>
<style>
  @page {
    size: A4 landscape;
    margin: 12mm 12mm 14mm;
    @bottom-left { content: ${cssString(model.footer)}; font: 8pt Arial, sans-serif; color: #5b646d; }
    @bottom-right { content: "стр. " counter(page) " из " counter(pages); font: 8pt Arial, sans-serif; color: #5b646d; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: #16191d; font: 12.5px/16px "Inter Variable", Inter, "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen { body { max-width: 1033px; margin: 0 auto; padding: 32px 24px; } }
  h1, h2, p { margin: 0; }
  .head { display: flex; align-items: flex-end; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #16191d; }
  .kicker { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #007a5e; }
  .title { margin-top: 3px; font-size: 26px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em; }
  .made { margin-left: auto; text-align: right; color: #5b646d; white-space: nowrap; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px 36px; margin-top: 12px; }
  .facts .k { font-size: 11px; line-height: 14px; color: #5b646d; }
  .facts .v { font-weight: 600; }
  .tiles { display: grid; grid-template-columns: repeat(${model.tiles.length}, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
  .tile { padding: 8px 10px; border: 1px solid #c9cfd4; border-radius: 6px; }
  .tile .k { font-size: 11px; line-height: 14px; color: #5b646d; }
  .tile .v { margin-top: 2px; font-size: 18px; line-height: 22px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tile.sum { padding: 7px 9px; border: 2px solid #16191d; }
  .tile.sum .k { color: #16191d; font-weight: 600; }
  .terms { margin-top: 12px; color: #5b646d; }
  .terms b { font-weight: 600; color: #16191d; }
  .sec { display: flex; align-items: baseline; gap: 10px; margin: 18px 0 6px; break-after: avoid; }
  .sec h2 { font-size: 14px; line-height: 18px; font-weight: 700; }
  .sec .hint { color: #5b646d; }
  table.works { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .works th { padding: 6px 8px; border-top: 1px solid #16191d; border-bottom: 1px solid #16191d; text-align: left; vertical-align: bottom; font-size: 11px; line-height: 14px; font-weight: 700; color: #5b646d; }
  .works td { padding: 6px 8px; border-bottom: 1px solid #e1e5e8; vertical-align: top; overflow-wrap: anywhere; }
  .works tr { break-inside: avoid; }
  .works .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .works .dim { color: #5b646d; }
  .works .sub { font-size: 11px; line-height: 14px; color: #5b646d; }
  .works tfoot td { border-top: 1px solid #16191d; border-bottom: 0; font-weight: 700; }
  .note { margin-top: 14px; color: #5b646d; }
</style></head><body>
<div class="head">
  <div>
    <div class="kicker">${escapeHtml(model.kicker)}</div>
    <h1 class="title">${escapeHtml(model.title)}</h1>
  </div>
  <div class="made">Сформирован ${escapeHtml(options.madeAt)}</div>
</div>
<div class="facts">
  ${model.facts
    .map(
      (fact) =>
        `<div><div class="k">${escapeHtml(fact.label)}</div><div class="v">${escapeHtml(fact.value)}</div></div>`,
    )
    .join("\n  ")}
</div>
<div class="tiles">
  ${model.tiles
    .map(
      (tile) =>
        `<div class="tile${tile.strong ? " sum" : ""}"><div class="k">${escapeHtml(tile.label)}</div><div class="v">${escapeHtml(tile.value)}</div></div>`,
    )
    .join("\n  ")}
</div>
<p class="terms">${model.variant === "full" ? "Условия расчёта: " : ""}${model.terms
  .map(
    (term) =>
      `${escapeHtml(term.text)}${term.value ? ` <b>${escapeHtml(term.value)}</b>` : ""}`,
  )
  .join(" · ")}</p>
${model.tables.map((table) => tableHtml(table, options)).join("\n")}
${model.note ? `<p class="note">${escapeHtml(model.note)}</p>` : ""}
</body></html>`;
