import type { CompaniesSummaryResponse } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

// Экспорт «Сводки» в Excel/CSV. Лист «По сотрудникам» из книги ушёл вместе со
// срезом: сотрудники — предмет соседнего отчёта. xlsx подгружается динамически
// в момент экспорта — в чанк страницы не входит.

const ratio = (onSiteTime: number, remoteTime: number) => {
  const total = onSiteTime + remoteTime;
  if (total <= 0) return "0% / 0%";
  return `${Math.round((onSiteTime / total) * 100)}% / ${Math.round(
    (remoteTime / total) * 100,
  )}%`;
};

const companySheetRows = (data: CompaniesSummaryResponse) =>
  data.companies.map((company) => ({
    Компания: company.company.alias,
    // Полного названия у компании поле fullTitle; прежний экспорт брал
    // несуществующее company.name и колонка всегда была пустой
    "Полное название": company.company.fullTitle ?? "",
    "Всего заявок": company.totalTickets,
    "Всего работ": company.totalWorks,
    "Общее время": msToHMS(company.totalTime),
    "Выездов (кол-во)": company.onSite.count,
    "Выездов (время)": msToHMS(company.onSite.time),
    "Удалённых (кол-во)": company.remote.count,
    "Удалённых (время)": msToHMS(company.remote.time),
    "Регламентных (кол-во)": company.routineTask.count,
    "Регламентных (время)": msToHMS(company.routineTask.time),
    "Соотношение (выезды/удалённые)": ratio(
      company.onSite.time,
      company.remote.time,
    ),
  }));

const fileName = (data: CompaniesSummaryResponse, extension: string) =>
  `companies_${data.period.from}_${data.period.to}.${extension}`;

export const exportAnalyticsToExcel = async (
  data: CompaniesSummaryResponse,
) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(companySheetRows(data)),
    "Сводка по компаниям",
  );

  XLSX.writeFile(workbook, fileName(data, "xlsx"));
};

const toCsvSection = (
  title: string,
  rows: Record<string, string | number>[],
) => {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  return [
    `# ${title}`,
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${row[header]}"`).join(",")),
    "",
  ];
};

export const exportAnalyticsToCsv = (data: CompaniesSummaryResponse) => {
  const sections = toCsvSection("Сводка по компаниям", companySheetRows(data));

  const blob = new Blob([sections.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", fileName(data, "csv"));
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
