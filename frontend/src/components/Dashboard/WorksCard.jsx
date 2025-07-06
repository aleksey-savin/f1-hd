import { useState } from "react";

import Card from "react-bootstrap/Card";
import Modal from "react-bootstrap/Modal";

import pad from "pad";

const WorksCard = (props) => {
  const { title, list, totalTime } = props.works;
  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(list?.length > 0);

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized = [
      pad(2, hours.toString(), "0"),
      pad(2, minutes.toString(), "0"),
    ].join(":");

    return humanized;
  };

  return (
    <>
      <a
        href="#"
        className={
          "link-offset-2 link-underline link-underline-opacity-0  " +
          (totalTime ? "pe-auto" : "pe-none user-select-none")
        }
      >
        <Card className="mb-3 shadow" onClick={handleShow}>
          <Card.Body className="text-center">
            <h5>{title}</h5>
            <h1 className="display-4">{totalTime}</h1>
          </Card.Body>
        </Card>
      </a>
      <Modal show={show} onHide={handleClose} centered size="xl">
        <Modal.Header closeButton>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <table className="table-responsive sortable">
            <thead>
              <tr>
                <th>Заявка</th>
                <th>Инициатор</th>
                <th>Категория</th>
                <th>Описание работ</th>
                <th>Исполнитель</th>
                <th>Длительность</th>
              </tr>
            </thead>
            <tbody>
              {list.map((work) => (
                <tr
                  key={work._id}
                  className={
                    parseInt(
                      msToHMS(
                        new Date(work.finishedAt) - new Date(work.startedAt),
                      ),
                      10,
                    ) >= 12
                      ? "table-warning"
                      : ""
                  }
                >
                  <td data-cell="заявка">
                    <a
                      href={`/tickets/${work.ticketNum}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {work.ticketNum}
                    </a>
                  </td>
                  <td data-cell="инициатор">{work.ticketApplicant}</td>
                  <td data-cell="категория">{work.ticketCategory}</td>
                  <td data-cell="описание">{work.description}</td>
                  <td data-cell="исполнитель">{work.finishedBy}</td>
                  <td data-cell="длительность">
                    {msToHMS(
                      new Date(work.finishedAt) - new Date(work.startedAt),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="table-round-bottom">
              <tr>
                <td colSpan="5" className="text-end">
                  ИТОГО:
                </td>
                <td>{totalTime}</td>
              </tr>
            </tfoot>
          </table>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default WorksCard;
