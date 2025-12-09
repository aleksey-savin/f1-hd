import { useState, useMemo } from "react";
import { Bar } from "react-chartjs-2";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";

import { RiSortAsc, RiSortDesc } from "react-icons/ri";
import Spinner from "../../animations/Spinner";

const EmployeeCompanyDistribution = ({
  data,
  isLoading,
  msToHMS,
  showChart = true,
}) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  if (!data || !data.companies) return null;

  // Собираем данные по сотрудникам и их работе в разных компаниях
  const employeeCompanyData = useMemo(() => {
    const employeeMap = {};

    data.companies.forEach((company) => {
      company.executors.forEach((executor) => {
        if (!employeeMap[executor.name]) {
          employeeMap[executor.name] = {
            name: executor.name,
            totalTime: 0,
            totalWorks: 0,
            totalRoutineTaskTime: 0,
            totalRoutineTaskWorks: 0,
            companies: [],
          };
        }

        employeeMap[executor.name].totalTime += executor.totalTime;
        employeeMap[executor.name].totalWorks += executor.totalWorks;
        employeeMap[executor.name].totalRoutineTaskTime +=
          executor.routineTaskTime || 0;
        employeeMap[executor.name].totalRoutineTaskWorks +=
          executor.routineTaskWorks || 0;
        employeeMap[executor.name].companies.push({
          companyAlias: company.company.alias,
          companyName: company.company.name,
          time: executor.totalTime,
          works: executor.totalWorks,
          onSiteTime: executor.onSiteTime,
          remoteTime: executor.remoteTime,
          onSiteWorks: executor.onSiteWorks,
          remoteWorks: executor.remoteWorks,
          routineTaskTime: executor.routineTaskTime || 0,
          routineTaskWorks: executor.routineTaskWorks || 0,
        });
      });
    });

    return Object.values(employeeMap).sort((a, b) => b.totalTime - a.totalTime);
  }, [data]);

  // Calculate totals
  const totals = useMemo(() => {
    return employeeCompanyData.reduce(
      (acc, employee) => {
        acc.totalTime += employee.totalTime;
        acc.totalWorks += employee.totalWorks;
        acc.totalRoutineTaskTime += employee.totalRoutineTaskTime;
        acc.totalRoutineTaskWorks += employee.totalRoutineTaskWorks;
        acc.totalCompanies += employee.companies.length;
        return acc;
      },
      {
        totalTime: 0,
        totalWorks: 0,
        totalRoutineTaskTime: 0,
        totalRoutineTaskWorks: 0,
        totalCompanies: 0,
      },
    );
  }, [employeeCompanyData]);

  // Топ-10 сотрудников для графика
  const topEmployees = employeeCompanyData.slice(0, 10);

  // Данные для графика - время по компаниям для каждого сотрудника
  const chartData = useMemo(() => {
    if (topEmployees.length === 0) return null;

    // Получаем все уникальные компании
    const allCompanies = [
      ...new Set(
        topEmployees.flatMap((emp) => emp.companies.map((c) => c.companyAlias)),
      ),
    ];

    // Генерируем цвета для компаний
    const colors = allCompanies.map(
      (_, index) => `hsl(${(index * 137.5) % 360}, 65%, 55%)`,
    );

    const datasets = allCompanies.map((companyAlias, index) => ({
      label: companyAlias,
      data: topEmployees.map((emp) => {
        const companyData = emp.companies.find(
          (c) => c.companyAlias === companyAlias,
        );
        return companyData ? companyData.time / (1000 * 60 * 60) : 0;
      }),
      backgroundColor: colors[index],
      borderColor: colors[index],
      borderWidth: 1,
    }));

    return {
      labels: topEmployees.map((emp) => emp.name),
      datasets,
    };
  }, [topEmployees]);

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "top",
      },
      title: {
        display: true,
        text: "Распределение времени топ-10 сотрудников по компаниям",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.dataset.label || "";
            const value = context.parsed.y;
            const hours = Math.floor(value);
            const minutes = Math.round((value - hours) * 60);
            return (
              label +
              ": " +
              hours.toString().padStart(2, "0") +
              ":" +
              minutes.toString().padStart(2, "0")
            );
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        stacked: true,
        title: {
          display: true,
          text: "Часы",
        },
      },
      x: {
        stacked: true,
        ticks: {
          maxRotation: 45,
          minRotation: 45,
        },
      },
    },
  };

  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedEmployees = useMemo(() => {
    if (!sortConfig.key) return employeeCompanyData;

    return [...employeeCompanyData].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "totalTime":
          aValue = a.totalTime;
          bValue = b.totalTime;
          break;
        case "totalWorks":
          aValue = a.totalWorks;
          bValue = b.totalWorks;
          break;
        case "companies":
          aValue = a.companies.length;
          bValue = b.companies.length;
          break;
        case "routinePercentage":
          aValue =
            a.totalTime > 0 ? (a.totalRoutineTaskTime / a.totalTime) * 100 : 0;
          bValue =
            b.totalTime > 0 ? (b.totalRoutineTaskTime / b.totalTime) * 100 : 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [employeeCompanyData, sortConfig]);

  const getSortIcon = (columnKey) => {
    if (sortConfig.key === columnKey) {
      return sortConfig.direction === "asc" ? <RiSortAsc /> : <RiSortDesc />;
    }
    return null;
  };

  const getSortableHeaderStyle = (columnKey) => ({
    cursor: "pointer",
    userSelect: "none",
    backgroundColor:
      sortConfig.key === columnKey ? "rgba(0,123,255,0.1)" : "transparent",
    transition: "background-color 0.2s",
  });

  return (
    <>
      {showChart && (
        <Row className="mb-4">
          <Col lg={12}>
            <Card>
              <Card.Header>
                <h6>Топ-10 сотрудников: время по компаниям</h6>
              </Card.Header>
              <Card.Body>
                {isLoading ? (
                  <div className="text-center p-4">
                    <Spinner />
                    <p className="mt-2 text-muted">Загрузка графика...</p>
                  </div>
                ) : chartData ? (
                  <Bar data={chartData} options={chartOptions} />
                ) : (
                  <p className="text-muted text-center">
                    Нет данных для отображения
                  </p>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      <Row className="mb-4">
        <Col lg={12}>
          <Card>
            <Card.Header>
              <h6>Сотрудники и их работа по компаниям</h6>
            </Card.Header>
            <Card.Body>
              <Table striped hover responsive className="sortable-table">
                <thead>
                  <tr>
                    <th
                      onClick={() => handleSort("name")}
                      style={getSortableHeaderStyle("name")}
                      className="sortable-header"
                    >
                      Сотрудник{" "}
                      <span className="sort-icon">{getSortIcon("name")}</span>
                    </th>
                    <th
                      onClick={() => handleSort("totalTime")}
                      style={getSortableHeaderStyle("totalTime")}
                      className="sortable-header"
                    >
                      Общее время{" "}
                      <span className="sort-icon">
                        {getSortIcon("totalTime")}
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("totalWorks")}
                      style={getSortableHeaderStyle("totalWorks")}
                      className="sortable-header"
                    >
                      Всего работ{" "}
                      <span className="sort-icon">
                        {getSortIcon("totalWorks")}
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("companies")}
                      style={getSortableHeaderStyle("companies")}
                      className="sortable-header"
                    >
                      Количество компаний{" "}
                      <span className="sort-icon">
                        {getSortIcon("companies")}
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort("routinePercentage")}
                      style={getSortableHeaderStyle("routinePercentage")}
                      className="sortable-header"
                    >
                      % регламентных{" "}
                      <span className="sort-icon">
                        {getSortIcon("routinePercentage")}
                      </span>
                    </th>
                    <th>Распределение по компаниям</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEmployees.map((employee) => (
                    <tr key={employee.name}>
                      <td>
                        <strong>{employee.name}</strong>
                      </td>
                      <td>
                        <strong>{msToHMS(employee.totalTime)}</strong>
                      </td>
                      <td>
                        <Badge bg="primary" pill>
                          {employee.totalWorks}
                        </Badge>
                      </td>
                      <td>
                        <Badge bg="info" pill>
                          {employee.companies.length}
                        </Badge>
                      </td>
                      <td>
                        <div>
                          <strong>
                            {employee.totalTime > 0
                              ? Math.round(
                                  (employee.totalRoutineTaskTime /
                                    employee.totalTime) *
                                    100,
                                ) + "%"
                              : "0%"}
                          </strong>
                        </div>
                        <div className="small text-muted mt-1">
                          {msToHMS(employee.totalRoutineTaskTime)} /{" "}
                          {employee.totalRoutineTaskWorks}
                        </div>
                      </td>
                      <td>
                        <Row className="g-1">
                          {employee.companies
                            .sort((a, b) => b.time - a.time)
                            .map((company, idx) => (
                              <Col xs="auto" key={idx}>
                                <Badge bg="secondary" className="me-1 mb-1">
                                  <strong>{company.companyAlias}</strong>
                                  <br />
                                  <small>
                                    {msToHMS(company.time)} / {company.works}
                                  </small>
                                </Badge>
                              </Col>
                            ))}
                        </Row>
                      </td>
                    </tr>
                  ))}
                  <tr
                    style={{
                      backgroundColor: "#f8f9fa",
                      fontWeight: "bold",
                      borderTop: "2px solid #dee2e6",
                    }}
                  >
                    <td>
                      <strong>ИТОГО</strong>
                      <br />
                      <small className="text-muted">
                        {employeeCompanyData.length} сотрудников
                      </small>
                    </td>
                    <td>
                      <strong>{msToHMS(totals.totalTime)}</strong>
                    </td>
                    <td>
                      <Badge bg="primary" pill>
                        {totals.totalWorks}
                      </Badge>
                    </td>
                    <td>
                      <Badge bg="info" pill>
                        {Math.round(
                          totals.totalCompanies / employeeCompanyData.length,
                        ) || 0}
                      </Badge>
                      <br />
                      <small className="text-muted">в среднем</small>
                    </td>
                    <td>
                      <div>
                        <strong>
                          {totals.totalTime > 0
                            ? Math.round(
                                (totals.totalRoutineTaskTime /
                                  totals.totalTime) *
                                  100,
                              ) + "%"
                            : "0%"}
                        </strong>
                      </div>
                      <div className="small text-muted mt-1">
                        {msToHMS(totals.totalRoutineTaskTime)} /{" "}
                        {totals.totalRoutineTaskWorks}
                      </div>
                    </td>
                    <td>
                      <small className="text-muted">
                        Всего уникальных связей сотрудник-компания
                      </small>
                    </td>
                  </tr>
                </tbody>
              </Table>

              {sortedEmployees.length === 0 && !isLoading && (
                <div className="text-center p-4">
                  <p className="text-muted">Нет данных по сотрудникам</p>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default EmployeeCompanyDistribution;
