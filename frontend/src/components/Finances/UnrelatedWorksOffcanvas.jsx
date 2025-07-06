import { useState } from "react";
import pad from "pad";

import Offcanvas from "react-bootstrap/Offcanvas";
import Table from "react-bootstrap/Table";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";

const UnrelatedWorksOffcanvas = ({ unrelatedWorks }) => {
  const [showUnrelatedWorks, setShowUnrelatedWorks] = useState(false);

  const handleCloseUnrelatedWorks = () => setShowUnrelatedWorks(false);
  const handleShowUnrelatedWorks = () => setShowUnrelatedWorks(true);

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

  const worktimeTotalDuration = unrelatedWorks.reduce((acc, work) => {
    return acc + (new Date(work.finishedAt) - new Date(work.startedAt));
  }, 0);

  return (
    <>
      {unrelatedWorks.length > 0 && (
        <Button
          onClick={handleShowUnrelatedWorks}
          variant="link"
          size="sm"
          className="text-primary bg-warning mx-2"
        >
          <strong>{`Выполненные работы, не попавшие ни в одну из услуг: ${unrelatedWorks.length}`}</strong>
        </Button>
      )}
      <Offcanvas
        show={showUnrelatedWorks}
        onHide={handleCloseUnrelatedWorks}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            Выполненные работы, не попавшие ни в одну из услуг
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Container>
            <Table bordered>
              <thead>
                <tr>
                  <th>Заявки</th>
                  <th>Инициаторы</th>
                  <th>Категории</th>
                  <th>Описание работ</th>
                  <th>Исполнитель</th>
                  <th>Длительность</th>
                </tr>
              </thead>
              <tbody>
                {unrelatedWorks.map((work) => (
                  <tr
                    key={work._id}
                    className={
                      parseInt(msToHMS(work.duration), 10) >= 12
                        ? "table-warning"
                        : ""
                    }
                  >
                    <td data-cell="Заявки">
                      {work.tickets.map((ticket) => (
                        <div key={Math.random()}>
                          <a
                            href={`/tickets/${ticket.num}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {ticket.num}
                          </a>
                          <br></br>
                        </div>
                      ))}
                    </td>
                    <td data-cell="инициаторы">
                      {work.tickets.map((ticket) => (
                        <div key={Math.random()}>
                          {ticket.applicantId
                            ? `${ticket.applicantId.lastName} ${ticket.applicantId.firstName}`
                            : "Пользователь не найден"}
                          <br></br>
                        </div>
                      ))}
                    </td>
                    <td data-cell="категории">
                      {work.ticketsCategories.map((category) => (
                        <div key={Math.random()}>
                          {category.title}
                          <br></br>
                        </div>
                      ))}
                    </td>
                    <td data-cell="описание работ">{work.description}</td>
                    <td data-cell="исполнитель">{work.finishedBy}</td>
                    <td data-cell="длительность" className="table-align-right">
                      {msToHMS(
                        new Date(work.finishedAt) - new Date(work.startedAt),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="table-secondary fw-bold">
                  <td colSpan={5}>Итого:</td>
                  <td className="table-align-right">
                    {msToHMS(worktimeTotalDuration)}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Container>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default UnrelatedWorksOffcanvas;
