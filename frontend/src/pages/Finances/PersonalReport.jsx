import { useContext, useState } from "react";
import {
  redirect,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { endOfMonth, format, startOfMonth } from "date-fns";

import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip as ChartTooltip,
} from "chart.js";

import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import ProgressBar from "react-bootstrap/ProgressBar";
import Row from "react-bootstrap/Row";

import { RiRefreshLine, RiUserLine } from "react-icons/ri";

import Transitions from "../../animations/Transition";
import Forbidden from "../../components/Error/403";
import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";

import CompanyLoadCard from "../../components/Finances/Personal/CompanyLoadCard";
import EmployeePicker from "../../components/Finances/Personal/EmployeePicker";
import ExportPersonalReport from "../../components/Finances/Personal/ExportPersonalReport";
import KpiCards from "../../components/Finances/Personal/KpiCards";
import PayrollCard from "../../components/Finances/Personal/PayrollCard";
import PeriodToolbar from "../../components/Finances/Personal/PeriodToolbar";
import TimeByDayChart from "../../components/Finances/Personal/TimeByDayChart";
import WorkCalendar from "../../components/Finances/Personal/WorkCalendar";
import WorkDetailsModal from "../../components/Finances/Personal/WorkDetailsModal";
import WorksTable from "../../components/Finances/Personal/WorksTable";
import {
  WORK_STATUS_META,
  formatMinutes,
} from "../../components/Finances/Personal/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartTooltip, Legend);

const STATUS_BAR_ORDER = [
  "approved",
  "underReview",
  "pendingApproval",
  "preview",
  "declined",
  "none",
];

