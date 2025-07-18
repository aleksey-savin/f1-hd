import { useState, useRef, useEffect } from "react";
import { useActionData, useFetcher } from "react-router";
import {
  FaAngleLeft,
  FaAngleRight,
  FaDownload,
  FaFilter,
} from "react-icons/fa";
import {
  RiUserLine,
  RiFileList3Line,
  RiTimelineView,
  RiEyeLine,
  RiTimeLine,
  RiMoneyDollarCircleLine,
  RiCalendarLine,
  RiBarChart2Line,
} from "react-icons/ri";

import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Accordion from "react-bootstrap/Accordion";
import Alert from "react-bootstrap/Alert";
import Form from "react-bootstrap/Form";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Dropdown from "react-bootstrap/Dropdown";
import ProgressBar from "react-bootstrap/ProgressBar";

import { getLocalStorageData } from "../../util/auth";
import { formatShortDate } from "../../util/format-date";
import { formatPrice } from "../../util/format-string";
import { msToHMS } from "../../util/time-helpers";
import {
  calcSingleWorkOvertime,
  calculateWorkTime,
  calculateCost,
  formatOvertimeMinutes,
} from "../../util/finances";

import Transitions from "../../animations/Transition";
import Spinner from "../../animations/Spinner";
import WorkDetailsModal from "../../components/Finances/Personal/WorkDetailsModal";

import WorkCalendar from "../../components/Finances/Personal/WorkCalendar";
import ExportReport from "../../components/Finances/Personal/ExportReport";

