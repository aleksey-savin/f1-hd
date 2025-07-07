import { redirect, useLoaderData } from "react-router";

import Transitions from "../../animations/Transition";

import ResetPassword from "../../components/User/ResetPassword";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Nav from "react-bootstrap/Nav";
import Tab from "react-bootstrap/Tab";
import Card from "react-bootstrap/Card";

import { RiUserSettingsLine } from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";
import Appearance from "../../components/User/AccountSettings/Appearance";
import Profile from "../../components/User/AccountSettings/Profile";
import Notifications from "../../components/User/AccountSettings/Notifications";
import Integrations from "../../components/User/AccountSettings/Integrations";

const MyAccount = () => {
  const { user, initialPrefs } = useLoaderData();

  return (
    <>
      <Transitions>
        <>
          <Card.Title>
            <h1 className="display-4">
              <RiUserSettingsLine /> Мой аккаунт
            </h1>
          </Card.Title>
          <hr></hr>
          <Tab.Container defaultActiveKey="appearance">
            <Row>
              <Col sm={3} className="mb-3">
                <Nav variant="pills" className="flex-column">
                  <Nav.Item>
                    <Nav.Link eventKey="appearance">Внешний вид</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="profile">Профиль</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="security">Безопасность</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="notifications">Уведомления</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="integrations">Интеграции</Nav.Link>
                  </Nav.Item>
                </Nav>
              </Col>
              <Col sm={9}>
                <Tab.Content>
                  <Tab.Pane eventKey="profile">
                    <Row className="mb-2">
                      <Col sm="auto">
                        <Profile user={user} />
                      </Col>
                    </Row>
                  </Tab.Pane>
                  <Tab.Pane eventKey="appearance">
                    <Row className="mb-2">
                      <Col sm="auto">
                        <Appearance user={user} />
                      </Col>
                    </Row>
                  </Tab.Pane>
                  <Tab.Pane eventKey="notifications">
                    <Row className="mb-2">
                      <Col sm="auto">
                        <Notifications
                          user={user}
                          initialPrefs={initialPrefs}
                        />
                      </Col>
                    </Row>
                  </Tab.Pane>
                  <Tab.Pane eventKey="security">
                    <Row className="mb-2">
                      <Col sm="auto">
                        <ResetPassword user={user} />
                      </Col>
                    </Row>
                  </Tab.Pane>
                  <Tab.Pane eventKey="integrations">
                    <Row className="mb-2">
                      <Col sm="auto">
                        <Integrations user={user} />
                      </Col>
                    </Row>
                  </Tab.Pane>
                </Tab.Content>
              </Col>
            </Row>
          </Tab.Container>
        </>
      </Transitions>
    </>
  );
};

export default MyAccount;

export async function loader() {
  const { token, userId } = getLocalStorageData();

  if (!token) {
    return redirect("/auth");
  }

  document.title = "F1 HD | МОЙ АККАУНТ";

  const userResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/users/${userId}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  const initialPrefsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/preferences-initial`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!userResponse.ok) {
    if (userResponse.status === 401 || userResponse.status === 402) {
      return redirect("/auth");
    }
    throw Response.json(
      { message: userResponse.message },
      {
        status: userResponse.status,
      },
    );
  } else {
    return {
      user: await userResponse.json(),
      initialPrefs: await initialPrefsResponse.json(),
    };
  }
}

export async function action({ request }) {
  const { token } = getLocalStorageData();
  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "profile-update") {
    const profile = {
      id: data.get("id"),
      firstName: data.get("firstName"),
      lastName: data.get("lastName"),
      email: data.get("email"),
      phone: data.get("phone"),
      position: data.get("position"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "notifications-update") {
    const profile = {
      id: data.get("id"),
      notify: {
        byTelegram: {
          newTicket: data.get("tgNewTicket") === "true",
          respStateUpdate: data.get("tgRespStateUpdate") === "true",
          ticketStateUpdate: data.get("tgTicketStateUpdate") === "true",
          ticketDeadlineUpdate: data.get("tgTicketDeadlineUpdate") === "true",
          ticketNewComment: data.get("tgTicketNewComment") === "true",
          scheduledWorks: data.get("tgScheduledWorks") === "true",
        },
        byEmail: {
          newTicket: data.get("emailNewTicket") === "true",
          respStateUpdate: data.get("emailRespStateUpdate") === "true",
          ticketStateUpdate: data.get("emailTicketStateUpdate") === "true",
          ticketDeadlineUpdate:
            data.get("emailTicketDeadlineUpdate") === "true",
          ticketNewComment: data.get("emailTicketNewComment") === "true",
          scheduledWorks: data.get("emailScheduledWorks") === "true",
        },
      },
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }

  if (intent === "integrations-update") {
    const profile = {
      id: data.get("id"),
      telegramBot: {
        chatId: "",
        isActive: false,
      },
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/update-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(profile),
      },
    );

    if (response.status === 409) {
      return response;
    }

    if (!response.ok) {
      throw Response.json(
        { message: "Не удалось обновить аккаунт" },
        { status: 500 },
      );
    }

    return response;
  }
}
