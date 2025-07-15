import { useState } from "react";
import pad from "pad";

import Offcanvas from "react-bootstrap/Offcanvas";
import Table from "react-bootstrap/Table";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";

import { HiOutlineMagnifyingGlass } from "react-icons/hi2";
import { calcSingleWorkOvertime, calculateCost } from "../../util/finances";
import { formatPrice } from "../../util/format-string";

const DetailedViewOffcanvasReport = ({
  worktimeWorks = [],
  overtimeWorks = [],
  plan = {},
  company = {},
}) => {
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

  const schedule = plan.companyWorkSchedule
    ? company?.workSchedule
    : plan.customProvisionSchedule;

  // Calculate totals for overtime works
  const overtimeTotals = overtimeWorks.reduce(
    (acc, work) => {
      const overtime = calcSingleWorkOvertime(
        schedule,
        work,
        plan.tariffingPeriod,
      );

      const cost = calculateCost(
        overtime.roundUpOvertime / (1000 * 60),
        plan.pricePerHourNonWorking,
        plan.tariffingPeriod,
      );

      return {
        duration: acc.duration + overtime.actualOvertime,
        cost: acc.cost + cost,
      };
    },
    { duration: 0, cost: 0 },
  );

  // Calculate total duration for worktime works
  const worktimeTotalDuration = worktimeWorks.reduce((acc, work) => {
    return acc + (new Date(work.finishedAt) - new Date(work.startedAt));
  }, 0);

  return (
    <>
      <Button
        onClick={handleShowUnrelatedWorks}
        variant="primary"
        size="sm"
        className="mx-2 my-1"
      >
        <HiOutlineMagnifyingGlass />
      </Button>
      <Offcanvas
        show={showUnrelatedWorks}
        onHide={handleCloseUnrelatedWorks}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Выполненные работы</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Container>
            {overtimeWorks.length > 0 && (
              <>
                <h3>Выполнены в нерабочее время</h3>
                <Alert variant="light" className="my-3 py-2">
                  <ul className="m-0">
                    <li>{`Период тарификации: ${plan.tariffingPeriod} минут`}</li>
                    <li>{`Стоимость 1 часа: ${formatPrice(
                      plan.pricePerHourNonWorking,
                    )}`}</li>
                  </ul>
                </Alert>
                <Table bordered>
                  <thead>
                    <tr>
                      <th>Заявки</th>
                      <th>Инициаторы</th>
                      <th>Категории</th>
                      <th>Описание работ</th>
                      <th>Исполнитель</th>
                      <th>Длительность</th>
                      <th>Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeWorks.map((work) => (
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
                                ? `${ticket.applicantId?.lastName} ${ticket.applicantId?.firstName}`
                                : "Пользователь не найден"}
                              <br></br>
                            </div>
                          ))}
                        </td>
                        <td data-cell="категории">
                          {work.tickets
                            .map((ticket) => ticket.category)
                            .map((category) => (
                              <div key={Math.random()}>
                                {category.title}
                                <br></br>
                              </div>
                            ))}
                        </td>
                        <td data-cell="описание работ">{work.description}</td>
                        <td data-cell="исполнитель">{`${work.finishedBy.lastName} ${work.finishedBy.firstName}`}</td>
                        <td
                          data-cell="длительность"
                          className="table-align-right"
                        >
                          {msToHMS(
                            calcSingleWorkOvertime(
                              schedule,
                              work,
                              plan.tariffingPeriod,
                            ).actualOvertime,
                          )}
                        </td>
                        <td data-cell="стоимость" className="table-align-right">
                          {calculateCost(
                            calcSingleWorkOvertime(
                              schedule,
                              work,
                              plan.tariffingPeriod,
                            ).roundUpOvertime /
                              (1000 * 60),
                            plan.pricePerHourNonWorking,
                            plan.tariffingPeriod,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-secondary fw-bold">
                      <td colSpan={5}>Итого:</td>
                      <td className="table-align-right">
                        {msToHMS(overtimeTotals.duration)}
                      </td>
                      <td className="table-align-right">
                        {formatPrice(overtimeTotals.cost)}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
          </Container>
          <Container>
            <h3>Выполнены в рабочее время</h3>
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
                {worktimeWorks.map((work) => (
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
                            ? `${ticket.applicantId?.lastName} ${ticket.applicantId?.firstName}`
                            : "Пользователь не найден"}
                          <br></br>
                        </div>
                      ))}
                    </td>
                    <td data-cell="категории">
                      {work.tickets
                        .map((ticket) => ticket.category)
                        .map((category) => (
                          <div key={Math.random()}>
                            {category.title}
                            <br></br>
                          </div>
                        ))}
                    </td>
                    <td data-cell="описание работ">{work.description}</td>
                    <td data-cell="исполнитель">{`${work.finishedBy.lastName} ${work.finishedBy.firstName}`}</td>
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

export default DetailedViewOffcanvasReport;
