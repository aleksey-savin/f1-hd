import { useState, useEffect, useCallback } from "react";
import { useLocation, useRevalidator } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";
import { Outlet, useLoaderData, useSubmit } from "react-router";

import { AuthedUserContext } from "../store/authed-user-context";
import useSidebarStore from "../store/sidebar";

import NavigationBar from "./Navbar";
import Footer from "./Footer";
import AlertToast from "../UI/AlertToast";

import Container from "react-bootstrap/Container";
import Card from "react-bootstrap/Card";
import ToastContainer from "react-bootstrap/ToastContainer";
import Alert from "react-bootstrap/Alert";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import Transitions from "../animations/Transition";

import useHttp from "../hooks/use-http";
import MobileBottomNavbar from "./MobileBottomNavbar";

import { getLocalStorageData, getTokenDuration } from "../util/auth";
import useOffcanvasStore from "../store/offcanvas";
import useInitialPrefsStore from "../store/prefs";

const RootLayout = () => {
  const { token, userId } = getLocalStorageData();
  const { appVersion, userData, prefs } = useLoaderData();

  const {
    leftSidebarIsActive,
    showLeftSidebar,
    closeLeftSidebar,
    leftSidebarContent,
  } = useSidebarStore();

  const initialPrefs = useInitialPrefsStore();

  useEffect(() => {
    initialPrefs.set(prefs);
  }, [prefs]);

  const offcanvas = useOffcanvasStore();
  const location = useLocation();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (location.state?.refresh) {
      revalidator.revalidate();
    }
  }, [location]);

  useEffect(() => {
    if (
      [
        "/tickets",
        "/routine-tasks",
        "/companies",
        "/users",
        "/ticket-templates",
        "/ticket-categories",
        "/finances/summary-report",
      ].includes(location.pathname)
    ) {
      return showLeftSidebar();
    }

    closeLeftSidebar();
  }, [location]);

  useEffect(() => {
    if (
      ["add", "update", "schedule", "confirm"].includes(
        location.pathname.split("/")[location.pathname.split("/").length - 1],
      ) ||
      ["update"].includes(
        location.pathname.split("/")[location.pathname.split("/").length - 2],
      )
    ) {
      return offcanvas.setShow();
    } else {
      return offcanvas.setClose();
    }
  }, [location]);

  const submit = useSubmit();
  const isLoggedIn = !!token;

  useEffect(() => {
    if (!token) {
      return;
    }

    if (token === "EXPIRED") {
      submit(null, { action: "/logout", method: "POST" });
      return;
    }

    const tokenDuration = getTokenDuration();

    setTimeout(() => {
      submit(null, { action: "/logout", method: "POST" });
    }, tokenDuration);
  }, [token, submit]);

  const [userPermissions, setUserPermissions] = useState([]);

  const { sendRequest: fetchUserHandler } = useHttp();
  const fetchUser = useCallback(() => {
    fetchUserHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/users/${userId}`,
        headers: {
          Authorization: "Bearer " + token,
        },
      },
      (data) => {
        if (data.permissions) {
          setUserPermissions(data.permissions);
        }
      },
    );
  }, [fetchUserHandler, token, userId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    fetchUser();
  }, [fetchUser, token]);

  return (
    <AuthedUserContext.Provider value={userData}>
      {isLoggedIn && <NavigationBar userPermissions={userPermissions} />}
      <Transitions>
        <BrowserView>
          {userData.backgroundImagePath && (
            <div
              className="background-container"
              style={{
                backgroundImage: `url("${import.meta.env.VITE_API_ADDRESS}/uploads/${userData.backgroundImagePath}")`,
              }}
            />
          )}
          <Container
            fluid
            style={{ maxWidth: "1920px", paddingTop: "100px" }}
            className="px-5 pb-5"
          >
            {appVersion !== import.meta.env.VITE_VERSION && (
              <Alert variant="warning" className="mb-4" dismissible>
                Версия приложения в браузере не совпадает с версией на сервере.
                Пожалуйста, обновите кэш страницы нажатием клавиш CTRL+SHIFT+R
              </Alert>
            )}

            <Row>
              {leftSidebarIsActive && (
                <Col hidden={!leftSidebarIsActive} className="col-4 col-xl-3">
                  <Card className="shadow">
                    <Card.Body className="h-100 p-3">
                      {leftSidebarContent}
                    </Card.Body>
                  </Card>
                </Col>
              )}
              <Col>
                <Card
                  className="mb-3 shadow"
                  style={{
                    minHeight: "calc(100svh - 124px)",
                  }}
                >
                  <Card.Body>
                    <Outlet />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            <Footer />
          </Container>
        </BrowserView>
      </Transitions>
      <MobileView>
        <Container style={{ paddingTop: "100px" }}>
          <Outlet />
          <Footer />
          <MobileBottomNavbar />
        </Container>
      </MobileView>
      <ToastContainer className="p-3" position="bottom-end">
        <AlertToast />
      </ToastContainer>
    </AuthedUserContext.Provider>
  );
};

export default RootLayout;
