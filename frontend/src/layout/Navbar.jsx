import { useState, useEffect, useContext } from "react";
import { NavLink } from "react-router";
import { AuthedUserContext } from "../store/authed-user-context";
import useInitialPrefs from "../store/prefs";
import { getLocalStorageData } from "../util/auth";
import Logout from "../components/Auth/Logout";

// Bootstrap Components
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import Nav from "react-bootstrap/Nav";
import NavDropdown from "react-bootstrap/NavDropdown";
import Offcanvas from "react-bootstrap/Offcanvas";

// Icons
import {
  RiAccountBoxLine,
  RiServerLine,
  RiBuilding2Line,
  RiSettings3Line,
  RiDraftLine,
  RiArchiveLine,
  RiUserLine,
  RiUserSettingsLine,
  RiFileList2Line,
  RiDashboard2Line,
  RiCalendar2Line,
  RiCoinLine,
  RiServiceLine,
  RiDeviceLine,
  RiTeamLine,
  RiContactsLine,
} from "react-icons/ri";
import { GoProjectTemplate } from "react-icons/go";
import { MdOutlineDarkMode, MdLightMode, MdComputer } from "react-icons/md";
import { FaNetworkWired } from "react-icons/fa";
import { IoHardwareChipOutline } from "react-icons/io5";
import { TbCheckbox } from "react-icons/tb";

// Dropdown Title Components
const DropdownTitles = {
  User: ({ firstName, lastName }) => (
    <span>
      <RiUserLine /> {`${firstName} ${lastName}`}
    </span>
  ),
  Lists: () => (
    <span>
      <RiFileList2Line /> Списки
    </span>
  ),
  Reports: () => (
    <span>
      <RiDraftLine /> Отчёты
    </span>
  ),
  Finances: () => (
    <span>
      <RiCoinLine /> Финансы
    </span>
  ),
  Templates: () => (
    <span>
      <GoProjectTemplate /> Шаблоны
    </span>
  ),
  Inventory: () => (
    <span>
      <IoHardwareChipOutline /> Оборудование
    </span>
  ),
};

const ThemeSelector = ({ theme, isDark, handleThemeChange }) => (
  <NavDropdown
    title={
      theme === "system" ? (
        <MdComputer />
      ) : isDark ? (
        <MdOutlineDarkMode />
      ) : (
        <MdLightMode />
      )
    }
    align="end"
  >
    <NavDropdown.Item
      active={theme === "light"}
      onClick={() => handleThemeChange("light")}
    >
      <MdLightMode /> Светлая
    </NavDropdown.Item>
    <NavDropdown.Item
      active={theme === "dark"}
      onClick={() => handleThemeChange("dark")}
    >
      <MdOutlineDarkMode /> Тёмная
    </NavDropdown.Item>
    <NavDropdown.Item
      active={theme === "system"}
      onClick={() => handleThemeChange("system")}
    >
      <MdComputer /> Системная
    </NavDropdown.Item>
  </NavDropdown>
);

