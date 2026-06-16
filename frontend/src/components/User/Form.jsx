import { useEffect, useState } from "react";
import { useActionData, useLoaderData, useNavigate } from "react-router";

import Select from "../../UI/Select";

import Form from "react-bootstrap/Form";

import { getInitialPrefsData } from "../../util/prefs";
import FormWrapper from "../../UI/FormWrapper";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import PhoneInput from "../../UI/PhoneInput";
import Button from "react-bootstrap/Button";

const UserForm = ({ title }) => {
  const navigate = useNavigate();
  const actionData = useActionData();

  const { user, companiesList, categoriesList } = useLoaderData();

  useEffect(() => {
    if (actionData?.userId) {
      navigate(`/users/${actionData.userId}`, {
        state: {
          message: actionData.message,
          error: actionData.error,
        },
      });
    }
  }, [actionData, navigate]);

  const { getScreen } = getInitialPrefsData();

  const [isServiceAccount, setIsServiceAccount] = useState(
    user ? user.isServiceAccount : false,
  );
  /* const [company, setCompany] = useState(
    companiesList.filter(
      (item) => item._id.toString() === user?.company?._id.toString(),
    )[0] || null,
  ); */
  const [company, setCompany] = useState(user?.company);
  const [categories, setCategories] = useState(user ? user.categories : []);
  const [isActive, setIsActive] = useState(user ? user.isActive : true);
  const [isAdmin, setIsAdmin] = useState(user ? user.isAdmin : false);
  const [isEndUser, setIsEndUser] = useState(user ? user.isEndUser : true);
  const [sendPassword, setSendPassword] = useState(false);
  const [isCloudTelephony, setIsCloudTelephony] = useState(
    user ? user.isCloudTelephony : false,
  );
  const [subdivision, setSubdivision] = useState(
    user ? user.subdivision : null,
  );

  const [subdivisionsList, setSubdivisionsList] = useState(
    companiesList.filter(
      (item) => item._id.toString() === user?.company?._id.toString(),
    )[0]?.subdivisions || [],
  );
  const subdivisionChangeHandler = (selectedItem) => {
    setSubdivision(selectedItem || undefined);
  };

  useEffect(() => {
    setSubdivisionsList(company?.subdivisions);
  }, [company]);

  const permissions = user?.permissions || {};

  const [ticketsWorkFlowPermissions, setTicketsWorkFlowPermissions] = useState([
    {
      label: "Отображение всех заявок своей компании",
      title: "canSeeAllCompanyTickets",
      isActive: permissions.canSeeAllCompanyTickets || false,
      isDisabled: false,
    },
    {
      label: "Отображение всех заявок в системе",
      title: "canSeeAllTickets",
      isActive: permissions.canSeeAllTickets || false,
      isDisabled: false,
    },
    {
      label: "Выполнение заявок",
      title: "canPerformTickets",
      isActive: permissions.canPerformTickets || false,
      isDisabled: false,
    },
    {
      label: "Администрирование заявок",
      title: "canAdministrateTickets",
      isActive: permissions.canAdministrateTickets || false,
      isDisabled: false,
    },
    {
      label: "Полное редактирование заявок",
      title: "canEditTickets",
      isActive: permissions.canEditTickets || false,
      isDisabled: false,
    },
    {
      label: "Удаление заявок",
      title: "canDeleteTickets",
      isActive: user?.permissions.canDeleteTickets || false,
      isDisabled: false,
    },
  ]);

  const [portalAdministrationPermissions, setPortalAdministrationPermissions] =
    useState([
      {
        label: "Управление компаниями",
        title: "canManageCompanies",
        isActive: permissions.canManageCompanies || false,
        isDisabled: false,
      },
      {
        label: "Управление пользователями",
        title: "canManageUsers",
        isActive: permissions.canManageUsers || false,
        isDisabled: false,
      },
      {
        label: "Управление категориями заявок",
        title: "canManageTicketCategories",
        isActive: permissions.canManageTicketCategories || false,
        isDisabled: false,
      },
      {
        label: "Просмотр базы знаний",
        title: "canSeeKnowledgeBase",
        isActive: permissions.canSeeKnowledgeBase || false,
        isDisabled: false,
      },
      {
        label: "Управление базой знаний",
        title: "canManageKnowledgeBase",
        isActive: permissions.canManageKnowledgeBase || false,
        isDisabled: false,
      },
      {
        label: "Управление регламентными заданиями",
        title: "canManageRoutineTasks",
        isActive: permissions.canManageRoutineTasks || false,
        isDisabled: false,
      },
      {
        label: "Управление записями в changelog",
        title: "canUpdateChangelog",
        isActive: permissions.canUpdateChangelog || false,
        isDisabled: false,
      },
      {
        label: "Управление шаблонами заявок",
        title: "canManageTicketTemplates",
        isActive: permissions.canManageTicketTemplates || false,
        isDisabled: false,
      },
    ]);

  const [timeTrackingModulePermissions, setTimeTrackingModulePermissions] =
    useState([
      {
        label: "Разрешено использование",
        title: "canUseTimeTrackingModule",
        isActive: permissions.canUseTimeTrackingModule || false,
        isDisabled: false,
      },
      {
        label: "Можно не указывать работы",
        title: "canAvoidWorks",
        isActive: permissions.canAvoidWorks || false,
        isDisabled: false,
      },
      {
        label: "Формирование и просмотр отчёта по работам",
        title: "canSeeWorksReport",
        isActive: permissions.canSeeWorksReport || false,
        isDisabled: false,
      },
      {
        label: "Просмотр аналитики и трендов",
        title: "canSeeAnalytics",
        isActive: permissions.canSeeAnalytics || false,
        isDisabled: false,
      },
    ]);

  const [inventoryModulePermissions, setInventoryModulePermissions] = useState([
    {
      label: "Разрешено использование",
      title: "canUseInventoryModule",
      isActive: permissions.canUseInventoryModule || false,
      isDisabled: false,
    },
    {
      label: "Управление устройствами",
      title: "canManageClientDevices",
      isActive: permissions.canManageClientDevices || false,
      isDisabled: false,
    },
    {
      label: "Управление устройствами Mikrotik",
      title: "canManageMikrotikDevices",
      isActive: permissions.canManageMikrotikDevices || false,
      isDisabled: false,
    },
  ]);

  const [financesModulePermissions, setFinancesModulePermissions] = useState([
    {
      label: "Разрешено использование",
      title: "canUseFinancesModule",
      isActive: permissions.canUseFinancesModule || false,
      isDisabled: false,
    },
    {
      label: "Управление услугами",
      title: "canManageServicePlans",
      isActive: permissions.canManageServicePlans || false,
      isDisabled: false,
    },
    {
      label: "Просмотр отчётов по оказанным услугам",
      title: "canSeeGlobalFinancialReport",
      isActive: permissions.canSeeGlobalFinancialReport || false,
      isDisabled: false,
    },
    {
      label: "Утверждение отчётов со стороны Исполнителя",
      title: "canConfirmReportActions",
      isActive: permissions.canConfirmReportActions || false,
      isDisabled: false,
    },
    {
      label: "Просмотр персонального отчёта",
      title: "canSeePersonalFinancialReport",
      isActive: permissions.canSeePersonalFinancialReport || false,
      isDisabled: false,
    },
  ]);

  // dashboard
  const [dashboard, setDashboard] = useState([
    {
      label: "Включить дашборд",
      title: "dashboardIsActive",
      isActive: user?.dashboard?.isActive || false,
    },
    {
      label: "Персональные действия",
      title: "dashboardPersonalActions",
      isActive: user?.dashboard?.personalActions || false,
    },
    {
      label: "Персональные задачи",
      title: "dashboardPersonalTasks",
      isActive: user?.dashboard?.personalTasks || false,
    },
    {
      label: "Персональная статистика",
      title: "dashboardPersonalStats",
      isActive: user?.dashboard?.personalStats || false,
    },
    {
      label: "Глобальные действия",
      title: "dashboardGlobalActions",
      isActive: user?.dashboard?.globalActions || false,
    },
    {
      label: "Глобальные задачи",
      title: "dashboardGlobalTasks",
      isActive: user?.dashboard?.globalTasks || false,
    },
    {
      label: "Глобальная статистика",
      title: "dashboardGlobalStats",
      isActive: user?.dashboard?.globalStats || false,
    },
  ]);

  const dashboardSwitchHandler = (event) => {
    setDashboard(
      dashboard.map((item) => {
        return item.title === event.target.name
          ? {
              label: item.label,
              title: item.title,
              isActive: !item.isActive,
            }
          : item;
      }),
    );
  };

  const isServiceAccountChangeHandler = () => {
    setIsServiceAccount(!isServiceAccount);
    setIsCloudTelephony(false);
  };

  const companyChangeHandler = (selectedItem) => {
    setCompany(selectedItem);
    setSubdivision("");
  };

  const [phoneNumber, setPhoneNumber] = useState(user?.phone);

  const categoriesChangeHandler = (selectedItems) => {
    setCategories(selectedItems);
  };

  const allCategoriesHandler = () => {
    setCategories(categoriesList);
  };

  const clearCategoriesHandler = () => {
    setCategories([]);
  };

  const isActiveChangeHandler = () => {
    setIsActive(!isActive);
  };

  const sendPasswordChangeHandler = () => {
    setSendPassword(!sendPassword);
  };

  const isCloudTelephonyChangeHandler = () => {
    setIsCloudTelephony(!isCloudTelephony);
  };

  const [lastName, setLastname] = useState(user ? user.lastName : "");

  const lastNameChangeHandler = (event) => {
    setLastname(event.target.value);
  };

  const [email, setEmail] = useState(user ? user.email : "");

  const emailChangeHandler = (event) => {
    setEmail(event.target.value);
  };

  return (
    <FormWrapper title={title}>
      <Row className="mb-3">
        <Col lg="auto">
          <h3>Основная информация</h3>
        </Col>
      </Row>
      <Row>
        <Col lg="auto">
          <Form.Group className="mb-3">
            <Form.Check
              checked={isActive}
              type="switch"
              id="isActive"
              name="isActive"
              label="Активный"
              value={isActive}
              onChange={isActiveChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col lg="auto">
          <Form.Group className="mb-3">
            <Form.Check
              checked={isServiceAccount}
              type="switch"
              id="isServiceAccount"
              name="isServiceAccount"
              label="Сервисный аккаунт"
              value={isServiceAccount}
              onChange={isServiceAccountChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      {isServiceAccount && (
        <>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Check
                  checked={isCloudTelephony}
                  type="switch"
                  id="isCloudTelephony"
                  name="isCloudTelephony"
                  label="Облачная телефония"
                  value={isCloudTelephony}
                  onChange={isCloudTelephonyChangeHandler}
                />
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="4">
              <Form.Group className="w-100 mb-3">
                <Form.Label htmlFor="firstName">
                  Наименование
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Form.Control
                  required
                  autoFocus
                  id="firstName"
                  name="firstName"
                  type="text"
                  defaultValue={user ? user.firstName : ""}
                />
              </Form.Group>
            </Col>
          </Row>
        </>
      )}
      {!isServiceAccount && (
        <>
          <Row>
            <Col lg="4">
              <Form.Group hidden={isServiceAccount} className="w-100 mb-3">
                <Form.Label htmlFor="lastName">
                  Фамилия
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Form.Control
                  required
                  id="lastName"
                  name="lastName"
                  type="text"
                  value={lastName}
                  onChange={lastNameChangeHandler}
                />
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="4">
              <Form.Group hidden={isServiceAccount} className="w-100 mb-3">
                <Form.Label htmlFor="firstName">
                  Имя
                  <span style={{ color: "red" }}>*</span>
                </Form.Label>
                <Form.Control
                  required
                  autoFocus
                  id="firstName"
                  name="firstName"
                  type="text"
                  defaultValue={user ? user.firstName : ""}
                />
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="4">
              <Form.Group hidden={isServiceAccount} className="w-100 mb-3">
                <Form.Label htmlFor="phone">Телефон</Form.Label>
                <PhoneInput
                  id="phone"
                  name="phone"
                  setValue={setPhoneNumber}
                  value={phoneNumber}
                />
              </Form.Group>
            </Col>
          </Row>
        </>
      )}
      <Row>
        <Col lg="4">
          <Form.Group className="w-100 mb-3">
            <Form.Label htmlFor="email">
              Email<span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Form.Control
              required
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={emailChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      {!isServiceAccount && !user && (
        <Row>
          <Col lg="4">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="password">
                Пароль
                <span style={{ color: "red" }}>*</span>
              </Form.Label>
              <Form.Control
                required
                id="password"
                name="password"
                type="password"
                defaultValue=""
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                checked={sendPassword}
                type="switch"
                id="sendPassword"
                name="sendPassword"
                label="Отправить учётные данные на email"
                value={sendPassword}
                onChange={sendPasswordChangeHandler}
              />
            </Form.Group>
          </Col>
        </Row>
      )}
      <Row>
        <Col lg="4">
          <Form.Group className="w-100 mb-3">
            <Form.Label htmlFor="company">
              Компания
              <span style={{ color: "red" }}>*</span>
            </Form.Label>
            <Select
              id="company"
              name="company"
              placeholder="Выберите компанию"
              required
              isSearchable
              value={company}
              options={companiesList}
              getOptionLabel={(option) => `${option.alias}`}
              getOptionValue={(option) => option._id}
              onChange={companyChangeHandler}
            />
          </Form.Group>
        </Col>
      </Row>
      {company?.subdivisions && (
        <Row>
          <Col lg="4">
            <Form.Group className="w-100 mb-3">
              <Form.Label htmlFor="subdivision">Подразделение</Form.Label>
              <Select
                id="subdivision"
                name="subdivision"
                placeholder="Выберите подразделение"
                isSearchable
                isClearable
                value={subdivision}
                options={subdivisionsList}
                getOptionLabel={(option) => option.name}
                getOptionValue={(option) => option._id}
                onChange={subdivisionChangeHandler}
                isDisabled={!company} // Disable if no company selected
              />
            </Form.Group>
          </Col>
        </Row>
      )}

      {!isServiceAccount && (
        <Row>
          <Col lg="4">
            <Form.Group hidden={isServiceAccount} className="w-100 mb-3">
              <Form.Label htmlFor="position">Должность</Form.Label>
              <Form.Control
                id="position"
                name="position"
                type="text"
                defaultValue={user ? user.position : ""}
              />
            </Form.Group>
          </Col>
        </Row>
      )}
      {!isServiceAccount && (
        <>
          <hr></hr>
          <Row className="mb-3">
            <Col>
              <h4>Права</h4>
            </Col>
          </Row>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Глобальные роли</h5>
                </Form.Label>
                <Form.Check
                  checked={isAdmin}
                  type="switch"
                  id="isAdmin"
                  name="isAdmin"
                  label="Администратор"
                  value={isAdmin}
                  onChange={() => {
                    setIsAdmin(!isAdmin);
                    if (!isAdmin) {
                      setIsEndUser(false);
                    }
                  }}
                  className="mb-3"
                />
                <Form.Check
                  checked={isEndUser}
                  type="switch"
                  id="isEndUser"
                  name="isEndUser"
                  label="Конечный пользователь / Клиент"
                  value={isEndUser}
                  onChange={() => {
                    setIsEndUser(!isEndUser);
                    if (!isEndUser) {
                      setIsAdmin(false);
                    }
                  }}
                />
              </Form.Group>
            </Col>
          </Row>
          {/* <Row>
              <Col lg="4">
                <Form.Group className="w-100 mb-3">
                  <Form.Label htmlFor="role">
                    Роль
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Select
                    id="role"
                    name="role"
                    placeholder="Выберите роль"
                    required
                    isSearchable
                    value={role}
                    options={rolesList}
                    getOptionLabel={(option) => `${option.title}`}
                    getOptionValue={(option) => option.title}
                    onChange={roleChangeHandler}
                  />
                </Form.Group>
              </Col>
            </Row> */}
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Управление заявками</h5>
                </Form.Label>
                {ticketsWorkFlowPermissions.map((item) => (
                  <Form.Check
                    key={item.title}
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={item.isDisabled}
                    onChange={() => {
                      setTicketsWorkFlowPermissions([
                        ...ticketsWorkFlowPermissions.map((p) => ({
                          label: p.label,
                          title: p.title,
                          isActive:
                            p.title === item.title
                              ? !item.isActive
                              : p.isActive,
                          isDisabled: p.isDisabled,
                        })),
                      ]);
                    }}
                    className="mb-3"
                  />
                ))}
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Администрирование портала</h5>
                </Form.Label>
                {portalAdministrationPermissions.map((item) => (
                  <Form.Check
                    key={item.title}
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={item.isDisabled}
                    onChange={() => {
                      setPortalAdministrationPermissions([
                        ...portalAdministrationPermissions.map((p) => ({
                          label: p.label,
                          title: p.title,
                          isActive:
                            p.title === item.title
                              ? !item.isActive
                              : p.isActive,
                          isDisabled: p.isDisabled,
                        })),
                      ]);
                    }}
                    className="mb-3"
                  />
                ))}
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Модуль учёта времени</h5>
                </Form.Label>
                {timeTrackingModulePermissions.map((item) => (
                  <Form.Check
                    key={item.title}
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={item.isDisabled}
                    onChange={() => {
                      setTimeTrackingModulePermissions([
                        ...timeTrackingModulePermissions.map((p) => ({
                          label: p.label,
                          title: p.title,
                          isActive:
                            p.title === item.title
                              ? !item.isActive
                              : p.isActive,
                          isDisabled: p.isDisabled,
                        })),
                      ]);
                    }}
                    className="mb-3"
                  />
                ))}
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Модуль учёта техники</h5>
                </Form.Label>
                {inventoryModulePermissions.map((item) => (
                  <Form.Check
                    key={item.title}
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={item.isDisabled}
                    onChange={() => {
                      setInventoryModulePermissions([
                        ...inventoryModulePermissions.map((p) => ({
                          label: p.label,
                          title: p.title,
                          isActive:
                            p.title === item.title
                              ? !item.isActive
                              : p.isActive,
                          isDisabled: p.isDisabled,
                        })),
                      ]);
                    }}
                    className="mb-3"
                  />
                ))}
              </Form.Group>
            </Col>
          </Row>
          <Row>
            <Col lg="auto">
              <Form.Group className="mb-3">
                <Form.Label>
                  <h5>Модуль учёта финансов</h5>
                </Form.Label>
                {financesModulePermissions.map((item) => (
                  <Form.Check
                    key={item.title}
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={item.isDisabled}
                    onChange={() => {
                      setFinancesModulePermissions([
                        ...financesModulePermissions.map((p) => ({
                          label: p.label,
                          title: p.title,
                          isActive:
                            p.title === item.title
                              ? !item.isActive
                              : p.isActive,
                          isDisabled: p.isDisabled,
                        })),
                      ]);
                    }}
                    className="mb-3"
                  />
                ))}
              </Form.Group>
            </Col>
          </Row>
          {ticketsWorkFlowPermissions.filter(
            (perm) => perm.title === "canPerformTickets" && perm.isActive,
          ).length > 0 && (
            <>
              <Row className="mb-3">
                <Col xs="auto" className="mb-3">
                  <Form.Group className="w-100">
                    <Form.Label htmlFor="categories">Категории</Form.Label>
                    <Select
                      id="categories"
                      name="categories"
                      placeholder="Выберите категории"
                      closeMenuOnSelect={false}
                      isClearable
                      isSearchable
                      isMulti
                      required
                      value={categories}
                      options={categoriesList}
                      getOptionLabel={(option) => `${option.title}`}
                      getOptionValue={(option) => option._id}
                      onChange={categoriesChangeHandler}
                    />
                    <Button
                      variant="link"
                      size="sm"
                      onClick={allCategoriesHandler}
                    >
                      добавить все
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={clearCategoriesHandler}
                    >
                      очистить
                    </Button>
                  </Form.Group>
                </Col>
              </Row>
            </>
          )}

          <hr></hr>
          <Row className="mb-3">
            <Col>
              <h4>Dashboard</h4>
            </Col>
          </Row>
          {dashboard.map((item) => (
            <Row key={item.title}>
              <Col lg="auto">
                <Form.Group className="mb-3">
                  <Form.Check
                    checked={item.isActive}
                    type="switch"
                    id={item.title}
                    name={item.title}
                    label={item.label}
                    value={item.isActive}
                    disabled={
                      item.title !== "dashboardIsActive" &&
                      !dashboard[0].isActive
                    }
                    onChange={dashboardSwitchHandler}
                  />
                </Form.Group>
              </Col>
            </Row>
          ))}
          <hr></hr>
          <Row className="mb-3">
            <Col>
              <h4>Интеграции</h4>
            </Col>
          </Row>
          <Row>
            <Col lg="4">
              <Form.Group className="mb-3">
                <Form.Label htmlFor="getScreenApi">Pro32Connect API</Form.Label>
                <Form.Control
                  id="getScreenApi"
                  name="getScreenApi"
                  type="text"
                  disabled={getScreen?.isActive && !isEndUser}
                  defaultValue={user ? user.getScreen.api : ""}
                />
              </Form.Group>
            </Col>
          </Row>
        </>
      )}
    </FormWrapper>
  );
};

export default UserForm;
