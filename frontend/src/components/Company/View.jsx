import { useState, useRef, useEffect, useContext } from "react";
import { Link, useNavigate, Outlet, useFetcher } from "react-router";

import { motion } from "framer-motion";

import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefsStore from "../../store/prefs";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Alert from "react-bootstrap/Alert";
import Offcanvas from "react-bootstrap/Offcanvas";
import Modal from "react-bootstrap/Modal";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import Tabs from "react-bootstrap/Tabs";
import Tab from "react-bootstrap/Tab";

import Transitions from "../../animations/Transition";

import {
  RiEdit2Line,
  RiArrowGoBackFill,
  RiHistoryLine,
  RiBuilding2Line,
  RiProfileLine,
  RiInformationLine,
  RiMapPin2Line,
  RiPhoneLine,
  RiAtLine,
  RiTimeLine,
  RiNodeTree,
  RiContractLine,
  RiContactsBook2Line,
  RiKey2Line,
  RiGroupLine,
} from "react-icons/ri";

import useOffcanvasStore from "../../store/offcanvas";
import { getWorkingStatus } from "../../util/get-working-status";

import Select from "../../UI/Select";
import AvatarUpload from "../../UI/AvatarUpload";

import DeleteItem from "../DeleteItem";

import WorkSchedule from "./View/WorkSchedule";
import UserSection from "./View/UsersSection";
import ResponsiblesSection from "./View/ResponsiblesSection";
import ServicePlansSection from "./View/ServicePlansSection";
import SubdivisionsSection from "./View/SubdivisionsSection";
import ApiKeysSection from "./View/ApiKeysSection";
import WorkingStatusIndicator from "./WorkingStatusIndicator";
import CompanyLogsOffcanvas from "../CompanyLogs/Offcanvas";

// Лёгкий каскад появления шапки — тот же приём, что на странице пользователя
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

// Карточка-секция вкладки (как на странице пользователя): border-0 shadow-sm
const SectionCard = ({ children }) => (
  <Card className="border-0 shadow-sm h-100">
    <Card.Body>{children}</Card.Body>
  </Card>
);

