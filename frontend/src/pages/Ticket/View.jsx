import { useState, useEffect, useRef, useContext } from "react";

import {
  useLoaderData,
  redirect,
  useNavigation,
  Outlet,
  useNavigate,
  useFetchers,
  useRevalidator,
} from "react-router";

import "react-h5-audio-player/lib/styles.css";

import { motion } from "framer-motion";

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
import Tabs from "react-bootstrap/Tabs";
import Tab from "react-bootstrap/Tab";
import ListGroup from "react-bootstrap/ListGroup";

import { formatDate } from "../../util/format-date";
import { getLocalStorageData } from "../../util/auth";

import { RiHistoryLine, RiComputerLine, RiCheckLine } from "react-icons/ri";

import BootstrapSpinner from "react-bootstrap/Spinner";

import Comments from "../../components/Comment/List";
import Works from "../../components/Work/List";

import Attachments from "../../components/Ticket/View/Attachments";
import ApplicantModal from "../../components/Ticket/View/ApplicantModal";
import CompanyModal from "../../components/Ticket/View/CompanyModal";
import DescriptionCard from "../../components/Ticket/View/DescriptionCard";
import AiAssistant from "../../components/Ticket/View/AiAssistant";
import EnvironmentViewer from "../../components/Ticket/View/EnvironmentViewer";
import AiSpeechBadge from "../../UI/AiSpeechBadge";
import AiCategoryBadge from "../../UI/AiCategoryBadge";
import CompanyLogsOffcanvas from "../../components/CompanyLogs/Offcanvas";
import RelatedNotes from "../../components/Ticket/RelatedNotes";

import TakeToWork from "../../components/Ticket/Actions/TakeToWork";
import ProcessTicket from "../../components/Ticket/Actions/Process";
import CloseTicket from "../../components/Ticket/Actions/Close";
import BackToWork from "../../components/Ticket/Actions/BackToWork";
import JoinResponsibles from "../../components/Ticket/Actions/JoinResponsibles";
import Pro32Connect from "../../components/Integrations/Pro32Connect";

import Error from "../Error";

import ChecklistItem from "../../components/Ticket/View/ChecklistItem";
import ActionDropdown from "../../components/Ticket/View/ActionsDropDown";

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import useInitialPrefsStore from "../../store/prefs";
import usePolling from "../../hooks/use-polling";

import CustomFieldsDisplay from "../../components/CustomFieldsDisplay";
import { Alert } from "react-bootstrap";
import WorkingStatusIndicator from "../../components/Company/WorkingStatusIndicator";

// Слепок «значимого» состояния заявки. Если он меняется между опросами — значит
// заявку обновили (чужой комментарий, смена статуса, дедлайн, ответственные,
// чек-лист, ИИ-статусы) и нужно тихо ревалидировать loader. Комментарии живут
// отдельной коллекцией и могут не двигать ticket.updatedAt — учитываем их явно.
const ticketSignature = (ticket) =>
  [
    ticket?.updatedAt,
    ticket?.state,
    ticket?.deadline,
    ticket?.comments?.length,
    ticket?.responsibles?.length,
    ticket?.checklist?.map((item) => `${item._id}:${item.checked}`).join(","),
    ticket?.aiSpeech?.status,
    ticket?.aiCategory?.status,
    ticket?.aiGuide?.status,
  ].join("|");

