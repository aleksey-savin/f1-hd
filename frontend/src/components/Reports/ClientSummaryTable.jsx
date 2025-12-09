import { useMemo } from "react";
import Table from "react-bootstrap/Table";
import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import { RiSortAsc, RiSortDesc } from "react-icons/ri";

const ClientSummaryTable = ({ data, sortConfig, onSort, msToHMS }) => {
  if (!data || !data.companies) return null;

  // Собираем данные по подразделениям из всех компаний
  const subdivisionData = useMemo(() => {
    const subdivisions = {};
    let hasSubdivisions = false;

    data.companies.forEach((company) => {
      if (company.subdivisions && company.subdivisions.length > 0) {
        hasSubdivisions = true;
        company.subdivisions.forEach((subdivision) => {
          if (!subdivisions[subdivision._id]) {
            subdivisions[subdivision._id] = {
              _id: subdivision._id,
              name: subdivision.name,
              totalWorks: 0,
              totalTime: 0,
              onSiteTime: 0,
              remoteTime: 0,
              routineTaskTime: 0,
            };
          }
          subdivisions[subdivision._id].totalWorks += subdivision.totalWorks;
          subdivisions[subdivision._id].totalTime += subdivision.totalTime;
          subdivisions[subdivision._id].onSiteTime += subdivision.onSiteTime;
          subdivisions[subdivision._id].remoteTime += subdivision.remoteTime;
          subdivisions[subdivision._id].routineTaskTime += subdivision.routineTaskTime;
        });
      }
    });

    return { subdivisions: Object.values(subdivisions), hasSubdivisions };
  }, [data.companies]);

  const sortedData = useMemo(() => {
    let dataToSort = [];

    if (subdivisionData.hasSubdivisions) {
      dataToSort = subdivisionData.subdivisions;
    } else {
      // Если подразделений нет, показываем данные по компании
      dataToSort = data.companies.map((company) => ({
        _id: company.company._id,
        name: company.company.alias,
        fullName: company.company.name,
        totalWorks: company.totalWorks,
        totalTime: company.totalTime,
        onSiteTime: company.onSite.time,
        remoteTime: company.remote.time,
        routineTaskTime: company.routineTask.time,
        totalTickets: company.totalTickets,
      }));
    }

    if (!sortConfig.key) {
      return dataToSort;
    }

    return [...dataToSort].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case "name":
          aValue = a.name;
          bValue = b.name;
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
        case "routineTaskTime":
          aValue = a.routineTaskTime;
          bValue = b.routineTaskTime;
          break;
        case "ratio": {
          const aTotalTime = a.onSiteTime + a.remoteTime;
          const bTotalTime = b.onSiteTime + b.remoteTime;
          aValue = aTotalTime > 0 ? (a.onSiteTime / aTotalTime) * 100 : 0;
          bValue = bTotalTime > 0 ? (b.onSiteTime / bTotalTime) * 100 : 0;
          break;
        }
        case "routineRatio": {
          aValue = a.totalTime > 0 ? (a.routineTaskTime / a.totalTime) * 100 : 0;
          bValue = b.totalTime > 0 ? (b.routineTaskTime / b.totalTime) * 100 : 0;
          break;
        }
        default:
          return 0;
      }

      if (typeof aValue === "string") {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [data, sortConfig, subdivisionData]);

  // Calculate totals
  const totals = useMemo(() => {
    return sortedData.reduce(
      (acc, item) => {
        acc.totalWorks += item.totalWorks || 0;
        acc.totalTime += item.totalTime || 0;
        acc.onSiteTime += item.onSiteTime || 0;
        acc.remoteTime += item.remoteTime || 0;
        acc.routineTaskTime += item.routineTaskTime || 0;
        return acc;
      },
      {
        totalWorks: 0,
        totalTime: 0,
        onSiteTime: 0,
        remoteTime: 0,
        routineTaskTime: 0,
      }
    );
  }, [sortedData]);

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
    <Card>
      <Card.Header>
        <h6>
          {subdivisionData.hasSubdivisions
            ? "Сводка по подразделениям"
            : "Общая сводка"}
        </h6>
      </Card.Header>
      <Card.Body>
        <Table striped hover responsive className="sortable-table">
          <thead>
            <tr>
              <th
                onClick={() => onSort("name")}
                style={getSortableHeaderStyle("name")}
                className="sortable-header"
              >
                {subdivisionData.hasSubdivisions ? "Подразделение" : "Организация"}{" "}
                <span className="sort-icon">{getSortIcon("name")}</span>
              </th>
              <th
                onClick={() => onSort("totalWorks")}
                style={getSortableHeaderStyle("totalWorks")}
                className="sortable-header"
              >
                Работы <span className="sort-icon">{getSortIcon("totalWorks")}</span>
              </th>
              <th
                onClick={() => onSort("totalTime")}
                style={getSortableHeaderStyle("totalTime")}
                className="sortable-header"
              >
                Общее время{" "}
                <span className="sort-icon">{getSortIcon("totalTime")}</span>
              </th>
              <th
                onClick={() => onSort("onSiteTime")}
                style={getSortableHeaderStyle("onSiteTime")}
                className="sortable-header"
              >
                Выезды{" "}
                <span className="sort-icon">{getSortIcon("onSiteTime")}</span>
              </th>
              <th
                onClick={() => onSort("remoteTime")}
                style={getSortableHeaderStyle("remoteTime")}
                className="sortable-header"
              >
                Удалённые{" "}
                <span className="sort-icon">{getSortIcon("remoteTime")}</span>
              </th>
              <th
                onClick={() => onSort("ratio")}
                style={getSortableHeaderStyle("ratio")}
                className="sortable-header"
              >
                Выезды / удалённые{" "}
                <span className="sort-icon">{getSortIcon("ratio")}</span>
              </th>
              <th
                onClick={() => onSort("routineTaskTime")}
                style={getSortableHeaderStyle("routineTaskTime")}
                className="sortable-header"
              >
                Регламентные{" "}
                <span className="sort-icon">{getSortIcon("routineTaskTime")}</span>
              </th>
              <th
                onClick={() => onSort("routineRatio")}
                style={getSortableHeaderStyle("routineRatio")}
                className="sortable-header"
              >
                Регламенты / инциденты{" "}
                <span className="sort-icon">{getSortIcon("routineRatio")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((item) => (
              <OverlayTrigger
                key={item._id}
                placement="top"
                overlay={
                  <Tooltip>
                    <strong>{item.fullName || item.name}</strong>
                    {item.totalWorks > 0 && (
                      <>
                        <br />
                        Средняя длительность работы:{" "}
                        {msToHMS(item.totalTime / item.totalWorks)}
                      </>
                    )}
                  </Tooltip>
                }
              >
                <tr style={{ cursor: "pointer" }}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.fullName && item.fullName !== item.name && (
                      <>
                        <br />
                        <small className="text-muted">{item.fullName}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <Badge bg="primary" pill>
                      {item.totalWorks || 0}
                    </Badge>
                  </td>
                  <td>
                    <strong>{msToHMS(item.totalTime || 0)}</strong>
                  </td>
                  <td>
                    <div>{msToHMS(item.onSiteTime || 0)}</div>
                  </td>
                  <td>
                    <div>{msToHMS(item.remoteTime || 0)}</div>
                  </td>
                  <td>
                    <div>
                      {(item.onSiteTime || 0) + (item.remoteTime || 0) > 0 ? (
                        <>
                          <strong>
                            {Math.round(
                              ((item.onSiteTime || 0) /
                                ((item.onSiteTime || 0) + (item.remoteTime || 0))) *
                                100
                            )}
                            %
                          </strong>{" "}
                          /{" "}
                          {Math.round(
                            ((item.remoteTime || 0) /
                              ((item.onSiteTime || 0) + (item.remoteTime || 0))) *
                              100
                          )}
                          %
                        </>
                      ) : (
                        <span className="text-muted">0% / 0%</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div>{msToHMS(item.routineTaskTime || 0)}</div>
                  </td>
                  <td>
                    <div>
                      {(() => {
                        const routineTime = item.routineTaskTime || 0;
                        const totalTime = item.totalTime || 0;

                        if (totalTime > 0) {
                          const routinePercent = Math.round(
                            (routineTime / totalTime) * 100
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
                          return <span className="text-muted">0% / 0%</span>;
                        }
                      })()}
                    </div>
                  </td>
                </tr>
              </OverlayTrigger>
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
                  {sortedData.length} {subdivisionData.hasSubdivisions ? "подразделений" : "организаций"}
                </small>
              </td>
              <td>
                <Badge bg="primary" pill>
                  {totals.totalWorks}
                </Badge>
              </td>
              <td>
                <strong>{msToHMS(totals.totalTime)}</strong>
              </td>
              <td>
                <div>{msToHMS(totals.onSiteTime)}</div>
              </td>
              <td>
                <div>{msToHMS(totals.remoteTime)}</div>
              </td>
              <td>
                <div>
                  {totals.onSiteTime + totals.remoteTime > 0 ? (
                    <>
                      <strong>
                        {Math.round(
                          (totals.onSiteTime /
                            (totals.onSiteTime + totals.remoteTime)) *
                            100
                        )}
                        %
                      </strong>{" "}
                      /{" "}
                      {Math.round(
                        (totals.remoteTime /
                          (totals.onSiteTime + totals.remoteTime)) *
                          100
                      )}
                      %
                    </>
                  ) : (
                    <span className="text-muted">0% / 0%</span>
                  )}
                </div>
              </td>
              <td>
                <div>{msToHMS(totals.routineTaskTime)}</div>
              </td>
              <td>
                <div>
                  {(() => {
                    if (totals.totalTime > 0) {
                      const routinePercent = Math.round(
                        (totals.routineTaskTime / totals.totalTime) * 100
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
                      return <span className="text-muted">0% / 0%</span>;
                    }
                  })()}
                </div>
              </td>
            </tr>
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};

export default ClientSummaryTable;
