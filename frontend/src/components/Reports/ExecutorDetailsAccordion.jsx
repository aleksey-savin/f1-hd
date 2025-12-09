import { useState } from "react";
import { Pie } from "react-chartjs-2";
import Accordion from "react-bootstrap/Accordion";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import { RiSortAsc, RiSortDesc } from "react-icons/ri";

const ExecutorDetailsAccordion = ({ companies, msToHMS }) => {
  const [executorSortConfigs, setExecutorSortConfigs] = useState({});

  const handleExecutorSort = (companyId, key) => {
    let direction = "asc";
    if (
      executorSortConfigs[companyId]?.key === key &&
      executorSortConfigs[companyId]?.direction === "asc"
    ) {
      direction = "desc";
    }
    setExecutorSortConfigs((prev) => ({
      ...prev,
      [companyId]: { key, direction },
    }));
  };

  const getExecutorSortIcon = (companyId, columnKey) => {
    const config = executorSortConfigs[companyId];
    if (config?.key === columnKey) {
      return config.direction === "asc" ? <RiSortAsc /> : <RiSortDesc />;
    }
    return null;
  };

  const getSortedExecutors = (executors, companyId) => {
    const config = executorSortConfigs[companyId];
    if (!config?.key) return executors;

    return [...executors].sort((a, b) => {
      let aValue, bValue;

      switch (config.key) {
        case "name":
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case "totalWorks":
          aValue = a.totalWorks;
          bValue = b.totalWorks;
          break;
        case "totalTime":
          aValue = a.totalTime;
          bValue = b.totalTime;
          break;
        case "onSiteTime":
          aValue = a.onSiteTime;
          bValue = b.onSiteTime;
          break;
        case "remoteTime":
          aValue = a.remoteTime;
          bValue = b.remoteTime;
          break;
        case "ratio": {
          const aTotalTime = a.onSiteTime + a.remoteTime;
          const bTotalTime = b.onSiteTime + b.remoteTime;
          aValue = aTotalTime > 0 ? (a.onSiteTime / aTotalTime) * 100 : 0;
          bValue = bTotalTime > 0 ? (b.onSiteTime / bTotalTime) * 100 : 0;
          break;
        }
        case "routineTaskTime":
          aValue = a.routineTaskTime || 0;
          bValue = b.routineTaskTime || 0;
          break;
        case "routineRatio": {
          const aRoutineTime = a.routineTaskTime || 0;
          const bRoutineTime = b.routineTaskTime || 0;

          aValue = a.totalTime > 0 ? (aRoutineTime / a.totalTime) * 100 : 0;
          bValue = b.totalTime > 0 ? (bRoutineTime / b.totalTime) * 100 : 0;
          break;
        }
        default:
          return 0;
      }

      if (aValue < bValue) {
        return config.direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return config.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  };

  const getSortableHeaderStyle = (companyId, columnKey) => ({
    cursor: "pointer",
    userSelect: "none",
    backgroundColor:
      executorSortConfigs[companyId]?.key === columnKey
        ? "rgba(0,123,255,0.1)"
        : "transparent",
    transition: "background-color 0.2s",
  });

  const generatePieChartData = (executors) => {
    const totalWorks = executors.reduce(
      (sum, exec) => sum + exec.totalWorks,
      0,
    );

    if (totalWorks === 0) return null;

    return {
      labels: executors.map((exec) => exec.name),
      datasets: [
        {
          data: executors.map((exec) =>
            ((exec.totalWorks / totalWorks) * 100).toFixed(1),
          ),
          backgroundColor: executors.map(
            (_, index) => `hsl(${(index * 137.5) % 360}, 65%, 60%)`,
          ),
          borderWidth: 1,
          borderColor: "#fff",
        },
      ],
    };
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          fontSize: 10,
          boxWidth: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            return `${context.label}: ${context.parsed}%`;
          },
        },
      },
    },
  };

  return (
    <Accordion>
      {companies.map((company, index) => (
        <Accordion.Item eventKey={index.toString()} key={company.company._id}>
          <Accordion.Header>
            <strong>{company.company.alias}</strong>
            <Badge bg="secondary" className="ms-2">
              {company.executors.length} исполнителей
            </Badge>
          </Accordion.Header>
          <Accordion.Body>
            {company.executors.length > 0 ? (
              <Row>
                <Col lg={8}>
                  <Table striped size="sm" className="sortable-table">
                    <thead>
                      <tr>
                        <th
                          onClick={() =>
                            handleExecutorSort(company.company._id, "name")
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "name",
                          )}
                          className="sortable-header"
                        >
                          Исполнитель{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(company.company._id, "name")}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(
                              company.company._id,
                              "totalWorks",
                            )
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "totalWorks",
                          )}
                          className="sortable-header"
                        >
                          Работы{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "totalWorks",
                            )}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(company.company._id, "totalTime")
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "totalTime",
                          )}
                          className="sortable-header"
                        >
                          Время{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "totalTime",
                            )}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(
                              company.company._id,
                              "onSiteTime",
                            )
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "onSiteTime",
                          )}
                          className="sortable-header"
                        >
                          Выезды{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "onSiteTime",
                            )}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(
                              company.company._id,
                              "remoteTime",
                            )
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "remoteTime",
                          )}
                          className="sortable-header"
                        >
                          Удалённые{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "remoteTime",
                            )}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(company.company._id, "ratio")
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "ratio",
                          )}
                          className="sortable-header"
                        >
                          Выезды / удалённые{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(company.company._id, "ratio")}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(
                              company.company._id,
                              "routineTaskTime",
                            )
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "routineTaskTime",
                          )}
                          className="sortable-header"
                        >
                          Регламентные{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "routineTaskTime",
                            )}
                          </span>
                        </th>
                        <th
                          onClick={() =>
                            handleExecutorSort(
                              company.company._id,
                              "routineRatio",
                            )
                          }
                          style={getSortableHeaderStyle(
                            company.company._id,
                            "routineRatio",
                          )}
                          className="sortable-header"
                        >
                          Регламенты / инциденты{" "}
                          <span className="sort-icon">
                            {getExecutorSortIcon(
                              company.company._id,
                              "routineRatio",
                            )}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {getSortedExecutors(
                        company.executors,
                        company.company._id,
                      ).map((executor, idx) => (
                        <tr key={idx}>
                          <td>{executor.name}</td>
                          <td>
                            <Badge bg="primary" pill>
                              {executor.totalWorks}
                            </Badge>
                          </td>
                          <td>
                            <strong>{msToHMS(executor.totalTime)}</strong>
                          </td>
                          <td>
                            <div>
                              {msToHMS(executor.onSiteTime)} /{" "}
                              {executor.onSiteWorks}
                            </div>
                          </td>
                          <td>
                            <div>{msToHMS(executor.remoteTime)}</div>
                          </td>
                          <td>
                            <div>
                              {executor.onSiteTime + executor.remoteTime > 0 ? (
                                <>
                                  <strong>
                                    {Math.round(
                                      (executor.onSiteTime /
                                        (executor.onSiteTime +
                                          executor.remoteTime)) *
                                        100,
                                    )}
                                    %
                                  </strong>{" "}
                                  /{" "}
                                  {Math.round(
                                    (executor.remoteTime /
                                      (executor.onSiteTime +
                                        executor.remoteTime)) *
                                      100,
                                  )}
                                  %
                                </>
                              ) : (
                                <span className="text-muted">0% / 0%</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div>
                              {msToHMS(executor.routineTaskTime || 0)} /{" "}
                              {executor.routineTaskWorks || 0}
                            </div>
                          </td>
                          <td>
                            <div>
                              {(() => {
                                const routineTime =
                                  executor.routineTaskTime || 0;
                                const totalTime = executor.totalTime;

                                if (totalTime > 0) {
                                  const routinePercent = Math.round(
                                    (routineTime / totalTime) * 100,
                                  );
                                  const incidentPercent = 100 - routinePercent;
                                  return (
                                    <>
                                      <strong>{routinePercent}%</strong>
                                      {" / "}
                                      <strong>{incidentPercent}%</strong>
                                    </>
                                  );
                                } else {
                                  return (
                                    <span className="text-muted">0% / 0%</span>
                                  );
                                }
                              })()}
                            </div>
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
                            {company.executors.length} исполнителей
                          </small>
                        </td>
                        <td>
                          <Badge bg="primary" pill>
                            {company.executors.reduce(
                              (sum, executor) => sum + executor.totalWorks,
                              0,
                            )}
                          </Badge>
                        </td>
                        <td>
                          <strong>
                            {msToHMS(
                              company.executors.reduce(
                                (sum, executor) => sum + executor.totalTime,
                                0,
                              ),
                            )}
                          </strong>
                        </td>
                        <td>
                          <div>
                            {msToHMS(
                              company.executors.reduce(
                                (sum, executor) => sum + executor.onSiteTime,
                                0,
                              ),
                            )}{" "}
                            /{" "}
                            {company.executors.reduce(
                              (sum, executor) => sum + executor.onSiteWorks,
                              0,
                            )}
                          </div>
                        </td>
                        <td>
                          <div>
                            {msToHMS(
                              company.executors.reduce(
                                (sum, executor) => sum + executor.remoteTime,
                                0,
                              ),
                            )}
                          </div>
                        </td>
                        <td>
                          <div>
                            {(() => {
                              const totalOnSiteTime = company.executors.reduce(
                                (sum, executor) => sum + executor.onSiteTime,
                                0,
                              );
                              const totalRemoteTime = company.executors.reduce(
                                (sum, executor) => sum + executor.remoteTime,
                                0,
                              );
                              const totalTime =
                                totalOnSiteTime + totalRemoteTime;

                              if (totalTime > 0) {
                                return (
                                  <>
                                    <strong>
                                      {Math.round(
                                        (totalOnSiteTime / totalTime) * 100,
                                      )}
                                      %
                                    </strong>{" "}
                                    /{" "}
                                    {Math.round(
                                      (totalRemoteTime / totalTime) * 100,
                                    )}
                                    %
                                  </>
                                );
                              } else {
                                return (
                                  <span className="text-muted">0% / 0%</span>
                                );
                              }
                            })()}
                          </div>
                        </td>
                        <td>
                          <div>
                            {msToHMS(
                              company.executors.reduce(
                                (sum, executor) =>
                                  sum + (executor.routineTaskTime || 0),
                                0,
                              ),
                            )}{" "}
                            /{" "}
                            {company.executors.reduce(
                              (sum, executor) =>
                                sum + (executor.routineTaskWorks || 0),
                              0,
                            )}
                          </div>
                        </td>
                        <td>
                          <div>
                            {(() => {
                              const totalRoutineTime = company.executors.reduce(
                                (sum, executor) =>
                                  sum + (executor.routineTaskTime || 0),
                                0,
                              );
                              const totalTime = company.executors.reduce(
                                (sum, executor) => sum + executor.totalTime,
                                0,
                              );

                              if (totalTime > 0) {
                                const routinePercent = Math.round(
                                  (totalRoutineTime / totalTime) * 100,
                                );
                                const incidentPercent = 100 - routinePercent;
                                return (
                                  <>
                                    <strong>{routinePercent}%</strong>
                                    {" / "}
                                    <strong>{incidentPercent}%</strong>
                                  </>
                                );
                              } else {
                                return (
                                  <span className="text-muted">0% / 0%</span>
                                );
                              }
                            })()}
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </Table>
                </Col>
                <Col lg={4}>
                  <Card className="h-100">
                    <Card.Header>
                      <h6 className="mb-0">Распределение работ</h6>
                    </Card.Header>
                    <Card.Body
                      className="d-flex flex-column justify-content-center"
                      style={{ minHeight: "250px" }}
                    >
                      {(() => {
                        const pieData = generatePieChartData(company.executors);
                        return pieData ? (
                          <div style={{ height: "200px" }}>
                            <Pie
                              data={pieData}
                              options={{
                                ...pieOptions,
                                plugins: {
                                  ...pieOptions.plugins,
                                  tooltip: {
                                    callbacks: {
                                      label: function (context) {
                                        const executor =
                                          company.executors[context.dataIndex];
                                        return `${context.label}: ${context.parsed}% (${executor.totalWorks} работ)`;
                                      },
                                    },
                                  },
                                },
                              }}
                            />
                          </div>
                        ) : (
                          <p className="text-muted text-center">
                            Нет данных для графика
                          </p>
                        );
                      })()}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            ) : (
              <p className="text-muted">Нет данных по исполнителям</p>
            )}
          </Accordion.Body>
        </Accordion.Item>
      ))}
    </Accordion>
  );
};

export default ExecutorDetailsAccordion;
