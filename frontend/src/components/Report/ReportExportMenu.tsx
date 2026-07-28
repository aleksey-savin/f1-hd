import { RiDownloadLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { formatDateTime } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

/**
 * Выгрузка отчёта — Excel и PDF, как у кнопок прежней «расшифровки».
 *
 * PDF делается ОКНОМ ПЕЧАТИ, а не jsPDF: у встроенных шрифтов jsPDF нет
 * кириллицы, и отчёт вышел бы кракозябрами. Прежний экран печатал так же —
 * браузер рисует текст сам и предлагает «Сохранить как PDF».
 *
 * `xlsx` подгружается динамически в момент нажатия: в чанк страницы он не
 * входит.
 *
 * Имя файла — латиницей. Кириллица в атрибуте `download` часть браузеров
 * игнорирует, и файл сохраняется как «download» без расширения.
 */

const TARIFF_LABEL: Record<string, string> = {
  hourPackage: "Пакеты часов",
  hourly: "Почасовая оплата",
  fixedPrice: "Фиксированная оплата",
};

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const translit = (value: string) =>
  (value || "")
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const fileBase = (report: any) =>
  `report-${translit(report.company?.alias || "company")}-${String(
    report.periodFrom,
  ).slice(0, 7)}`;

const money = (value: number) => Math.round(value || 0);

const fullName = (person?: { firstName?: string; lastName?: string }) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const headerRows = (report: any) => {
  const terms = report.terms || {};
  return [
    ["Компания", report.company?.fullTitle || report.company?.alias || ""],
    ["Услуга", report.servicePlan?.title || ""],
    // Месяц берём готовым с сервера: в зоне браузера он уезжает на предыдущий
    ["Период", report.period || ""],
    ["Тип тарификации", TARIFF_LABEL[terms.type] || ""],
    [
      "Период тарификации",
      terms.tariffingPeriod ? `${terms.tariffingPeriod} мин` : "",
    ],
    [
      "Стоимость в нерабочее время",
      terms.pricePerHourNonWorking ? `${terms.pricePerHourNonWorking} ₽/час` : "",
    ],
  ];
};

const worksRows = (works: any[], withCost: boolean) =>
  works.map((work) => {
    const row: (string | number)[] = [
      (work.tickets || []).map((ticket: any) => ticket.num).join(", "),
      (work.tickets || [])
        .map((ticket: any) => fullName(ticket.applicantId))
        .filter(Boolean)
        .join(", "),
      work.description || "",
      fullName(work.finishedBy),
      formatDateTime(work.startedAt),
      msToHMS((work.billedMinutes || 0) * 60000),
    ];
    if (withCost) row.push(money(work.cost));
    return row;
  });

const HEAD = [
  "Заявки",
  "Инициаторы",
  "Описание работ",
  "Исполнитель",
  "Начало",
  "Длительность",
];

const totalsRows = (report: any) => {
  const rows: [string, number][] = [["Оплата по тарифу", money(report.calc?.price)]];
  if (report.calc?.additionalPrice) {
    rows.push(["Оплата в нерабочее время", money(report.calc.additionalPrice)]);
  }
  rows.push(["ИТОГО", money(report.calc?.total)]);
  return rows;
};

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] || char,
  );

const ReportExportMenu = ({ report }: { report: any }) => {
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows: (string | number)[][] = [...headerRows(report), []];

    if ((report.overtimeWorks || []).length > 0) {
      rows.push(["Выполнены в нерабочее время"]);
      rows.push([...HEAD, "Стоимость"]);
      rows.push(...worksRows(report.overtimeWorks, true));
      rows.push([]);
    }

    rows.push(["Выполнены в рабочее время"]);
    rows.push([...HEAD]);
    rows.push(...worksRows(report.worktimeWorks || [], false));
    rows.push([]);
    rows.push(...totalsRows(report));

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 60 },
      { wch: 22 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Отчёт");

    // writeFile сам собирает ссылку и на кириллическом имени отдаёт «download»
    // без расширения — пишем в Blob и качаем сами
    const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
    download(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${fileBase(report)}.xlsx`,
    );
  };

  const exportPdf = () => {
    const table = (head: string[], rows: (string | number)[][]) => `
      <table>
        <thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>`;

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>${escapeHtml(fileBase(report))}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  h2 { font-size: 13px; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  .meta td:first-child { font-weight: bold; width: 220px; }
  .meta { margin-bottom: 6px; }
  .totals td:first-child { font-weight: bold; }
  .totals tr:last-child { font-weight: bold; background: #f8f9fa; }
  @page { size: landscape; margin: 12mm; }
</style></head><body>
<h1>Отчёт по оказанным услугам</h1>
<table class="meta"><tbody>
  ${headerRows(report)
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("")}
</tbody></table>
${
  (report.overtimeWorks || []).length > 0
    ? `<h2>Выполнены в нерабочее время</h2>${table(
        [...HEAD, "Стоимость"],
        worksRows(report.overtimeWorks, true),
      )}`
    : ""
}
<h2>Выполнены в рабочее время</h2>
${table(HEAD, worksRows(report.worktimeWorks || [], false))}
<h2>Итог</h2>
<table class="totals"><tbody>
  ${totalsRows(report)
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td>${value.toLocaleString("ru-RU")} ₽</td></tr>`,
    )
    .join("")}
</tbody></table>
</body></html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // Даём странице отрисоваться, иначе печать уходит с пустым телом
    setTimeout(() => printWindow.print(), 400);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <RiDownloadLine /> Экспорт
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportExcel}>Excel (.xlsx)</DropdownMenuItem>
        <DropdownMenuItem onSelect={exportPdf}>PDF (печать)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReportExportMenu;
