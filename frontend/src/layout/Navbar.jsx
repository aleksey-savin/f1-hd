import { useState, useEffect, useContext } from "react";
import { NavLink, Form } from "react-router";
import { AuthedUserContext } from "../store/authed-user-context";

import { getLocalStorageData } from "../util/auth";
import Logout from "../components/Auth/Logout";

// Bootstrap Components
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import Nav from "react-bootstrap/Nav";
import NavDropdown from "react-bootstrap/NavDropdown";
import Offcanvas from "react-bootstrap/Offcanvas";

// Icons
import { RiUserLine, RiUserSettingsLine, RiDoorOpenLine } from "react-icons/ri";

import { MdOutlineDarkMode, MdLightMode, MdComputer } from "react-icons/md";

import EndUserNavs from "./Navigation/EndUser";
import EmployeeNavs from "./Navigation/Employee";

// Dropdown Title Components
const DropdownTitles = {
  User: ({ firstName, lastName }) => (
    <span>
      <RiUserLine /> {`${firstName} ${lastName}`}
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

// Сегментированный переключатель темы для мобильного бургер-меню
const DrawerThemeSwitch = ({ theme, handleThemeChange }) => {
  const options = [
    { value: "light", label: "Светлая", Icon: MdLightMode },
    { value: "dark", label: "Тёмная", Icon: MdOutlineDarkMode },
    { value: "system", label: "Системная", Icon: MdComputer },
  ];

  return (
    <div className="drawer-theme" role="group" aria-label="Тема оформления">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          className={`drawer-theme__btn${theme === value ? " is-active" : ""}`}
          onClick={() => handleThemeChange(value)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
};

const NavigationBar = ({ handleShowAuthModal, embedded = false }) => {
  const { token } = getLocalStorageData();

  // State and Context
  const [showOffcanvas, setShowOffcanvas] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [isDark, setIsDark] = useState(
    localStorage.getItem("darkMode") === "true",
  );

  const { firstName, lastName, isEndUser, isAdmin } =
    useContext(AuthedUserContext);
  const isLoggedIn = !!token;

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

  const roleLabel = isAdmin
    ? "Администратор"
    : isEndUser
      ? "Пользователь"
      : "Сотрудник";
  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.trim() || "?";

  return (
    <Navbar
      expand="xxl"
      bg={isDark ? "dark" : "primary"}
      className={`navbar-dark ${embedded ? "mobile-shell__header" : "fixed-top py-2"}`}
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

          {embedded ? (
            // Мобильное бургер-меню: шапка пользователя + навигация + футер.
            // Классы .drawer-* стилизуют его независимо от десктопного бара.
            <Offcanvas.Body className="drawer-body">
              {isLoggedIn && (
                <>
                  <div className="drawer-user">
                    <span className="drawer-user__avatar">{initials}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="drawer-user__name text-truncate">
                        {firstName} {lastName}
                      </div>
                      <div className="drawer-user__role">{roleLabel}</div>
                    </div>
                  </div>

                  <div className="drawer-section__label">Навигация</div>
                  <Nav className="drawer-nav flex-column">
                    {isEndUser ? (
                      <EndUserNavs setShowOffcanvas={setShowOffcanvas} />
                    ) : (
                      <EmployeeNavs setShowOffcanvas={setShowOffcanvas} />
                    )}
                  </Nav>

                  <div className="drawer-footer">
                    <div className="drawer-section__label">Тема</div>
                    <DrawerThemeSwitch
                      theme={theme}
                      handleThemeChange={handleThemeChange}
                    />
                    <NavLink
                      to="/my-account"
                      onClick={handleClose}
                      className="drawer-action"
                    >
                      <RiUserSettingsLine /> Мой аккаунт
                    </NavLink>
                    <Form action="/logout" method="POST">
                      <button
                        type="submit"
                        className="drawer-action drawer-action--danger"
                      >
                        <RiDoorOpenLine /> Выйти
                      </button>
                    </Form>
                  </div>
                </>
              )}
            </Offcanvas.Body>
          ) : (
            <Offcanvas.Body>
              <Nav className="justify-content-start flex-grow-1 pe-3">
                {isLoggedIn && (
                  <>
                    {isEndUser && (
                      <EndUserNavs setShowOffcanvas={setShowOffcanvas} />
                    )}
                    {!isEndUser && (
                      <EmployeeNavs setShowOffcanvas={setShowOffcanvas} />
                    )}
                  </>
                )}
              </Nav>

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
          )}
        </Navbar.Offcanvas>
      </Container>
    </Navbar>
  );
};

export default NavigationBar;