const PersonalReport = () => {
  const fetcher = useFetcher();
  const [date, setDate] = useState(new Date());
  const [selectedPeriod, setSelectedPeriod] = useState("current");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const fromInputRef = useRef();
  const toInputRef = useRef();

  const data = useActionData() ?? fetcher.data;

  const [processedData, setProcessedData] = useState({
    completedWorks: [],
    previewWorks: [],
    overtimeWorks: [],
    withinTariffWorks: [],
    totalOvertime: 0,
    totalOvertimeWorks: 0,
    totalEarnings: 0,
    totalWorkTime: 0,
    totalRoundedWorkTime: 0,
    stats: {
      totalWorks: 0,
      approvedWorks: 0,
      pendingWorks: 0,
      rejectedWorks: 0,
    },
  });

  const [selectedWork, setSelectedWork] = useState(null);
  const [showWorkModal, setShowWorkModal] = useState(false);

  useEffect(() => {
    setPeriod("current");
  }, []);

  useEffect(() => {
    if (data) {
      processWorkData(data);
    }
  }, [data]);

  const processWorkData = (workData) => {
    let overtimeWorksData = [];
    let withinTariffWorksData = [];
    let previewWorksData = [];
    let totalOvertime = 0;
    let totalOvertimeWorks = 0;
    let totalEarnings = 0;
    let totalWorkTime = 0;
    let totalRoundedWorkTime = 0;

    const stats = {
      totalWorks: 0,
      approvedWorks: 0,
      pendingWorks: 0,
      rejectedWorks: 0,
    };

    // Process completed works
    if (workData.completedWorks && Array.isArray(workData.completedWorks)) {
      stats.totalWorks = workData.completedWorks.length;

      for (let work of workData.completedWorks) {
        // Count status
        if (work.status === "approved") stats.approvedWorks++;
        else if (work.status === "pending") stats.pendingWorks++;
        else if (work.status === "rejected") stats.rejectedWorks++;

        if (work.servicePlan && work.startedAt && work.finishedAt) {
          // Get proper schedule
          const schedule = work.servicePlan?.companyWorkSchedule
            ? work.company?.workSchedule
            : work.servicePlan?.customProvisionSchedule;

          // Get tariffing period (default to 20 minutes if not specified)
          const tariffingPeriod = work.servicePlan?.tariffingPeriod || 20;

          if (schedule) {
            // Calculate work time properly
            const workTimeResult = calculateWorkTime(
              schedule,
              [work],
              tariffingPeriod,
            );

            totalWorkTime += workTimeResult.worktime || 0;
            totalRoundedWorkTime += workTimeResult.roundedWorktime || 0;

            // Calculate overtime properly
            const overtimeData = calcSingleWorkOvertime(
              schedule,
              work,
              tariffingPeriod,
            );

            if (
              overtimeData &&
              overtimeData.roundUpOvertime > 0 &&
              !work.withinPlan
            ) {
              const overtimeMinutes =
                overtimeData.roundUpOvertime / (1000 * 60);
              totalOvertime += overtimeMinutes;
              totalOvertimeWorks++;

              overtimeWorksData.push({
                ...work,
                overtime: {
                  minutes: overtimeMinutes,
                  formatted: formatOvertimeMinutes(overtimeMinutes),
                  actualMinutes: overtimeData.actualOvertime / (1000 * 60),
                },
                workTime: workTimeResult.worktime || 0,
                roundedWorkTime: workTimeResult.roundedWorktime || 0,
              });
            } else {
              withinTariffWorksData.push({
                ...work,
                workTime: workTimeResult.worktime || 0,
                roundedWorkTime: workTimeResult.roundedWorktime || 0,
              });
            }

            // Calculate earnings based on rounded work time
            const hourlyRate = work.servicePlan?.hourlyRate || 1000;
            const cost = calculateCost(
              (workTimeResult.roundedWorktime || 0) / 60,
              hourlyRate,
              tariffingPeriod,
            );
            totalEarnings += cost;
          } else {
            // If no schedule, just add to within tariff works
            withinTariffWorksData.push(work);
          }
        } else {
          // If incomplete work data, add to within tariff works
          withinTariffWorksData.push(work);
        }
      }
    }

    // Process preview works
    if (workData.previewWorks && Array.isArray(workData.previewWorks)) {
      previewWorksData = workData.previewWorks.map((work) => {
        if (work.servicePlan && work.startedAt && work.finishedAt) {
          const schedule = work.servicePlan?.companyWorkSchedule
            ? work.company?.workSchedule
            : work.servicePlan?.customProvisionSchedule;

          const tariffingPeriod = work.servicePlan?.tariffingPeriod || 20;

          if (schedule) {
            const workTimeResult = calculateWorkTime(
              schedule,
              [work],
              tariffingPeriod,
            );

            return {
              ...work,
              workTime: workTimeResult.worktime || 0,
              roundedWorkTime: workTimeResult.roundedWorktime || 0,
            };
          }
        }
        return work;
      });
    }

    setProcessedData({
      completedWorks: [...withinTariffWorksData, ...overtimeWorksData],
      overtimeWorks: overtimeWorksData,
      withinTariffWorks: withinTariffWorksData,
      previewWorks: previewWorksData,
      totalOvertime,
      totalOvertimeWorks,
      totalEarnings,
      totalWorkTime,
      totalRoundedWorkTime,
      formattedTotalOvertime: formatOvertimeMinutes(totalOvertime),
      stats,
    });
  };

  const setPeriod = (periodType) => {
    const now = new Date();
    let fromDate, toDate;

    switch (periodType) {
      case "current":
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case "previous":
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "currentQuarter": {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        fromDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
        toDate = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0);
        break;
      }
      case "last30days":
        toDate = new Date();
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        break;
      case "custom":
      default:
        return;
    }

    if (fromInputRef.current && toInputRef.current) {
      fromInputRef.current.value = fromDate.toISOString().split("T")[0];
      toInputRef.current.value = toDate.toISOString().split("T")[0];
    }
    setSelectedPeriod(periodType);
    setDate(fromDate);
  };

  const handleCustomDateChange = () => {
    setSelectedPeriod("custom");
  };

  const handlePrevMonth = () => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() - 1);
    setDate(newDate);
    generateReport(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() + 1);
    setDate(newDate);
    generateReport(newDate);
  };

  const generateReport = (reportDate = date) => {
    const fromDate =
      fromInputRef.current?.value ||
      new Date(reportDate.getFullYear(), reportDate.getMonth(), 1)
        .toISOString()
        .split("T")[0];
    const toDate =
      toInputRef.current?.value ||
      new Date(reportDate.getFullYear(), reportDate.getMonth() + 1, 0)
        .toISOString()
        .split("T")[0];

    fetcher.submit({ fromDate, toDate }, { method: "post", action: "." });
  };

  const handleExport = async (exportData) => {
    const { format, options, data } = exportData;

    try {
      const filename = `personal_report_${fromInputRef.current?.value || "unknown"}_${toInputRef.current?.value || "unknown"}.${format}`;

      if (format === "csv") {
        downloadCSV(data, filename);
      } else if (format === "excel") {
        downloadExcel(data, options, filename);
      } else if (format === "pdf") {
        downloadPDF(data, options, filename);
      }
    } catch (error) {
      console.error("Export error:", error);
    }
  };

  const downloadCSV = (data, filename) => {
    const csvData = [];

    csvData.push([
      "Дата",
      "Компания",
      "Тариф",
      "Описание",
      "Время работы",
      "Округленное время",
      "Переработка",
      "Статус",
      "Стоимость",
    ]);

    data.completedWorks?.forEach((work) => {
      const workTime = work.workTime || 0;
      const roundedWorkTime = work.roundedWorkTime || 0;
      const cost = work.servicePlan?.hourlyRate
        ? calculateCost(
            roundedWorkTime / 60,
            work.servicePlan.hourlyRate,
            work.servicePlan?.tariffingPeriod || 20,
          )
        : 0;

      csvData.push([
        formatShortDate(work.startedAt || work.createdAt),
        work.company?.name || "",
        work.servicePlan?.name || "",
        work.description || work.name || "",
        workTime > 0 ? msToHMS(workTime * 60 * 1000) : "",
        roundedWorkTime > 0 ? msToHMS(roundedWorkTime * 60 * 1000) : "",
        work.overtime?.formatted || "",
        work.status || "pending",
        cost > 0 ? cost.toFixed(2) : "",
      ]);
    });

    const csvContent = csvData
      .map((row) => row.map((field) => `"${field}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  const downloadExcel = (_data, _options, _filename) => {
    console.log("Excel export not implemented yet");
  };

  const downloadPDF = (_data, _options, _filename) => {
    console.log("PDF export not implemented yet");
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      approved: { variant: "success", text: "Утверждён" },
      awaitingPayment: { variant: "warning", text: "Ожидает оплаты" },
      pending: { variant: "secondary", text: "В ожидании" },
      preview: { variant: "info", text: "Превью" },
      rejected: { variant: "danger", text: "Отклонён" },
    };

    return statusMap[status] || { variant: "secondary", text: status };
  };

  const handleViewWorkDetails = (work) => {
    setSelectedWork(work);
    setShowWorkModal(true);
  };

  const handleCloseWorkModal = () => {
    setShowWorkModal(false);
    setSelectedWork(null);
  };

  const filterAndSortWorks = (works) => {
    let filtered = works;

    // Filter by status
    if (filterStatus !== "all") {
      filtered = filtered.filter((work) => work.status === filterStatus);
    }

    // Sort works
    filtered.sort((a, b) => {
      let aValue, bValue;

      switch (sortBy) {
        case "date":
          aValue = new Date(a.startedAt || a.createdAt);
          bValue = new Date(b.startedAt || b.createdAt);
          break;
        case "company":
          aValue = a.company?.name || "";
          bValue = b.company?.name || "";
          break;
        case "earnings":
          aValue = a.servicePlan?.hourlyRate
            ? calculateCost(
                (a.roundedWorkTime || 0) / 60,
                a.servicePlan.hourlyRate,
                a.servicePlan?.tariffingPeriod || 20,
              )
            : 0;
          bValue = b.servicePlan?.hourlyRate
            ? calculateCost(
                (b.roundedWorkTime || 0) / 60,
                b.servicePlan.hourlyRate,
                b.servicePlan?.tariffingPeriod || 20,
              )
            : 0;
          break;
        case "workTime":
          aValue = a.workTime || 0;
          bValue = b.workTime || 0;
          break;
        default:
          return 0;
      }

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return filtered;
  };

  const renderStatsCards = () => {
    if (!data) return null;

    return (
      <Row className="mb-4">
        <Col md={3}>
          <Card className="text-center h-100 border-primary">
            <Card.Body>
              <RiFileList3Line className="display-4 text-primary mb-2" />
              <h5 className="card-title">Всего работ</h5>
              <h3 className="text-primary">{processedData.stats.totalWorks}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 border-success">
            <Card.Body>
              <RiMoneyDollarCircleLine className="display-4 text-success mb-2" />
              <h5 className="card-title">Заработано</h5>
              <h3 className="text-success">
                {formatPrice(processedData.totalEarnings)}
              </h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 border-info">
            <Card.Body>
              <RiTimeLine className="display-4 text-info mb-2" />
              <h5 className="card-title">Время работы</h5>
              <h3 className="text-info">
                {msToHMS(processedData.totalRoundedWorkTime * 60 * 1000)}
              </h3>
              <small className="text-muted">
                Фактическое: {msToHMS(processedData.totalWorkTime * 60 * 1000)}
              </small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 border-warning">
            <Card.Body>
              <RiBarChart2Line className="display-4 text-warning mb-2" />
              <h5 className="card-title">Переработки</h5>
              <h3 className="text-warning">
                {processedData.formattedTotalOvertime}
              </h3>
              <small className="text-muted">
                {processedData.totalOvertimeWorks} работ
              </small>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    );
  };

  const renderProgressStats = () => {
    if (!data || processedData.stats.totalWorks === 0) return null;

    const approvedPercent =
      (processedData.stats.approvedWorks / processedData.stats.totalWorks) *
      100;
    const pendingPercent =
      (processedData.stats.pendingWorks / processedData.stats.totalWorks) * 100;
    const rejectedPercent =
      (processedData.stats.rejectedWorks / processedData.stats.totalWorks) *
      100;

    return (
      <Card className="mb-4">
        <Card.Header>
          <h5 className="mb-0">Статистика по статусам</h5>
        </Card.Header>
        <Card.Body>
          <Row>
            <Col md={4}>
              <div className="mb-3">
                <div className="d-flex justify-content-between">
                  <span>Утверждено</span>
                  <span>{processedData.stats.approvedWorks}</span>
                </div>
                <ProgressBar variant="success" now={approvedPercent} />
              </div>
            </Col>
            <Col md={4}>
              <div className="mb-3">
                <div className="d-flex justify-content-between">
                  <span>В ожидании</span>
                  <span>{processedData.stats.pendingWorks}</span>
                </div>
                <ProgressBar variant="secondary" now={pendingPercent} />
              </div>
            </Col>
            <Col md={4}>
              <div className="mb-3">
                <div className="d-flex justify-content-between">
                  <span>Отклонено</span>
                  <span>{processedData.stats.rejectedWorks}</span>
                </div>
                <ProgressBar variant="danger" now={rejectedPercent} />
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>
    );
  };

  const renderWorkTable = (works, title, isPreview = false) => {
    const filteredWorks = filterAndSortWorks(works);

    if (!works || works.length === 0) {
      return (
        <Alert variant="secondary" className="text-center">
          {isPreview
            ? "Предварительные работы не найдены"
            : "Работы не найдены"}
        </Alert>
      );
    }

    return (
      <Card className="mb-4">
        <Card.Header>
          <Row className="align-items-center">
            <Col>
              <h5 className="mb-0 d-flex align-items-center">
                {isPreview ? (
                  <RiTimelineView className="me-2" />
                ) : (
                  <RiFileList3Line className="me-2" />
                )}
                {title}
                <Badge bg="primary" className="ms-2">
                  {filteredWorks.length} / {works.length}
                </Badge>
              </h5>
            </Col>
            <Col xs="auto">
              <div className="d-flex gap-2">
                <Dropdown>
                  <Dropdown.Toggle variant="outline-secondary" size="sm">
                    <FaFilter className="me-1" />
                    Статус:{" "}
                    {filterStatus === "all"
                      ? "Все"
                      : getStatusBadge(filterStatus).text}
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item onClick={() => setFilterStatus("all")}>
                      Все
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => setFilterStatus("approved")}>
                      Утверждён
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => setFilterStatus("pending")}>
                      В ожидании
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => setFilterStatus("rejected")}>
                      Отклонён
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>

                <Dropdown>
                  <Dropdown.Toggle variant="outline-secondary" size="sm">
                    Сортировка
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item
                      onClick={() => {
                        setSortBy("date");
                        setSortOrder("desc");
                      }}
                    >
                      По дате (новые)
                    </Dropdown.Item>
                    <Dropdown.Item
                      onClick={() => {
                        setSortBy("date");
                        setSortOrder("asc");
                      }}
                    >
                      По дате (старые)
                    </Dropdown.Item>
                    <Dropdown.Item
                      onClick={() => {
                        setSortBy("company");
                        setSortOrder("asc");
                      }}
                    >
                      По компании
                    </Dropdown.Item>
                    <Dropdown.Item
                      onClick={() => {
                        setSortBy("earnings");
                        setSortOrder("desc");
                      }}
                    >
                      По доходу
                    </Dropdown.Item>
                    <Dropdown.Item
                      onClick={() => {
                        setSortBy("workTime");
                        setSortOrder("desc");
                      }}
                    >
                      По времени работы
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </div>
            </Col>
          </Row>
        </Card.Header>
        <Card.Body className="p-0">
          <div className="table-responsive">
            <Table striped hover className="mb-0">
              <thead className="table-dark">
                <tr>
                  <th>Дата</th>
                  <th>Компания</th>
                  <th>Тариф</th>
                  <th>Описание</th>
                  <th>Время работы</th>
                  <th>Округленное</th>
                  {!isPreview && <th>Переработка</th>}
                  <th>Статус</th>
                  {!isPreview && <th>Стоимость</th>}
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorks.map((work, index) => {
                  const workTime = work.workTime || 0;
                  const roundedWorkTime = work.roundedWorkTime || 0;
                  const cost = work.servicePlan?.hourlyRate
                    ? calculateCost(
                        roundedWorkTime / 60,
                        work.servicePlan.hourlyRate,
                        work.servicePlan?.tariffingPeriod || 20,
                      )
                    : 0;

                  return (
                    <tr key={work._id || index}>
                      <td>
                        <div className="fw-bold">
                          {formatShortDate(work.startedAt || work.createdAt)}
                        </div>
                        <small className="text-muted">
                          {work.startedAt &&
                            new Date(work.startedAt).toLocaleTimeString(
                              "ru-RU",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                        </small>
                      </td>
                      <td>
                        <div className="fw-bold">
                          {work.company?.alias || "—"}
                        </div>
                      </td>
                      <td>
                        <div>{work.servicePlan?.name || "—"}</div>
                        <small className="text-muted">
                          {work.servicePlan?.hourlyRate
                            ? `${work.servicePlan.hourlyRate}₽/ч`
                            : ""}
                        </small>
                      </td>
                      <td>
                        <div
                          style={{ maxWidth: "200px", wordWrap: "break-word" }}
                        >
                          {work.description || work.name || "—"}
                        </div>
                      </td>
                      <td>
                        <div className="fw-bold">
                          {workTime > 0 ? msToHMS(workTime * 60 * 1000) : "—"}
                        </div>
                        {workTime > 0 && (
                          <small className="text-muted">{workTime} мин</small>
                        )}
                      </td>
                      <td>
                        <div className="fw-bold text-info">
                          {roundedWorkTime > 0
                            ? msToHMS(roundedWorkTime * 60 * 1000)
                            : "—"}
                        </div>
                        {roundedWorkTime > 0 && (
                          <small className="text-muted">
                            {roundedWorkTime} мин
                          </small>
                        )}
                      </td>
                      {!isPreview && (
                        <td>
                          {work.overtime?.formatted ? (
                            <div>
                              <div className="fw-bold text-warning">
                                {work.overtime.formatted}
                              </div>
                              <small className="text-muted">
                                Факт:{" "}
                                {formatOvertimeMinutes(
                                  work.overtime.actualMinutes || 0,
                                )}
                              </small>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td>
                        <Badge
                          bg={getStatusBadge(work.status || "pending").variant}
                        >
                          {getStatusBadge(work.status || "pending").text}
                        </Badge>
                      </td>
                      {!isPreview && (
                        <td>
                          <div className="fw-bold text-success">
                            {cost > 0 ? formatPrice(cost) : "—"}
                          </div>
                        </td>
                      )}
                      <td>
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleViewWorkDetails(work)}
                          title="Просмотр деталей"
                        >
                          <RiEyeLine />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    );
  };

  return (
    <Transitions>
      <div className="container-fluid">
        <Row className="mb-4">
          <Col>
            <h1 className="display-4 mb-0 d-flex align-items-center">
              <RiUserLine className="me-3 text-primary" />
              Личный отчёт
            </h1>
            <p className="lead text-muted">
              Анализ выполненных работ и доходов за выбранный период
            </p>
          </Col>
        </Row>

        {/* Date Navigation */}
        <Card className="mb-4 shadow-sm">
          <Card.Body>
            <Row className="align-items-center">
              <Col md={6}>
                <div className="d-flex align-items-center">
                  <Button
                    variant="outline-primary"
                    onClick={handlePrevMonth}
                    disabled={fetcher.state === "submitting"}
                  >
                    <FaAngleLeft />
                  </Button>
                  <span className="px-3 fw-bold fs-5">
                    {date
                      .toLocaleDateString("ru-RU", {
                        month: "long",
                        year: "numeric",
                      })
                      .toUpperCase()}
                  </span>
                  <Button
                    variant="outline-primary"
                    onClick={handleNextMonth}
                    disabled={fetcher.state === "submitting"}
                  >
                    <FaAngleRight />
                  </Button>
                </div>
              </Col>
              <Col md={6}>
                <ButtonGroup className="w-100">
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
                    Предыдущий
                  </Button>
                  <Button
                    variant={
                      selectedPeriod === "last30days"
                        ? "primary"
                        : "outline-primary"
                    }
                    onClick={() => setPeriod("last30days")}
                  >
                    30 дней
                  </Button>
                </ButtonGroup>
              </Col>
            </Row>

            <Row className="mt-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>От</Form.Label>
                  <Form.Control
                    type="date"
                    ref={fromInputRef}
                    onChange={handleCustomDateChange}
                    disabled={fetcher.state === "submitting"}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label>До</Form.Label>
                  <Form.Control
                    type="date"
                    ref={toInputRef}
                    onChange={handleCustomDateChange}
                    disabled={fetcher.state === "submitting"}
                  />
                </Form.Group>
              </Col>
              <Col md={4} className="d-flex align-items-end">
                <Button
                  variant="success"
                  onClick={() => generateReport()}
                  disabled={fetcher.state === "submitting"}
                  className="w-100"
                >
                  {fetcher.state === "submitting" ? (
                    <>
                      <Spinner size="sm" className="me-2" />
                      Загрузка...
                    </>
                  ) : (
                    <>
                      <RiBarChart2Line className="me-2" />
                      Сформировать отчёт
                    </>
                  )}
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Statistics Cards */}
        {renderStatsCards()}

        {/* Progress Stats */}
        {renderProgressStats()}

        {/* Export Button Row */}
        {data && (
          <Card className="mb-4 shadow-sm">
            <Card.Header className="bg-light">
              <h5 className="mb-0 d-flex align-items-center">
                <FaDownload className="me-2" />
                Экспорт отчёта
              </h5>
            </Card.Header>
            <Card.Body>
              <ExportReport
                data={processedData}
                dateRange={{
                  from: fromInputRef.current?.value,
                  to: toInputRef.current?.value,
                }}
                onExport={handleExport}
              />
            </Card.Body>
          </Card>
        )}

        {/* Calendar */}
        {data && (
          <div className="mb-4">
            <WorkCalendar
              works={processedData.completedWorks}
              selectedMonth={date}
            />
          </div>
        )}

        {fetcher.state === "submitting" && (
          <Card className="text-center py-5">
            <Card.Body>
              <Spinner size="lg" />
              <h5 className="mt-3">Загрузка отчёта...</h5>
              <p className="text-muted">
                Обрабатываем данные за выбранный период
              </p>
            </Card.Body>
          </Card>
        )}

        {data && fetcher.state === "idle" && (
          <Accordion defaultActiveKey={["0", "1"]} alwaysOpen>
            {/* Completed Works */}
            <Accordion.Item eventKey="0">
              <Accordion.Header>
                <div className="d-flex align-items-center">
                  <RiFileList3Line className="me-2" />
                  Выполненные работы
                  <Badge bg="primary" className="ms-2">
                    {processedData.completedWorks.length}
                  </Badge>
                  {processedData.totalEarnings > 0 && (
                    <Badge bg="success" className="ms-2">
                      {formatPrice(processedData.totalEarnings)}
                    </Badge>
                  )}
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-0">
                {renderWorkTable(
                  processedData.completedWorks,
                  "Выполненные работы",
                  false,
                )}
              </Accordion.Body>
            </Accordion.Item>

            {/* Preview Works */}
            <Accordion.Item eventKey="1">
              <Accordion.Header>
                <div className="d-flex align-items-center">
                  <RiTimelineView className="me-2" />
                  Работы на утверждение
                  <Badge bg="info" className="ms-2">
                    {processedData.previewWorks.length}
                  </Badge>
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-0">
                {renderWorkTable(
                  processedData.previewWorks,
                  "Работы на утверждение",
                  true,
                )}
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
        )}

        {!data && fetcher.state === "idle" && (
          <Card className="text-center py-5">
            <Card.Body>
              <RiCalendarLine className="display-1 text-muted mb-3" />
              <h4>Добро пожаловать в личный отчёт!</h4>
              <p className="text-muted mb-4">
                Выберите период и нажмите "Сформировать отчёт" для просмотра
                ваших работ, переработок и доходов.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => generateReport()}
              >
                <RiBarChart2Line className="me-2" />
                Создать первый отчёт
              </Button>
            </Card.Body>
          </Card>
        )}

        {data && data.error && (
          <Alert variant="danger" className="text-center">
            <h5>Ошибка загрузки данных</h5>
            <p>{data.error}</p>
            <Button variant="outline-danger" onClick={() => generateReport()}>
              Попробовать снова
            </Button>
          </Alert>
        )}

        {/* Work Details Modal */}
        <WorkDetailsModal
          show={showWorkModal}
          onHide={handleCloseWorkModal}
          work={selectedWork}
        />
      </div>
    </Transitions>
  );
};

export default PersonalReport;

export async function loader() {
  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const fromDate = data.get("fromDate");
  const toDate = data.get("toDate");

  try {
    // Get completed works
    const completedWorksResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-report?from=${fromDate}&to=${toDate}`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    // Get preview works
    const previewWorksResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-preview?from=${fromDate}&to=${toDate}`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    const completedWorks = completedWorksResponse.ok
      ? await completedWorksResponse.json()
      : { works: [] };

    const previewWorks = previewWorksResponse.ok
      ? await previewWorksResponse.json()
      : { works: [] };

    return {
      completedWorks: completedWorks.works || [],
      previewWorks: previewWorks.works || [],
      fromDate,
      toDate,
    };
  } catch (error) {
    console.error("Error fetching personal report:", error);
    return {
      completedWorks: [],
      previewWorks: [],
      fromDate,
      toDate,
      error: "Ошибка загрузки данных",
    };
  }
}
