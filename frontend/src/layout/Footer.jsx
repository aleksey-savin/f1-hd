import { useContext } from "react";
import { isBrowser } from "react-device-detect";

import { cn } from "@/lib/utils";
import useInitialPrefs from "../store/prefs";
import { AuthedUserContext } from "../store/authed-user-context";
import { getLocalStorageData } from "../util/auth";

// Футер оболочки: контакты компании и служебная строка. Лёгкий текст на канве
// (без легаси-карточек). ОБЯЗАТЕЛЬНО relative: фоновая картинка (fixed
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
        className="text-muted-foreground no-underline hover:text-foreground"
      >
        {contacts.tel}
      </a>
    ),
    contacts?.email && (
      <a
        key="email"
        href={`mailto:${contacts.email}`}
        className="text-muted-foreground no-underline hover:text-foreground"
      >
        {contacts.email}
      </a>
    ),
    contacts?.address && <span key="address">{contacts.address}</span>,
  ].filter(Boolean);

  return (
    <footer
      className={cn(
        "relative mt-6 py-6 text-center text-sm text-muted-foreground",
        sheet
          ? "mx-auto w-fit max-w-full rounded-2xl border border-border bg-card px-8"
          : "border-t border-border-soft",
      )}
    >
      {contactItems.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          {contactItems.map((item, index) => (
            <span key={index} className="inline-flex items-center gap-2.5">
              {index > 0 && (
                <span aria-hidden className="text-faint">
                  ·
                </span>
              )}
              {item}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-faint">
        <span>© {new Date().getFullYear()} F1Lab Helpdesk</span>
        <span aria-hidden>·</span>
        <span>Версия {import.meta.env.VITE_VERSION}</span>
      </div>
    </footer>
  );
};

export default Footer;
