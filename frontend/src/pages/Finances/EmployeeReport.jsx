import { useState, useRef, useEffect } from "react";
import { RiTeamLine } from "react-icons/ri";

import useHttp from "../../hooks/use-http";
import { getLocalStorageData } from "../../util/auth";

import Transitions from "../../animations/Transition";
import Spinner from "../../animations/Spinner";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";
import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import Accordion from "react-bootstrap/Accordion";
import ButtonGroup from "react-bootstrap/ButtonGroup";

import { formatShortDate } from "../../util/format-date";
import {
  calcSingleWorkOvertime,
  formatOvertimeMinutes,
  calculateCost,
} from "../../util/finances";

const EmployeeReport = () => {
  const { token } = getLocalStorageData();

  const fromInputRef = useRef();
  const toInputRef = useRef();

  const [reportData, setReportData] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState("current");

  const { isLoading, sendRequest: generateReport } = useHttp();

  // Bonus calculation function
  const calculateBonusAmount = (totalTimeMs) => {
    const totalMinutes = totalTimeMs / (1000 * 60);
    const hourlyRate = 1000; // 1000₽ per hour
    const billingPeriod = 20; // 20 minutes
    return calculateCost(totalMinutes, hourlyRate, billingPeriod);
  };

  // Auto-set current month on component mount
  useEffect(() => {
    setPeriod("current");
  }, []);

  const msToHMS = (ms) => {
    if (!ms) return "00:00";

    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  const submitHandler = (event) => {
    event.preventDefault();

    const filterData = {
      periodFrom: fromInputRef.current.value,
      periodTo: toInputRef.current.value,
    };

    generateReport(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/finances/employee-report`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: filterData,
      },
      (data) => {
        // Calculate overtime for each employee
        const enrichedData = {
          ...data,
          employees: data.employees.map((employee) => {
            let totalOvertime = 0;
            let totalOvertimeWorks = 0;

            const enrichedWorks = employee.works.map((work) => {
              // Use default schedule for overtime calculation
              const defaultSchedule = {
                Monday: { isWorking: true, start: "09:00", end: "18:00" },
                Tuesday: { isWorking: true, start: "09:00", end: "18:00" },
                Wednesday: { isWorking: true, start: "09:00", end: "18:00" },
                Thursday: { isWorking: true, start: "09:00", end: "18:00" },
                Friday: { isWorking: true, start: "09:00", end: "18:00" },
                Saturday: { isWorking: false, start: "09:00", end: "18:00" },
                Sunday: { isWorking: false, start: "09:00", end: "18:00" },
              };

              const tariffingPeriod = 15; // 15 minutes default

              // Calculate overtime for this work
              const overtimeData = calcSingleWorkOvertime(
                defaultSchedule,
                work,
                tariffingPeriod,
              );
              const overtimeMinutes =
                overtimeData.roundUpOvertime / (1000 * 60);

              if (overtimeMinutes > 0) {
                totalOvertime += overtimeMinutes;
                totalOvertimeWorks++;
              }

              return {
                ...work,
                overtime: {
                  minutes: overtimeMinutes,
                  formatted: formatOvertimeMinutes(overtimeMinutes),
                },
              };
            });

            return {
              ...employee,
              works: enrichedWorks,
              totalOvertime: totalOvertime,
              totalOvertimeWorks: totalOvertimeWorks,
              formattedTotalOvertime: formatOvertimeMinutes(totalOvertime),
            };
          }),
        };

        setReportData(enrichedData);
      },
    );
  };

  const setPeriod = (periodType) => {
    const now = new Date();
    let fromDate, toDate;

    switch (periodType) {
      case "current":
        // Current month
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case "previous":
        // Previous month
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "currentQuarter": {
        // Current quarter
        const currentQuarter = Math.floor(now.getMonth() / 3);
        fromDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
        toDate = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
        break;
      }
      case "previousQuarter": {
        // Previous quarter
        const prevQuarter = Math.floor(now.getMonth() / 3) - 1;
        if (prevQuarter < 0) {
          fromDate = new Date(now.getFullYear() - 1, 9, 1);
          toDate = new Date(now.getFullYear() - 1, 11, 31);
        } else {
          fromDate = new Date(now.getFullYear(), prevQuarter * 3, 1);
          toDate = new Date(now.getFullYear(), (prevQuarter + 1) * 3, 0);
        }
        break;
      }
      case "currentYear":
        // Current year
        fromDate = new Date(now.getFullYear(), 0, 1);
        toDate = new Date(now.getFullYear(), 11, 31);
        break;
      case "last30days":
        // Last 30 days
        toDate = new Date();
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        break;
      case "custom":
      default:
        return;
    }
    fromInputRef.current.value = fromDate.toISOString().split("T")[0];
    toInputRef.current.value = toDate.toISOString().split("T")[0];
    setSelectedPeriod(periodType);
  };

  const handleCustomDateChange = () => {
    setSelectedPeriod("custom");
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      approved: { variant: "success", text: "Утверждён" },
      awaitingPayment: { variant: "warning", text: "Ожидает оплаты" },
      paid: { variant: "primary", text: "Оплачен" },
      archived: { variant: "secondary", text: "Архивирован" },
    };

    const statusInfo = statusMap[status] || {
      variant: "secondary",
      text: status,
    };

    return (
      <Badge bg={statusInfo.variant} className="ms-1">
        {statusInfo.text}
      </Badge>
    );
  };

  return (
    <Transitions>
      <>
        <Card.Title className="mb-3 border-bottom">
          <h1 className="display-4">
            <RiTeamLine /> Отчёт по сотрудникам
          </h1>
          <p className="text-muted">
            Работы согласно утверждённым отчётам по услугам
          </p>
        </Card.Title>

        <Form onSubmit={submitHandler}>
          <Row className="mb-3">
            <Col>
              <div className="d-flex gap-2 flex-wrap mt-2">
                <ButtonGroup size="sm">
                  <Button
                    variant={
                      selectedPeriod === "current"
                        ? "primary"
                        : "outline-primary"
                    }
                    onClick={() => setPeriod("current")}
                  >
                    Текущий месяц
                  </Button>
                  <Button
                    variant={
                      selectedPeriod === "previous"
                        ? "primary"
                        : "outline-primary"
                    }
                    onClick={() => setPeriod("previous")}
                  >
                    Прошлый месяц
                  </Button>
                </ButtonGroup>

                <ButtonGroup size="sm" className="ms-2">
                  <Button
                    variant={
                      selectedPeriod === "currentQuarter"
                        ? "success"
                        : "outline-success"
                    }
                    onClick={() => setPeriod("currentQuarter")}
                  >
                    Текущий квартал
                  </Button>
                  <Button
                    variant={
                      selectedPeriod === "previousQuarter"
                        ? "success"
                        : "outline-success"
                    }
                    onClick={() => setPeriod("previousQuarter")}
                  >
                    Прошлый квартал
                  </Button>
                </ButtonGroup>

                <ButtonGroup size="sm" className="ms-2">
                  <Button
                    variant={
                      selectedPeriod === "currentYear" ? "info" : "outline-info"
                    }
                    onClick={() => setPeriod("currentYear")}
                  >
                    Текущий год
                  </Button>
                  <Button
                    variant={
                      selectedPeriod === "last30days" ? "info" : "outline-info"
                    }
                    onClick={() => setPeriod("last30days")}
                  >
                    Последние 30 дней
                  </Button>
                </ButtonGroup>

                <Button
                  variant={
                    selectedPeriod === "custom" ? "warning" : "outline-warning"
                  }
                  onClick={() => setSelectedPeriod("custom")}
                  size="sm"
                  className="ms-2"
                >
                  📅 Произвольный период
                </Button>
              </div>
            </Col>
          </Row>
          <Row>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  Начало периода
                  {selectedPeriod !== "custom" && (
                    <Badge bg="secondary" className="ms-2 small">
                      Автозаполнение
                    </Badge>
                  )}
                </Form.Label>
                <Form.Control
                  type="date"
                  ref={fromInputRef}
                  required
                  onChange={handleCustomDateChange}
                  disabled={selectedPeriod !== "custom"}
                />
              </Form.Group>
            </Col>
            <Col sm="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  Конец периода
                  {selectedPeriod !== "custom" && (
                    <Badge bg="secondary" className="ms-2 small">
                      Автозаполнение
                    </Badge>
                  )}
                </Form.Label>
                <Form.Control
                  type="date"
                  ref={toInputRef}
                  required
                  onChange={handleCustomDateChange}
                  disabled={selectedPeriod !== "custom"}
                />
              </Form.Group>
            </Col>
          </Row>
          <Row className="mb-3">
            <Col sm="auto" className="d-flex align-items-end">
              <Form.Group>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="mb-3"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Формирование...
                    </>
                  ) : (
                    "📊 Сформировать отчёт"
                  )}
                </Button>
              </Form.Group>
            </Col>
          </Row>
        </Form>

        {isLoading && <Spinner />}

        {reportData && !isLoading && (
          <Transitions>
            <Row className="mb-4">
              <Col>
                <Card>
                  <Card.Header>
                    <h5 className="mb-0">Общая статистика</h5>
                  </Card.Header>
                  <Card.Body>
                    <Row>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-primary">
                            {reportData.totals.totalEmployees}
                          </h4>
                          <small className="text-muted">Сотрудников</small>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-success">
                            {reportData.totals.totalWorks}
                          </h4>
                          <small className="text-muted">Всего работ</small>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-info">
                            {msToHMS(reportData.totals.totalDuration)}
                          </h4>
                          <small className="text-muted">Общее время</small>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-warning">
                            {reportData.totals.totalWorks > 0
                              ? msToHMS(
                                  reportData.totals.totalDuration /
                                    reportData.totals.totalWorks,
                                )
                              : "00:00"}
                          </h4>
                          <small className="text-muted">
                            Среднее время на работу
                          </small>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-danger">
                            {reportData.employees.reduce(
                              (sum, emp) => sum + emp.totalOvertimeWorks,
                              0,
                            )}
                          </h4>
                          <small className="text-muted">
                            Работ сверхурочно
                          </small>
                        </div>
                      </Col>
                      <Col md={2}>
                        <div className="text-center">
                          <h4 className="text-info">
                            {msToHMS(
                              reportData.employees.reduce(
                                (sum, emp) => sum + emp.totalOvertime,
                                0,
                              ) *
                                60 *
                                1000,
                            )}
                          </h4>
                          <small className="text-muted">
                            Общие переработки
                          </small>
                        </div>
                      </Col>
                    </Row>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Row>
              <Col>
                <h3 className="mb-3">Детализация по сотрудникам</h3>

                <Table striped hover responsive>
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th className="text-center">Количество работ</th>
                      <th className="text-center">Общее время</th>
                      <th className="text-center">Среднее время</th>
                      <th className="text-center">Переработки</th>
                      <th className="text-center">Работ сверхурочно</th>
                      <th className="text-center">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.employees.map((employee, index) => (
                      <tr key={employee.employee._id}>
                        <td>
                          <strong>{employee.employee.name}</strong>
                        </td>
                        <td className="text-center">
                          <Badge bg="primary">{employee.totalWorksCount}</Badge>
                        </td>
                        <td className="text-center">
                          {msToHMS(employee.totalDuration)}
                        </td>
                        <td className="text-center">
                          {employee.totalWorksCount > 0
                            ? msToHMS(
                                employee.totalDuration /
                                  employee.totalWorksCount,
                              )
                            : "00:00"}
                        </td>
                        <td className="text-center">
                          <Badge
                            bg={
                              employee.totalOvertime > 0
                                ? "danger"
                                : "secondary"
                            }
                          >
                            {msToHMS(employee.totalOvertime * 60 * 1000)}
                          </Badge>
                        </td>
                        <td className="text-center">
                          <Badge
                            bg={
                              employee.totalOvertimeWorks > 0
                                ? "warning"
                                : "secondary"
                            }
                          >
                            {employee.totalOvertimeWorks}
                          </Badge>
                        </td>
                        <td className="text-center">
                          <Button
                            variant="outline-primary"
                            size="sm"
                            href={`#employee-${index}`}
                          >
                            Подробности
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <h4 className="mt-5 mb-3">Подробная информация по работам</h4>

                <Accordion>
                  {reportData.employees.map((employee, employeeIndex) => (
                    <Accordion.Item
                      eventKey={employeeIndex.toString()}
                      key={employee.employee._id}
                      id={`employee-${employeeIndex}`}
                    >
                      <Accordion.Header>
                        <div className="d-flex justify-content-between align-items-center w-100 me-3">
                          <span>
                            <strong>{employee.employee.name}</strong>
                          </span>
                          <div>
                            <Badge bg="primary" className="me-2">
                              {employee.totalWorksCount} работ
                            </Badge>
                            <Badge bg="info" className="me-2">
                              {msToHMS(employee.totalDuration)}
                            </Badge>
                            {employee.totalOvertime > 0 && (
                              <Badge bg="danger" className="me-2">
                                {msToHMS(employee.totalOvertime * 60 * 1000)}{" "}
                                переработок
                              </Badge>
                            )}
                            {employee.totalOvertimeWorks > 0 && (
                              <Badge bg="warning">
                                {employee.totalOvertimeWorks} сверхурочных
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Accordion.Header>
                      <Accordion.Body>
                        <Table size="sm" striped>
                          <thead>
                            <tr>
                              <th>Описание работы</th>
                              <th>Компания</th>
                              <th>Услуга</th>
                              <th>Заявки</th>
                              <th>Период</th>
                              <th>Длительность</th>
                              <th>Переработка</th>
                              <th>Статус отчёта</th>
                            </tr>
                          </thead>
                          <tbody>
                            {employee.works.map((work) => (
                              <tr key={work._id}>
                                <td>
                                  <div
                                    className="text-truncate"
                                    style={{ maxWidth: "200px" }}
                                  >
                                    {work.description || "Описание не указано"}
                                  </div>
                                </td>
                                <td>{work.company.fullTitle}</td>
                                <td>{work.servicePlan.title}</td>
                                <td>
                                  {work.tickets.map((ticket, index) => (
                                    <div key={ticket._id} className="small">
                                      <a
                                        href={`/tickets/${ticket.num}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-decoration-none"
                                      >
                                        №{ticket.num}
                                      </a>
                                      <br />
                                      <span className="text-muted">
                                        {ticket.category}
                                      </span>
                                      {index < work.tickets.length - 1 && (
                                        <hr className="my-1" />
                                      )}
                                    </div>
                                  ))}
                                </td>
                                <td className="small">
                                  {formatShortDate(work.report.periodFrom)} -{" "}
                                  {formatShortDate(work.report.periodTo)}
                                </td>
                                <td>
                                  <Badge
                                    bg={
                                      work.duration > 8 * 60 * 60 * 1000
                                        ? "warning"
                                        : "secondary"
                                    }
                                  >
                                    {msToHMS(work.duration)}
                                  </Badge>
                                </td>
                                <td>
                                  {work.overtime.minutes > 0 ? (
                                    <Badge bg="danger" className="small">
                                      {msToHMS(
                                        work.overtime.minutes * 60 * 1000,
                                      )}
                                    </Badge>
                                  ) : (
                                    <Badge
                                      bg="light"
                                      text="dark"
                                      className="small"
                                    >
                                      Нет
                                    </Badge>
                                  )}
                                </td>
                                <td>{getStatusBadge(work.report.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </Accordion.Body>
                    </Accordion.Item>
                  ))}
                </Accordion>

                {/* Bonus Calculation Summary */}
                <Row className="mt-5">
                  <Col>
                    <Card className="border-warning">
                      <Card.Header className="bg-warning text-dark">
                        <h5 className="mb-0">Расчёт оплаты переработок</h5>
                      </Card.Header>
                      <Card.Body>
                        <Table striped hover responsive size="sm">
                          <thead>
                            <tr>
                              <th>Сотрудник</th>
                              <th className="text-center">Работ</th>
                              <th className="text-center">Переработки</th>
                              <th className="text-center">К доплате</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.employees.map((employee) => {
                              const bonusAmount = calculateBonusAmount(
                                employee.totalOvertime * 60 * 1000,
                              );

                              return (
                                <tr key={employee.employee._id}>
                                  <td>
                                    <strong>{employee.employee.name}</strong>
                                  </td>
                                  <td className="text-center">
                                    <Badge
                                      bg={
                                        employee.totalOvertimeWorks > 0
                                          ? "warning"
                                          : "secondary"
                                      }
                                    >
                                      {employee.totalOvertimeWorks}
                                    </Badge>
                                  </td>
                                  <td className="text-center">
                                    <Badge
                                      bg={
                                        employee.totalOvertime > 0
                                          ? "danger"
                                          : "secondary"
                                      }
                                    >
                                      {msToHMS(
                                        employee.totalOvertime * 60 * 1000,
                                      )}
                                    </Badge>
                                  </td>

                                  <td className="text-center">
                                    <Badge
                                      bg={
                                        bonusAmount > 0
                                          ? "primary"
                                          : "secondary"
                                      }
                                      className="px-3"
                                    >
                                      {bonusAmount.toLocaleString("ru-RU")} ₽
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="table-warning">
                              <td>
                                <strong>ИТОГО:</strong>
                              </td>
                              <td className="text-center">
                                <strong>
                                  {reportData.employees.reduce(
                                    (sum, emp) => sum + emp.totalOvertimeWorks,
                                    0,
                                  )}
                                </strong>
                              </td>
                              <td className="text-center">
                                <strong>
                                  {msToHMS(
                                    reportData.employees.reduce(
                                      (sum, emp) => sum + emp.totalOvertime,
                                      0,
                                    ) *
                                      60 *
                                      1000,
                                  )}
                                </strong>
                              </td>
                              <td className="text-center">
                                <strong>
                                  {calculateBonusAmount(
                                    reportData.employees.reduce((sum, emp) => {
                                      const outOfPlanTime = emp.totalOvertime;
                                      return (
                                        sum +
                                        outOfPlanTime +
                                        emp.totalOvertime * 60 * 1000
                                      );
                                    }, 0),
                                  ).toLocaleString("ru-RU")}{" "}
                                  ₽
                                </strong>
                              </td>
                            </tr>
                          </tfoot>
                        </Table>

                        <div className="mt-3 p-3 bg-light rounded">
                          <h6 className="text-muted">
                            Примечания к расчёту премиальных:
                          </h6>
                          <ul className="text-muted small mb-0">
                            <li>
                              <strong>Переработки</strong> - работы, выполненные
                              вне рабочего времени (будни 9:00-18:00)
                            </li>

                            <li>
                              <strong>Расчёт доплаты:</strong> 1000₽ за час
                              дополнительной работы с округлением до 20-минутных
                              периодов
                            </li>
                          </ul>
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
              </Col>
            </Row>
          </Transitions>
        )}
      </>
    </Transitions>
  );
};

export default EmployeeReport;

export async function loader() {
  document.title = "ОТЧЁТ ПО СОТРУДНИКАМ";
  return null;
}
