import { Link } from "react-router";

import useInitialPrefs from "../store/prefs";
import { getLocalStorageData } from "../util/auth";

// Футер оболочки: контакты компании и служебная строка. Лёгкий текст на канве
// (без легаси-карточек) — живёт и под мигрированными экранами, и под Card
// легаси-страниц.
const Footer = () => {
  const { token } = getLocalStorageData();
  const { contacts } = useInitialPrefs();

  if (!token) return null;

  const contactItems = [
    contacts?.tel && (
      <a
        key="tel"
        href={`tel:${contacts.tel}`}
        className="tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        {contacts.tel}
      </a>
    ),
    contacts?.email && (
      <a
        key="email"
        href={`mailto:${contacts.email}`}
        className="tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
      >
        {contacts.email}
      </a>
    ),
    contacts?.address && <span key="address">{contacts.address}</span>,
  ].filter(Boolean);

  return (
    <footer className="tw:mt-10 tw:border-t tw:border-border-soft tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground">
      {contactItems.length > 0 && (
        <div className="tw:mb-2 tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-x-2.5 tw:gap-y-1">
          {contactItems.map((item, index) => (
            <span
              key={index}
              className="tw:inline-flex tw:items-center tw:gap-2.5"
            >
              {index > 0 && (
                <span aria-hidden className="tw:text-faint">
                  ·
                </span>
              )}
              {item}
            </span>
          ))}
        </div>
      )}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-x-2.5 tw:gap-y-1 tw:text-faint">
        <Link
          to="/changelog"
          className="tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
        >
          Changelog
        </Link>
        <span aria-hidden>·</span>
        <span>© {new Date().getFullYear()} F1Lab Helpdesk</span>
        <span aria-hidden>·</span>
        <span>Версия {import.meta.env.VITE_VERSION}</span>
      </div>
    </footer>
  );
};

export default Footer;