const StatusBreakdownCard = ({ byStatus, worksCount }) => {
  const entries = STATUS_BAR_ORDER.filter((status) => byStatus[status]);
  if (!entries.length) {
    return null;
  }
  return (
    <Card>
      <Card.Header>Статусы работ в биллинге</Card.Header>
      <Card.Body>
        <ProgressBar className="mb-3" style={{ height: "10px" }}>
          {entries.map((status) => (
            <ProgressBar
              key={status}
              variant={WORK_STATUS_META[status].variant}
              now={(byStatus[status].count / worksCount) * 100}
            />
          ))}
        </ProgressBar>
        <div className="d-flex flex-column gap-1">
          {entries.map((status) => (
            <div
              key={status}
              className="d-flex justify-content-between align-items-center small"
            >
              <span>
                <Badge
                  bg={WORK_STATUS_META[status].variant}
                  className="me-2 fw-normal"
                >
                  {" "}
                </Badge>
                {WORK_STATUS_META[status].label}
              </span>
              <span className="pr-num">
                {byStatus[status].count} ·{" "}
                {formatMinutes(byStatus[status].minutes)}
              </span>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
};

const scheduleSummary = (schedule) => {
  if (!schedule) {
    return "";
  }
  const workingDays = Object.values(schedule).filter(
    (day) => day?.isWorking,
  ).length;
  const monday = schedule.Monday;
  const hours =
    monday?.isWorking && monday.start && monday.end
      ? ` ${monday.start}–${monday.end}`
      : "";
  return `${workingDays} дн/нед${hours}`;
};

const SettingsFootnote = ({ settings, period, warnings }) => (
  <Card className="mb-3">
    <Card.Body className="small text-body-secondary">
      Переработки считаются идентично сводному финансовому отчёту: график и шаг
      округления — из тарифа компании; для работ вне тарифов — резервный график
      ({scheduleSummary(settings.defaultSchedule)}, шаг{" "}
      {settings.defaultTariffingPeriodMinutes} мин). Коэффициенты оплаты: будни
      ×{settings.weekdayCoefficient}, выходные ×{settings.weekendCoefficient}.
      Часовой пояс: {period.timezone}.
      {warnings.fallbackScheduleWorks > 0 && (
        <div className="mt-1">
          Работ на резервном графике: {warnings.fallbackScheduleWorks}.
        </div>
      )}
      {warnings.overlapMinutes > 0 && (
        <div className="mt-1">
          Пересечения работ по времени:{" "}
          {formatMinutes(warnings.overlapMinutes)} (время в пересечениях учтено
          в каждой работе).
        </div>
      )}
      {warnings.excludedWorks > 0 && (
        <div className="mt-1 text-warning">
          Работ с некорректным временем, исключённых из подсчёта:{" "}
          {warnings.excludedWorks}.
        </div>
      )}
    </Card.Body>
  </Card>
);

const PersonalReport = () => {
  const { report, employees, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const {
    isAdmin,
    permissions = {},
    _id: selfId,
  } = useContext(AuthedUserContext);

  const [selectedWork, setSelectedWork] = useState(null);

  const allowed =
    isAdmin ||
    permissions.canSeePersonalFinancialReport ||
    permissions.canSeeGlobalFinancialReport;
  if (!allowed) {
    return <Forbidden />;
  }

  const isLoading =
    navigation.state === "loading" || revalidator.state === "loading";

  const setPeriod = (from, to) => {
    const next = new URLSearchParams(searchParams);
    next.set("from", from);
    next.set("to", to);
    setSearchParams(next);
  };

  const setEmployee = (userId) => {
    const next = new URLSearchParams(searchParams);
    if (userId) {
      next.set("userId", userId);
    } else {
      next.delete("userId");
    }
    setSearchParams(next);
  };

  const employee = report?.employee;
  const daysWithWork = report
    ? report.byDay.filter((day) => day.minutes > 0).length
    : 0;

  return (
    <Transitions>
      <Card.Title className="mb-3 border-bottom">
        <h1 className="display-4">
          <RiUserLine /> Персональный отчёт
        </h1>
        {employee && (
          <p className="lead text-body-secondary">
            {employee.firstName} {employee.lastName}
            {employee.position && ` · ${employee.position}`}
            {!employee.isSelf && (
              <Badge bg="info" className="ms-2 fw-normal align-middle">
                просмотр отчёта сотрудника
              </Badge>
            )}
          </p>
        )}
      </Card.Title>

      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-center">
            <Col xs={12} xl={employees ? 8 : 12}>
              <PeriodToolbar
                from={report?.period.from || searchParams.get("from")}
                to={report?.period.to || searchParams.get("to")}
                onChange={setPeriod}
                disabled={isLoading}
              />
            </Col>
            {employees && (
              <Col xs={12} sm={8} md={6} xl={4}>
                <EmployeePicker
                  employees={employees}
                  selfId={selfId}
                  value={searchParams.get("userId")}
                  onChange={setEmployee}
                />
              </Col>
            )}
          </Row>
        </Card.Body>
      </Card>

      {error && (
        <Alert variant="danger" className="d-flex justify-content-between">
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline-danger"
            onClick={() => revalidator.revalidate()}
          >
            <RiRefreshLine /> Повторить
          </Button>
        </Alert>
      )}

      {report && (
        <div className={isLoading ? "pr-loading" : ""}>
          <KpiCards
            totals={report.totals}
            prevTotals={report.prevPeriod?.totals}
            daysWithWork={daysWithWork}
          />

          <Row className="g-3 mb-3">
            <Col xs={12} lg={4}>
              <PayrollCard
                payroll={report.payroll}
                employee={employee}
                canManageUsers={Boolean(isAdmin || permissions.canManageUsers)}
              />
            </Col>
            <Col xs={12} lg={8}>
              <TimeByDayChart byDay={report.byDay} />
            </Col>
          </Row>

          <CompanyLoadCard byCompany={report.byCompany} />

          <Row className="g-3 mb-3">
            <Col xs={12} lg={8}>
              <WorkCalendar
                byDay={report.byDay}
                schedule={report.settings.defaultSchedule}
                from={report.period.from}
                to={report.period.to}
              />
            </Col>
            <Col xs={12} lg={4}>
              <StatusBreakdownCard
                byStatus={report.totals.byStatus}
                worksCount={report.totals.worksCount}
              />
            </Col>
          </Row>

          {report.works.length > 0 ? (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                <h5 className="mb-0">Работы за период</h5>
                <ExportPersonalReport report={report} />
              </div>
              <WorksTable works={report.works} onSelect={setSelectedWork} />
            </>
          ) : (
            <Card className="mb-3">
              <Card.Body className="text-center text-body-secondary py-5">
                Работ за выбранный период не найдено. Измените период или
                выполните работы по заявкам — они появятся в отчёте.
              </Card.Body>
            </Card>
          )}

          <SettingsFootnote
            settings={report.settings}
            period={report.period}
            warnings={report.warnings}
          />
        </div>
      )}

      <WorkDetailsModal
        work={selectedWork}
        show={Boolean(selectedWork)}
        onHide={() => setSelectedWork(null)}
      />
    </Transitions>
  );
};

export default PersonalReport;

export async function loader({ request }) {
  document.title = "F1 HD | ПЕРСОНАЛЬНЫЙ ОТЧЁТ";

  const { token } = getLocalStorageData();
  if (!token) {
    return redirect("/auth");
  }

  const url = new URL(request.url);
  const now = new Date();
  const from =
    url.searchParams.get("from") || format(startOfMonth(now), "yyyy-MM-dd");
  const to =
    url.searchParams.get("to") || format(endOfMonth(now), "yyyy-MM-dd");
  const userId = url.searchParams.get("userId");

  const params = new URLSearchParams({ from, to });
  if (userId) {
    params.set("userId", userId);
  }

  const headers = { Authorization: "Bearer " + token };

  const [reportResponse, employeesResponse] = await Promise.all([
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/personal-report-summary?${params}`,
      { headers },
    ),
    // 403 здесь ожидаем у рядовых сотрудников — селектор просто не показываем
    fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/report-employees`,
      { headers },
    ),
  ]);

  if (reportResponse.status === 401) {
    return redirect("/auth");
  }

  let report = null;
  let error = null;
  if (reportResponse.ok) {
    report = await reportResponse.json();
  } else {
    const body = await reportResponse.json().catch(() => ({}));
    error = body.message || "Не удалось загрузить отчёт. Попробуйте ещё раз.";
  }

  const employees = employeesResponse.ok
    ? await employeesResponse.json()
    : null;

  return { report, employees, error };
}
