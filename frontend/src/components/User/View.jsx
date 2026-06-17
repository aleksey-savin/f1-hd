import { useContext, useState } from "react";
import { Link, useNavigate, Outlet } from "react-router";

import { motion } from "framer-motion";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";
import Table from "react-bootstrap/Table";
import Tabs from "react-bootstrap/Tabs";
import Tab from "react-bootstrap/Tab";
import Alert from "react-bootstrap/Alert";
import ListGroup from "react-bootstrap/ListGroup";
import Offcanvas from "react-bootstrap/Offcanvas";

import ResetPassword from "./ResetPassword";

import {
  RiEdit2Line,
  RiArrowGoBackFill,
  RiShieldCheckLine,
  RiShieldUserLine,
  RiCheckLine,
  RiCloseLine,
  RiMailLine,
  RiPhoneLine,
  RiBuilding2Line,
  RiLoginCircleLine,
  RiContactsBook2Line,
  RiImageLine,
  RiPriceTag3Line,
  RiNotification3Line,
  RiTelegramLine,
  RiMailSendLine,
  RiRemoteControlLine,
  RiTicket2Line,
  RiSettings4Line,
  RiTimeLine,
  RiHardDrive2Line,
  RiMoneyDollarCircleLine,
  RiDashboardLine,
  RiVipCrownLine,
} from "react-icons/ri";

import { formatDate, formatShortDate } from "../../util/format-date";

import Transitions from "../../animations/Transition";

import { AuthedUserContext } from "../../store/authed-user-context";
import useOffcanvasStore from "../../store/offcanvas";
import DeleteItem from "../DeleteItem";
import ImageUpload from "./ImageUpload";
import ToggleActive from "./ToggleActive";
import LinkToActiveDirectory from "./LinkToActiveDirectory";

// Анимация появления шапки: лёгкий каскад (аватар «выезжает», текст следом)
const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};
const heroAvatar = {
  hidden: { opacity: 0, scale: 0.85 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, ease: "easeOut" },
  },
};

// Исходные массивы прав иногда задают флаг ключом `permissions` (опечатка) —
// читаем оба, чтобы такие пункты («все заявки в системе», «управление
// пользователями») перестали молча выпадать из отображения.
const toCap = (item) => ({
  label: item.label,
  granted: Boolean(item.permission ?? item.permissions),
});

// Превращаем массив прав модуля в { master, items }. Пункт с bg:"success" —
// это «рубильник» модуля: он становится статусом в шапке карточки, а не строкой.
const buildModule = (arr) => {
  const masterItem = arr.find((item) => item.bg === "success");
  return {
    master: masterItem
      ? Boolean(masterItem.permission ?? masterItem.permissions)
      : undefined,
    items: arr.filter((item) => item.bg !== "success").map(toCap),
  };
};

const ticketStateVariant = (state) =>
  state === "Новая" || state === "Не в работе"
    ? "warning"
    : state === "В работе"
      ? "info"
      : state === "Закрыта"
        ? "secondary"
        : "info";

// Строка возможности: зелёная галочка = есть, серый прочерк = нет
const CapRow = ({ on, children }) => (
  <div className={`cap-row ${on ? "cap-row--on" : "cap-row--off"}`}>
    <span className="cap-row__icon">
      {on ? <RiCheckLine /> : <RiCloseLine />}
    </span>
    <span>{children}</span>
  </div>
);

// Пилюля статуса модуля/интеграции
const StatusPill = ({ on, onText = "Активен", offText = "Отключён" }) => (
  <Badge bg={on ? "success" : "secondary"} className="ms-auto fw-normal">
    {on ? onText : offText}
  </Badge>
);

// Карточка группы возможностей: заголовок (+статус модуля) и список строк
const CapCard = ({ icon, title, items, master, masterOn, masterOff }) => (
  <Card className="border-0 shadow-sm h-100">
    <Card.Body>
      <div className="cap-card-title mb-3">
        {icon}
        <span>{title}</span>
        {master !== undefined && (
          <StatusPill on={master} onText={masterOn} offText={masterOff} />
        )}
      </div>
      <div className={master === false ? "opacity-50 cap-rows--disabled" : ""}>
        {items.map((item) => (
          <CapRow key={item.label} on={item.granted}>
            {item.label}
          </CapRow>
        ))}
      </div>
    </Card.Body>
  </Card>
);

