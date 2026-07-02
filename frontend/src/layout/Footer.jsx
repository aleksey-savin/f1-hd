import { Link } from "react-router";

import Card from "react-bootstrap/Card";

import { getLocalStorageData } from "../util/auth";
import { getInitialPrefsData } from "../util/prefs";

const Footer = () => {
  const { token } = getLocalStorageData();
  const { contacts } = getInitialPrefsData();
  const isLoggedIn = !!token;

  return (
    <>
      {isLoggedIn && (
        <>
          {(contacts.tel || contacts.email || contacts.address) && (
            <Card className="text-center mb-3 shadow">
              <Card.Body>
                <h5>Наши контакты</h5>
                <hr></hr>
                <p>
                  Телефон: <a href={`tel:${contacts.tel}`}>{contacts.tel}</a>
                </p>
                <p>
                  Email: <a href="mailto:">{contacts.email}</a>
                </p>
                <p>Адрес: {contacts.address}</p>
              </Card.Body>
            </Card>
          )}

          <Card className="text-center shadow">
            <Card.Body>
              <div className="text-center">
                <Link to="/changelog">Changelog</Link>
              </div>
              <div className="footer-copyright text-center pt-3">
                © {new Date().getFullYear()} F1Lab Helpdesk
              </div>
              <div className="text-center pb-3">
                Версия {import.meta.env.VITE_VERSION}
              </div>
            </Card.Body>
          </Card>
        </>
      )}
    </>
  );
};
export default Footer;