const ViewTicket = () => {
  const { state: routerState } = useNavigation();

  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const { modules, ai } = useInitialPrefsStore();
  const data = useLoaderData();
  const { ticketData, otherCompanyTickets, responsiblesData } = data;

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

  const { _id: userId, permissions, isEndUser } = useContext(AuthedUserContext);
  const { canAvoidWorks, canUseTimeTrackingModule } = permissions;

  const isOverdue =
    !!ticket?.deadline &&
    new Date(ticket.deadline) < new Date() &&
    ticket.state !== "Закрыта";

  const [badgeBg, setBadgeBg] = useState("light");

  const [closeTicketIsActive, setCloseTicketIsActive] = useState(false);

  // Состояние для Offcanvas с логами
  const [showLogsOffcanvas, setShowLogsOffcanvas] = useState(false);
  const [logsSearchQuery, setLogsSearchQuery] = useState("");

  // Кол-во связанных заметок базы знаний — для счётчика во вкладке
  const [relatedNotesCount, setRelatedNotesCount] = useState(0);

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

  // Постоянное фоновое автообновление заявки: опрашиваем лёгкий GET, сравниваем
  // слепок состояния и тихо ревалидируем loader при изменениях (чужой
  // комментарий, смена статуса, новые работы, чек-лист, ИИ-бейджи). Ревалидация
  // не триггерит navigation "loading" — спиннер и fade не появляются.
  // Не вмешиваемся во время сабмита действия/навигации и при открытой
  // Offcanvas-форме, чтобы не затереть ввод. Пауза при скрытой вкладке — внутри
  // usePolling.
  const revalidator = useRevalidator();
  // Сабмит действия по заявке идёт через fetcher и НЕ меняет navigation state,
  // поэтому фетчеры проверяем отдельно. Ревалидация во время висящего фетчера
  // роняет роутер ("Did not find corresponding fetcher result") и способна
  // затереть оптимистичный ввод — на это время автообновление ставим на паузу.
  const fetchers = useFetchers();
  const hasActiveFetcher = fetchers.some((f) => f.state !== "idle");
  const autoUpdateEnabled =
    routerState === "idle" &&
    revalidator.state === "idle" &&
    !hasActiveFetcher &&
    !offcanvas.isActive;

  usePolling(
    async () => {
      if (!ticket?.num) return;
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) return;
        const data = await response.json();
        if (
          data?.ticket &&
          ticketSignature(data.ticket) !== ticketSignature(ticket)
        ) {
          revalidator.revalidate();
        }
      } catch (error) {
        console.error("Ticket auto-update poll failed:", error);
      }
    },
    { intervalMs: 15000, enabled: autoUpdateEnabled },
  );

  const firstColumnRef = useRef();

  const [firstColumnHeight, setFirstColumnHeight] = useState("0px");
  const [firstColumnClassName, setFirstColumnClassName] = useState("");

  const screenWidth = window.innerWidth;
  const isWideLayout = screenWidth >= 1500;

  useEffect(() => {
    const updateFirstColumnHeight = () => {
      if (firstColumnRef.current && isWideLayout) {
        setFirstColumnHeight(firstColumnRef.current.clientHeight + "px");
        setFirstColumnClassName("col col-8 border-end d-flex flex-column");
      } else {
        setFirstColumnHeight("100%");
        setFirstColumnClassName("col mb-3");
      }
    };

    updateFirstColumnHeight();

    window.addEventListener("resize", updateFirstColumnHeight);

    return () => {
      window.removeEventListener("resize", updateFirstColumnHeight);
    };
  }, [isWideLayout]);

  return (
    <>
      {routerState === "idle" && ticket?.num && (
        <Transitions>
          <Row>
            <Col
              ref={firstColumnRef}
              className={firstColumnClassName}
              style={{
                minHeight: isWideLayout ? "calc(100svh - 156px)" : undefined,
              }}
            >
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
                          <motion.span
                            key={ticket.state}
                            className="d-block w-100"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.3 }}
                          >
                            <Badge bg={badgeBg} className="w-100">
                              {ticket.state}
                            </Badge>
                          </motion.span>
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
                          <motion.span
                            key={ticket.state}
                            className="d-inline-block"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.3 }}
                          >
                            <Badge bg={badgeBg}>{ticket.state}</Badge>
                          </motion.span>
                        </h3>
                      </BrowserView>
                    </Col>
                  </Row>
                  <Row className="mb-2">
                    <Col>
                      <div className="d-flex justify-content-between align-items-center gap-2">
                        <h1 className="display-6 mb-0">{ticket.title}</h1>
                        {!isEndUser && (
                          <div className="d-flex flex-shrink-0 gap-2 mt-1">
                            <AiSpeechBadge status={ticket.aiSpeech?.status} />
                            <AiCategoryBadge
                              status={ticket.aiCategory?.status}
                            />
                          </div>
                        )}
                      </div>
                    </Col>
                  </Row>
                  <Row className="mb-2">
                    <Col>
                      <DescriptionCard ticket={ticket} />
                    </Col>
                  </Row>
                  <CustomFieldsDisplay customFields={ticket.customFields} />
                  <Tabs
                    defaultActiveKey="info"
                    className="mb-3 scrollable-tabs"
                  >
                    <Tab eventKey="info" title="Информация">
                      <h6>
                        <Row>
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
                                    className={isOverdue ? "text-danger" : ""}
                                  >
                                    {ticket.deadline && (
                                      <>{formatDate(ticket.deadline)}</>
                                    )}
                                    {isOverdue && (
                                      <Badge bg="danger" className="ms-2">
                                        Просрочена
                                      </Badge>
                                    )}
                                  </td>
                                </tr>
                                {ticket.realSender && (
                                  <tr>
                                    <th>Отправитель</th>
                                    <td>{ticket.realSender}</td>
                                  </tr>
                                )}
                                <tr>
                                  <th>Компания</th>
                                  <td>
                                    <h5 className="mb-0 d-flex align-items-center flex-wrap gap-2">
                                      <CompanyModal
                                        ticket={ticket}
                                        company={company}
                                      />
                                      <small>
                                        <WorkingStatusIndicator
                                          workSchedule={company.workSchedule}
                                        />
                                      </small>
                                      {!isEndUser && (
                                        <Button
                                          onClick={() => handleShowLogs()}
                                          size="sm"
                                          variant="outline-info"
                                          title="Лог активности компании"
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
                                            title="Лог активности пользователя"
                                          >
                                            <RiHistoryLine />
                                          </Button>
                                        )}
                                    </h5>
                                  </td>
                                </tr>
                                {!isEndUser &&
                                  ticket.applicant?.computer?.name && (
                                    <tr>
                                      <th>Компьютер</th>
                                      <td>
                                        <span className="d-inline-flex align-items-center gap-1">
                                          <RiComputerLine />
                                          <span className="font-monospace">
                                            {ticket.applicant.computer.name}
                                          </span>
                                          {ticket.applicant.computer
                                            .activeDirectoryLogin && (
                                            <small className="text-muted ms-1">
                                              (
                                              {
                                                ticket.applicant.computer
                                                  .activeDirectoryLogin
                                              }
                                              )
                                            </small>
                                          )}
                                        </span>
                                        {ticket.applicant.computer
                                          .lastSeenAt && (
                                          <div>
                                            <small className="text-muted">
                                              Вход:{" "}
                                              {formatDate(
                                                ticket.applicant.computer
                                                  .lastSeenAt,
                                              )}
                                            </small>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                <tr>
                                  <th>Ответственные</th>
                                  <td>
                                    <h5 className="mb-0">
                                      {ticket.responsibles?.map((user) => (
                                        <Badge
                                          bg="secondary"
                                          style={{ marginLeft: "0.5rem" }}
                                          key={user._id}
                                        >
                                          {user.lastName + " " + user.firstName}
                                        </Badge>
                                      ))}
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
                    </Tab>
                    {!isEndUser &&
                      modules.inventory?.isActive &&
                      permissions.canUseInventoryModule && (
                        <Tab eventKey="environment" title="Окружение">
                          <EnvironmentViewer
                            userId={ticket.applicant?._id}
                            deviceId={ticket.relatedClientDeviceId}
                          />
                        </Tab>
                      )}
                    <Tab
                      eventKey="attachments"
                      title={
                        <>
                          Вложения{" "}
                          {ticket.attachments?.length > 0 && (
                            <Badge bg="secondary" pill>
                              {ticket.attachments.length}
                            </Badge>
                          )}
                        </>
                      }
                    >
                      <Attachments ticket={ticket} />
                    </Tab>
                    {modules.timeTracking.isActive &&
                      canUseTimeTrackingModule && (
                        <Tab
                          eventKey="works"
                          title={
                            <>
                              Работы{" "}
                              {works.length > 0 && (
                                <Badge bg="secondary" pill>
                                  {works.length}
                                </Badge>
                              )}
                            </>
                          }
                        >
                          <Works
                            ticket={ticket}
                            company={company}
                            otherCompanyTickets={otherCompanyTickets}
                            responsibles={responsiblesData}
                            works={works}
                            closeTicketIsActive={closeTicketIsActive}
                          />
                        </Tab>
                      )}
                    {modules.knowledgeBase.isActive &&
                      permissions?.canSeeKnowledgeBase && (
                        <Tab
                          eventKey="knowledge"
                          title={
                            <>
                              База знаний{" "}
                              <Badge bg="secondary" pill>
                                {relatedNotesCount}
                              </Badge>
                            </>
                          }
                        >
                          <RelatedNotes
                            companyId={ticket.company?._id}
                            categoryId={ticket.category?._id}
                            applicantId={ticket.applicant?._id}
                            onCountChange={setRelatedNotesCount}
                          />
                        </Tab>
                      )}
                    {!isEndUser && ai?.isActive && (
                      <Tab
                        eventKey="ai"
                        title={
                          <>
                            AI-ассистент{" "}
                            {ticket.aiGuide?.status === "pending" && (
                              <BootstrapSpinner
                                animation="border"
                                size="sm"
                                title="ИИ готовит руководство"
                              />
                            )}
                            {ticket.aiGuide?.status === "ready" && (
                              <Badge
                                bg="success"
                                pill
                                title="Руководство сформировано"
                              >
                                <RiCheckLine className="align-middle" />
                              </Badge>
                            )}
                          </>
                        }
                      >
                        <AiAssistant />
                      </Tab>
                    )}
                    {!isEndUser && (
                      <Tab
                        eventKey="log"
                        title={
                          <>
                            Лог{" "}
                            {logs?.length > 0 && (
                              <Badge bg="secondary" pill>
                                {logs.length}
                              </Badge>
                            )}
                          </>
                        }
                      >
                        <ListGroup variant="flush">
                          {logs?.length > 0 ? (
                            logs.map((entry) => (
                              <ListGroup.Item key={entry._id}>
                                <Badge className="me-2" bg={entry.severity}>
                                  {entry.severity}
                                </Badge>
                                {entry.user
                                  ? `${formatDate(entry.createdAt)} — ${entry.user.firstName} ${entry.user.lastName}, ${entry.event}`
                                  : `${formatDate(entry.createdAt)} — ${entry.event}`}
                              </ListGroup.Item>
                            ))
                          ) : (
                            <Alert variant="light">Нет записей</Alert>
                          )}
                        </ListGroup>
                      </Tab>
                    )}
                  </Tabs>
                </Col>
              </Row>
              <Row className="mt-auto pt-3">
                <Col>
                  {!ticket.isArchived && (
                    <Row id="ticket-actions">
                      <ProcessTicket ticket={ticket} />
                      <JoinResponsibles ticket={ticket} />
                      <TakeToWork ticket={ticket} />
                      <CloseTicket
                        scheduledWorks={
                          works.filter(
                            (item) => !item.finishedAt && item.planningToStart,
                          ).length > 0
                        }
                      />
                      <Pro32Connect ticket={ticket} />
                      {ticket.state === "Закрыта" && (
                        <Col sm="auto">
                          <BackToWork ticket={ticket} />
                        </Col>
                      )}
                      <ActionDropdown
                        ticket={ticket}
                        isOverdue={isOverdue}
                        responsibles={responsiblesData}
                      />
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
        // У заявки может не быть компании (легаси системных заявок) — такие в
        // «другие заявки компании» не попадают, и сравнение undefined ===
        // undefined не должно склеивать две заявки без компании.
        const currentCompanyId = ticketData.ticket?.company?._id;
        return (
          currentCompanyId &&
          ticket?.company?._id?.toString() === currentCompanyId.toString() &&
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
      expectedVersion: data.get("expectedVersion"),
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

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }

  if (intent === "requestHelp") {
    const ticketData = {
      _id: data.get("_id"),
      responsibles: JSON.parse(data.getAll("responsibles")),
      expectedVersion: data.get("expectedVersion"),
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

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

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
          expectedVersion: data.get("expectedVersion"),
        }),
      },
    );

    if (response.status === 409) {
      return await response.json();
    }

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
