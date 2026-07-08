import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { RiBuilding2Line } from "react-icons/ri";

import { formatMinutes } from "./format";

// Полосы масштабируются к самой загруженной компании (100%), а не к сумме —
// так сравнимы длины строк; доля от общего времени показана числом
const CompanyLoadCard = ({ byCompany }) => {
  if (!byCompany.length) {
    return null;
  }

  const maxMinutes = byCompany[0].minutes || 1;

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>
          <RiBuilding2Line /> Нагрузка по компаниям
        </span>
        <Badge bg="secondary">{byCompany.length}</Badge>
      </Card.Header>
      <div className="table-responsive">
        <Table hover size="sm" className="mb-0 align-middle pr-load-table">
          <thead>
            <tr>
              <th>Компания</th>
              <th className="pr-load-table__bar-col">Нагрузка</th>
              <th className="text-end">Доля</th>
              <th className="text-end">Время</th>
              <th className="text-end">Работы</th>
              <th className="text-end">Выезды</th>
              <th className="text-end">Переработка</th>
            </tr>
          </thead>
          <tbody>
            {byCompany.map((company) => {
              const overtime = Math.min(
                company.overtimeMinutes,
                company.minutes,
              );
              const workWidth =
                ((company.minutes - overtime) / maxMinutes) * 100;
              const overtimeWidth = (overtime / maxMinutes) * 100;
              return (
                <tr key={company._id || "none"}>
                  <td className="text-truncate" style={{ maxWidth: "16rem" }}>
                    {company.alias}
                  </td>
                  <td className="pr-load-table__bar-col">
                    <OverlayTrigger
                      placement="top"
                      overlay={
                        <Tooltip>
                          {company.alias}: {formatMinutes(company.minutes)}
                          {company.overtimeMinutes > 0 &&
                            `, переработка ${formatMinutes(company.overtimeMinutes)}`}
                        </Tooltip>
                      }
                    >
                      <div className="pr-loadbar" role="img" aria-label={`Нагрузка ${company.alias}`}>
                        <div
                          className="pr-loadbar__work"
                          style={{ width: `${workWidth}%` }}
                        />
                        <div
                          className="pr-loadbar__ot"
                          style={{ width: `${overtimeWidth}%` }}
                        />
                      </div>
                    </OverlayTrigger>
                  </td>
                  <td className="text-end pr-num">{company.sharePercent}%</td>
                  <td className="text-end pr-num">
                    {formatMinutes(company.minutes)}
                  </td>
                  <td className="text-end pr-num">{company.worksCount}</td>
                  <td className="text-end pr-num">
                    {company.onSiteCount > 0 ? company.onSiteCount : "—"}
                  </td>
                  <td className="text-end pr-num">
                    {company.overtimeMinutes > 0 ? (
                      <span className="pr-ot-text">
                        {formatMinutes(company.overtimeMinutes)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <Card.Footer className="small text-body-secondary d-flex gap-3 flex-wrap">
        <span>
          <span className="pr-legend-swatch pr-legend-swatch--work" /> рабочее
          время
        </span>
        <span>
          <span className="pr-legend-swatch pr-legend-swatch--ot" /> переработка
        </span>
      </Card.Footer>
    </Card>
  );
};

export default CompanyLoadCard;