// Строка реквизита: иконка-плашка + подпись/значение
const ContactRow = ({ icon, label, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div className="contact-row__value">{children}</div>
    </div>
  </div>
);

const ViewCompany = ({
  company = {},
  servicePlans = [],
  servicePlansList = [],
}) => {
  const { permissions } = useContext(AuthedUserContext);
  const { modules } = useInitialPrefsStore();

  const fetcher = useFetcher();
  const navigate = useNavigate();
  const offcanvas = useOffcanvasStore();

  const [newServicePlan, setNewServicePlan] = useState({});
  const isActiveSinceInputRef = useRef();
  const [customerApprovalRequired, setCustomerApprovalRequired] =
    useState(false);

  // Состояние для Offcanvas с логами
  const [showLogsOffcanvas, setShowLogsOffcanvas] = useState(false);
  const [logsSearchQuery, setLogsSearchQuery] = useState("");

  // Логотип компании в шапке — обновляется «вживую» после загрузки
  const [logoImage, setLogoImage] = useState(
    company.profileImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${company.profileImagePath}`
      : "/companypic-placeholder.png",
  );

  const customerApprovalRequiredHandler = () => {
    setCustomerApprovalRequired(!customerApprovalRequired);
  };

  const servicePlanChangeHandler = (selectedItem) => {
    setNewServicePlan(selectedItem);
  };

  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  const handleShowLogs = (searchQuery = "") => {
    setLogsSearchQuery(searchQuery);
    setShowLogsOffcanvas(true);
  };

  const handleCloseLogs = () => {
    setShowLogsOffcanvas(false);
    setLogsSearchQuery("");
  };

  const addServicePlanHandler = async (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "addServicePlan",
        id: company._id,
        servicePlan: newServicePlan._id,
        isActiveSince: new Date(isActiveSinceInputRef.current.value),
        customerApprovalRequired: customerApprovalRequired,
      },
      {
        method: "POST",
        action: `/companies/${company._id}`,
      },
    );

    setCustomerApprovalRequired(false);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (!fetcher.data.error) {
        handleClose();
      }
    }
  }, [fetcher.state, fetcher.data]);

  const canManage = permissions.canManageCompanies;
  const showFinances =
    modules.finances.isActive && permissions.canUseFinancesModule;

  const workingStatus = getWorkingStatus(company.workSchedule);
  const noSchedule = workingStatus.verbose === "расписание не указано";

  return (
    <Transitions>
      {/* Шапка-«личность» компании: логотип, название, реквизиты, статус работы */}
      <motion.div
        className="account-hero mb-4"
        variants={heroContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={heroAvatar}>
          <AvatarUpload
            image={logoImage}
            onChange={setLogoImage}
            uploadUrl={`${import.meta.env.VITE_API_ADDRESS}/api/companies/${company._id}/add-profile-image`}
            method="PATCH"
            canEdit={canManage}
            alt={company.alias}
            placeholder="/companypic-placeholder.png"
          />
        </motion.div>

        <motion.div variants={heroItem} className="flex-grow-1">
          <h2 className="mb-1">{company.alias}</h2>
          {company.fullTitle && (
            <div className="text-body-secondary mb-2">{company.fullTitle}</div>
          )}
          <div className="d-flex flex-wrap gap-3 small">
            {company.address && (
              <a
                href={company.linkToMap}
                target="_blank"
                rel="noreferrer"
                className="d-inline-flex align-items-center gap-1 text-decoration-none"
              >
                <RiMapPin2Line /> {company.address}
              </a>
            )}
            {company.phones?.[0] && (
              <a
                href={`tel:${company.phones[0]}`}
                className="d-inline-flex align-items-center gap-1 text-decoration-none"
              >
                <RiPhoneLine /> {company.phones[0]}
              </a>
            )}
          </div>
        </motion.div>

        <motion.div
          variants={heroItem}
          className="ms-sm-auto d-flex flex-column align-items-sm-end gap-1"
        >
          <Badge
            bg={workingStatus.isOpened ? "success" : "secondary"}
            className="fs-6 fw-normal d-inline-flex align-items-center gap-1"
          >
            <RiTimeLine />{" "}
            {noSchedule
              ? "График не указан"
              : workingStatus.isOpened
                ? "Открыта"
                : "Закрыта"}
          </Badge>
          {!noSchedule && (
            <small>
              <WorkingStatusIndicator workSchedule={company.workSchedule} />
            </small>
          )}
        </motion.div>
      </motion.div>

      <Tabs defaultActiveKey="details" className="mb-3 scrollable-tabs">
        {/* ---- Реквизиты + график работы ---- */}
        <Tab
          eventKey="details"
          title={
            <>
              <RiProfileLine /> Реквизиты
            </>
          }
        >
          <div className="pt-3">
            <Row className="g-3">
              <Col xs={12} lg={6}>
                <SectionCard>
                  <div className="cap-card-title mb-3">
                    <RiInformationLine />
                    <span>Реквизиты</span>
                  </div>
                  <ContactRow
                    icon={<RiBuilding2Line />}
                    label="Полное наименование"
                  >
                    {company.fullTitle || (
                      <span className="text-body-secondary">—</span>
                    )}
                  </ContactRow>
                  <ContactRow icon={<RiPhoneLine />} label="Телефоны">
                    {company.phones?.length ? (
                      <span className="d-inline-flex flex-wrap gap-2">
                        {company.phones.map((phone) => (
                          <a key={phone} href={`tel:${phone}`}>
                            {phone}
                          </a>
                        ))}
                      </span>
                    ) : (
                      <span className="text-body-secondary">—</span>
                    )}
                  </ContactRow>
                  <ContactRow icon={<RiMapPin2Line />} label="Адрес">
                    {company.address ? (
                      <a
                        href={company.linkToMap}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {company.address}
                      </a>
                    ) : (
                      <span className="text-body-secondary">—</span>
                    )}
                  </ContactRow>
                  {canManage && (
                    <ContactRow icon={<RiAtLine />} label="Почтовые домены">
                      {company.emailDomains?.length ? (
                        <span className="d-inline-flex flex-wrap gap-2">
                          {company.emailDomains.map((domain) => (
                            <Badge
                              key={domain}
                              bg="secondary"
                              className="fw-normal"
                            >
                              {domain}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-body-secondary">—</span>
                      )}
                    </ContactRow>
                  )}
                </SectionCard>
              </Col>
              <Col xs={12} lg={6}>
                <SectionCard>
                  <WorkSchedule />
                </SectionCard>
              </Col>
            </Row>
          </div>
        </Tab>

        {/* ---- Структура компании ---- */}
        <Tab
          eventKey="structure"
          title={
            <>
              <RiNodeTree /> Структура
            </>
          }
        >
          <div className="pt-3">
            <SectionCard>
              <SubdivisionsSection
                company={company}
                permissions={permissions}
              />
            </SectionCard>
          </div>
        </Tab>

        {/* ---- Сотрудники ---- */}
        <Tab
          eventKey="employees"
          title={
            <>
              <RiGroupLine /> Сотрудники{" "}
              <Badge bg="secondary" pill>
                {company.employees?.length ?? 0}
              </Badge>
            </>
          }
        >
          <div className="pt-3">
            <SectionCard>
              <UserSection />
            </SectionCard>
          </div>
        </Tab>

        {/* ---- Услуги (модуль финансов) ---- */}
        {showFinances && (
          <Tab
            eventKey="services"
            title={
              <>
                <RiContractLine /> Услуги{" "}
                <Badge bg="secondary" pill>
                  {servicePlans.length}
                </Badge>
              </>
            }
          >
            <div className="pt-3">
              <SectionCard>
                <ServicePlansSection
                  servicePlans={servicePlans}
                  company={company}
                  permissions={permissions}
                  handleShow={handleShow}
                />
              </SectionCard>
            </div>
          </Tab>
        )}

        {/* ---- Ответственные лица ---- */}
        <Tab
          eventKey="responsibles"
          title={
            <>
              <RiContactsBook2Line /> Ответственные
            </>
          }
        >
          <div className="pt-3">
            <SectionCard>
              <ResponsiblesSection company={company} />
            </SectionCard>
          </div>
        </Tab>

        {/* ---- API-ключи ---- */}
        <Tab
          eventKey="apikeys"
          title={
            <>
              <RiKey2Line /> API-ключи
            </>
          }
        >
          <div className="pt-3">
            <SectionCard>
              <ApiKeysSection company={company} permissions={permissions} />
            </SectionCard>
          </div>
        </Tab>
      </Tabs>

      {/* Действия */}
      <Row className="py-3 border-top justify-content-end gap-2">
        <Col sm="auto">
          <Button
            onClick={() => navigate("/companies")}
            className="w-100"
            variant="secondary"
          >
            <RiArrowGoBackFill /> К списку
          </Button>
        </Col>
        {canManage && (
          <Col sm="auto">
            <Button
              onClick={() => handleShowLogs()}
              className="w-100"
              variant="info"
            >
              <RiHistoryLine /> Лог активности
            </Button>
          </Col>
        )}
        {canManage && (
          <>
            <Col sm="auto">
              <Button
                as={Link}
                to={`update`}
                className="w-100"
                onClick={offcanvas.show}
              >
                <RiEdit2Line /> Изменить
              </Button>
            </Col>
            <Col sm="auto">
              <DeleteItem isButton item={company} />
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

      <Modal show={show} centered onHide={handleClose}>
        <Form onSubmit={addServicePlanHandler}>
          <Modal.Header closeButton>
            <Modal.Title>Новая услуга</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {fetcher.data?.error && fetcher.data && (
              <Alert variant="danger">
                <div>{fetcher.data.error}</div>
                <ul>
                  {fetcher.data.duplicates &&
                    fetcher.data.duplicates.map((duplicate) => (
                      <li key={duplicate._id.toString()}>{duplicate.title}</li>
                    ))}
                </ul>
              </Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label htmlFor="servicePlan">Услуга</Form.Label>
              <Select
                id="servicePlan"
                placeholder="Выберите услугу"
                required
                isClearable
                isSearchable
                options={servicePlansList.filter(
                  (plan) =>
                    !company.servicePlans.some((sp) => sp._id === plan._id),
                )}
                getOptionLabel={(option) => `${option.title}`}
                getOptionValue={(option) => option._id}
                onChange={servicePlanChangeHandler}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Действует с</Form.Label>
              <Form.Control type="date" required ref={isActiveSinceInputRef} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                label="Требуется согласование c Клиентом"
                value={isActiveSinceInputRef}
                onChange={customerApprovalRequiredHandler}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose}>
              Закрыть
            </Button>
            <Button
              variant="primary"
              type="submit"
              name="intent"
              value="addServicePlan"
              disabled={fetcher.state !== "idle"}
            >
              Сохранить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <CompanyLogsOffcanvas
        show={showLogsOffcanvas}
        onHide={handleCloseLogs}
        companyId={company._id}
        company={company}
        permissions={permissions}
        initialSearchQuery={logsSearchQuery}
      />
    </Transitions>
  );
};

export default ViewCompany;