// Контактная строка профиля
const ContactRow = ({ icon, label, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div className="contact-row__value">{children}</div>
    </div>
  </div>
);

const ViewUser = ({ user, tickets }) => {
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();
  const authedUser = useContext(AuthedUserContext);
  const canManageUsers = authedUser.permissions.canManageUsers;
  const canManageCompanies = authedUser.permissions.canManageCompanies;

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
    canManageCompanies: userCanManageCompanies,
    canManageUsers: userCanManageUsers,
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
      permission: canSeeAllTickets,
      label: "Отображение всех заявок в системе",
    },
    { permission: canPerformTickets, label: "Выполнение заявок" },
    { permission: canAdministrateTickets, label: "Администрирование заявок" },
    { permission: canEditTickets, label: "Полное редактирование заявок" },
    { permission: canDeleteTickets, label: "Удаление заявок" },
  ];

  const portalAdminPermissions = [
    { permission: userCanManageCompanies, label: "Управление компаниями" },
    { permission: userCanManageUsers, label: "Управление пользователями" },
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
    { permission: canAvoidWorks, label: "Можно не указывать работы" },
    {
      permission: canSeeWorksReport,
      label: "Формирование и просмотр отчёта по работам",
    },
    { permission: canSeeAnalytics, label: "Просмотр аналитики и трендов" },
  ];

  const inventoryModulePermissions = [
    {
      permission: canUseInventoryModule,
      label: "Разрешено использование модуля",
      bg: "success",
    },
    { permission: canManageClientDevices, label: "Управление устройствами" },
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
    { permission: canManageServicePlans, label: "Управление услугами" },
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
    { permission: dashboard.globalActions, label: "Глобальные действия" },
    { permission: dashboard.globalTasks, label: "Глобальные задачи" },
    { permission: dashboard.globalStats, label: "Глобальная статистика" },
    { permission: dashboard.personalActions, label: "Персональные действия" },
    { permission: dashboard.personalTasks, label: "Персональные задачи" },
    { permission: dashboard.personalStats, label: "Персональная статистика" },
  ];

  const globalRoles = [
    { role: isAdmin, label: "Администратор" },
    { role: isEndUser, label: "Конечный пользователь / Клиент" },
    { role: isServiceAccount, label: "Сервисный аккаунт" },
    { role: isCloudTelephony, label: "Облачная телефония" },
  ];
  const grantedRoles = globalRoles.filter((item) => item.role);

  const moduleGroups = [
    {
      title: "Заявки",
      icon: <RiTicket2Line />,
      ...buildModule(ticketWorkFlowPermissions),
    },
    {
      title: "Администрирование портала",
      icon: <RiSettings4Line />,
      ...buildModule(portalAdminPermissions),
    },
    {
      title: "Учёт времени",
      icon: <RiTimeLine />,
      ...buildModule(timeTrackingModulePermissions),
    },
    {
      title: "Учёт техники",
      icon: <RiHardDrive2Line />,
      ...buildModule(inventoryModulePermissions),
    },
    {
      title: "Финансы",
      icon: <RiMoneyDollarCircleLine />,
      ...buildModule(financesModulePermissions),
    },
    {
      title: "Dashboard",
      icon: <RiDashboardLine />,
      ...buildModule(dashboardPermissions),
    },
  ];

  const telegramItems = [
    { flag: notify.byTelegram.newTicket, label: "Новая заявка" },
    {
      flag: notify.byTelegram.respStateUpdate,
      label: "Изменение статуса ответственного за заявку",
    },
    {
      flag: notify.byTelegram.ticketStateUpdate,
      label: "Изменение статуса заявки",
    },
    { flag: notify.byTelegram.ticketNewComment, label: "Новые комментарии" },
    { flag: notify.byTelegram.scheduledWorks, label: "Запланированные работы" },
  ].map((event) => ({
    label: event.label,
    granted: Boolean(event.flag) && telegramBot.isActive,
  }));

  const emailItems = [
    { flag: notify.byEmail.newTicket, label: "Новая заявка" },
    {
      flag: notify.byEmail.respStateUpdate,
      label: "Изменение статуса ответственного за заявку",
    },
    {
      flag: notify.byEmail.ticketStateUpdate,
      label: "Изменение статуса заявки",
    },
    { flag: notify.byEmail.ticketNewComment, label: "Новые комментарии" },
    { flag: notify.byEmail.scheduledWorks, label: "Запланированные работы" },
  ].map((event) => ({ label: event.label, granted: Boolean(event.flag) }));

  return (
    <Transitions>
      {/* Шапка-«личность»: аватар, имя, компания, статус, последний вход */}
      <motion.div
        className="account-hero mb-4"
        variants={heroContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div
          variants={heroAvatar}
          className={`account-avatar ${user.isActive ? "" : "account-avatar--off"}`}
          style={{ backgroundImage: `url(${profileImage})` }}
          role="img"
          aria-label={`${user.firstName} ${user.lastName}`}
        />
        <motion.div variants={heroItem} className="flex-grow-1">
          {user.company && (
            <Link
              to={`/companies/${user.company._id}`}
              className="text-decoration-none d-inline-flex align-items-center gap-1 mb-1"
            >
              <RiBuilding2Line /> {user.company.alias}
            </Link>
          )}
          <h2 className="mb-1">
            {user.firstName} {user.lastName}
          </h2>
          {user.position && (
            <div className="text-body-secondary mb-2">{user.position}</div>
          )}
          <div className="text-body-secondary small d-inline-flex align-items-center gap-1">
            <RiLoginCircleLine /> Последний вход:{" "}
            {user.lastLogin ? formatDate(user.lastLogin) : "никогда"}
          </div>
        </motion.div>
        <motion.div
          variants={heroItem}
          className="ms-sm-auto d-flex flex-column align-items-sm-end gap-2"
        >
          <Badge
            bg={user.isActive ? "success" : "danger"}
            className="fs-6 fw-normal"
          >
            {user.isActive ? "Включён" : "Отключён"}
          </Badge>
        </motion.div>
      </motion.div>

      <Tabs defaultActiveKey="profile" className="mb-3 scrollable-tabs">
        {/* ---- Профиль: контакты, фото, категории ---- */}
        <Tab
          eventKey="profile"
          title={
            <>
              <RiContactsBook2Line /> Профиль
            </>
          }
        >
          <div className="pt-3">
            <Row className="g-3">
              <Col lg={7}>
                <Card className="border-0 shadow-sm h-100">
                  <Card.Body>
                    <div className="cap-card-title mb-3">
                      <RiContactsBook2Line />
                      <span>Контактные данные</span>
                    </div>
                    <ContactRow icon={<RiMailLine />} label="Почта">
                      {user.email ? (
                        <a href={`mailto:${user.email}`}>{user.email}</a>
                      ) : (
                        <span className="text-body-secondary">—</span>
                      )}
                    </ContactRow>
                    <ContactRow icon={<RiPhoneLine />} label="Телефон">
                      {user.phone ? (
                        <a href={`tel:${user.phone}`}>{user.phone}</a>
                      ) : (
                        <span className="text-body-secondary">—</span>
                      )}
                    </ContactRow>
                    <ContactRow
                      icon={<RiShieldCheckLine />}
                      label="Active Directory"
                    >
                      {user.activeDirectoryObjectGUID ? (
                        <Badge
                          bg="success"
                          className="d-inline-flex align-items-center gap-1 fw-normal"
                        >
                          <RiShieldCheckLine /> Связан
                        </Badge>
                      ) : (
                        <Badge bg="secondary" className="fw-normal">
                          Не связан
                        </Badge>
                      )}
                    </ContactRow>
                  </Card.Body>
                </Card>
              </Col>
              {canManageUsers && (
                <Col lg={5}>
                  <Card className="border-0 shadow-sm h-100">
                    <Card.Body>
                      <div className="cap-card-title mb-3">
                        <RiImageLine />
                        <span>Фотография профиля</span>
                      </div>
                      <ImageUpload
                        userId={user._id.toString()}
                        setProfileImage={setProfileImage}
                      />
                    </Card.Body>
                  </Card>
                </Col>
              )}
            </Row>
            {user.permissions?.canPerformTickets && (
              <Card className="border-0 shadow-sm mt-3">
                <Card.Body>
                  <div className="cap-card-title mb-3">
                    <RiPriceTag3Line />
                    <span>Категории заявок</span>
                  </div>
                  {user.categories?.length > 0 ? (
                    <div className="d-flex flex-wrap gap-2">
                      {[...user.categories]
                        .sort((a, b) => a.title.localeCompare(b.title))
                        .map((category) => (
                          <Badge
                            key={category.title}
                            bg="primary"
                            className="fw-normal"
                          >
                            {category.title}
                          </Badge>
                        ))}
                    </div>
                  ) : (
                    <span className="text-body-secondary">
                      Категории не назначены
                    </span>
                  )}
                </Card.Body>
              </Card>
            )}
          </div>
        </Tab>

        {/* ---- Права (только для управляющих пользователями) ---- */}
        {canManageUsers && (
          <Tab
            eventKey="permissions"
            title={
              <>
                <RiShieldUserLine /> Права
              </>
            }
          >
            <div className="pt-3">
              <Card className="border-0 shadow-sm mb-3">
                <Card.Body>
                  <div className="cap-card-title mb-3">
                    <RiVipCrownLine />
                    <span>Глобальная роль</span>
                  </div>
                  {grantedRoles.length > 0 ? (
                    <div className="d-flex flex-wrap gap-2">
                      {grantedRoles.map((item) => (
                        <Badge
                          key={item.label}
                          bg="primary"
                          className="fs-6 fw-normal"
                        >
                          {item.label}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-body-secondary">
                      Роль не назначена
                    </span>
                  )}
                </Card.Body>
              </Card>
              <Row className="row-cols-1 row-cols-lg-2 g-3">
                {moduleGroups.map((group) => (
                  <Col key={group.title}>
                    <CapCard
                      icon={group.icon}
                      title={group.title}
                      master={group.master}
                      items={group.items}
                    />
                  </Col>
                ))}
              </Row>
            </div>
          </Tab>
        )}

        {/* ---- Уведомления (только для управляющих пользователями) ---- */}
        {canManageUsers && (
          <Tab
            eventKey="notifications"
            title={
              <>
                <RiNotification3Line /> Уведомления
              </>
            }
          >
            <div className="pt-3">
              <Row className="row-cols-1 row-cols-lg-2 g-3">
                <Col>
                  <CapCard
                    icon={<RiTelegramLine />}
                    title="Telegram"
                    master={telegramBot.isActive}
                    masterOn="Подключён"
                    masterOff="Не подключён"
                    items={telegramItems}
                  />
                </Col>
                <Col>
                  <CapCard
                    icon={<RiMailSendLine />}
                    title="Email"
                    items={emailItems}
                  />
                </Col>
              </Row>
            </div>
          </Tab>
        )}

        {/* ---- Интеграции ---- */}
        <Tab
          eventKey="integrations"
          title={
            <>
              <RiRemoteControlLine /> Интеграции
            </>
          }
        >
          <div className="pt-3">
            <Card className="border-0 shadow-sm">
              <ListGroup variant="flush">
                <ListGroup.Item className="d-flex align-items-center gap-3 py-3 bg-transparent">
                  <span className="contact-row__icon">
                    <RiRemoteControlLine />
                  </span>
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="fw-medium">Pro32Connect (GetScreen)</div>
                    <small className="text-body-secondary">
                      Удалённое подключение к рабочему столу
                    </small>
                  </div>
                  <StatusPill
                    on={Boolean(getScreen?.api)}
                    onText="Активна"
                    offText="Отключена"
                  />
                </ListGroup.Item>
              </ListGroup>
            </Card>
          </div>
        </Tab>

        {/* ---- Заявки ---- */}
        <Tab
          eventKey="tickets"
          title={
            <>
              Заявки{" "}
              <Badge bg="secondary" pill>
                {tickets.length}
              </Badge>
            </>
          }
        >
          <div className="pt-3">
            {tickets.length > 0 ? (
              <Card className="border-0 shadow-sm">
                <Table responsive hover className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Тема</th>
                      <th>Создана</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr key={ticket._id}>
                        <td data-cell="Номер">
                          <Link to={`/tickets/${ticket.num}`} target="_blank">
                            {ticket.num}
                          </Link>
                        </td>
                        <td data-cell="Тема">{ticket.title}</td>
                        <td data-cell="Создана" className="text-nowrap">
                          {formatShortDate(ticket.createdAt)}
                        </td>
                        <td data-cell="Статус">
                          <Badge bg={ticketStateVariant(ticket.state)}>
                            {ticket.state}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ) : (
              <Alert variant="light" className="text-center mb-0">
                Заявки не найдены
              </Alert>
            )}
          </div>
        </Tab>
      </Tabs>

      {/* Действия */}
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
        {canManageUsers && (
          <Col sm="auto">
            <Button as={Link} to={`update`} className="mb-2 w-100">
              <RiEdit2Line /> Изменить
            </Button>
          </Col>
        )}
        {canManageCompanies && (
          <Col sm="auto">
            <LinkToActiveDirectory user={user} />
          </Col>
        )}
        {canManageUsers && (
          <>
            {!user.isServiceAccount && (
              <Col sm="auto">
                <ResetPassword user={user} />
              </Col>
            )}
            <Col sm="auto">
              <ToggleActive isButton item={user} />
            </Col>
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
  );
};

export default ViewUser;
