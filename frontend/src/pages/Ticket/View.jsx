import { useState, useEffect, useRef, useContext } from "react";

import {
  useLoaderData,
  redirect,
  useNavigation,
  Outlet,
  useNavigate,
  useFetcher,
} from "react-router";

import "react-h5-audio-player/lib/styles.css";

import useViewTicketStore from "../../store/view-ticket";

import { BrowserView, MobileView } from "react-device-detect";

import Transitions from "../../animations/Transition";
import Spinner from "../../animations/Spinner";

import Offcanvas from "react-bootstrap/Offcanvas";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import Table from "react-bootstrap/Table";
import Button from "react-bootstrap/Button";

import { formatDate } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

import { RiHistoryLine } from "react-icons/ri";

import Comments from "../../components/Comment/List";
import Works from "../../components/Work/List";

import DisplayOriginalModal from "../../components/Ticket/View/DisplayOriginalModal";
import Attachments from "../../components/Ticket/View/Attachments";
import ApplicantModal from "../../components/Ticket/View/ApplicantModal";
import CompanyModal from "../../components/Ticket/View/CompanyModal";
import DescriptionCard from "../../components/Ticket/View/DescriptionCard";
import CompanyLogsOffcanvas from "../../components/CompanyLogs/Offcanvas";

import TakeToWork from "../../components/Ticket/Actions/TakeToWork";
import ProcessTicket from "../../components/Ticket/Actions/Process";
import CloseTicket from "../../components/Ticket/Actions/Close";
import BackToWork from "../../components/Ticket/Actions/BackToWork";
import JoinResponsibles from "../../components/Ticket/Actions/JoinResponsibles";
import Pro32Connect from "../../components/Integrations/Pro32Connect";

import Error from "../Error";

import ChecklistItem from "../../components/Ticket/View/ChecklistItem";
import ActionDropdown from "../../components/Ticket/View/ActionsDropDown";
import TicketLogList from "../../components/TicketLog/List";

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import useInitialPrefsStore from "../../store/prefs";

import CustomFieldsDisplay from "../../components/CustomFieldsDisplay";
import { Alert } from "react-bootstrap";
import WorkingStatusIndicator from "../../components/Company/WorkingStatusIndicator";

