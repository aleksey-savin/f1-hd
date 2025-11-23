import { useState } from "react";
import Table from "react-bootstrap/Table";
import Card from "react-bootstrap/Card";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import { RiArrowUpLine, RiArrowDownLine, RiSubtractLine } from "react-icons/ri";

const TrendTable = ({ data, msToHMS }) => {
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [selectedMetric, setSelectedMetric] = useState("totalTime");

  if (!data || !data.data || data.data.length === 0) {
    return (
      <Card>
        <Card.Body className="text-center">
          <p className="text-muted">Нет данных для отображения</p>
        </Card.Body>
      </Card>
    );
  }

  // Получаем список компаний для фильтра
  const companies = data.data.map((company) => ({
    id: company.company._id,
    name: company.company.alias,
  }));

  // Фильтруем данные по выбранной компании
  const filteredData =
    selectedCompany === "all"
      ? data.data
      : data.data.filter((company) => company.company._id === selectedCompany);

  // Функция для получения значения метрики
  const getMetricValue = (period, metric) => {
    switch (metric) {
      case "totalWorks":
        return period.totalWorks;
      case "totalTickets":
        return period.totalTickets;
      case "totalTime":
        return period.totalTime;
      case "onSiteCount":
        return period.onSite?.count || 0;
      case "remoteCount":
        return period.remote?.count || 0;
      case "onSiteTime":
        return period.onSite?.time || 0;
      case "remoteTime":
        return period.remote?.time || 0;
      case "routineTaskCount":
        return period.routineTask?.count || 0;
      case "routineTaskTime":
        return period.routineTask?.time || 0;
      case "routineRatio": {
        const routineTime = period.routineTask?.time || 0;
        const totalTime = period.totalTime;
        return totalTime > 0 ? (routineTime / totalTime) * 100 : 0;
      }
      default:
        return 0;
    }
  };

  // Функция для форматирования значения
  const formatValue = (value, metric) => {
    if (metric.includes("Time")) {
      return msToHMS(value);
    }
    if (metric === "routineRatio") {
      return Math.round(value) + "%";
    }
    return value.toString();
  };

  // Функция для получения названия метрики
  const getMetricName = (metric) => {
    switch (metric) {
      case "totalWorks":
        return "Всего работ";
      case "totalTickets":
        return "Всего заявок";
      case "totalTime":
        return "Общее время";
      case "onSiteCount":
        return "Выезды";
      case "remoteCount":
        return "Удаленные";
      case "onSiteTime":
        return "Время выездов";
      case "remoteTime":
        return "Время удаленных";
      case "routineTaskCount":
        return "Регламентные работы";
      case "routineTaskTime":
        return "Время регламентных работ";
      case "routineRatio":
        return "Регламенты / инциденты";
      default:
        return metric;
    }
  };

  // Функция для расчета изменения относительно суммы всех предыдущих периодов
  const calculateChange = (current, allPrevious) => {
    if (!allPrevious || allPrevious.length === 0) {
      return { value: 0, percentage: 0, direction: "same" };
    }

    const sumPrevious = allPrevious.reduce((sum, val) => sum + val, 0);
    const averagePrevious = sumPrevious / allPrevious.length;

    if (averagePrevious === 0) {
      return { value: 0, percentage: 0, direction: "same" };
    }

    const change = current - averagePrevious;
    const percentage = Math.round((change / averagePrevious) * 100);
    const direction = change > 0 ? "up" : change < 0 ? "down" : "same";

    return { value: change, percentage, direction };
  };

  // Функция для рендера иконки изменения
  const renderChangeIcon = (direction) => {
    switch (direction) {
      case "up":
        return <RiArrowUpLine className="text-success" />;
      case "down":
        return <RiArrowDownLine className="text-danger" />;
      default:
        return <RiSubtractLine className="text-muted" />;
    }
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5>Таблица трендов</h5>
        <Row className="mt-2">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Компания</Form.Label>
              <Form.Select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
              >
                <option value="all">Все компании</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Показатель</Form.Label>
              <Form.Select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
              >
                <option value="totalWorks">Всего работ</option>
                <option value="totalTickets">Всего заявок</option>
                <option value="totalTime">Общее время</option>
                <option value="onSiteCount">Количество выездов</option>
                <option value="remoteCount">Количество удаленных</option>
                <option value="onSiteTime">Время выездов</option>
                <option value="remoteTime">Время удаленных</option>
                <option value="routineTaskCount">Регламентные работы</option>
                <option value="routineTaskTime">
                  Время регламентных работ
                </option>
                <option value="routineRatio">Регламенты / инциденты</option>
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>
      </Card.Header>
      <Card.Body className="p-0">
        <div className="table-responsive">
          <Table striped hover className="mb-0">
            <thead className="table-dark">
              <tr>
                {selectedCompany === "all" && <th>Компания</th>}
                <th>Период</th>
                <th className="text-end">{getMetricName(selectedMetric)}</th>
                <th className="text-center">Изменение</th>
                <th className="text-center">% от среднего</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((company) =>
                company.periods.map((period, periodIndex) => {
                  const currentValue = getMetricValue(period, selectedMetric);
                  const allPreviousValues =
                    periodIndex > 0
                      ? company.periods
                          .slice(0, periodIndex)
                          .map((p) => getMetricValue(p, selectedMetric))
                      : [];

                  const change = calculateChange(
                    currentValue,
                    allPreviousValues,
                  );

                  return (
                    <tr key={`${company.company._id}-${period.key}`}>
                      {selectedCompany === "all" && (
                        <td>
                          <strong>{company.company.alias}</strong>
                          <br />
                          <small className="text-muted">
                            {company.company.name}
                          </small>
                        </td>
                      )}
                      <td>
                        <strong>{period.label}</strong>
                      </td>
                      <td className="text-end">
                        <strong>
                          {formatValue(currentValue, selectedMetric)}
                        </strong>
                      </td>
                      <td className="text-center">
                        {allPreviousValues.length > 0 ? (
                          <div className="d-flex align-items-center justify-content-center">
                            {renderChangeIcon(change.direction)}
                            <span
                              className={`ms-1 ${
                                change.direction === "up"
                                  ? "text-success"
                                  : change.direction === "down"
                                    ? "text-danger"
                                    : "text-muted"
                              }`}
                            >
                              {change.direction !== "same" &&
                                formatValue(
                                  Math.abs(change.value),
                                  selectedMetric,
                                )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-center">
                        {allPreviousValues.length > 0 ? (
                          <Badge
                            bg={
                              change.direction === "up"
                                ? "success"
                                : change.direction === "down"
                                  ? "danger"
                                  : "secondary"
                            }
                          >
                            {change.direction === "up" ? "+" : ""}
                            {change.percentage}%
                          </Badge>
                        ) : (
                          <Badge bg="secondary">—</Badge>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </Table>
        </div>
      </Card.Body>
    </Card>
  );
};

export default TrendTable;
