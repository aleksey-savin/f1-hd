import { useMemo } from "react";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import { RiSortAsc, RiSortDesc, RiInformationLine } from "react-icons/ri";

const CompanySummaryTable = ({ data, sortConfig, onSort, msToHMS }) => {
  if (!data || !data.companies) return null;

  const sortedCompanies = useMemo(() => {
    if (!sortConfig.key) {
      return data.companies || [];
    }

    const sorted = [...data.companies].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case "company":
          aValue = a.company.alias;
          bValue = b.company.alias;
          break;
        case "tickets":
          aValue = a.totalTickets;
          bValue = b.totalTickets;
          break;
        case "works":
          aValue = a.totalWorks;
          bValue = b.totalWorks;
          break;
        case "totalTime":
          aValue = a.totalTime;
          bValue = b.totalTime;
          break;
        case "onSiteCount":
          aValue = a.onSite.count;
          bValue = b.onSite.count;
          break;
        case "onSiteTime":
          aValue = a.onSite.time;
          bValue = b.onSite.time;
          break;
        case "remoteCount":
          aValue = a.remote.count;
          bValue = b.remote.count;
          break;
        case "remoteTime":
          aValue = a.remote.time;
          bValue = b.remote.time;
          break;
        case "ratio": {
          const aTotalTime = a.onSite.time + a.remote.time;
          const bTotalTime = b.onSite.time + b.remote.time;
          aValue = aTotalTime > 0 ? (a.onSite.time / aTotalTime) * 100 : 0;
          bValue = bTotalTime > 0 ? (b.onSite.time / bTotalTime) * 100 : 0;
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

    return sorted;
  }, [data, sortConfig]);

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
    <Table striped hover responsive className="sortable-table">
      <thead>
        <tr>
          <th
            onClick={() => onSort("company")}
            style={getSortableHeaderStyle("company")}
            className="sortable-header"
          >
            Компания <span className="sort-icon">{getSortIcon("company")}</span>
          </th>
          <th
            onClick={() => onSort("tickets")}
            style={getSortableHeaderStyle("tickets")}
            className="sortable-header"
          >
            Заявки <span className="sort-icon">{getSortIcon("tickets")}</span>
          </th>
          <th
            onClick={() => onSort("works")}
            style={getSortableHeaderStyle("works")}
            className="sortable-header"
          >
            Работы <span className="sort-icon">{getSortIcon("works")}</span>
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
            onClick={() => onSort("onSiteCount")}
            style={getSortableHeaderStyle("onSiteCount")}
            className="sortable-header"
          >
            Выезды{" "}
            <span className="sort-icon">{getSortIcon("onSiteCount")}</span>
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
            Соотношение (выезды / удалённые){" "}
            <span className="sort-icon">{getSortIcon("ratio")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedCompanies.map((company) => (
          <OverlayTrigger
            key={company.company._id}
            placement="top"
            overlay={
              <Tooltip>
                <strong>{company.company.name}</strong>
                <br />
                Средняя длительность работы:{" "}
                {company.totalWorks > 0
                  ? msToHMS(company.totalTime / company.totalWorks)
                  : "0:00"}
              </Tooltip>
            }
          >
            <tr style={{ cursor: "pointer" }}>
              <td>
                <strong>{company.company.alias}</strong>
                <br />
                <small className="text-muted">{company.company.name}</small>
              </td>
              <td>
                <Badge bg="info" pill>
                  {company.totalTickets}
                </Badge>
              </td>
              <td>
                <Badge bg="primary" pill>
                  {company.totalWorks}
                </Badge>
              </td>
              <td>
                <strong>{msToHMS(company.totalTime)}</strong>
              </td>
              <td>
                <div>
                  {msToHMS(company.onSite.time)} / {company.onSite.count}
                </div>
              </td>
              <td>
                <div>{msToHMS(company.remote.time)}</div>
              </td>
              <td>
                <div>
                  {company.onSite.time + company.remote.time > 0 ? (
                    <>
                      <strong>
                        {Math.round(
                          (company.onSite.time /
                            (company.onSite.time + company.remote.time)) *
                            100,
                        )}
                        %
                      </strong>{" "}
                      /{" "}
                      {Math.round(
                        (company.remote.time /
                          (company.onSite.time + company.remote.time)) *
                          100,
                      )}
                      %
                    </>
                  ) : (
                    <span className="text-muted">0% / 0%</span>
                  )}
                </div>
              </td>
            </tr>
          </OverlayTrigger>
        ))}
      </tbody>
    </Table>
  );
};

export default CompanySummaryTable;