const ViewTicket = () => {
  const { state: routerState } = useNavigation();
  const fetcher = useFetcher();

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { modules } = useInitialPrefsStore();
  const data = useLoaderData();
  const { ticketData, otherCompanyTickets, responsiblesData } = data;

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load();
    }
  }, [fetcher]);

  const { ticket, company, works, logs } = ticketData;

  const ticketStore = useViewTicketStore();
  useEffect(() => {
    ticketStore.updateTicket(ticket);
    ticketStore.updateCompany(company);
    ticketStore.updateResponsibles(responsiblesData);
    ticketStore.updateComments(ticket.comments);
    ticketStore.updateWorks(works);
    ticketStore.updateOtherCompanyTickets(otherCompanyTickets);
  }, [ticket, company, works, otherCompanyTickets, responsiblesData]);

  const { _id: userId, permissions, isClient } = useContext(AuthedUserContext);
  const { canAvoidWorks, canUseTimeTrackingModule } = permissions;

  const [isOverdue, setIsOverdue] = useState(false);

  const [badgeBg, setBadgeBg] = useState("light");

  const [closeTicketIsActive, setCloseTicketIsActive] = useState(false);

  // Состояние для Offcanvas с логами
  const [showLogsOffcanvas, setShowLogsOffcanvas] = useState(false);
  const [logsSearchQuery, setLogsSearchQuery] = useState("");

  const handleShowLogs = (searchQuery = "") => {
    setLogsSearchQuery(searchQuery);
    setShowLogsOffcanvas(true);
  };

  const handleCloseLogs = () => {
    setShowLogsOffcanvas(false);
    setLogsSearchQuery("");
  };

  useEffect(() => {
    const finishedWorks = works.filter(
      (item) =>
        item.finishedAt && userId.toString() === item.finishedBy._id.toString(),
    );
    if (
      finishedWorks.length > 0 ||
      canAvoidWorks ||
      !modules.timeTracking.isActive
    ) {
      setCloseTicketIsActive(true);
    } else {
      setCloseTicketIsActive(false);
    }
  }, [works, canAvoidWorks]);

  useEffect(() => {
    if (ticket) {
      setBadgeBg(
        ticket.state === "Новая"
          ? "warning"
          : ticket.state === "Не в работе"
            ? "warning"
            : ticket.state === "В работе"
              ? "info"
              : ticket.state === "Закрыта"
                ? "secondary"
                : "info",
      );
    }
  }, [ticket]);

  const firstColumnRef = useRef();

  const [firstColumnHeight, setFirstColumnHeight] = useState("0px");
  const [firstColumnClassName, setFirstColumnClassName] = useState("");

  const screenWidth = window.innerWidth;

  useEffect(() => {
    const updateFirstColumnHeight = () => {
      if (firstColumnRef.current && screenWidth >= 1500) {
        setFirstColumnHeight(firstColumnRef.current.clientHeight + "px");
        setFirstColumnClassName("col col-8 border-end");
      } else {
        setFirstColumnHeight("100%");
        setFirstColumnClassName("col mb-3");
      }
    };

    updateFirstColumnHeight(); // Set initial height

    // Update height when the window is resized
    window.addEventListener("resize", updateFirstColumnHeight);

    return () => {
      window.removeEventListener("resize", updateFirstColumnHeight);
    };
  }, [screenWidth]);

  return (
    <>
      {routerState === "idle" && ticket?.num && (
        <Transitions>
          <Row className="h-100">
            <Col ref={firstColumnRef} className={firstColumnClassName}>
              {ticket.isArchived && (
                <Row>
                  <Col>
                    <Alert variant="warning">
                      <strong>{`Заявка находится в архиве и привязана к отчёту за соответствующий период. Редактирование запрещено.`}</strong>
                    </Alert>
                  </Col>
                </Row>
              )}
              <Row>
                <Col>
                  <Row className="justify-content-md-between">
                    <MobileView>
                      <Col sm="auto">
                        <h3>
                          <Badge bg={badgeBg} className="w-100">
                            {ticket.state}
                          </Badge>
                        </h3>
                      </Col>
                    </MobileView>
                    <Col sm="auto">
                      <h3>
                        <Badge bg="secondary" className="w-100">
                          {ticket.num}
                        </Badge>
                      </h3>
                    </Col>
                    <Col sm="auto">
                      <BrowserView>
                        <h3>
                          <Badge bg={badgeBg}>{ticket.state}</Badge>
                        </h3>
                      </BrowserView>
                    </Col>
                  </Row>
                  <Row>
                    <Col>
                      <h1 className="display-6">{ticket.title}</h1>
                    </Col>
                  </Row>
                  <Row className="mb-2">
                    <Col>
                      <DescriptionCard ticket={ticket} />
                    </Col>
                  </Row>
                  <CustomFieldsDisplay customFields={ticket.customFields} />
                  <DisplayOriginalModal ticket={ticket} />
                  <Attachments ticket={ticket} />
                  <h6>
                    <Row className="mb-2">
                      <Col sm="12">
                        <Table>
                          <tbody>
                            <tr>
                              <th>Создана</th>
                              <td>{formatDate(ticket.createdAt)}</td>
                            </tr>
                            <tr>
                              <th>Дедлайн</th>
                              <td
                                className={
                                  isOverdue && ticket.state !== "Закрыта"
                                    ? "text-danger"
                                    : ""
                                }
                              >
                                {ticket.deadline && (
                                  <>{formatDate(ticket.deadline)}</>
                                )}
                              </td>
                            </tr>
                            {ticket.realSender && (
                              <>
                                <tr>
                                  <th>Отправитель</th>
                                  <td>{ticket.realSender}</td>
                                </tr>
                              </>
                            )}
                            <tr>
                              <th>Компания</th>
                              <td>
                                <h5 className="mb-0 d-flex align-items-center gap-2">
                                  <CompanyModal
                                    ticket={ticket}
                                    company={company}
                                  />
                                  <small className={`ms-2`}>
                                    <WorkingStatusIndicator
                                      workSchedule={company.workSchedule}
                                    />
                                  </small>
                                  {!isClient && (
                                    <Button
                                      onClick={() => handleShowLogs()}
                                      size="sm"
                                      variant="outline-info"
                                      title="Логи активности компании"
                                    >
                                      <RiHistoryLine />
                                    </Button>
                                  )}
                                </h5>
                              </td>
                            </tr>
                            <tr>
                              <th>Инициатор</th>
                              <td>
                                <h5 className="mb-0 d-flex align-items-center gap-2">
                                  <ApplicantModal ticket={ticket} />
                                  {permissions.canManageCompanies &&
                                    ticket.applicant
                                      ?.activeDirectoryObjectGUID && (
                                      <Button
                                        onClick={() =>
                                          handleShowLogs(
                                            `${ticket.applicant.firstName} ${ticket.applicant.lastName}`,
                                          )
                                        }
                                        size="sm"
                                        variant="outline-success"
                                        title="Логи активности пользователя"
                                      >
                                        <RiHistoryLine />
                                      </Button>
                                    )}
                                </h5>
                              </td>
                            </tr>
                            <tr>
                              <th>Ответственные</th>
                              <td>
                                <h5 className="mb-0">
                                  {ticket.responsibles?.map((user) => {
                                    return (
                                      <Badge
                                        bg="secondary"
                                        style={{
                                          marginLeft: "0.5rem",
                                        }}
                                        key={user._id}
                                      >
                                        {user.lastName + " " + user.firstName}
                                      </Badge>
                                    );
                                  })}
                                </h5>
                              </td>
                            </tr>
                            <tr>
                              <th>Категория</th>
                              <td>{ticket.category?.title}</td>
                            </tr>
                            <tr>
                              <th>Источник</th>
                              <td>{ticket.source}</td>
                            </tr>
                          </tbody>
                        </Table>
                      </Col>
                    </Row>
                  </h6>
                  <Row className="mb-3">
                    <Col>
                      {ticket.checklist.map((item) => (
                        <ChecklistItem
                          key={item._id}
                          item={item}
                          ticketResponsibles={ticket.responsibles}
                          ticketNum={ticket.num}
                        />
                      ))}
                    </Col>
                  </Row>
                  {/* ад, переделать */}
                  <Row className="mb-3" id="ticket-actions">
                    {!ticket.isArchived && (
                      <>
                        <ProcessTicket ticket={ticket} />
                        <JoinResponsibles ticket={ticket} />
                        <TakeToWork ticket={ticket} />
                        <CloseTicket
                          scheduledWorks={
                            works.filter(
                              (item) =>
                                !item.finishedAt && item.planningToStart,
                            ).length > 0
                          }
                        />
                        <Pro32Connect ticket={ticket} />
                        {ticket.state === "Закрыта" && (
                          <>
                            <Col sm="auto">
                              <BackToWork ticket={ticket} />
                            </Col>
                          </>
                        )}
                        <ActionDropdown
                          ticket={ticket}
                          isOverdue={isOverdue}
                          setIsOverdue={setIsOverdue}
                          responsibles={responsiblesData}
                        />
                      </>
                    )}
                    <TicketLogList logs={logs} />
                  </Row>
                  {modules.timeTracking.isActive &&
                    canUseTimeTrackingModule && (
                      <Row>
                        <Col sm="auto" className="w-100" id="works-section">
                          <Works
                            ticket={ticket}
                            company={company}
                            otherCompanyTickets={otherCompanyTickets}
                            responsibles={responsiblesData}
                            works={works}
                            closeTicketIsActive={closeTicketIsActive}
                          />
                        </Col>
                      </Row>
                    )}
                </Col>
              </Row>
            </Col>
            <Col
              xxl="4"
              style={{
                height: firstColumnHeight,
              }}
              className="overflow-y-auto m-0"
            >
              <h3>Комментарии</h3>
              <Comments ticket={ticket} />
            </Col>
          </Row>
        </Transitions>
      )}
      {data.error && <Error error={data} />}
      {routerState === "loading" && (
        <Transitions>
          <Spinner />
        </Transitions>
      )}
      <Offcanvas
        show={offcanvas.isActive}
        onHide={() => {
          navigate(-1);
          offcanvas.setClose();
        }}
        keyboard
        placement="bottom"
        className="h-100"
        backdrop={false}
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Outlet />
        </Offcanvas.Body>
      </Offcanvas>

      <CompanyLogsOffcanvas
        show={showLogsOffcanvas}
        onHide={handleCloseLogs}
        companyId={company._id}
        company={company}
        permissions={permissions}
        initialSearchQuery={logsSearchQuery}
      />
    </>
  );
};