const NavigationBar = ({ handleShowAuthModal }) => {
  // State and Context
  const [showOffcanvas, setShowOffcanvas] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [isDark, setIsDark] = useState(
    localStorage.getItem("darkMode") === "true",
  );

  const { token } = getLocalStorageData();
  const { modules } = useInitialPrefs();
  const { isAdmin, firstName, lastName, dashboard, permissions } =
    useContext(AuthedUserContext);
  const isLoggedIn = !!token;

  const {
    canManageTicketCategories,
    canManageCompanies,
    canManageUsers,
    canManageRoutineTasks,
    canSeeWorksReport,
    canUseTimeTrackingModule,
    canUseInventoryModule,
    canManageMikrotikDevices,
    canManageClientDevices,
    canUseFinancesModule,
    canSeeGlobalFinancialReport,
    canSeePersonalFinancialReport,
    canManageServicePlans,
    canPerformTickets,
  } = permissions;

  // Event Handlers
  const handleClose = () => setShowOffcanvas(false);
  const handleShow = () => setShowOffcanvas(true);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    let newIsDark;

    switch (newTheme) {
      case "dark":
        newIsDark = true;
        break;
      case "light":
        newIsDark = false;
        break;
      case "system":
        newIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        break;
      default:
        newIsDark = false;
    }

    setIsDark(newIsDark);
    localStorage.setItem("theme", newTheme);
    localStorage.setItem("darkMode", newIsDark);
    window.location.reload();
  };

  // System Theme Effect
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = () => {
      if (theme === "system") {
        const newIsDark = mediaQuery.matches;
        setIsDark(newIsDark);
        localStorage.setItem("darkMode", newIsDark);
        window.location.reload();
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () =>
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  return (
    <Navbar
      expand="xxl"
      bg={isDark ? "dark" : "primary"}
      className="navbar-dark fixed-top py-2"
    >
      <Container fluid>
        <Navbar.Toggle
          aria-controls={`offcanvasNavbar-expand-lg`}
          onClick={handleShow}
        />
        <Navbar.Brand as={NavLink} to="/" id="logo" className="p-0">
          <img
            alt=""
            src="/logo.png"
            className="my-1"
            style={{ maxHeight: "50px" }}
          />
        </Navbar.Brand>

        <Navbar.Offcanvas
          show={showOffcanvas}
          onHide={handleClose}
          id={`offcanvasNavbar-expand-lg`}
          aria-labelledby={`offcanvasNavbarLabel-expand-lg`}
          placement="start"
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title id={`offcanvasNavbarLabel-expand-lg`}>
              Меню
            </Offcanvas.Title>
          </Offcanvas.Header>

          <Offcanvas.Body>
            <Nav className="justify-content-start flex-grow-1 pe-3">
              {isLoggedIn && (
                <>
                  {/* Main Navigation Items */}
                  <Nav.Link
                    hidden={!dashboard?.isActive}
                    as={NavLink}
                    to="/dashboard"
                    onClick={handleClose}
                  >
                    <RiDashboard2Line /> Dashboard
                  </Nav.Link>

                  <Nav.Link as={NavLink} to="/tickets" onClick={handleClose}>
                    <TbCheckbox /> Заявки
                  </Nav.Link>

                  {/* Conditional Navigation Items */}
                  {canPerformTickets && !canManageCompanies && (
                    <Nav.Link
                      as={NavLink}
                      to="/companies"
                      onClick={handleClose}
                    >
                      <RiAccountBoxLine /> Компании
                    </Nav.Link>
                  )}

                  {canPerformTickets && !canManageUsers && (
                    <Nav.Link as={NavLink} to="/users" onClick={handleClose}>
                      <RiAccountBoxLine /> Пользователи
                    </Nav.Link>
                  )}

                  {/* Templates Dropdown */}
                  {!canPerformTickets && (
                    <Nav.Link
                      as={NavLink}
                      to="/ticket-templates"
                      onClick={handleClose}
                    >
                      <GoProjectTemplate /> Шаблоны заявок
                    </Nav.Link>
                  )}

                  {/* Lists Dropdown */}
                  <NavDropdown
                    hidden={
                      !canPerformTickets &&
                      !isAdmin &&
                      !canManageTicketCategories &&
                      !canManageCompanies &&
                      !canManageUsers &&
                      !canManageRoutineTasks
                    }
                    title={<DropdownTitles.Lists />}
                  >
                    <NavDropdown.Item
                      as={NavLink}
                      to="/ticket-templates"
                      onClick={handleClose}
                    >
                      <GoProjectTemplate /> Шаблоны заявок
                    </NavDropdown.Item>
                    <NavDropdown.Item
                      as={NavLink}
                      hidden={!canManageTicketCategories}
                      to="/ticket-categories"
                      onClick={handleClose}
                    >
                      <RiServerLine /> Категории заявок
                    </NavDropdown.Item>
                    <NavDropdown.Item
                      as={NavLink}
                      hidden={!canManageCompanies}
                      to="/companies"
                      onClick={handleClose}
                    >
                      <RiBuilding2Line /> Компании
                    </NavDropdown.Item>
                    <NavDropdown.Item
                      as={NavLink}
                      hidden={!canManageUsers && !isAdmin}
                      to="/users"
                      onClick={handleClose}
                    >
                      <RiAccountBoxLine /> Пользователи
                    </NavDropdown.Item>
                    {canManageRoutineTasks && (
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canManageRoutineTasks}
                        to="/routine-tasks"
                        onClick={handleClose}
                      >
                        <RiCalendar2Line /> Регламентные задания
                      </NavDropdown.Item>
                    )}
                  </NavDropdown>

                  {/* Reports Dropdown */}
                  {(modules.timeTracking.isActive ||
                    modules.inventory.isActive) && (
                    <NavDropdown
                      hidden={!canSeeWorksReport && !canManageMikrotikDevices}
                      title={<DropdownTitles.Reports />}
                    >
                      {canUseTimeTrackingModule &&
                        modules.timeTracking.isActive && (
                          <NavDropdown.Item
                            as={NavLink}
                            hidden={!canSeeWorksReport}
                            to="/report/work"
                            onClick={handleClose}
                          >
                            <RiDraftLine /> Отчёт по работам
                          </NavDropdown.Item>
                        )}
                      {canUseInventoryModule && modules.inventory.isActive && (
                        <NavDropdown.Item
                          hidden={!canManageMikrotikDevices}
                          as={NavLink}
                          to="/report/networks"
                          onClick={handleClose}
                        >
                          <RiDraftLine /> Диапазоны сетей
                        </NavDropdown.Item>
                      )}
                    </NavDropdown>
                  )}

                  {/* Finances Dropdown */}
                  {modules?.finances.isActive && canUseFinancesModule && (
                    <NavDropdown title={<DropdownTitles.Finances />}>
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canManageServicePlans}
                        to="/finances/service-plans"
                        onClick={handleClose}
                      >
                        <RiServiceLine /> Услуги
                      </NavDropdown.Item>
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canSeeGlobalFinancialReport}
                        to="/finances/summary-report"
                        onClick={handleClose}
                      >
                        <RiDraftLine /> Согласование отчётов
                      </NavDropdown.Item>
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canSeePersonalFinancialReport}
                        to="/finances/personal-report"
                        onClick={handleClose}
                      >
                        <RiContactsLine /> Персональный отчёт
                      </NavDropdown.Item>
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canSeeGlobalFinancialReport}
                        to="/finances/employee-report"
                        onClick={handleClose}
                      >
                        <RiTeamLine /> Отчёт по сотрудникам
                      </NavDropdown.Item>
                    </NavDropdown>
                  )}

                  {/* Inventory Dropdown */}
                  {modules?.inventory.isActive && canUseInventoryModule && (
                    <NavDropdown title={<DropdownTitles.Inventory />}>
                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canManageClientDevices}
                        to="/inventory/client-devices"
                        onClick={handleClose}
                      >
                        <RiDeviceLine /> Устройства
                      </NavDropdown.Item>

                      <NavDropdown.Item
                        as={NavLink}
                        hidden={!canManageMikrotikDevices}
                        to="/devices/mikrotik"
                        onClick={handleClose}
                      >
                        <FaNetworkWired /> Устройства Mikrotik
                      </NavDropdown.Item>
                    </NavDropdown>
                  )}

                  {/* Admin Settings */}
                  {isAdmin && (
                    <Nav.Link
                      as={NavLink}
                      to="/preferences"
                      onClick={handleClose}
                    >
                      <RiSettings3Line /> Настройки
                    </Nav.Link>
                  )}

                  <Nav.Link
                    as={NavLink}
                    to="/closed-tickets"
                    onClick={handleClose}
                  >
                    <RiArchiveLine /> Архив заявок
                  </Nav.Link>
                </>
              )}
            </Nav>

            {/* User Navigation */}
            <Nav>
              {isLoggedIn && (
                <>
                  <ThemeSelector
                    theme={theme}
                    isDark={isDark}
                    handleThemeChange={handleThemeChange}
                  />
                  <NavDropdown
                    title={
                      <DropdownTitles.User
                        firstName={firstName}
                        lastName={lastName}
                      />
                    }
                    align="end"
                  >
                    <NavDropdown.Item
                      as={NavLink}
                      to="/my-account"
                      onClick={handleClose}
                    >
                      <RiUserSettingsLine /> Мой аккаунт
                    </NavDropdown.Item>
                    <NavDropdown.Divider />
                    <Logout handleShowAuthModal={handleShowAuthModal} />
                  </NavDropdown>
                </>
              )}
            </Nav>
          </Offcanvas.Body>
        </Navbar.Offcanvas>
      </Container>
    </Navbar>
  );
};

export default NavigationBar;
