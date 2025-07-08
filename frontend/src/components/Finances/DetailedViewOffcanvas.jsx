import { useState } from "react";

import Offcanvas from "react-bootstrap/Offcanvas";
import Table from "react-bootstrap/Table";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";

import { HiOutlineMagnifyingGlass } from "react-icons/hi2";
import {
  calcSingleWorkOvertime,
  calculateWorkTime,
  calculateCost,
  calculateOvertime,
  calcRoundedWorkTime,
  overallRoundedWorktime,
} from "../../util/finances";
import { formatPrice } from "../../util/format-string";
import { msToHMS } from "../../util/time-helpers";

const DetailedViewOffcanvas = ({ works = [], plan = {}, company = {} }) => {
  // show / hide offcanvas
  const [showUnrelatedWorks, setShowUnrelatedWorks] = useState(false);
  const handleCloseUnrelatedWorks = () => setShowUnrelatedWorks(false);
  const handleShowUnrelatedWorks = () => setShowUnrelatedWorks(true);

  // company schedule
  const schedule = plan.companyWorkSchedule
    ? company?.workSchedule
    : plan.customProvisionSchedule;

  // works
  const overtime = calculateOvertime(schedule, works, plan.tariffingPeriod);
  const worktime = calculateWorkTime(schedule, works, plan.tariffingPeriod);

  // overtime totals
  const overtimeTotals = overtime.overtimeWorks.reduce(
    (acc, work) => {
      const overtime = calcSingleWorkOvertime(
        schedule,
        work,
        plan.tariffingPeriod,
      );

      const cost = Number(
        calculateCost(
          overtime.roundUpOvertime / (1000 * 60),
          plan.pricePerHourNonWorking,
          plan.tariffingPeriod,
        ),
      ); // Remove currency symbols and spaces

      return {
        duration: acc.duration + overtime.roundUpOvertime,
        cost: acc.cost + cost,
      };
    },
    { duration: 0, cost: 0 },
  );

  const hourlyTotalCost = () => {
    let totalCost = 0;
    for (let work of works) {
      totalCost += calculateCost(
        calcRoundedWorkTime(work, plan.tariffingPeriod) / (1000 * 60),
        plan.pricePerHour,
        plan.tariffingPeriod,
      );
    }
    return totalCost;
  };

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
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Container>
            {plan?.tariffing?.type !== "hourly" && (
              <>
                {overtime.overtimeWorks.length > 0 && (
                  <>
                    <h3>Выполнены в нерабочее время</h3>
                    <Alert variant="light" className="my-3 py-2">
                      <ul className="m-0">
                        <li>{`Период тарификации: ${plan.tariffingPeriod} минут`}</li>
                        <li>{`Стоимость 1 часа: ${formatPrice(plan.pricePerHourNonWorking)}`}</li>
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
                          <th className="text-end">Стоимость</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overtime.overtimeWorks.map((work) => (
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
                              {work.ticketsCategories.map((category) => (
                                <div key={Math.random()}>
                                  {category.title}
                                  <br></br>
                                </div>
                              ))}
                            </td>
                            <td data-cell="описание работ">
                              {work.description}
                            </td>
                            <td data-cell="исполнитель">{work.finishedBy}</td>
                            <td data-cell="длительность" className="text-end">
                              {msToHMS(
                                calcSingleWorkOvertime(
                                  schedule,
                                  work,
                                  plan.tariffingPeriod,
                                ).roundUpOvertime,
                              )}
                            </td>
                            <td data-cell="стоимость" className="text-end">
                              {formatPrice(
                                calculateCost(
                                  calcSingleWorkOvertime(
                                    schedule,
                                    work,
                                    plan.tariffingPeriod,
                                  ).roundUpOvertime /
                                    (1000 * 60),
                                  plan.pricePerHourNonWorking,
                                  plan.tariffingPeriod,
                                ),
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="table-secondary fw-bold">
                          <td className="text-end" colSpan={5}>
                            Итого:
                          </td>
                          <td className="text-end">
                            {msToHMS(overtimeTotals.duration)}
                          </td>
                          <td className="text-end">
                            {formatPrice(overtimeTotals.cost)}
                          </td>
                        </tr>
                      </tfoot>
                    </Table>
                  </>
                )}
                <h3>Выполнены в рабочее время</h3>
                <Table bordered>
                  <thead>
                    <tr>
                      <th>Заявки</th>
                      <th>Инициаторы</th>
                      <th>Категории</th>
                      <th>Описание работ</th>
                      <th>Исполнитель</th>
                      <th className="text-end">Длительность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worktime.worktimeWorks.map((work) => (
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
                        <td data-cell="длительность" className="text-end">
                          {msToHMS(
                            calcRoundedWorkTime(work, plan.tariffingPeriod),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-secondary fw-bold">
                      <td className="text-end" colSpan={5}>
                        Итого:
                      </td>
                      <td className="text-end">
                        {msToHMS(
                          overallRoundedWorktime(
                            worktime.worktimeWorks,
                            plan.tariffingPeriod,
                          ),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
            {plan?.tariffing?.type === "hourly" && (
              <>
                <h3>Почасовая оплата</h3>
                <Alert variant="light" className="my-3 py-2">
                  <ul className="m-0">
                    <li>{`Период тарификации: ${plan.tariffingPeriod} минут`}</li>
                    <li>{`Стоимость 1 часа: ${formatPrice(plan.pricePerHour)}`}</li>
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
                      <th className="text-end">Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {works
                      .filter((work) => work.finishedAt !== work.startedAt)
                      .map((work) => (
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
                          <td data-cell="длительность" className="text-end">
                            {msToHMS(
                              calcRoundedWorkTime(work, plan.tariffingPeriod),
                            )}
                          </td>
                          <td data-cell="стоимость" className="text-end">
                            {formatPrice(
                              calculateCost(
                                calcRoundedWorkTime(
                                  work,
                                  plan.tariffingPeriod,
                                ) /
                                  (1000 * 60),
                                plan.pricePerHour,
                                plan.tariffingPeriod,
                              ),
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="table-secondary fw-bold">
                      <td className="text-end" colSpan={5}>
                        Итого:
                      </td>
                      <td className="text-end">
                        {msToHMS(
                          overallRoundedWorktime(works, plan.tariffingPeriod),
                        )}
                      </td>
                      <td className="text-end">
                        {formatPrice(hourlyTotalCost())}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </>
            )}
          </Container>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default DetailedViewOffcanvas;
