import * as XLSX from "xlsx";

import Button from "react-bootstrap/Button";

import { RiFileExcel2Line, RiFileTextLine } from "react-icons/ri";

import { SCHEDULE_SOURCE_LABELS, workStatusMeta } from "./format";

const toHours = (minutes) => Number(((minutes || 0) / 60).toFixed(2));

const buildSummaryRows = (report) => {
  const { totals, payroll, period, employee } = report;
  const rows = [
    { Показатель: "Сотрудник", Значение: `${employee.lastName} ${employee.firstName}`.trim() },
    { Показатель: "Период", Значение: `${period.from} — ${period.to}` },
    { Показатель: "Отработано, ч", Значение: toHours(totals.totalMinutes) },
    { Показатель: "Норма, ч", Значение: toHours(totals.normMinutes) },
    { Показатель: "Работы", Значение: totals.worksCount },
    { Показатель: "Заявок закрыто", Значение: totals.ticketsFinished },
    { Показатель: "Выезды", Значение: totals.onSite.count },
    {
      Показатель: "Переработка (с округлением), ч",
      Значение: toHours(totals.overtime.roundedMinutes),
    },
    {
      Показатель: "Переработка в будни, ч",
      Значение: toHours(totals.overtime.weekdayMinutes),
    },
    {
      Показатель: "Переработка в выходные, ч",
      Значение: toHours(totals.overtime.weekendMinutes),
    },
  ];
  if (payroll.overtimePay != null) {
    rows.push({ Показатель: "Доплата за переработки, ₽", Значение: payroll.overtimePay });
  }
  if (payroll.salary != null) {
    rows.push({ Показатель: "Оклад, ₽/мес", Значение: payroll.salary });
  }
  if (payroll.estimatedTotal != null) {
    rows.push({
      Показатель: "Итого за месяц (оценка), ₽",
      Значение: payroll.estimatedTotal,
    });
  }
  return rows;
};

const buildByDayRows = (report) =>
  report.byDay.map((day) => ({
    Дата: day.date,
    "Время, ч": toHours(day.minutes),
    "Переработка, ч": toHours(day.overtimeMinutes),
    Работы: day.worksCount,
    Выезды: day.onSiteCount,
  }));

const buildByCompanyRows = (report) =>
  report.byCompany.map((company) => ({
    Компания: company.alias,
    "Время, ч": toHours(company.minutes),
    "Доля, %": company.sharePercent,
    Работы: company.worksCount,
    Выезды: company.onSiteCount,
    "Переработка, ч": toHours(company.overtimeMinutes),
  }));

const buildWorksRows = (report) =>
  report.works.map((work) => ({
    Начало: work.startedAt || "",
    Окончание: work.finishedAt || "",
    Компания: work.company?.alias || "",
    Заявки: work.tickets.map((ticket) => `#${ticket.num}`).join(", "),
    Описание: work.description,
    "Длительность, мин": work.durationMinutes,
    "Переработка, мин": work.overtime.roundedMinutes,
    "Переработка факт., мин": work.overtime.actualMinutes,
    График: SCHEDULE_SOURCE_LABELS[work.scheduleSource],
    Статус: workStatusMeta(work.financesStatus).label,
    Выезд: work.visitRequired ? "да" : "нет",
  }));

const ExportPersonalReport = ({ report }) => {
  const fileName = `personal_report_${report.period.from}_${report.period.to}`;

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildSummaryRows(report)),
      "Сводка",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildByDayRows(report)),
      "По дням",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildByCompanyRows(report)),
      "По компаниям",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildWorksRows(report)),
      "Работы",
    );
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  };

  const exportToCSV = () => {
    const sections = [
      ["# Сводка", buildSummaryRows(report)],
      ["# По дням", buildByDayRows(report)],
      ["# По компаниям", buildByCompanyRows(report)],
      ["# Работы", buildWorksRows(report)],
    ];

    const csvContent = sections
      .map(([title, rows]) => {
        if (!rows.length) {
          return title;
        }
        const headers = Object.keys(rows[0]);
        const lines = rows.map((row) =>
          headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(","),
        );
        return [title, headers.join(","), ...lines].join("\n");
      })
      .join("\n\n");

    // BOM — чтобы Excel корректно открыл кириллицу в UTF-8 CSV
    const blob = new Blob(["﻿" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="d-flex gap-2">
      <Button variant="success" onClick={exportToExcel}>
        <RiFileExcel2Line /> Excel
      </Button>
      <Button variant="outline-success" onClick={exportToCSV}>
        <RiFileTextLine /> CSV
      </Button>
    </div>
  );
};

export default ExportPersonalReport;
