import type { AnalyticsSummaryResponse } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import { aggregateExecutors } from "./employees";

// Экспорт «Сводки» в Excel/CSV — перенос легаси ExportButtons на новую форму
// ответа (+ колонки регламента, которых в легаси не было). xlsx подгружается
// динамически в момент экспорта — в чанк страницы не входит.

const ratio = (onSiteTime: number, remoteTime: number) => {
  const total = onSiteTime + remoteTime;
  if (total <= 0) return "0% / 0%";
  return `${Math.round((onSiteTime / total) * 100)}% / ${Math.round(
    (remoteTime / total) * 100,
  )}%`;
};

const companySheetRows = (data: AnalyticsSummaryResponse) =>
  data.companies.map((company) => ({
    Компания: company.company.alias,
    "Полное название": company.company.name,
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
    Исполнителей: company.executors.length,
  }));

const employeeSheetRows = (data: AnalyticsSummaryResponse) =>
  aggregateExecutors(data.companies).map((employee) => ({
    Сотрудник: employee.name,
    "Всего работ": employee.totalWorks,
    "Общее время": msToHMS(employee.totalTime),
    "Выездов (кол-во)": employee.onSiteWorks,
    "Выездов (время)": msToHMS(employee.onSiteTime),
    "Удалённых (кол-во)": employee.remoteWorks,
    "Удалённых (время)": msToHMS(employee.remoteTime),
    "Регламентных (кол-во)": employee.routineTaskWorks,
    "Регламентных (время)": msToHMS(employee.routineTaskTime),
    Компании: employee.companies
      .map((company) => `${company.alias}: ${msToHMS(company.time)}`)
      .join("; "),
  }));

const subdivisionSheetRows = (data: AnalyticsSummaryResponse) =>
  (data.companies[0]?.subdivisions ?? [])
    .filter((subdivision) => subdivision.totalWorks > 0)
    .map((subdivision) => ({
      Подразделение: subdivision.name,
      "Всего работ": subdivision.totalWorks,
      "Общее время": msToHMS(subdivision.totalTime),
      "Выездов (кол-во)": subdivision.onSiteCount,
      "Выездов (время)": msToHMS(subdivision.onSiteTime),
      "Удалённых (кол-во)": subdivision.remoteCount,
      "Удалённых (время)": msToHMS(subdivision.remoteTime),
      "Регламентных (кол-во)": subdivision.routineTaskCount,
      "Регламентных (время)": msToHMS(subdivision.routineTaskTime),
    }));

const fileName = (data: AnalyticsSummaryResponse, extension: string) =>
  `analytics_${data.period.from}_${data.period.to}.${extension}`;

export const exportAnalyticsToExcel = async (
  data: AnalyticsSummaryResponse,
) => {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(companySheetRows(data)),
    "Сводка по компаниям",
  );

  if (data.isClientView) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(subdivisionSheetRows(data)),
      "По подразделениям",
    );
  } else {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(employeeSheetRows(data)),
      "По сотрудникам",
    );

    // Детализация исполнителей — отдельный лист на компанию (как в легаси)
    for (const company of data.companies) {
      if (company.executors.length === 0) continue;
      const rows = company.executors.map((executor) => ({
        Исполнитель: executor.name,
        "Всего работ": executor.totalWorks,
        "Общее время": msToHMS(executor.totalTime),
        "Выездов (кол-во)": executor.onSiteWorks,
        "Выездов (время)": msToHMS(executor.onSiteTime),
        "Удалённых (кол-во)": executor.remoteWorks,
        "Удалённых (время)": msToHMS(executor.remoteTime),
        "Регламентных (кол-во)": executor.routineTaskWorks,
        "Регламентных (время)": msToHMS(executor.routineTaskTime),
      }));
      // Excel ограничивает имя листа 31 символом
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        company.company.alias.substring(0, 31),
      );
    }
  }

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
    ...rows.map((row) =>
      headers.map((header) => `"${row[header]}"`).join(","),
    ),
    "",
  ];
};

export const exportAnalyticsToCsv = (data: AnalyticsSummaryResponse) => {
  const sections = [
    ...toCsvSection("Сводка по компаниям", companySheetRows(data)),
    ...(data.isClientView
      ? toCsvSection("По подразделениям", subdivisionSheetRows(data))
      : toCsvSection("По сотрудникам", employeeSheetRows(data))),
  ];

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
