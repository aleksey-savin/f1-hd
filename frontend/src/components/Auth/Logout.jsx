import NavDropdown from "react-bootstrap/NavDropdown";
import Button from "react-bootstrap/Button";

import { RiDoorOpenLine } from "react-icons/ri";
import { Form, redirect } from "react-router";

const Logout = () => {
  return (
    <Form action="/logout" method="POST">
      <NavDropdown.Item as={Button} type="submit">
        <RiDoorOpenLine /> Выйти
      </NavDropdown.Item>
    </Form>
  );
};

export default Logout;

export function action() {
  localStorage.removeItem("token");
  localStorage.removeItem("userId");
  localStorage.removeItem("expiryDate");
  localStorage.removeItem("isAdmin");
  localStorage.removeItem("role");
  localStorage.removeItem("canEditTickets");
  localStorage.removeItem("canAdministrateTickets");
  localStorage.removeItem("canDeleteTickets");
  localStorage.removeItem("canSeeAllTickets");
  localStorage.removeItem("canSeeWorksReport");
  localStorage.removeItem("canSeeAnalytics");
  localStorage.removeItem("canUpdateChangelog");
  localStorage.removeItem("userName");
  localStorage.removeItem("contactsTel");
  localStorage.removeItem("contactsEmail");
  localStorage.removeItem("contactsAddress");
  localStorage.removeItem("getScreenIsActive");
  localStorage.removeItem("dashboardIsActive");
  localStorage.removeItem("timezone");
  localStorage.removeItem("emailNotifications");

  return redirect("/auth?mode=login");
}
