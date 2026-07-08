import { useState } from "react";
import { Link } from "react-router";

import Accordion from "react-bootstrap/Accordion";
import Badge from "react-bootstrap/Badge";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Table from "react-bootstrap/Table";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { RiCarLine, RiFlashlightLine } from "react-icons/ri";

import { formatShortDate } from "../../../util/format-date";
import {
  SCHEDULE_SOURCE_LABELS,
  WORK_ISSUE_LABELS,
  WORK_STATUS_META,
  formatMinutes,
  workStatusMeta,
} from "./format";

const SORTERS = {
  date: (a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0),
  duration: (a, b) => b.durationMinutes - a.durationMinutes,
  overtime: (a, b) => b.overtime.roundedMinutes - a.overtime.roundedMinutes,
};

const OvertimeCell = ({ work }) => {
  if (work.overtime.roundedMinutes === 0) {
    return <span className="text-body-secondary">—</span>;
  }
  return (
    <OverlayTrigger
      placement="top"
      overlay={
        <Tooltip>
          Фактически: {formatMinutes(work.overtime.actualMinutes)}
          <br />
          С округлением: {formatMinutes(work.overtime.roundedMinutes)} (шаг{" "}
          {work.tariffingPeriodMinutes} мин)
          <br />
          Считается по: {SCHEDULE_SOURCE_LABELS[work.scheduleSource]}
          {work.planTitle ? ` «${work.planTitle}»` : ""}
        </Tooltip>
      }
    >
      <span className="pr-ot-text pr-num">
        <RiFlashlightLine /> {formatMinutes(work.overtime.roundedMinutes)}
      </span>
    </OverlayTrigger>
  );
};

const WorkRow = ({ work, onSelect }) => {
  const status = workStatusMeta(work.financesStatus);
  return (
    <tr
      onClick={() => onSelect(work)}
      style={{ cursor: "pointer" }}
      title="Подробнее о работе"
    >
      <td className="text-nowrap">
        {work.finishedAt ? formatShortDate(work.finishedAt) : "—"}
        {work.issues.map((issue) => (
          <Badge key={issue} bg="danger" className="ms-1 fw-normal">
            {WORK_ISSUE_LABELS[issue] || issue}
          </Badge>
        ))}
      </td>
      <td className="text-truncate" style={{ maxWidth: "10rem" }}>
        {work.company?.alias || "—"}
      </td>
      <td className="text-nowrap">
        {work.tickets.map((ticket, index) => (
          <span key={ticket._id}>
            {index > 0 && ", "}
            <Link
              to={`/tickets/${ticket.num}`}
              onClick={(event) => event.stopPropagation()}
            >
              #{ticket.num}
            </Link>
          </span>
        ))}
      </td>
      <td className="text-truncate" style={{ maxWidth: "22rem" }}>
        {work.visitRequired && (
          <span className="me-1 text-body-secondary" title="Выезд">
            <RiCarLine />
          </span>
        )}
        {work.description || <span className="text-body-secondary">без описания</span>}
      </td>
      <td className="text-end pr-num">{formatMinutes(work.durationMinutes)}</td>
      <td className="text-end">
        <OvertimeCell work={work} />
      </td>
      <td>
        <Badge bg={status.variant} className="fw-normal">
          {status.label}
        </Badge>
      </td>
    </tr>
  );
};

const WorksTableInner = ({ works, onSelect }) => (
  <div className="table-responsive">
    <Table striped hover size="sm" className="align-middle mb-0">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Компания</th>
          <th>Заявки</th>
          <th>Описание</th>
          <th className="text-end">Время</th>
          <th className="text-end">Переработка</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {works.map((work) => (
          <WorkRow key={work._id} work={work} onSelect={onSelect} />
        ))}
      </tbody>
    </Table>
  </div>
);

const WorksTable = ({ works, onSelect }) => {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");

  const overtimeWorks = works
    .filter((work) => work.overtime.roundedMinutes > 0)
    .sort(SORTERS.overtime);

  const filteredWorks = works
    .filter(
      (work) =>
        statusFilter === "all" ||
        (work.financesStatus || "none") === statusFilter,
    )
    .sort(SORTERS[sortBy]);

  return (
    <Accordion defaultActiveKey={["overtime"]} alwaysOpen className="mb-3">
      <Accordion.Item eventKey="overtime">
        <Accordion.Header>
          <span className="me-2">Работы с переработкой</span>
          <Badge bg={overtimeWorks.length > 0 ? "warning" : "secondary"} text={overtimeWorks.length > 0 ? "dark" : undefined}>
            {overtimeWorks.length}
          </Badge>
        </Accordion.Header>
        <Accordion.Body className="p-0">
          {overtimeWorks.length > 0 ? (
            <WorksTableInner works={overtimeWorks} onSelect={onSelect} />
          ) : (
            <div className="p-3 text-body-secondary">
              Переработок за период не было.
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="all">
        <Accordion.Header>
          <span className="me-2">Все работы</span>
          <Badge bg="secondary">{works.length}</Badge>
        </Accordion.Header>
        <Accordion.Body className="p-0">
          <Row className="g-2 p-2 border-bottom mx-0">
            <Col xs={12} sm={6} md={4}>
              <Form.Select
                size="sm"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Фильтр по статусу"
              >
                <option value="all">Все статусы</option>
                {Object.entries(WORK_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12} sm={6} md={4}>
              <Form.Select
                size="sm"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                aria-label="Сортировка"
              >
                <option value="date">Сначала новые</option>
                <option value="duration">По длительности</option>
                <option value="overtime">По переработке</option>
              </Form.Select>
            </Col>
          </Row>
          {filteredWorks.length > 0 ? (
            <WorksTableInner works={filteredWorks} onSelect={onSelect} />
          ) : (
            <div className="p-3 text-body-secondary">
              Нет работ с выбранным статусом.
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
};

export default WorksTable;
