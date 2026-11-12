import { useContext } from "react";
import { Link } from "react-router";
import { isBrowser } from "react-device-detect";

import { cn } from "@/lib/utils";
import { formatPhone, phoneHref } from "@/util/phone";
import useInitialPrefs from "../store/prefs";
import { useAuthedUser } from "@/store/authed-user";
import { ThemeContext } from "../store/theme-context";

// Один разделитель для контактов и служебной строки футера.
const FooterSeparator = ({ className }) => (
  <span aria-hidden className={cn("text-faint", className)}>
    ·
  </span>
);

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
  const user = useAuthedUser();
  const { contacts, brand, hasHelp } = useInitialPrefs();
  const { plainCanvas } = useContext(ThemeContext);

  const sheet = isBrowser && !plainCanvas;

  if (!user?._id) return null;

  // На десктопе контакты и адрес делят строку. На телефоне адрес ниже;
  // точка перед адресом скрыта вместе с десктопной раскладкой.
  const contactItems = [
    contacts?.tel &&
      (phoneHref(contacts.tel) ? (
        <a
          key="tel"
          href={phoneHref(contacts.tel)}
          className="text-muted-foreground no-underline tabular-nums hover:text-foreground"
        >
          {formatPhone(contacts.tel)}
        </a>
      ) : (
        <span key="tel" className="text-muted-foreground tabular-nums">
          {formatPhone(contacts.tel)}
        </span>
      )),
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
        "relative mt-6 py-6 text-center text-sm text-muted-foreground lg:py-4",
        sheet
          ? "mx-auto w-fit max-w-full rounded-2xl border border-border bg-card px-8"
          : "border-t border-border-soft",
      )}
    >
      {(contactItems.length > 0 || contacts?.address) && (
        <div className="mb-2 flex flex-col items-center justify-center gap-x-2.5 gap-y-1 lg:flex-row">
          {contactItems.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
              {contactItems.map((item, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-2.5 whitespace-nowrap"
                >
                  {index > 0 && <FooterSeparator />}
                  {item}
                </span>
              ))}
            </div>
          )}
          {contactItems.length > 0 && contacts?.address && (
            <FooterSeparator className="hidden shrink-0 lg:inline" />
          )}
          {contacts?.address && (
            <div className="min-w-0 text-pretty">{contacts.address}</div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-faint">
        <span className="whitespace-nowrap">
          © {new Date().getFullYear()} {brand.productName}
        </span>
        <FooterSeparator />
        <span className="whitespace-nowrap">
          {/* В подвале — только версия: VITE_VERSION имеет вид «версия+коммит»
              (в разработке — "dev"), коммит читателю не нужен */}
          Версия {String(import.meta.env.VITE_VERSION ?? "").split("+")[0]}
        </span>
        {/* Только когда читателю есть что открыть (prefs.hasHelp из /api/me) */}
        {hasHelp && (
          <>
            <FooterSeparator />
            <Link
              to="/help"
              className="whitespace-nowrap text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Справка
            </Link>
          </>
        )}
      </div>
    </footer>
  );
};

export default Footer;
