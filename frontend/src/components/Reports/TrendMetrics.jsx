import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import {
  RiArrowUpLine,
  RiArrowDownLine,
  RiSubtractLine,
  RiBarChartLine,
} from "react-icons/ri";

const TrendMetrics = ({ data, msToHMS }) => {
  if (!data || !data.data || data.data.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center">
          <p className="text-muted">Нет данных для отображения</p>
        </Card.Body>
      </Card>
    );
  }

  // Функция для расчета общих метрик по всем компаниям
  const calculateOverallMetrics = () => {
    const allPeriods = data.data.flatMap((company) => company.periods);

    // Группируем периоды по ключу (дата)
    const periodGroups = {};
    allPeriods.forEach((period) => {
      if (!periodGroups[period.key]) {
        periodGroups[period.key] = {
          label: period.label,
          totalWorks: 0,
          totalTickets: 0,
          totalTime: 0,
          onSiteCount: 0,
          remoteCount: 0,
          onSiteTime: 0,
          remoteTime: 0,
          routineTaskCount: 0,
          routineTaskTime: 0,
        };
      }

      periodGroups[period.key].totalWorks += period.totalWorks;
      periodGroups[period.key].totalTickets += period.totalTickets;
      periodGroups[period.key].totalTime += period.totalTime;
      periodGroups[period.key].onSiteCount += period.onSite?.count || 0;
      periodGroups[period.key].remoteCount += period.remote?.count || 0;
      periodGroups[period.key].onSiteTime += period.onSite?.time || 0;
      periodGroups[period.key].remoteTime += period.remote?.time || 0;
      periodGroups[period.key].routineTaskCount +=
        period.routineTask?.count || 0;
      periodGroups[period.key].routineTaskTime += period.routineTask?.time || 0;
    });

    return Object.values(periodGroups).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  };

  // Функция для расчета изменения между первым и последним периодом
  const calculateTotalChange = (metric) => {
    const overallMetrics = calculateOverallMetrics();
    if (overallMetrics.length < 2) {
      return { value: 0, percentage: 0, direction: "same" };
    }

    const first = overallMetrics[0][metric];
    const last = overallMetrics[overallMetrics.length - 1][metric];

    if (!first || first === 0) {
      return { value: 0, percentage: 0, direction: "same" };
    }

    const change = last - first;
    const percentage = Math.round((change / first) * 100);
    const direction = change > 0 ? "up" : change < 0 ? "down" : "same";

    return { value: change, percentage, direction };
  };

  // Функция для расчета среднего значения
  const calculateAverage = (metric) => {
    const overallMetrics = calculateOverallMetrics();
    if (overallMetrics.length === 0) return 0;

    const total = overallMetrics.reduce(
      (sum, period) => sum + period[metric],
      0,
    );
    return Math.round(total / overallMetrics.length);
  };

  // Функция для поиска максимального значения
  const findMaxValue = (metric) => {
    const overallMetrics = calculateOverallMetrics();
    if (overallMetrics.length === 0) return { value: 0, period: null };

    const max = overallMetrics.reduce(
      (max, period) => {
        return period[metric] > max.value
          ? { value: period[metric], period: period.label }
          : max;
      },
      { value: 0, period: null },
    );

    return max;
  };

  // Функция для поиска минимального значения
  const findMinValue = (metric) => {
    const overallMetrics = calculateOverallMetrics();
    if (overallMetrics.length === 0) return { value: 0, period: null };

    const min = overallMetrics.reduce(
      (min, period) => {
        return period[metric] < min.value
          ? { value: period[metric], period: period.label }
          : min;
      },
      { value: Infinity, period: null },
    );

    return min.value === Infinity ? { value: 0, period: null } : min;
  };

  // Функция для рендера иконки изменения
  const renderChangeIcon = (direction) => {
    switch (direction) {
      case "up":
        return <RiArrowUpLine className="text-success me-1" />;
      case "down":
        return <RiArrowDownLine className="text-danger me-1" />;
      default:
        return <RiSubtractLine className="text-muted me-1" />;
    }
  };

  // Функция для форматирования значения
  const formatValue = (value, metric) => {
    if (metric.includes("Time")) {
      return msToHMS(value);
    }
    return value.toString();
  };

  // Метрики для отображения
  const metrics = [
    { key: "totalWorks", name: "Всего работ", icon: "🔧" },
    { key: "totalTickets", name: "Всего заявок", icon: "📋" },
    { key: "totalTime", name: "Общее время", icon: "⏱️" },
    { key: "onSiteCount", name: "Выезды", icon: "🚗" },
    { key: "remoteCount", name: "Удаленные", icon: "💻" },
    { key: "routineTaskCount", name: "Регламентные", icon: "🔄" },
    { key: "routineTaskTime", name: "Время регламентных", icon: "⏱️" },
  ];

  const overallMetrics = calculateOverallMetrics();
  const totalPeriods = overallMetrics.length;

  return (
    <Card className="mb-4">
      <Card.Header className="d-flex align-items-center">
        <RiBarChartLine className="me-2" />
        <h5 className="mb-0">Ключевые метрики</h5>
      </Card.Header>
      <Card.Body>
        <Row className="mb-3">
          <Col>
            <div className="text-center">
              <h6 className="text-muted mb-1">Период анализа</h6>
              <div>
                <Badge bg="info" className="me-2">
                  {data.meta?.grouping === "month"
                    ? "По месяцам"
                    : data.meta?.grouping === "quarter"
                      ? "По кварталам"
                      : "По неделям"}
                </Badge>
                <Badge bg="secondary">{totalPeriods} периодов</Badge>
              </div>
            </div>
          </Col>
        </Row>

        <Row>
          {metrics.map((metric) => {
            const totalChange = calculateTotalChange(metric.key);
            const average = calculateAverage(metric.key);
            const max = findMaxValue(metric.key);
            const min = findMinValue(metric.key);

            return (
              <Col key={metric.key} lg={4} md={6} className="mb-4">
                <Card className="h-100 border-0 shadow-sm">
                  <Card.Body>
                    <div className="d-flex align-items-center mb-2">
                      <span className="me-2" style={{ fontSize: "1.5em" }}>
                        {metric.icon}
                      </span>
                      <h6 className="mb-0">{metric.name}</h6>
                    </div>

                    <div className="mb-3">
                      <div className="d-flex align-items-center">
                        {renderChangeIcon(totalChange.direction)}
                        <span className="small">Общее изменение:</span>
                      </div>
                      <div className="d-flex align-items-center mt-1">
                        <Badge
                          bg={
                            totalChange.direction === "up"
                              ? "success"
                              : totalChange.direction === "down"
                                ? "danger"
                                : "secondary"
                          }
                          className="me-2"
                        >
                          {totalChange.direction === "up" ? "+" : ""}
                          {totalChange.percentage}%
                        </Badge>
                        <span className="small text-muted">
                          ({totalChange.direction === "up" ? "+" : ""}
                          {formatValue(Math.abs(totalChange.value), metric.key)}
                          )
                        </span>
                      </div>
                    </div>

                    <div className="row g-2 small">
                      <div className="col-12">
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Среднее:</span>
                          <strong>{formatValue(average, metric.key)}</strong>
                        </div>
                      </div>
                      <div className="col-12">
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Максимум:</span>
                          <div className="text-end">
                            <strong className="text-success">
                              {formatValue(max.value, metric.key)}
                            </strong>
                            {max.period && (
                              <div
                                className="text-muted"
                                style={{ fontSize: "0.75em" }}
                              >
                                {max.period}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="col-12">
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Минимум:</span>
                          <div className="text-end">
                            <strong className="text-danger">
                              {formatValue(min.value, metric.key)}
                            </strong>
                            {min.period && (
                              <div
                                className="text-muted"
                                style={{ fontSize: "0.75em" }}
                              >
                                {min.period}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card.Body>
    </Card>
  );
};

export default TrendMetrics;
