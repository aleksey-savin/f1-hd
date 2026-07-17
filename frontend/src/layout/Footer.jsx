import { useContext } from "react";
import { Link } from "react-router";
import { isBrowser } from "react-device-detect";

import { cn } from "@/lib/utils";
import useInitialPrefs from "../store/prefs";
import { AuthedUserContext } from "../store/authed-user-context";
import { getLocalStorageData } from "../util/auth";

// Футер оболочки: контакты компании и служебная строка. Лёгкий текст на канве
// (без легаси-карточек). ОБЯЗАТЕЛЬНО tw:relative: фоновая картинка (fixed
// .background-container) рисуется поверх статического контента — без
// позиционирования футер под ней исчезает. При заданной картинке текст канвы
// нечитаем — футер получает подложку-«лист» цвета канвы (как контент в Root).
const Footer = () => {
  const { token } = getLocalStorageData();
  const { contacts } = useInitialPrefs();
  const { backgroundImagePath } = useContext(AuthedUserContext);

  // Фон рендерится только на десктопе (Root.jsx)
  const sheet = isBrowser && !!backgroundImagePath;

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
    <footer
      className={cn(
        "tw:relative tw:mt-6 tw:py-6 tw:text-center tw:text-sm tw:text-muted-foreground",
        sheet
          ? "tw:mx-auto tw:w-fit tw:max-w-full tw:rounded-2xl tw:border tw:border-border tw:px-8"
          : "tw:border-t tw:border-border-soft",
      )}
      style={sheet ? { background: "var(--bs-body-bg)" } : undefined}
    >
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
