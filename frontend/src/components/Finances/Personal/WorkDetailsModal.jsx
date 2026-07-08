import { Link } from "react-router";

import Badge from "react-bootstrap/Badge";
import Modal from "react-bootstrap/Modal";
import Table from "react-bootstrap/Table";

import { RiCarLine } from "react-icons/ri";

import { formatDateTime, formatShortDate } from "../../../util/format-date";
import {
  SCHEDULE_SOURCE_LABELS,
  formatMinutes,
  workStatusMeta,
} from "./format";

// Детали работы — всё уже посчитано сервером, компонент только отображает
const WorkDetailsModal = ({ work, show, onHide }) => {
  if (!work) {
    return null;
  }

  const status = workStatusMeta(work.financesStatus);

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="fs-5">
          Работа от {work.finishedAt ? formatShortDate(work.finishedAt) : "—"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <Badge bg={status.variant} className="fw-normal">
            {status.label}
          </Badge>
          {work.visitRequired && (
            <Badge bg="info" className="fw-normal">
              <RiCarLine /> выезд
            </Badge>
          )}
          {work.withinPlan && (
            <Badge bg="secondary" className="fw-normal">
              в рамках тарифа
            </Badge>
          )}
        </div>

        <p className="mb-3">{work.description || "Без описания"}</p>

        <Table size="sm" borderless className="mb-3 w-auto">
          <tbody>
            <tr>
              <td className="text-body-secondary pe-3">Компания</td>
              <td>{work.company?.alias || "—"}</td>
            </tr>
            <tr>
              <td className="text-body-secondary pe-3">Заявки</td>
              <td>
                {work.tickets.length > 0
                  ? work.tickets.map((ticket, index) => (
                      <span key={ticket._id}>
                        {index > 0 && ", "}
                        <Link to={`/tickets/${ticket.num}`}>
                          #{ticket.num}
                        </Link>{" "}
                        {ticket.title}
                      </span>
                    ))
                  : "—"}
              </td>
            </tr>
            <tr>
              <td className="text-body-secondary pe-3">Начало</td>
              <td>{work.startedAt ? formatDateTime(work.startedAt) : "—"}</td>
            </tr>
            <tr>
              <td className="text-body-secondary pe-3">Окончание</td>
              <td>{work.finishedAt ? formatDateTime(work.finishedAt) : "—"}</td>
            </tr>
            <tr>
              <td className="text-body-secondary pe-3">Длительность</td>
              <td className="pr-num">{formatMinutes(work.durationMinutes)}</td>
            </tr>
          </tbody>
        </Table>

        {work.overtime.roundedMinutes > 0 && (
          <>
            <h6>Переработка</h6>
            <Table size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип дня</th>
                  <th className="text-end">Фактически</th>
                  <th className="text-end">С округлением</th>
                </tr>
              </thead>
              <tbody>
                {work.overtime.days.map((day) => (
                  <tr key={day.date}>
                    <td>{formatShortDate(`${day.date}T00:00:00`)}</td>
                    <td>
                      {day.bucket === "weekend" ? (
                        <Badge bg="secondary" className="fw-normal">
                          выходной
                        </Badge>
                      ) : (
                        "будний"
                      )}
                    </td>
                    <td className="text-end pr-num">
                      {formatMinutes(day.actualMinutes)}
                    </td>
                    <td className="text-end pr-num">
                      {formatMinutes(day.roundedMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="small text-body-secondary">
              Округление вверх до {work.tariffingPeriodMinutes} мин — как в
              сводном финансовом отчёте. Источник:{" "}
              {SCHEDULE_SOURCE_LABELS[work.scheduleSource]}
              {work.planTitle ? ` «${work.planTitle}»` : ""}.
            </div>
          </>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default WorkDetailsModal;