export default ViewTicket;

export async function loader({ params }) {
  try {
    document.title = `ЗАЯВКА ${params.ticketNum}`;

    const { token, userId } = getLocalStorageData();

    const ticketResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${params.ticketNum}`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!ticketResponse.ok) {
      throw ticketResponse;
    }

    const ticketData = await ticketResponse.json();

    const responsiblesResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!responsiblesResponse.ok) {
      throw responsiblesResponse;
    }

    const openedTicketsResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/all-opened`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!openedTicketsResponse.ok) {
      throw openedTicketsResponse;
    }

    const openedTickets = await openedTicketsResponse.json();

    const additionalDataResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/works/additional-data/${params.ticketNum}`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!additionalDataResponse.ok) {
      throw additionalDataResponse;
    }

    const additionalData = await additionalDataResponse.json();

    return {
      ...additionalData,
      ticketData: ticketData,
      responsiblesData: await responsiblesResponse.json(),
      otherCompanyTickets: openedTickets.tickets.filter((ticket) => {
        const ticketCategory = ticket.categoryId
          ? ticket.categoryId.toString()
          : null;
        return (
          ticket?.company._id.toString() ===
            ticketData.ticket?.company._id.toString() &&
          ticket.num !== ticketData.ticket.num &&
          ticket.responsibles
            .map((user) => user._id.toString())
            .includes(userId) &&
          ticketCategory === ticketData.ticket.categoryId?.toString()
        );
      }),
    };
  } catch (error) {
    console.log(error);
  }
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const intent = data.get("intent");

  if (intent === "process") {
    const ticketData = {
      _id: data.get("_id"),
      title: data.get("title"),
      description: data.get("description"),
      company: JSON.parse(data.get("company")),
      categoryId: data.get("categoryId"),
      applicantId: data.get("applicantId"),
      responsibles: JSON.parse(data.getAll("responsibles")),
      deadline: new Date(data.get("deadline")),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(ticketData),
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "takeToWork") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/take-to-work`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          takeOver: data.get("takeOver") === "true",
        }),
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "reject") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/reject`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          rejectDesc: data.get("rejectDesc"),
        }),
      },
    );
    if (!response.ok) {
      throw response;
    }

    return redirect("/tickets");
  }

  if (intent === "join") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/join-responsibles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
        }),
      },
    );
    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "requestHelp") {
    const ticketData = {
      _id: data.get("_id"),
      responsibles: JSON.parse(data.getAll("responsibles")),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/request-help`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(ticketData),
      },
    );

    if (!response.ok) {
      throw response;
    }
    return response;
  }

  if (intent === "updateDeadline") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/update-deadline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          deadline: data.get("deadline"),
        }),
      },
    );
    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "close") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/close`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          closingComment: data.get("closingComment"),
        }),
      },
    );

    if ([403].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/tickets");
  }

  if (intent === "backToWork") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/back-to-work`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          _id: data.get("_id"),
          returningComment: data.get("returningComment"),
        }),
      },
    );
    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось вернуть заявку в работу" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "addComment") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/comments/add`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
        body: data,
      },
    );

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "updateChecklistItem") {
    const ticketNum = data.get("ticketNum");

    const checklistItem = {
      _id: data.get("itemId"),
      description: data.get("itemDescription"),
      checked: data.get("itemChecked"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/update-checklist-item`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(checklistItem),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "updateChecklist") {
    const ticketNum = data.get("ticketNum");

    const checklist = data.getAll("checklist");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/update-checklist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(checklist),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "delete") {
    const ticketId = data.get("id");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/delete/${ticketId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/tickets");
  }

  return null;
}
