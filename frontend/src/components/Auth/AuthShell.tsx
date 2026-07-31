import type { ReactNode } from "react";
import { useContext } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { RiMailLine, RiPhoneLine } from "react-icons/ri";

import BrandMark from "@/components/app/BrandMark";
import ThemeSegment from "@/components/app/ThemeSegment";
import { cn } from "@/lib/utils";

import useMinuteTick from "../../hooks/use-minute-tick";
import { ThemeContext } from "../../store/theme-context";
import { tzCity } from "../../util/timezone-display";
import type { AuthPrefs } from "../../pages/Auth/prefs";

/**
 * Оболочка пред-авторизационных экранов: стойка слева, лист формы справа.
 *
 * Стойка — типографика прямо на канве, единственный «лист» на экране это
 * форма. Контакты в стойке настоящие (Preferences.contacts): интерфейс службы
 * поддержки не имеет права оставлять человека, который не может войти, без
 * канала связи.
 *
 * В стойке НЕТ ни одной выдуманной строки — только марка и то, что задано в
 * настройках. Подпись под маркой берётся из `contacts.title` («Настройки →
 * Основные»), а не из кода: своего названия у приложения нет (см.
 * `services/reportCard.js` — компанию-исполнителя везде выводят из автора
 * документа), а до входа автора тоже нет. Не задана — подписи просто нет.
 *
 * Лист закреплён по ВЕРХНЕМУ краю, а не центрирован: у входа два поля, у
 * регистрации четыре, и при центрировании заголовок прыгал бы при каждом
 * переходе между экранами. Стойка неподвижна всегда.
 */

const Contact = ({
  label,
  value,
  href,
  icon,
  desktopOnly = false,
}: {
  label: string;
  value: string;
  href?: string;
  icon?: ReactNode;
  desktopOnly?: boolean;
}) => {
  // Одна разметка на две поверхности: на мобилке — нажимаемая строка с
  // иконкой, на десктопе — метка со значением на канве
  const className = cn(
    "tw:flex tw:h-11 tw:items-center tw:gap-2.5 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:px-3 tw:text-sm tw:text-foreground tw:no-underline",
    "tw:lg:h-auto tw:lg:block tw:lg:rounded-none tw:lg:border-0 tw:lg:bg-transparent tw:lg:px-0",
    desktopOnly && "tw:hidden tw:lg:block",
  );
  const body = (
    <>
      <span className="tw:text-faint tw:lg:hidden" aria-hidden>
        {icon}
      </span>
      <span className="tw:hidden tw:text-xs tw:font-semibold tw:tracking-wider tw:text-faint tw:uppercase tw:lg:block">
        {label}
      </span>
      <span className="tw:lg:mt-0.5 tw:lg:block">{value}</span>
    </>
  );

  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
};

const Clock = ({ timezone }: { timezone: string }) => {
  const now = useMinuteTick(Boolean(timezone));
  if (!timezone) return null;

  let time = "";
  try {
    time = formatInTimeZone(now, timezone, "HH:mm");
  } catch {
    return null;
  }

  return (
    <span className="tw:text-sm tw:text-faint tw:tabular-nums">
      {tzCity(timezone)} · {time}
    </span>
  );
};

const AuthShell = ({
  prefs,
  children,
}: {
  prefs: AuthPrefs;
  children: ReactNode;
}) => {
  // theme-context — ещё .jsx, поэтому типизируем на границе
  const { theme, setTheme } = useContext(ThemeContext) as {
    theme: string;
    setTheme: (value: string) => void;
  };

  const changeTheme = (value: string) => {
    if (value === theme) return;
    setTheme(value);
    // Легаси-CSS до эндшпиля подхватывает тему только с перезагрузкой
    window.location.reload();
  };

  const { contacts } = prefs;
  const hasContacts = Boolean(contacts.tel || contacts.email);

  return (
    // items-center на min-height-контейнере: если содержимое выше экрана,
    // контейнер просто растёт и центрирование ничего не режет
    <div className="tw:flex tw:min-h-svh tw:items-center">
      {/*
        Композиция ограничена по ширине и НЕ растягивается на весь экран: без
        этого на 1920 стойка уезжала к левому краю, лист — к правому, а между
        ними оставалась пустая половина экрана. Ряды тоже не тянутся (`auto`):
        служебная строка стоит под контактами, а не липнет к низу монитора.
      */}
      <div className="tw:mx-auto tw:flex tw:w-full tw:max-w-6xl tw:flex-col tw:px-4 tw:py-5 tw:lg:grid tw:lg:grid-cols-5 tw:lg:gap-x-10 tw:lg:px-10 tw:lg:py-16">
        {/*
          Стойка — ОДНА ячейка сетки: пока лист пересекал две строки, его
          высота размазывалась по ним и отрывала марку от фразы под ней.
          На мобилке обёртка становится `display: contents`, и порядок
          «марка → форма → контакты» задаётся через order у самих блоков.
        */}
        <div className="tw:contents tw:lg:col-span-2 tw:lg:flex tw:lg:flex-col">
          {/* марка */}
          <div className="tw:order-1 tw:flex tw:items-center tw:justify-between tw:gap-4">
            <BrandMark logo={contacts.logo} size="lg" mark />
            <ThemeSegment
              theme={theme}
              onChange={changeTheme}
              showLabels={false}
              className="tw:lg:hidden"
            />
          </div>

          {/* фраза, контакты и служебная строка */}
          <aside
            className={cn(
              "tw:order-3 tw:flex tw:flex-col tw:pt-8",
              // без подписи контакты подходят к марке ближе, чем нужно
              contacts.title ? "tw:lg:pt-6" : "tw:lg:pt-10",
            )}
          >
            {contacts.title && (
              <p className="tw:mt-0 tw:mb-0 tw:hidden tw:max-w-xs tw:text-base tw:text-muted-foreground tw:lg:block">
                {contacts.title}
              </p>
            )}

            {hasContacts && (
              <div
                className={cn(
                  "tw:flex tw:flex-col tw:gap-2 tw:lg:gap-4",
                  contacts.title && "tw:lg:mt-8",
                )}
              >
                {contacts.tel && (
                  <Contact
                    label="Телефон"
                    value={contacts.tel}
                    href={`tel:${contacts.tel.replace(/[^+\d]/g, "")}`}
                    icon={<RiPhoneLine size={16} />}
                  />
                )}
                {contacts.email && (
                  <Contact
                    label="Почта"
                    value={contacts.email}
                    href={`mailto:${contacts.email}`}
                    icon={<RiMailLine size={16} />}
                  />
                )}
                {contacts.address && (
                  <Contact label="Адрес" value={contacts.address} desktopOnly />
                )}
              </div>
            )}

            <div className="tw:mt-6 tw:flex tw:items-center tw:justify-center tw:gap-4 tw:lg:mt-10 tw:lg:justify-between">
              <Clock timezone={prefs.timezone} />
              <ThemeSegment
                theme={theme}
                onChange={changeTheme}
                showLabels={false}
                className="tw:hidden tw:lg:inline-flex"
              />
            </div>
          </aside>
        </div>

        {/*
          Верх листа — вровень с маркой: пока он стоял ниже, стойка читалась
          приподнятой над формой. Сама композиция центрируется по вертикали
          целиком (см. обёртку выше), поэтому при переходе на регистрацию, где
          полей больше, блок слегка смещается — это принятое решение.
        */}
        <main className="tw:order-2 tw:flex tw:justify-center tw:pt-8 tw:lg:col-span-3 tw:lg:items-start tw:lg:pt-0">
          <div className="tw:w-full tw:max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default AuthShell;
