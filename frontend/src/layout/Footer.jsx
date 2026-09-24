import { useContext } from "react";
import { isBrowser } from "react-device-detect";

import { cn } from "@/lib/utils";
import useInitialPrefs from "../store/prefs";
import { getLocalStorageData } from "../util/auth";
import { ThemeContext } from "../store/theme-context";

// Футер оболочки: контакты компании и служебная строка. ОБЯЗАТЕЛЬНО relative:
// слой обоев (fixed .app-wallpaper) рисуется поверх статического контента —
// без позиционирования футер под ним исчезает.
//
// На десктопе футер получает подложку-«лист», как и контент в Root: на канве
// с фактурой (index.css → «Фактура канвы») мелкий серый текст поверх клетки
// не читается, а под обоями — тем более. В чистом виде листа нет ни у
// контента, ни здесь. На телефоне его нет никогда: там канва спокойнее, а
// ширины на поля вокруг листа всё равно нет.
const Footer = () => {
  const { token } = getLocalStorageData();
  const { contacts } = useInitialPrefs();
  const { plainCanvas } = useContext(ThemeContext);

  const sheet = isBrowser && !plainCanvas;

  if (!token) return null;

  // Телефон и почта — одной строкой, адрес — своей: факт не переносится
  // посередине, и строка не начинается с точки-разделителя (так было на
  // телефоне, когда все три факта шли одним переносимым рядом)
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
        <div className="mb-1 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          {contactItems.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-2.5 whitespace-nowrap"
            >
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
      {contacts?.address && <div className="mb-2 text-pretty">{contacts.address}</div>}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-faint">
        <span className="whitespace-nowrap">
          © {new Date().getFullYear()} F1Lab Helpdesk
        </span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">
          Версия {import.meta.env.VITE_VERSION}
        </span>
      </div>
    </footer>
  );
};

export default Footer;
