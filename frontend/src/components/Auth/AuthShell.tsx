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
    "flex h-11 items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-sm text-foreground no-underline",
    "lg:h-auto lg:block lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0",
    desktopOnly && "hidden lg:block",
  );
  const body = (
    <>
      <span className="text-faint lg:hidden" aria-hidden>
        {icon}
      </span>
      <span className="hidden text-xs font-semibold tracking-wider text-faint uppercase lg:block">
        {label}
      </span>
      <span className="lg:mt-0.5 lg:block">{value}</span>
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
    <span className="text-sm text-faint tabular-nums">
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

  // Тема применяется на месте: контекст переключает класс `.dark` на <html>,
  // как и у переключателей внутри приложения. Перезагрузка здесь когда-то
  // была ради легаси-CSS и осталась лишней — она ещё и стирала введённое.
  const changeTheme = (value: string) => {
    if (value === theme) return;
    setTheme(value);
  };

  const { contacts } = prefs;
  const hasContacts = Boolean(contacts.tel || contacts.email);

  return (
    // items-center на min-height-контейнере: если содержимое выше экрана,
    // контейнер просто растёт и центрирование ничего не режет
    <div className="flex min-h-svh items-center">
      {/*
        Композиция ограничена по ширине и НЕ растягивается на весь экран: без
        этого на 1920 стойка уезжала к левому краю, лист — к правому, а между
        ними оставалась пустая половина экрана. Ряды тоже не тянутся (`auto`):
        служебная строка стоит под контактами, а не липнет к низу монитора.
      */}
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 lg:grid lg:grid-cols-5 lg:gap-x-10 lg:px-10 lg:py-16">
        {/*
          Стойка — ОДНА ячейка сетки: пока лист пересекал две строки, его
          высота размазывалась по ним и отрывала марку от фразы под ней.
          На мобилке обёртка становится `display: contents`, и порядок
          «марка → форма → контакты» задаётся через order у самих блоков.
        */}
        <div className="contents lg:col-span-2 lg:flex lg:flex-col">
          {/* марка */}
          <div className="order-1 flex items-center justify-between gap-4">
            <BrandMark logo={contacts.logo} size="lg" />
            <ThemeSegment
              theme={theme}
              onChange={changeTheme}
              showLabels={false}
              className="lg:hidden"
            />
          </div>

          {/* фраза, контакты и служебная строка */}
          <aside
            className={cn(
              "order-3 flex flex-col pt-8",
              // без подписи контакты подходят к марке ближе, чем нужно
              contacts.title ? "lg:pt-6" : "lg:pt-10",
            )}
          >
            {contacts.title && (
              <p className="mt-0 mb-0 hidden max-w-xs text-base text-muted-foreground lg:block">
                {contacts.title}
              </p>
            )}

            {hasContacts && (
              <div
                className={cn(
                  "flex flex-col gap-2 lg:gap-4",
                  contacts.title && "lg:mt-8",
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

            <div className="mt-6 flex items-center justify-center gap-4 lg:mt-10 lg:justify-between">
              <Clock timezone={prefs.timezone} />
              <ThemeSegment
                theme={theme}
                onChange={changeTheme}
                showLabels={false}
                className="hidden lg:inline-flex"
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
        <main className="order-2 flex justify-center pt-8 lg:col-span-3 lg:items-start lg:pt-0">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default AuthShell;
