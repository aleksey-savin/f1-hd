import { useContext, useState } from "react";
import { Link, useNavigate, Outlet } from "react-router";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Table from "react-bootstrap/Table";
import Image from "react-bootstrap/Image";
import Accordion from "react-bootstrap/Accordion";
import Alert from "react-bootstrap/Alert";
import Offcanvas from "react-bootstrap/Offcanvas";

import ResetPassword from "./ResetPassword";

import { RiEdit2Line, RiArrowGoBackFill } from "react-icons/ri";

import { formatDate, formatShortDate } from "../../util/format-date";

import Transitions from "../../animations/Transition";

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import DeleteItem from "../DeleteItem";
import ImageUpload from "./ImageUpload";

const ViewUser = ({ user, tickets }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const authedUser = useContext(AuthedUserContext);

  const {
    permissions,
    telegramBot,
    notify,
    isAdmin,
    isEndUser,
    isServiceAccount,
    isCloudTelephony,
    dashboard,
    getScreen,
  } = user;

  const [profileImage, setProfileImage] = useState(
    user.profileImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.profileImagePath}`
      : "/profilepic-placeholder.jpg",
  );

  const {
    canSeeAllCompanyTickets,
    canEditTickets,
    canPerformTickets,
    canAdministrateTickets,
    canDeleteTickets,
    canSeeAllTickets,
    canUseTimeTrackingModule,
    canSeeWorksReport,
    canSeeAnalytics,
    canAvoidWorks,
    canUseInventoryModule,
    canManageClientDevices,
    canManageMikrotikDevices,
    canUseFinancesModule,
    canManageServicePlans,
    canSeeGlobalFinancialReport,
    canConfirmReportActions,
    canSeePersonalFinancialReport,
    canManageCompanies,
    canManageUsers,
    canManageTicketCategories,
    canManageRoutineTasks,
    canUpdateChangelog,
  } = permissions;

  const ticketWorkFlowPermissions = [
    {
      permission: canSeeAllCompanyTickets,
      label: "Отображение всех заявок своей компании",
    },
    {
      permissions: canSeeAllTickets,
      label: "Отображение всех заявок в системе",
    },
    { permission: canPerformTickets, label: "Выполнение заявок" },
    { permission: canAdministrateTickets, label: "Администрирование заявок" },
    { permission: canEditTickets, label: "Полное редактирование заявок" },
    { permission: canDeleteTickets, label: "Удаление заявок" },
  ];

  const portalAdminPermissions = [
    {
      permission: canManageCompanies,
      label: "Управление компаниями",
    },
    {
      permissions: canManageUsers,
      label: "Управление пользователями",
    },
    {
      permission: canManageTicketCategories,
      label: "Управление категориями заявок",
    },
    {
      permission: canManageRoutineTasks,
      label: "Управление регламентными заданиями",
    },
    {
      permission: canUpdateChangelog,
      label: "Управление записями в changelog",
    },
  ];

  const timeTrackingModulePermissions = [
    {
      permission: canUseTimeTrackingModule,
      label: "Разрешено использование модуля",
      bg: "success",
    },
    {
      permission: canAvoidWorks,
      label: "Можно не указывать работы",
    },
    {
      permission: canSeeWorksReport,
      label: "Формирование и просмотр отчёта по работам",
    },
    {
      permission: canSeeAnalytics,
      label: "Просмотр аналитики и трендов",
    },
  ];

  const inventoryModulePermissions = [
    {
      permission: canUseInventoryModule,
      label: "Разрешено использование модуля",
      bg: "success",
    },
    {
      permission: canManageClientDevices,
      label: "Управление устройствами",
    },
    {
      permission: canManageMikrotikDevices,
      label: "Управление устройствами Mikrotik",
    },
  ];

  const financesModulePermissions = [
    {
      permission: canUseFinancesModule,
      label: "Разрешено использование модуля",
      bg: "success",
    },
    {
      permission: canManageServicePlans,
      label: "Управление услугами",
    },
    {
      permission: canSeeGlobalFinancialReport,
      label: "Просмотр отчётов по оказанным услугам",
    },
    {
      permission: canConfirmReportActions,
      label: "Утверждение отчётов со стороны Исполнителя",
    },
    {
      permission: canSeePersonalFinancialReport,
      label: "Просмотр персонального отчёта",
    },
  ];

  const dashboardPermissions = [
    {
      permission: dashboard.isActive,
      label: "Разрешено использование",
      bg: "success",
    },
    {
      permission: dashboard.globalActions,
      label: "Глобальные действия",
    },
    {
      permission: dashboard.globalTasks,
      label: "Глобальные задачи",
    },
    {
      permission: dashboard.globalStats,
      label: "Глобальная статистика",
    },
    {
      permission: dashboard.personalActions,
      label: "Персональные действия",
    },
    {
      permission: dashboard.personalTasks,
      label: "Персональные задачи",
    },
    {
      permission: dashboard.personalStats,
      label: "Персональная статистика",
    },
  ];

  const globalRoles = [
    {
      role: isAdmin,
      label: "Администратор",
    },
    { role: isEndUser, label: "Конечный пользователь / Клиент" },
    { role: isServiceAccount, label: "Сервисный аккаунт" },
    { role: isCloudTelephony, label: "Облачная телефония" },
  ];

  const telegramNotifications = [
    {
      notification: telegramBot.isActive,
      label: "Подключен telegram-бот",
      bg: "success",
    },
    {
      notification: notify.byTelegram.newTicket && telegramBot.isActive,
      label: "Новая заявка",
    },
    {
      notification: notify.byTelegram.respStateUpdate && telegramBot.isActive,
      label: "Изменение статуса ответственного за заявку",
    },
    {
      notification: notify.byTelegram.ticketStateUpdate && telegramBot.isActive,
      label: "Изменение статуса заявки",
    },
    {
      notification: notify.byTelegram.ticketNewComment && telegramBot.isActive,
      label: "Новые комментарии",
    },
    {
      notification: notify.byTelegram.scheduledWorks && telegramBot.isActive,
      label: "Запланированные работы",
    },
  ];

  const emailNotifications = [
    {
      notification: notify.byEmail.newTicket,
      label: "Новая заявка",
    },
    {
      notification: notify.byEmail.respStateUpdate,
      label: "Изменение статуса ответственного за заявку",
    },
    {
      notification: notify.byEmail.ticketStateUpdate,
      label: "Изменение статуса заявки",
    },
    {
      notification: notify.byEmail.ticketNewComment,
      label: "Новые комментарии",
    },
    {
      notification: notify.byEmail.scheduledWorks,
      label: "Запланированные работы",
    },
  ];
  return (
    <>
      <Transitions>
        <Row className="justify-content-md-end mb-3">
          <Col xs="5" sm="auto" className="mb-3 flex-shrink-1">
            <Image
              src={profileImage}
              style={{ maxHeight: "20rem" }}
              roundedCircle
            />
          </Col>
          <Col>
            <Link to={`/companies/${user.company._id}`}>
              <h5>{user.company.alias}</h5>
            </Link>
            <h3>
              {user.firstName} {user.lastName}
            </h3>
            <p className="lead">{user.position}</p>
            <p>
              <em>
                Последний вход:{" "}
                {user.lastLogin ? formatDate(user.lastLogin) : "никогда"}
              </em>
            </p>
          </Col>
          <Col sm="auto" className="mb-2">
            {user.isActive && <Badge bg="success">Включен</Badge>}
            {!user.isActive && <Badge bg="danger">Отключен</Badge>}
          </Col>
        </Row>
        <Row className="mb-3">
          <Col>
            <ImageUpload
              userId={user._id.toString()}
              setProfileImage={setProfileImage}
            />
          </Col>
        </Row>
        <Row className="mb-2">
          <Col xs="auto" xl="4">
            <h4>Контакты</h4>
            <Table>
              <tbody>
                <tr>
                  <th>Почта</th>
                  <td>
                    <a href={"mailto:" + user.email}>{user.email}</a>
                  </td>
                </tr>
                <tr>
                  <th>Телефон</th>
                  <td>
                    <a href={"tel:" + user.phone}>{user.phone}</a>
                  </td>
                </tr>
              </tbody>
            </Table>
          </Col>
        </Row>
        {authedUser.permissions.canManageUsers && (
          <>
            <Row className="mb-2">
              <Col xs="auto">
                <h4>Права</h4>
                <Table>
                  <tbody>
                    <tr>
                      <th>Глобальная роль</th>
                      <td>
                        <ul
                          style={{ listStyle: "none", paddingLeft: 0 }}
                          className="my-0"
                        >
                          {globalRoles
                            .filter((item) => item.role)
                            .map((item) => (
                              <li key={item.role}>{item.label}</li>
                            ))}
                        </ul>
                      </td>
                    </tr>
                    <tr>
                      <th>Управление заявками</th>
                      <td>
                        {ticketWorkFlowPermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge key={item.label} className="mx-1">
                              {item.label}
                            </Badge>
                          ))}
                        {ticketWorkFlowPermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Администрирование портала</th>
                      <td>
                        {portalAdminPermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge key={item.label} className="mx-1">
                              {item.label}
                            </Badge>
                          ))}
                        {ticketWorkFlowPermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Учёт времени</th>
                      <td>
                        {timeTrackingModulePermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {timeTrackingModulePermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Учёт техники</th>
                      <td>
                        {inventoryModulePermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {inventoryModulePermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Учёт финансов</th>
                      <td>
                        {financesModulePermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {financesModulePermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Dashboard</th>
                      <td>
                        {dashboardPermissions
                          .filter((item) => item.permission)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {financesModulePermissions.filter(
                          (item) => item.permission,
                        ).length === 0 && (
                          <Badge bg="warning">Нет активных разрешений</Badge>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Col>
            </Row>
            <Row className="mb-2">
              <Col sm="6">
                <h4>Уведомления</h4>
                <Table>
                  <tbody>
                    <tr>
                      <th>Telegram</th>
                      <td>
                        {telegramNotifications
                          .filter((item) => item.notification)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {telegramNotifications.filter(
                          (item) => item.notification,
                        ).length === 0 && (
                          <Badge bg="warning">Уведомления отключены</Badge>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Email</th>
                      <td>
                        {emailNotifications
                          .filter((item) => item.notification)
                          .map((item) => (
                            <Badge
                              key={item.label}
                              bg={item.bg ? item.bg : "primary"}
                              className="mx-1"
                            >
                              {item.label}
                            </Badge>
                          ))}
                        {emailNotifications.filter((item) => item.notification)
                          .length === 0 && (
                          <Badge bg="warning">Уведомления отключены</Badge>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Col>
            </Row>
          </>
        )}

        {user.permissions?.canPerformTickets && (
          <Row className="mb-2">
            <Col className="mb-2">
              <h4>Категории</h4>
              {user.categories
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((category) => {
                  return (
                    <Badge key={category.title} className="mx-1">
                      {category.title}
                    </Badge>
                  );
                })}
            </Col>
          </Row>
        )}
        <Row className="mb-2">
          <Col sm="6">
            <h4>Интеграции</h4>
            <Table>
              <tbody>
                <tr>
                  <th>Pro32Connect (GetScreen)</th>
                  <td>
                    <Badge bg={getScreen?.api ? "success" : "warning"}>
                      {getScreen?.api ? "Активна" : "Отключена"}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </Table>
          </Col>
        </Row>

        <Row className="mb-2">
          <Col className="mb-2">
            <h4>Заявки</h4>
            {tickets.length > 0 && (
              <Accordion className="mb-2">
                <Accordion.Item eventKey="0">
                  <Accordion.Header>{`Раскрыть список (${tickets.length} записей)`}</Accordion.Header>
                  <Accordion.Body>
                    <Table responsive>
                      <thead>
                        <tr>
                          <th>Номер</th>
                          <th>Тема</th>
                          <th>Создана</th>
                          <th>Статус</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((ticket) => {
                          return (
                            <tr key={ticket._id}>
                              <td data-cell="Номер">
                                <Link
                                  to={"/tickets/" + ticket.num}
                                  target="_blank"
                                >
                                  {ticket.num}
                                </Link>
                              </td>
                              <td data-cell="Тема">{ticket.title}</td>
                              <td data-cell="Создана">
                                {formatShortDate(ticket.createdAt)}
                              </td>
                              <td data-cell="Статус">{ticket.state}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </Accordion.Body>
                </Accordion.Item>
              </Accordion>
            )}
            {tickets.length === 0 && (
              <Alert variant="light" className="text-centered mb-2">
                Заявки не найдены
              </Alert>
            )}
          </Col>
        </Row>
        <Row className="py-3 border-top justify-content-end gap-2">
          <Col sm="auto">
            <Button
              onClick={() => navigate("/users")}
              className="mb-2 w-100"
              variant="secondary"
            >
              <RiArrowGoBackFill /> К списку
            </Button>
          </Col>
          {authedUser.permissions.canManageUsers && (
            <>
              <Col sm="auto">
                <Button as={Link} to={`update`} className="mb-2 w-100">
                  <RiEdit2Line /> Изменить
                </Button>
              </Col>
              {!user.isServiceAccount && (
                <Col sm="auto">
                  <ResetPassword user={user} />
                </Col>
              )}
              <Col sm="auto">
                <DeleteItem isButton item={user} />
              </Col>
            </>
          )}
        </Row>
        <Offcanvas
          show={offcanvas.isActive}
          onHide={() => {
            navigate(-1);
            offcanvas.setClose();
          }}
          keyboard
          placement="bottom"
          className="h-100"
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title></Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <Outlet />
          </Offcanvas.Body>
        </Offcanvas>
      </Transitions>
    </>
  );
};

export default ViewUser;
