import { useState, useEffect, useContext } from "react";
import { NavLink } from "react-router";
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
import { RiUserLine, RiUserSettingsLine } from "react-icons/ri";

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

const NavigationBar = ({ handleShowAuthModal }) => {
  const { token } = getLocalStorageData();

  // State and Context
  const [showOffcanvas, setShowOffcanvas] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [isDark, setIsDark] = useState(
    localStorage.getItem("darkMode") === "true",
  );

  const { firstName, lastName, isEndUser } = useContext(AuthedUserContext);
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

  console.log(isEndUser);

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
        </Navbar.Offcanvas>
      </Container>
    </Navbar>
  );
};

export default NavigationBar;
