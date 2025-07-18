import { Modal, Table, Badge, Row, Col } from "react-bootstrap";
import { formatShortDate } from "../../../util/format-date";
import { formatPrice } from "../../../util/format-string";
import { msToHMS } from "../../../util/time-helpers";
import { calculateWorkTime, calculateCost } from "../../../util/finances";

const WorkDetailsModal = ({ show, onHide, work }) => {
  if (!work) return null;

  const workTime = work.finishedAt && work.startedAt
    ? calculateWorkTime(work.startedAt, work.finishedAt)
    : 0;

  const cost = workTime > 0
    ? calculateCost(workTime / (1000 * 60), 1000, 20)
    : 0;

  const getStatusBadge = (status) => {
    const statusMap = {
      approved: { variant: "success", text: "Утверждён" },
      awaitingPayment: { variant: "warning", text: "Ожидает оплаты" },
      pending: { variant: "secondary", text: "В ожидании" },
      preview: { variant: "info", text: "Превью" },
      rejected: { variant: "danger", text: "Отклонён" },
    };

    return statusMap[status] || { variant: "secondary", text: status };
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Детали работы</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="mb-3">
          <Col md={6}>
            <h6>Основная информация</h6>
            <Table size="sm" borderless>
              <tbody>
                <tr>
                  <td><strong>Компания:</strong></td>
                  <td>{work.company?.name || "—"}</td>
                </tr>
                <tr>
                  <td><strong>Тариф:</strong></td>
                  <td>{work.servicePlan?.name || "—"}</td>
                </tr>
                <tr>
                  <td><strong>Статус:</strong></td>
                  <td>
                    <Badge bg={getStatusBadge(work.status || "pending").variant}>
                      {getStatusBadge(work.status || "pending").text}
                    </Badge>
                  </td>
                </tr>
                <tr>
                  <td><strong>Дата создания:</strong></td>
                  <td>{formatShortDate(work.createdAt)}</td>
                </tr>
              </tbody>
            </Table>
          </Col>
          <Col md={6}>
            <h6>Время и оплата</h6>
            <Table size="sm" borderless>
              <tbody>
                <tr>
                  <td><strong>Начало:</strong></td>
                  <td>{work.startedAt ? formatShortDate(work.startedAt) : "—"}</td>
                </tr>
                <tr>
                  <td><strong>Окончание:</strong></td>
                  <td>{work.finishedAt ? formatShortDate(work.finishedAt) : "—"}</td>
                </tr>
                <tr>
                  <td><strong>Время работы:</strong></td>
                  <td>{workTime > 0 ? msToHMS(workTime) : "—"}</td>
                </tr>
                {work.overtime && work.overtime.formatted && (
                  <tr>
                    <td><strong>Переработка:</strong></td>
                    <td className="text-warning">{work.overtime.formatted}</td>
                  </tr>
                )}
                <tr>
                  <td><strong>Стоимость:</strong></td>
                  <td className="text-success fw-bold">
                    {cost > 0 ? formatPrice(cost) : "—"}
                  </td>
                </tr>
              </tbody>
            </Table>
          </Col>
        </Row>

        {work.description && (
          <Row>
            <Col>
              <h6>Описание работы</h6>
              <div className="p-3 bg-light rounded">
                {work.description}
              </div>
            </Col>
          </Row>
        )}

        {work.servicePlan && (
          <Row className="mt-3">
            <Col>
              <h6>Информация о тарифе</h6>
              <Table size="sm" striped>
                <tbody>
                  <tr>
                    <td><strong>Название тарифа:</strong></td>
                    <td>{work.servicePlan.name}</td>
                  </tr>
                  {work.servicePlan.description && (
                    <tr>
                      <td><strong>Описание:</strong></td>
                      <td>{work.servicePlan.description}</td>
                    </tr>
                  )}
                  {work.servicePlan.hourlyRate && (
                    <tr>
                      <td><strong>Часовая ставка:</strong></td>
                      <td>{formatPrice(work.servicePlan.hourlyRate)}</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Col>
          </Row>
        )}

        {work.ticket && (
          <Row className="mt-3">
            <Col>
              <h6>Связанный тикет</h6>
              <Table size="sm" striped>
                <tbody>
                  <tr>
                    <td><strong>Номер тикета:</strong></td>
                    <td>#{work.ticket.id}</td>
                  </tr>
                  <tr>
                    <td><strong>Заголовок:</strong></td>
                    <td>{work.ticket.title}</td>
                  </tr>
                  {work.ticket.description && (
                    <tr>
                      <td><strong>Описание:</strong></td>
                      <td>{work.ticket.description}</td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Col>
          </Row>
        )}
      </Modal.Body>
    </Modal>
  );
};

export default WorkDetailsModal;
