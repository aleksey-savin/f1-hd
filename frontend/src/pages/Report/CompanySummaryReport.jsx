import pad from "pad";

import { useState, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  ArcElement,
} from "chart.js";

import { RiBarChart2Line, RiToggleLine } from "react-icons/ri";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  ArcElement,
);

import useHttp from "../../hooks/use-http";

import Transitions from "../../animations/Transition";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";

import Spinner from "../../animations/Spinner";

import { getLocalStorageData } from "../../util/auth";

// Import separate components
import {
  CompanyTimeChart,
  CompanyDistributionChart,
  EmployeeCharts,
  EmployeeCompanyDistribution,
  CompanySummaryTable,
  ExecutorDetailsAccordion,
  ExportButtons,
  TrendLineChart,
  TrendTable,
  TrendMetrics,
} from "../../components/Reports";

const CompanySummaryReport = () => {
  const { token } = getLocalStorageData();

  const fromInputRef = useRef();
  const toInputRef = useRef();

  const [reportData, setReportData] = useState(null);
  const [showCharts, setShowCharts] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [viewType, setViewType] = useState("companies"); // "companies" or "employees"
  const [chartsLoading, setChartsLoading] = useState(false);
  const [reportMode, setReportMode] = useState("summary"); // "summary" or "trends"
  const [trendsData, setTrendsData] = useState(null);
  const [showCustomDates, setShowCustomDates] = useState(false);

  // Refs for trends analysis
  const periodTypeRef = useRef();
  const groupingRef = useRef();
  const customStartDateRef = useRef();
  const customEndDateRef = useRef();

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized = [
      pad(2, hours.toString(), "0"),
      pad(2, minutes.toString(), "0"),
    ].join(":");

    return humanized;
  };

  const { isLoading, sendRequest: generateReportHandler } = useHttp();
  const { isLoading: trendsLoading, sendRequest: generateTrendsHandler } =
    useHttp();

  const submitHandler = (event) => {
    event.preventDefault();

    if (reportMode === "summary") {
      const filterData = {
        from: fromInputRef.current.value,
        to: toInputRef.current.value,
      };

      generateReportHandler(
        {
          url: `${import.meta.env.VITE_API_ADDRESS}/api/report/company-summary`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: filterData,
        },
        (data) => {
          setReportData(data);
          setTrendsData(null); // Clear trends data
          setChartsLoading(true);
          // Simulate chart rendering delay
          setTimeout(() => setChartsLoading(false), 500);
        },
      );
    } else if (reportMode === "trends") {
      const periodType = periodTypeRef.current.value;
      const grouping = groupingRef.current.value;

      let trendsFilterData = {
        period: periodType,
        grouping: grouping,
      };

      if (periodType === "custom") {
        trendsFilterData.startDate = customStartDateRef.current.value;
        trendsFilterData.endDate = customEndDateRef.current.value;
      }

      generateTrendsHandler(
        {
          url: `${import.meta.env.VITE_API_ADDRESS}/api/report/trends-analysis`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: trendsFilterData,
        },
        (data) => {
          setTrendsData(data);
          setReportData(null); // Clear summary data
          setChartsLoading(true);
          // Simulate chart rendering delay
          setTimeout(() => setChartsLoading(false), 500);
        },
      );
    }
  };

  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const handleModeChange = (mode) => {
    setReportMode(mode);
    setReportData(null);
    setTrendsData(null);
  };

  return (
    <Transitions>
      <>
        <style>{`
          .sortable-table .sortable-header:hover {
            background-color: rgba(0,123,255,0.1) !important;
          }
          .sort-icon {
            margin-left: 5px;
            font-size: 0.8em;
            opacity: 0.7;
          }
          .sortable-header {
            position: relative;
          }
          .sortable-header:hover .sort-icon {
            opacity: 1;
          }
        `}</style>

        <Card.Title className="mb-3 border-bottom">
          <h1 className="display-4">
            <RiBarChart2Line /> Аналитика
          </h1>
        </Card.Title>
        <Form onSubmit={submitHandler}>
          <Row className="mb-3">
            <Col sm="auto">
              <Form.Group>
                <Form.Label>Тип отчета</Form.Label>
                <Form.Select
                  value={reportMode}
                  onChange={(e) => handleModeChange(e.target.value)}
                  className="mb-2"
                >
                  <option value="summary">Сводный отчет</option>
                  <option value="trends">Анализ трендов</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {reportMode === "summary" && (
            <Row>
              <Col sm="auto">
                <Form.Group className="mb-3">
                  <Form.Label>Начало периода</Form.Label>
                  <Form.Control type="date" ref={fromInputRef} required />
                </Form.Group>
              </Col>
              <Col sm="auto">
                <Form.Group className="mb-3">
                  <Form.Label>Конец периода</Form.Label>
                  <Form.Control type="date" ref={toInputRef} required />
                </Form.Group>
              </Col>
            </Row>
          )}

          {reportMode === "trends" && (
            <Row>
              <Col sm="auto">
                <Form.Group className="mb-3">
                  <Form.Label>Период анализа</Form.Label>
                  <Form.Select
                    ref={periodTypeRef}
                    required
                    defaultValue="12months"
                    onChange={(e) =>
                      setShowCustomDates(e.target.value === "custom")
                    }
                  >
                    <option value="12months">Последние 12 месяцев</option>
                    <option value="currentYear">Текущий год</option>
                    <option value="lastYear">Прошлый год</option>
                    <option value="custom">Произвольный период</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col sm="auto">
                <Form.Group className="mb-3">
                  <Form.Label>Группировка</Form.Label>
                  <Form.Select ref={groupingRef} required defaultValue="month">
                    <option value="month">По месяцам</option>
                    <option value="quarter">По кварталам</option>
                    <option value="week">По неделям</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              {showCustomDates && (
                <>
                  <Col sm="auto">
                    <Form.Group className="mb-3">
                      <Form.Label>Начальная дата</Form.Label>
                      <Form.Control
                        type="date"
                        ref={customStartDateRef}
                        required
                      />
                    </Form.Group>
                  </Col>
                  <Col sm="auto">
                    <Form.Group className="mb-3">
                      <Form.Label>Конечная дата</Form.Label>
                      <Form.Control
                        type="date"
                        ref={customEndDateRef}
                        required
                      />
                    </Form.Group>
                  </Col>
                </>
              )}
            </Row>
          )}

          <Row className="mb-3">
            <Col sm="auto">
              <Form.Group>
                <Button
                  type="submit"
                  className="mb-2 w-100"
                  disabled={isLoading || trendsLoading}
                >
                  Сформировать отчёт
                </Button>
              </Form.Group>
            </Col>
            {reportData && reportMode === "summary" && (
              <>
                <ExportButtons reportData={reportData} msToHMS={msToHMS} />
                <Col sm="auto">
                  <Form.Group>
                    <Form.Select
                      value={viewType}
                      onChange={(e) => setViewType(e.target.value)}
                      className="mb-2"
                    >
                      <option value="companies">По компаниям</option>
                      <option value="employees">По сотрудникам</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col sm="auto">
                  <Form.Group>
                    <Button
                      variant="outline-info"
                      className="mb-2 w-100"
                      onClick={() => setShowCharts(!showCharts)}
                    >
                      <RiToggleLine /> {showCharts ? "Скрыть" : "Показать"}{" "}
                      графики
                    </Button>
                  </Form.Group>
                </Col>
              </>
            )}
            {trendsData && reportMode === "trends" && (
              <Col sm="auto">
                <Form.Group>
                  <Button
                    variant="outline-info"
                    className="mb-2 w-100"
                    onClick={() => setShowCharts(!showCharts)}
                  >
                    <RiToggleLine /> {showCharts ? "Скрыть" : "Показать"}{" "}
                    графики
                  </Button>
                </Form.Group>
              </Col>
            )}
          </Row>
        </Form>

        {(isLoading || trendsLoading) && <Spinner />}

        {reportData && !isLoading && reportMode === "summary" && (
          <Transitions>
            <Row className="mb-4">
              <Col>
                <h4>
                  Период: {reportData.period.from} - {reportData.period.to}
                </h4>
              </Col>
            </Row>

            {showCharts && viewType === "companies" && (
              <>
                <Row className="mb-4">
                  <Col lg={12}>
                    <CompanyTimeChart
                      data={reportData}
                      isLoading={chartsLoading}
                    />
                  </Col>
                </Row>
                <Row className="mb-4">
                  <Col lg={12}>
                    <CompanyDistributionChart
                      data={reportData}
                      isLoading={chartsLoading}
                    />
                  </Col>
                </Row>
              </>
            )}

            {showCharts && viewType === "employees" && (
              <EmployeeCharts data={reportData} isLoading={chartsLoading} />
            )}

            {viewType === "companies" && (
              <>
                <Row>
                  <Col>
                    <CompanySummaryTable
                      data={reportData}
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      msToHMS={msToHMS}
                    />
                  </Col>
                </Row>

                <Row>
                  <Col>
                    <h4 className="mb-3">Детализация по исполнителям</h4>
                    <ExecutorDetailsAccordion
                      companies={reportData.companies}
                      msToHMS={msToHMS}
                    />
                  </Col>
                </Row>
              </>
            )}

            {viewType === "employees" && (
              <Row>
                <Col>
                  <h4 className="mb-3">Детализация по сотрудникам</h4>
                  <EmployeeCompanyDistribution
                    data={reportData}
                    isLoading={false}
                    msToHMS={msToHMS}
                    showChart={showCharts}
                  />
                </Col>
              </Row>
            )}
          </Transitions>
        )}

        {trendsData && !trendsLoading && reportMode === "trends" && (
          <Transitions>
            <Row className="mb-4">
              <Col>
                <h4>
                  Анализ трендов:{" "}
                  {trendsData.meta?.grouping === "month"
                    ? "по месяцам"
                    : trendsData.meta?.grouping === "quarter"
                      ? "по кварталам"
                      : "по неделям"}
                </h4>
              </Col>
            </Row>

            {showCharts && (
              <>
                <TrendLineChart
                  data={trendsData}
                  isLoading={chartsLoading}
                  metric="totalTime"
                  title="Динамика времени работ"
                />

                <TrendLineChart
                  data={trendsData}
                  isLoading={chartsLoading}
                  metric="totalTickets"
                  title="Динамика количества заявок"
                />

                <TrendLineChart
                  data={trendsData}
                  isLoading={chartsLoading}
                  metric="onSiteCount"
                  title="Динамика выездов"
                />

                <TrendLineChart
                  data={trendsData}
                  isLoading={chartsLoading}
                  metric="remoteCount"
                  title="Динамика удаленных работ"
                />
              </>
            )}

            <TrendTable data={trendsData} msToHMS={msToHMS} />
          </Transitions>
        )}

        {reportData &&
          reportData.companies.length === 0 &&
          !isLoading &&
          reportMode === "summary" && (
            <Row>
              <Col>
                <Card>
                  <Card.Body className="text-center">
                    <p className="text-muted">
                      За выбранный период данных не найдено
                    </p>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}
      </>
    </Transitions>
  );
};

export default CompanySummaryReport;

export async function loader() {
  document.title = "АНАЛИТИКА";

  // Возвращаем пустой объект, так как форм-данные нам не нужны
  return {};
}
