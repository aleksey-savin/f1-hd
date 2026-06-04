import { useState, useRef, useEffect, useContext } from "react";
import { Link, useNavigate, Outlet, useFetcher } from "react-router";

import { AuthedUserContext } from "../../store/authed-user-context";
import useInitialPrefsStore from "../../store/prefs";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Button from "react-bootstrap/Button";

import Alert from "react-bootstrap/Alert";
import Offcanvas from "react-bootstrap/Offcanvas";
import Modal from "react-bootstrap/Modal";
import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";

import Transitions from "../../animations/Transition";

import { RiEdit2Line, RiArrowGoBackFill, RiHistoryLine } from "react-icons/ri";
import useOffcanvasStore from "../../store/offcanvas";

import Select from "../../UI/Select";

import DeleteItem from "../DeleteItem";

import CompanyHeader from "./View/CompanyHeader";
import WorkSchedule from "./View/WorkSchedule";
import UserSection from "./View/UsersSection";
import ResponsiblesSection from "./View/ResponsiblesSection";
import ServicePlansSection from "./View/ServicePlansSection";
import SubdivisionsSection from "./View/SubdivisionsSection";
import ApiKeysSection from "./View/ApiKeysSection";
import CompanyLogsOffcanvas from "../CompanyLogs/Offcanvas";

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

  return (
    <Transitions>
      <Card className="mb-4">
        <Card.Body>
          <CompanyHeader company={company} permissions={permissions} />
        </Card.Body>
      </Card>
      <Card className="mb-4">
        <Card.Body>
          <SubdivisionsSection company={company} permissions={permissions} />
        </Card.Body>
      </Card>
      <Row>
        <Col lg="6" className="mb-4">
          <Card className="h-100">
            <Card.Body>
              <WorkSchedule />
            </Card.Body>
          </Card>
        </Col>
        {modules.finances.isActive && permissions.canUseFinancesModule && (
          <Col lg="6" className="mb-4">
            <Card className="h-100">
              <Card.Body>
                <ResponsiblesSection company={company} />
              </Card.Body>
            </Card>
          </Col>
        )}
      </Row>
      {modules.finances.isActive && permissions.canUseFinancesModule && (
        <>
          {modules.finances.isActive && permissions.canUseFinancesModule && (
            <Card className="mb-4">
              <Card.Body>
                <ServicePlansSection
                  servicePlans={servicePlans}
                  company={company}
                  permissions={permissions}
                  handleShow={handleShow}
                />
              </Card.Body>
            </Card>
          )}
        </>
      )}
      <Card className="mb-4">
        <Card.Body>
          <ApiKeysSection company={company} permissions={permissions} />
        </Card.Body>
      </Card>
      <UserSection />
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
        {permissions.canManageCompanies && (
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
        {permissions.canManageCompanies && (
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
