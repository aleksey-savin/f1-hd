import { useContext } from "react";
import { useLoaderData } from "react-router";

import { RiSettings3Line } from "react-icons/ri";

import Transitions from "../animations/Transition";

import useHttp from "../hooks/use-http";

import useToastStore from "../store/toast-store";

import { RiSaveLine } from "react-icons/ri";

import Tab from "react-bootstrap/Tab";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Nav from "react-bootstrap/Nav";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";

import PrefsNotifications from "../components/Preferences/Notifications";
import PrefsTicketsCollect from "../components/Preferences/TicketsCollect";
import PrefsIntegrations from "../components/Preferences/Integrations";
import PrefsService from "../components/Preferences/Service";
import PrefsModules from "../components/Preferences/Modules";
import PrefsGlobals from "../components/Preferences/Globals";
import PrefsAi from "../components/Preferences/Ai";
import PrefsKnowledgeBase from "../components/Preferences/KnowledgeBase";
import PrefsMikrotik from "../components/Preferences/Mikrotik";

import Forbidden from "../components/Error/403";
import { getLocalStorageData } from "../util/auth";
import { AuthedUserContext } from "../store/authed-user-context";

const Preferences = () => {
  const { token } = getLocalStorageData();
  const { isAdmin } = useContext(AuthedUserContext);

  const { showToast } = useToastStore();

  const data = useLoaderData();
  const prefs = data ? data : [];

  const { sendRequest: updatePreferencesHandler } = useHttp();

  const submitHandler = (event) => {
    event.preventDefault();

    updatePreferencesHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/preferences`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: prefs,
      },
      (data) => {
        if (data.preferences) {
          localStorage.setItem("timezone", data.preferences.timezone);
          showToast("success text-white", "Изменения сохранены");
        } else {
          showToast("danger text-white", data.message);
        }
      },
    );
  };

  return (
    <>
      {isAdmin && (
        <Transitions>
          <Card.Title className="mb-3 border-bottom">
            <h1 className="display-4">
              <RiSettings3Line /> Глобальные настройки
            </h1>
          </Card.Title>
          <Tab.Container defaultActiveKey="globals">
            <Row>
              <Col lg={3} className="mb-3">
                <Nav variant="pills" className="flex-column">
                  <Nav.Item>
                    <Nav.Link eventKey="globals">Основные</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="tickets">Сбор заявок</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="notifications">Уведомления</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="modules">
                      Функциональные модули
                    </Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="integrations">Интеграции</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="ai">AI</Nav.Link>
                  </Nav.Item>
                  {prefs?.modules?.knowledgeBase.isActive && (
                    <Nav.Item>
                      <Nav.Link eventKey="knowledgeBase">База знаний</Nav.Link>
                    </Nav.Item>
                  )}
                  {prefs?.modules?.inventory?.isActive && (
                    <Nav.Item>
                      <Nav.Link eventKey="mikrotik">Mikrotik</Nav.Link>
                    </Nav.Item>
                  )}
                  <Nav.Item>
                    <Nav.Link eventKey="service">Обслуживание</Nav.Link>
                  </Nav.Item>
                </Nav>
              </Col>
              <Col lg={9} className="border-start ps-3">
                <Form onSubmit={submitHandler}>
                  <Tab.Content>
                    <Tab.Pane eventKey="globals">
                      <PrefsGlobals prefs={prefs} />
                    </Tab.Pane>
                    <Tab.Pane eventKey="tickets">
                      <PrefsTicketsCollect prefs={prefs} />
                    </Tab.Pane>
                    <Tab.Pane eventKey="notifications">
                      <PrefsNotifications prefs={prefs} />
                    </Tab.Pane>
                    <Tab.Pane eventKey="modules">
                      <PrefsModules prefs={prefs} />
                    </Tab.Pane>
                    <Tab.Pane eventKey="integrations">
                      <PrefsIntegrations prefs={prefs} />
                    </Tab.Pane>
                    <Tab.Pane eventKey="ai">
                      <PrefsAi prefs={prefs} />
                    </Tab.Pane>
                    {prefs?.modules?.knowledgeBase.isActive && (
                      <Tab.Pane eventKey="knowledgeBase">
                        <PrefsKnowledgeBase prefs={prefs} />
                      </Tab.Pane>
                    )}
                    {prefs?.modules?.inventory?.isActive && (
                      <Tab.Pane eventKey="mikrotik">
                        <PrefsMikrotik prefs={prefs} />
                      </Tab.Pane>
                    )}
                    <Tab.Pane eventKey="service">
                      <PrefsService prefs={prefs} />
                    </Tab.Pane>
                  </Tab.Content>
                  <Form.Group className="mt-3 border-top pt-3">
                    <Button variant="primary" type="submit">
                      <RiSaveLine /> Сохранить
                    </Button>
                  </Form.Group>
                </Form>
              </Col>
            </Row>
          </Tab.Container>
        </Transitions>
      )}
      {!isAdmin && <Forbidden />}
    </>
  );
};

export default Preferences;

export async function initialPrefsLoader() {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function loader() {
  document.title = "F1 HD | НАСТРОЙКИ";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action() {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences/update-db-conf`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
