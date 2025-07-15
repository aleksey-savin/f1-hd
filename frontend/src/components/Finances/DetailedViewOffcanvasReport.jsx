import { useState } from "react";
import * as XLSX from "xlsx";
import "jspdf-autotable";

import Offcanvas from "react-bootstrap/Offcanvas";
import Table from "react-bootstrap/Table";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import { HiOutlineMagnifyingGlass } from "react-icons/hi2";
import { FaRegFilePdf, FaRegFileExcel } from "react-icons/fa6";
import {
  calcSingleWorkOvertime,
  calculateWorkTime,
  calculateCost,
  calculateOvertime,
  calcRoundedWorkTime,
  overallRoundedWorktime,
} from "../../util/finances";
import { formatPrice } from "../../util/format-string";
import { msToHMS } from "../../util/time-helpers";

const DetailedViewOffcanvasReport = ({
  works = [],
  plan = {},
  company = {},
}) => {
  const [showUnrelatedWorks, setShowUnrelatedWorks] = useState(false);

  const handleCloseUnrelatedWorks = () => setShowUnrelatedWorks(false);
  const handleShowUnrelatedWorks = () => setShowUnrelatedWorks(true);

  const schedule = plan.companyWorkSchedule
    ? company?.workSchedule
    : plan.customProvisionSchedule;

  // works
  const overtime = calculateOvertime(schedule, works, plan.tariffingPeriod);

  const worktime = calculateWorkTime(schedule, works, plan.tariffingPeriod);

  // overtime totals
  const overtimeTotals = overtime.overtimeWorks.reduce(
    (acc, work) => {
      const overtime = calcSingleWorkOvertime(
        schedule,
        work,
        plan.tariffingPeriod,
      );

      const cost = Number(
        calculateCost(
          overtime.roundUpOvertime / (1000 * 60),
          plan.pricePerHourNonWorking,
          plan.tariffingPeriod,
        ),
      );

      return {
        duration: acc.duration + overtime.roundUpOvertime,
        cost: acc.cost + cost,
      };
    },
    { duration: 0, cost: 0 },
  );

  const hourlyTotalCost = () => {
    let totalCost = 0;
    for (let work of works) {
      totalCost += calculateCost(
        calcRoundedWorkTime(work, plan.tariffingPeriod) / (1000 * 60),
        plan.pricePerHour,
        plan.tariffingPeriod,
      );
    }
    return totalCost;
  };

  const exportToExcel = () => {
    try {
      console.log("Starting Excel export...");
      let exportData = [];

      exportData.push({
        "Тип работ": "Тип тарификации:",
        Заявки:
          plan.tariffing?.type === "hourly"
            ? "Почасовая"
            : plan.tariffing?.type === "fixed"
              ? "Фиксированная"
              : "Пакеты часов",
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      exportData.push({
        "Тип работ": "Период тарификации:",
        Заявки: `${plan.tariffingPeriod || 0} минут`,
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      exportData.push({
        "Тип работ": "",
        Заявки: company.fullTitle || "",
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      exportData.push({
        "Тип работ": "Стоимость в нерабочее время:",
        Заявки: `${formatPrice(plan.pricePerHourNonWorking || 0)} / час`,
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      if (plan.tariffing?.type === "hourly") {
        exportData.push({
          "Тип работ": "Стоимость в рабочее время:",
          Заявки: `${formatPrice(plan.pricePerHour || 0)} / час`,
          Инициаторы: "",
          "Описание работ": "",
          Исполнитель: "",
          Длительность: "",
          Стоимость: "",
        });
      }

      // Add empty row for spacing
      exportData.push({
        "Тип работ": "",
        Заявки: "",
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      if (plan?.tariffing?.type !== "hourly") {
        // Export overtime works
        if (overtime.overtimeWorks.length > 0) {
          exportData.push({
            "Тип работ": "ВЫПОЛНЕНЫ В НЕРАБОЧЕЕ ВРЕМЯ",
            Заявки: "",
            Инициаторы: "",
            "Описание работ": "",
            Исполнитель: "",
            Длительность: "",
            Стоимость: "",
          });

          overtime.overtimeWorks.forEach((work) => {
            exportData.push({
              "Тип работ": "",
              Заявки: work.tickets.map((ticket) => ticket.num).join(", "),
              Инициаторы: work.tickets
                .map((ticket) =>
                  ticket.applicantId
                    ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                    : "Пользователь не найден",
                )
                .join(", "),
              "Описание работ": work.description,
              Исполнитель: work.finishedBy,
              Длительность: msToHMS(
                calcSingleWorkOvertime(schedule, work, plan.tariffingPeriod)
                  .roundUpOvertime,
              ),
              Стоимость: formatPrice(
                calculateCost(
                  calcSingleWorkOvertime(schedule, work, plan.tariffingPeriod)
                    .roundUpOvertime /
                    (1000 * 60),
                  plan.pricePerHourNonWorking,
                  plan.tariffingPeriod,
                ),
              ),
            });
          });

          exportData.push({
            "Тип работ": "",
            Заявки: "",
            Инициаторы: "",
            "Описание работ": "",
            Исполнитель: "Итого:",
            Длительность: msToHMS(overtimeTotals.duration),
            Стоимость: formatPrice(overtimeTotals.cost),
          });

          // Add empty row for spacing
          exportData.push({
            "Тип работ": "",
            Заявки: "",
            Инициаторы: "",
            "Описание работ": "",
            Исполнитель: "",
            Длительность: "",
            Стоимость: "",
          });
        }

        // Export regular worktime works
        exportData.push({
          "Тип работ": "ВЫПОЛНЕНЫ В РАБОЧЕЕ ВРЕМЯ",
          Заявки: "",
          Инициаторы: "",
          "Описание работ": "",
          Исполнитель: "",
          Длительность: "",
          Стоимость: "",
        });

        worktime.worktimeWorks.forEach((work) => {
          exportData.push({
            "Тип работ": "",
            Заявки: work.tickets.map((ticket) => ticket.num).join(", "),
            Инициаторы: work.tickets
              .map((ticket) =>
                ticket.applicantId
                  ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                  : "Пользователь не найден",
              )
              .join(", "),
            "Описание работ": work.description,
            Исполнитель: work.finishedBy,
            Длительность: msToHMS(
              calcRoundedWorkTime(work, plan.tariffingPeriod),
            ),
            Стоимость: "",
          });
        });

        exportData.push({
          "Тип работ": "",
          Заявки: "",
          Инициаторы: "",
          "Описание работ": "",
          Исполнитель: "Итого:",
          Длительность: msToHMS(
            overallRoundedWorktime(
              worktime.worktimeWorks,
              plan.tariffingPeriod,
            ),
          ),
          Стоимость: "",
        });
      } else {
        // Export hourly works
        exportData.push({
          "Тип работ": "ПОЧАСОВАЯ ОПЛАТА",
          Заявки: "",
          Инициаторы: "",
          "Описание работ": "",
          Исполнитель: "",
          Длительность: "",
          Стоимость: "",
        });

        works
          .filter((work) => work.finishedAt !== work.startedAt)
          .forEach((work) => {
            exportData.push({
              "Тип работ": "",
              Заявки: work.tickets.map((ticket) => ticket.num).join(", "),
              Инициаторы: work.tickets
                .map((ticket) =>
                  ticket.applicantId
                    ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                    : "Пользователь не найден",
                )
                .join(", "),
              "Описание работ": work.description,
              Исполнитель: work.finishedBy,
              Длительность: msToHMS(
                calcRoundedWorkTime(work, plan.tariffingPeriod),
              ),
              Стоимость: formatPrice(
                calculateCost(
                  calcRoundedWorkTime(work, plan.tariffingPeriod) / (1000 * 60),
                  plan.pricePerHour,
                  plan.tariffingPeriod,
                ),
              ),
            });
          });

        exportData.push({
          "Тип работ": "",
          Заявки: "",
          Инициаторы: "",
          "Описание работ": "",
          Исполнитель: "Итого:",
          Длительность: msToHMS(
            overallRoundedWorktime(works, plan.tariffingPeriod),
          ),
          Стоимость: formatPrice(hourlyTotalCost()),
        });
      }

      // Add grand total summary
      exportData.push({
        "Тип работ": "",
        Заявки: "",
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      exportData.push({
        "Тип работ": "ОБЩИЙ ИТОГ",
        Заявки: "",
        Инициаторы: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      const grandTotalDuration =
        plan?.tariffing?.type === "hourly"
          ? overallRoundedWorktime(works, plan.tariffingPeriod)
          : overtimeTotals.duration +
            overallRoundedWorktime(
              worktime.worktimeWorks,
              plan.tariffingPeriod,
            );

      const grandTotalCost =
        plan?.tariffing?.type === "hourly"
          ? hourlyTotalCost()
          : overtimeTotals.cost;

      exportData.push({
        "Тип работ": "Общее время:",
        Заявки: msToHMS(grandTotalDuration),
        Инициаторы: "",
        Категории: "",
        "Описание работ": "",
        Исполнитель: "",
        Длительность: "",
        Стоимость: "",
      });

      if (plan?.tariffing?.type === "hourly" || overtimeTotals.cost > 0) {
        exportData.push({
          "Тип работ": "Общая стоимость:",
          Заявки: formatPrice(grandTotalCost),
          Инициаторы: "",
          Категории: "",
          "Описание работ": "",
          Исполнитель: "",
          Длительность: "",
          Стоимость: "",
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(exportData);

      for (let R = 0; R <= 7; R++) {
        for (let C = 0; C <= 7; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!worksheet[cellAddress]) continue;

          if (R === 0 || (R > 0 && R <= 7 && C === 0)) {
            worksheet[cellAddress].s = {
              font: { bold: true },
              fill: { fgColor: { rgb: "E6E6FA" } },
            };
          }
        }
      }

      // Format grand total section
      const totalRowStart = exportData.length - 4; // Adjust based on number of total rows added
      for (let R = totalRowStart; R < exportData.length; R++) {
        for (let C = 0; C <= 7; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!worksheet[cellAddress]) continue;

          worksheet[cellAddress].s = {
            font: { bold: true },
            fill: { fgColor: { rgb: "FFE4B5" } },
          };
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Детальный просмотр");

      const today = new Date().toISOString().split("T")[0];
      const fileName = `Detalniy_prosmotr_${today}.xlsx`;
      console.log("Saving file as:", fileName);

      XLSX.writeFileXLSX(workbook, fileName);
      console.log("Excel export completed");
    } catch (error) {
      console.error("Excel export error:", error);
      alert("Ошибка при экспорте в Excel: " + error.message);
    }
  };

  const exportToPDF = () => {
    try {
      console.log("Starting PDF export...");

      const printWindow = window.open("", "_blank");
      let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Предварительный отчёт по работам</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .title { font-size: 16px; font-weight: bold; margin-bottom: 20px; }
            .section-title { font-size: 14px; font-weight: bold; margin-top: 30px; margin-bottom: 10px; }
            .total { font-weight: bold; background-color: #f8f9fa; }
            .alert { background-color: #f8f9fa; padding: 10px; margin: 10px 0; border-left: 4px solid #0d6efd; }
            .summary-table { background-color: #f8f9fa; margin-bottom: 30px; }
            .summary-table th { background-color: #e9ecef; font-weight: bold; }
            .summary-table td { padding: 10px; }
          </style>
        </head>
        <body>
          <div class="title">Предварительный отчёт по работам</div>
          <table class="summary-table">
            <tbody>
              <tr>
                <th>Компания:</th>
                <td>${company.fullTitle || ""}</td>
              </tr>
              <tr>
                <th>Услуга:</th>
                <td>${plan.title || ""}</td>
              </tr>
              <tr>
                <th>Тип тарификации:</th>
                <td>${
                  plan.tariffing?.type === "hourly"
                    ? "Почасовая"
                    : plan.tariffing?.type === "fixed"
                      ? "Фиксированная"
                      : "Пакеты часов"
                }</td>
              </tr>
              <tr>
                <th>Период тарификации:</th>
                <td>${plan.tariffingPeriod || 0} минут</td>
              </tr>
              <tr>
                <th>Стоимость в нерабочее время:</th>
                <td>${formatPrice(plan.pricePerHourNonWorking || 0)} / час</td>
              </tr>
              ${
                plan.tariffing?.type === "hourly"
                  ? `
              <tr>
                <th>Стоимость в рабочее время:</th>
                <td>${formatPrice(plan.pricePerHour || 0)} / час</td>
              </tr>
              `
                  : ""
              }
            </tbody>
          </table>
      `;

      if (plan?.tariffing?.type !== "hourly") {
        if (overtime.overtimeWorks.length > 0) {
          htmlContent += `
            <div class="section-title">Выполнены в нерабочее время</div>
            <table>
              <thead>
                <tr>
                  <th>Заявки</th>
                  <th>Инициаторы</th>
                  <th>Описание работ</th>
                  <th>Исполнитель</th>
                  <th>Длительность</th>
                  <th>Стоимость</th>
                </tr>
              </thead>
              <tbody>
                ${overtime.overtimeWorks
                  .map(
                    (work) => `
                  <tr>
                    <td>${work.tickets.map((ticket) => ticket.num).join(", ")}</td>
                    <td>${work.tickets
                      .map((ticket) =>
                        ticket.applicantId
                          ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                          : "Пользователь не найден",
                      )
                      .join(", ")}</td>
                    <td>${work.description}</td>
                    <td >${work.finishedBy?.lastName} ${work.finishedBy?.firstName}</td>

                    <td>${msToHMS(
                      calcSingleWorkOvertime(
                        schedule,
                        work,
                        plan.tariffingPeriod,
                      ).roundUpOvertime,
                    )}</td>
                    <td>${formatPrice(
                      calculateCost(
                        calcSingleWorkOvertime(
                          schedule,
                          work,
                          plan.tariffingPeriod,
                        ).roundUpOvertime /
                          (1000 * 60),
                        plan.pricePerHourNonWorking,
                        plan.tariffingPeriod,
                      ),
                    )}</td>
                  </tr>
                `,
                  )
                  .join("")}
                <tr class="total">
                  <td colspan="4">Итого:</td>
                  <td>${msToHMS(overtimeTotals.duration)}</td>
                  <td>${formatPrice(overtimeTotals.cost)}</td>
                </tr>
              </tbody>
            </table>
          `;
        }

        htmlContent += `
          <div class="section-title">Выполнены в рабочее время</div>
          <table>
            <thead>
              <tr>
                <th>Заявки</th>
                <th>Инициаторы</th>
                <th>Описание работ</th>
                <th>Исполнитель</th>
                <th>Длительность</th>
              </tr>
            </thead>
            <tbody>
              ${worktime.worktimeWorks
                .map(
                  (work) => `
                <tr>
                  <td>${work.tickets.map((ticket) => ticket.num).join(", ")}</td>
                  <td>${work.tickets
                    .map((ticket) =>
                      ticket.applicantId
                        ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                        : "Пользователь не найден",
                    )
                    .join(", ")}</td>
                  <td>${work.description}</td>
                  <td >${work.finishedBy?.lastName} ${work.finishedBy?.firstName}</td>
                  <td>${msToHMS(calcRoundedWorkTime(work, plan.tariffingPeriod))}</td>
                </tr>
              `,
                )
                .join("")}
              <tr class="total">
                <td colspan="4">Итого:</td>
                <td>${msToHMS(
                  overallRoundedWorktime(
                    worktime.worktimeWorks,
                    plan.tariffingPeriod,
                  ),
                )}</td>
              </tr>
            </tbody>
          </table>
        `;
      } else {
        htmlContent += `
          <div class="section-title">Почасовая оплата</div>
          <table>
            <thead>
              <tr>
                <th>Заявки</th>
                <th>Инициаторы</th>
                <th>Описание работ</th>
                <th>Исполнитель</th>
                <th>Длительность</th>
                <th>Стоимость</th>
              </tr>
            </thead>
            <tbody>
              ${works
                .filter((work) => work.finishedAt !== work.startedAt)
                .map(
                  (work) => `
                <tr>
                  <td>${work.tickets.map((ticket) => ticket.num).join(", ")}</td>
                  <td>${work.tickets
                    .map((ticket) =>
                      ticket.applicantId
                        ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                        : "Пользователь не найден",
                    )
                    .join(", ")}</td>
                  <td>${work.description}</td>
                  <td >${work.finishedBy?.lastName} ${work.finishedBy?.firstName}</td>
                  <td>${msToHMS(calcRoundedWorkTime(work, plan.tariffingPeriod))}</td>
                  <td>${formatPrice(
                    calculateCost(
                      calcRoundedWorkTime(work, plan.tariffingPeriod) /
                        (1000 * 60),
                      plan.pricePerHour,
                      plan.tariffingPeriod,
                    ),
                  )}</td>
                </tr>
              `,
                )
                .join("")}
              <tr class="total">
                <td colspan="4">Итого:</td>
                <td>${msToHMS(overallRoundedWorktime(works, plan.tariffingPeriod))}</td>
                <td>${formatPrice(hourlyTotalCost())}</td>
              </tr>
            </tbody>
          </table>
          </body>
          </html>
        `;
      }

      printWindow.document.write(htmlContent);
      printWindow.document.close();

      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);

      console.log("PDF export completed");
    } catch (error) {
      console.error("PDF export error:", error);
      alert("Ошибка при экспорте в PDF: " + error.message);
    }
  };

  return (
    <>
      <Button
        onClick={handleShowUnrelatedWorks}
        variant="primary"
        size="sm"
        className="mx-2 my-1"
      >
        <HiOutlineMagnifyingGlass />
      </Button>
      <Offcanvas
        show={showUnrelatedWorks}
        onHide={handleCloseUnrelatedWorks}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Выполненные работы</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Container>
            <h3>Отчёт по работам</h3>
            <Row>
              <Col sm="6">
                <Table className="table-sm">
                  <tbody>
                    <tr>
                      <th style={{ width: "40%" }}>Компания</th>
                      <td>{company.fullTitle}</td>
                    </tr>
                    <tr>
                      <th>Услуга</th>
                      <td>{plan.title}</td>
                    </tr>
                    <tr>
                      <th>Период</th>
                      <td>
                        {new Date(works[0].finishedAt).toLocaleDateString(
                          "ru-RU",
                          { month: "long", year: "numeric" },
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Тип тарификации</th>
                      <td>
                        {plan.tariffing?.type === "hourly"
                          ? "Почасовая"
                          : plan.tariffing?.type === "fixed"
                            ? "Фиксированная"
                            : "Пакеты часов"}
                      </td>
                    </tr>
                    <tr>
                      <th>Период тарификации</th>
                      <td>{plan.tariffingPeriod} минут</td>
                    </tr>
                    <tr>
                      <th>Стоимость в нерабочее время</th>
                      <td>{formatPrice(plan.pricePerHourNonWorking)} / час</td>
                    </tr>
                    {plan.tariffing?.type === "hourly" && (
                      <tr>
                        <th>Стоимость в рабочее время</th>
                        <td>{formatPrice(plan.pricePerHour)} / час</td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </Col>
            </Row>
            {plan?.tariffing?.type !== "hourly" && (
              <>
                {overtime.overtimeWorks.length > 0 && (
                  <>
                    <h5>Выполнены в нерабочее время</h5>
                    <Table bordered>
                      <thead>
                        <tr>
                          <th>Заявки</th>
                          <th>Инициаторы</th>

                          <th>Описание работ</th>
                          <th>Исполнитель</th>
                          <th>Длительность</th>
                          <th className="text-end">Стоимость</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overtime.overtimeWorks.map((work) => (
                          <tr
                            key={work._id}
                            className={
                              parseInt(msToHMS(work.duration), 10) >= 12
                                ? "table-warning"
                                : ""
                            }
                          >
                            <td data-cell="Заявки">
                              {work.tickets.map((ticket) => (
                                <div key={Math.random()}>
                                  <a
                                    href={`/tickets/${ticket.num}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {ticket.num}
                                  </a>
                                  <br></br>
                                </div>
                              ))}
                            </td>
                            <td data-cell="инициаторы">
                              {work.tickets.map((ticket) => (
                                <div key={Math.random()}>
                                  {ticket.applicantId
                                    ? `${ticket.applicantId?.lastName} ${ticket.applicantId?.firstName}`
                                    : "Пользователь не найден"}
                                  <br></br>
                                </div>
                              ))}
                            </td>

                            <td data-cell="описание работ">
                              {work.description}
                            </td>
                            <td data-cell="исполнитель">{`${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`}</td>
                            <td data-cell="длительность" className="text-end">
                              {msToHMS(
                                calcSingleWorkOvertime(
                                  schedule,
                                  work,
                                  plan.tariffingPeriod,
                                ).roundUpOvertime,
                              )}
                            </td>
                            <td data-cell="стоимость" className="text-end">
                              {formatPrice(
                                calculateCost(
                                  calcSingleWorkOvertime(
                                    schedule,
                                    work,
                                    plan.tariffingPeriod,
                                  ).roundUpOvertime /
                                    (1000 * 60),
                                  plan.pricePerHourNonWorking,
                                  plan.tariffingPeriod,
                                ),
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="table-secondary fw-bold">
                          <td className="text-end" colSpan={4}>
                            Итого:
                          </td>
                          <td className="text-end">
                            {msToHMS(overtimeTotals.duration)}
                          </td>
                          <td className="text-end">
                            {formatPrice(overtimeTotals.cost)}
                          </td>
                        </tr>
                      </tfoot>
                    </Table>
                  </>
                )}
                <h5>Выполнены в рабочее время</h5>
                <Table bordered>
                  <thead>
                    <tr>
                      <th>Заявки</th>
                      <th>Инициаторы</th>

                      <th>Описание работ</th>
                      <th>Исполнитель</th>
                      <th className="text-end">Длительность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worktime.worktimeWorks.map((work) => (
                      <tr
                        key={work._id}
                        className={
                          parseInt(msToHMS(work.duration), 10) >= 12
                            ? "table-warning"
                            : ""
                        }
                      >
                        <td data-cell="Заявки">
                          {work.tickets.map((ticket) => (
                            <div key={Math.random()}>
                              <a
                                href={`/tickets/${ticket.num}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {ticket.num}
                              </a>
                              <br></br>
                            </div>
                          ))}
                        </td>
                        <td data-cell="инициаторы">
                          {work.tickets.map((ticket) => (
                            <div key={Math.random()}>
                              {ticket.applicantId
                                ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                                : "Пользователь не найден"}
                              <br></br>
                            </div>
                          ))}
                        </td>

                        <td data-cell="описание работ">{work.description}</td>
                        <td data-cell="исполнитель">{`${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`}</td>
                        <td data-cell="длительность" className="text-end">
                          {msToHMS(
                            calcRoundedWorkTime(work, plan.tariffingPeriod),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-secondary fw-bold">
                      <td className="text-end" colSpan={4}>
                        Итого:
                      </td>
                      <td className="text-end">
                        {msToHMS(
                          overallRoundedWorktime(
                            worktime.worktimeWorks,
                            plan.tariffingPeriod,
                          ),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
            {plan?.tariffing?.type === "hourly" && (
              <>
                <Table bordered>
                  <thead>
                    <tr>
                      <th>Заявки</th>
                      <th>Инициаторы</th>
                      <th>Описание работ</th>
                      <th>Исполнитель</th>
                      <th>Длительность</th>
                      <th className="text-end">Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {works
                      .filter((work) => work.finishedAt !== work.startedAt)
                      .map((work) => (
                        <tr
                          key={work._id}
                          className={
                            parseInt(msToHMS(work.duration), 10) >= 12
                              ? "table-warning"
                              : ""
                          }
                        >
                          <td data-cell="Заявки">
                            {work.tickets.map((ticket) => (
                              <div key={Math.random()}>
                                <a
                                  href={`/tickets/${ticket.num}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {ticket.num}
                                </a>
                                <br></br>
                              </div>
                            ))}
                          </td>
                          <td data-cell="инициаторы">
                            {work.tickets.map((ticket) => (
                              <div key={Math.random()}>
                                {ticket.applicantId
                                  ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                                  : "Пользователь не найден"}
                                <br></br>
                              </div>
                            ))}
                          </td>

                          <td data-cell="описание работ">{work.description}</td>
                          <td data-cell="исполнитель">
                            {`${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`}
                          </td>
                          <td data-cell="длительность" className="text-end">
                            {msToHMS(
                              calcRoundedWorkTime(work, plan.tariffingPeriod),
                            )}
                          </td>
                          <td data-cell="стоимость" className="text-end">
                            {formatPrice(
                              calculateCost(
                                calcRoundedWorkTime(
                                  work,
                                  plan.tariffingPeriod,
                                ) /
                                  (1000 * 60),
                                plan.pricePerHour,
                                plan.tariffingPeriod,
                              ),
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-secondary fw-bold">
                      <td className="text-end" colSpan={4}>
                        Итого:
                      </td>
                      <td className="text-end">
                        {msToHMS(
                          overallRoundedWorktime(works, plan.tariffingPeriod),
                        )}
                      </td>
                      <td className="text-end">
                        {formatPrice(hourlyTotalCost())}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
            {works.length > 0 && (
              <div className="mb-3 d-flex justify-content-end gap-2">
                <Button
                  variant="outline-success"
                  size="sm"
                  onClick={exportToExcel}
                >
                  <FaRegFileExcel /> Экспорт в Excel
                </Button>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={exportToPDF}
                >
                  <FaRegFilePdf /> Экспорт в PDF
                </Button>
              </div>
            )}
          </Container>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default DetailedViewOffcanvasReport;
