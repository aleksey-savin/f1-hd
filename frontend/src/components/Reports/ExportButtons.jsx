import * as XLSX from "xlsx";
import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import { RiFileExcel2Line, RiFileTextLine } from "react-icons/ri";

const ExportButtons = ({ reportData, msToHMS }) => {
  if (!reportData || !reportData.companies) return null;

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Создаем общий лист с данными по всем компаниям
    const summaryData = reportData.companies.map((company) => ({
      Компания: company.company.alias,
      "Полное название": company.company.name,
      "Всего заявок": company.totalTickets,
      "Всего работ": company.totalWorks,
      "Общее время": msToHMS(company.totalTime),
      "Выездов (кол-во)": company.onSite.count,
      "Выездов (время)": msToHMS(company.onSite.time),
      "Удаленных (время)": msToHMS(company.remote.time),
      "Соотношение (выезды/удалённые)":
        company.onSite.time + company.remote.time > 0
          ? `${Math.round((company.onSite.time / (company.onSite.time + company.remote.time)) * 100)}% / ${Math.round((company.remote.time / (company.onSite.time + company.remote.time)) * 100)}%`
          : "0% / 0%",
      Исполнителей: company.executors.length,
    }));

    const summaryWS = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWS, "Сводка по компаниям");

    // Создаем сводный лист по всем сотрудникам
    const allExecutors = reportData.companies.reduce((acc, company) => {
      company.executors.forEach((executor) => {
        acc.push({
          Компания: company.company.alias,
          Исполнитель: executor.name,
          "Всего работ": executor.totalWorks,
          "Общее время": msToHMS(executor.totalTime),
          "Выездов (кол-во)": executor.onSiteWorks,
          "Выездов (время)": msToHMS(executor.onSiteTime),
          "Удаленных (время)": msToHMS(executor.remoteTime),
          "Соотношение (выезды/удалённые)":
            executor.onSiteTime + executor.remoteTime > 0
              ? `${Math.round(
                  (executor.onSiteTime /
                    (executor.onSiteTime + executor.remoteTime)) *
                    100,
                )}% / ${Math.round(
                  (executor.remoteTime /
                    (executor.onSiteTime + executor.remoteTime)) *
                    100,
                )}%`
              : "0% / 0%",
        });
      });
      return acc;
    }, []);

    // Сортируем сотрудников по общему времени
    allExecutors.sort((a, b) => {
      const aTime = a["Общее время"];
      const bTime = b["Общее время"];
      return bTime.localeCompare(aTime);
    });

    const allExecutorsWS = XLSX.utils.json_to_sheet(allExecutors);
    XLSX.utils.book_append_sheet(wb, allExecutorsWS, "Все исполнители");

    // Создаем лист с распределением сотрудников по компаниям
    const employeeCompanyData = {};
    reportData.companies.forEach((company) => {
      company.executors.forEach((executor) => {
        if (!employeeCompanyData[executor.name]) {
          employeeCompanyData[executor.name] = {
            name: executor.name,
            totalTime: 0,
            totalWorks: 0,
            companies: [],
          };
        }
        employeeCompanyData[executor.name].totalTime += executor.totalTime;
        employeeCompanyData[executor.name].totalWorks += executor.totalWorks;
        employeeCompanyData[executor.name].companies.push({
          alias: company.company.alias,
          time: executor.totalTime,
          works: executor.totalWorks,
        });
      });
    });

    const employeeDistributionData = Object.values(employeeCompanyData)
      .sort((a, b) => b.totalTime - a.totalTime)
      .map((emp) => {
        const row = {
          Сотрудник: emp.name,
          "Общее время": msToHMS(emp.totalTime),
          "Всего работ": emp.totalWorks,
          "Количество компаний": emp.companies.length,
        };

        // Добавляем данные по каждой компании
        emp.companies.forEach((company, index) => {
          row[`Компания ${index + 1}`] = company.alias;
          row[`Время в компании ${index + 1}`] = msToHMS(company.time);
          row[`Работ в компании ${index + 1}`] = company.works;
        });

        return row;
      });

    const employeeDistributionWS = XLSX.utils.json_to_sheet(
      employeeDistributionData,
    );
    XLSX.utils.book_append_sheet(
      wb,
      employeeDistributionWS,
      "Сотрудники по компаниям",
    );

    // Создаем отдельные листы для каждой компании с детализацией по исполнителям
    reportData.companies.forEach((company) => {
      if (company.executors.length > 0) {
        const executorData = company.executors.map((executor) => ({
          Исполнитель: executor.name,
          "Всего работ": executor.totalWorks,
          "Общее время": msToHMS(executor.totalTime),
          "Выездов (кол-во)": executor.onSiteWorks,
          "Выездов (время)": msToHMS(executor.onSiteTime),
          "Удаленных (время)": msToHMS(executor.remoteTime),
          "Соотношение (выезды/удалённые)":
            executor.onSiteTime + executor.remoteTime > 0
              ? `${Math.round(
                  (executor.onSiteTime /
                    (executor.onSiteTime + executor.remoteTime)) *
                    100,
                )}% / ${Math.round(
                  (executor.remoteTime /
                    (executor.onSiteTime + executor.remoteTime)) *
                    100,
                )}%`
              : "0% / 0%",
        }));

        const executorWS = XLSX.utils.json_to_sheet(executorData);
        const sheetName = company.company.alias.substring(0, 31); // Excel ограничивает длину названия листа
        XLSX.utils.book_append_sheet(wb, executorWS, sheetName);
      }
    });

    const fileName = `company_summary_report_${reportData.period.from}_${reportData.period.to}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const exportToCSV = () => {
    // Создаем CSV с общими данными по компаниям
    const summaryHeaders = [
      "Компания",
      "Полное название",
      "Всего заявок",
      "Всего работ",
      "Общее время (часы)",
      "Выездов (кол-во)",
      "Выездов (часы)",
      "Удаленных (часы)",
      "Соотношение (выезды/удалённые)",
      "Исполнителей",
    ];

    const summaryRows = reportData.companies.map((company) => [
      company.company.alias,
      company.company.name,
      company.totalTickets,
      company.totalWorks,
      (company.totalTime / (1000 * 60 * 60)).toFixed(2),
      company.onSite.count,
      (company.onSite.time / (1000 * 60 * 60)).toFixed(2),
      (company.remote.time / (1000 * 60 * 60)).toFixed(2),
      company.onSite.time + company.remote.time > 0
        ? `${Math.round((company.onSite.time / (company.onSite.time + company.remote.time)) * 100)}% / ${Math.round((company.remote.time / (company.onSite.time + company.remote.time)) * 100)}%`
        : "0% / 0%",
      company.executors.length,
    ]);

    // Создаем CSV для исполнителей
    const executorHeaders = [
      "Компания",
      "Исполнитель",
      "Всего работ",
      "Общее время (часы)",
      "Выездов (кол-во)",
      "Выездов (часы)",
      "Удаленных (часы)",
      "Соотношение (выезды/удалённые)",
    ];

    const executorRows = [];
    reportData.companies.forEach((company) => {
      company.executors.forEach((executor) => {
        executorRows.push([
          company.company.alias,
          executor.name,
          executor.totalWorks,
          (executor.totalTime / (1000 * 60 * 60)).toFixed(2),
          executor.onSiteWorks,
          (executor.onSiteTime / (1000 * 60 * 60)).toFixed(2),
          (executor.remoteTime / (1000 * 60 * 60)).toFixed(2),
          executor.onSiteTime + executor.remoteTime > 0
            ? `${Math.round(
                (executor.onSiteTime /
                  (executor.onSiteTime + executor.remoteTime)) *
                  100,
              )}% / ${Math.round(
                (executor.remoteTime /
                  (executor.onSiteTime + executor.remoteTime)) *
                  100,
              )}%`
            : "0% / 0%",
        ]);
      });
    });

    // Создаем данные о распределении сотрудников по компаниям для CSV
    const employeeCompanyCSVData = {};
    reportData.companies.forEach((company) => {
      company.executors.forEach((executor) => {
        if (!employeeCompanyCSVData[executor.name]) {
          employeeCompanyCSVData[executor.name] = {
            name: executor.name,
            totalTime: 0,
            totalWorks: 0,
            companies: [],
          };
        }
        employeeCompanyCSVData[executor.name].totalTime += executor.totalTime;
        employeeCompanyCSVData[executor.name].totalWorks += executor.totalWorks;
        employeeCompanyCSVData[executor.name].companies.push({
          alias: company.company.alias,
          time: executor.totalTime,
          works: executor.totalWorks,
        });
      });
    });

    const employeeDistributionHeaders = [
      "Сотрудник",
      "Общее время (часы)",
      "Всего работ",
      "Количество компаний",
      "Компании (детали)",
    ];

    const employeeDistributionRows = Object.values(employeeCompanyCSVData)
      .sort((a, b) => b.totalTime - a.totalTime)
      .map((emp) => [
        emp.name,
        (emp.totalTime / (1000 * 60 * 60)).toFixed(2),
        emp.totalWorks,
        emp.companies.length,
        emp.companies
          .map(
            (c) =>
              `${c.alias}: ${(c.time / (1000 * 60 * 60)).toFixed(2)}ч/${c.works}р`,
          )
          .join("; "),
      ]);

    // Конвертируем в CSV формат
    const csvContent = [
      "# Сводка по компаниям",
      summaryHeaders.join(","),
      ...summaryRows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      "",
      "# Детализация по исполнителям",
      executorHeaders.join(","),
      ...executorRows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      "",
      "# Распределение сотрудников по компаниям",
      employeeDistributionHeaders.join(","),
      ...employeeDistributionRows.map((row) =>
        row.map((cell) => `"${cell}"`).join(","),
      ),
    ].join("\n");

    // Создаем и скачиваем файл
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `company_summary_report_${reportData.period.from}_${reportData.period.to}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <Col sm="auto">
        <Form.Group>
          <Button
            variant="success"
            className="mb-2 w-100"
            onClick={exportToExcel}
          >
            <RiFileExcel2Line /> Excel
          </Button>
        </Form.Group>
      </Col>
      <Col sm="auto">
        <Form.Group>
          <Button
            variant="outline-success"
            className="mb-2 w-100"
            onClick={exportToCSV}
          >
            <RiFileTextLine /> CSV
          </Button>
        </Form.Group>
      </Col>
    </>
  );
};

export default ExportButtons;
