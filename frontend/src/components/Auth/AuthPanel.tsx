import type { ReactNode } from "react";
import { Link } from "react-router";
import { RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Части листа пред-авторизационных экранов. Лежат вместе, потому что делят
// одни отступы и врозь не используются (тот же приём, что в app/Panel).

/** Единственный «лист» на экране: форма или итоговое сообщение. */
export const AuthPanel = ({ children }: { children: ReactNode }) => (
  <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-6 tw:lg:p-8">
    {children}
  </div>
);

export const AuthHeading = ({
  title,
  lede,
}: {
  title: string;
  lede?: ReactNode;
}) => (
  <>
    <h1 className="tw:mb-0 tw:text-2xl tw:font-bold tw:tracking-tight">
      {title}
    </h1>
    {lede && (
      <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {lede}
      </p>
    )}
  </>
);

/** Плитка-иконка итогового состояния (письмо ушло, ссылка протухла). */
export const AuthTile = ({
  tone,
  children,
}: {
  tone: "success" | "warning";
  children: ReactNode;
}) => (
  <div
    className={cn(
      "tw:mb-4 tw:flex tw:size-10 tw:items-center tw:justify-center tw:rounded-xl",
      tone === "success"
        ? "tw:bg-primary/15 tw:text-accent-text"
        : "tw:bg-warning/15 tw:text-warning",
    )}
  >
    {children}
  </div>
);

export type Way = { label: string; to?: string; href?: string };

/**
 * Пути «если не получается». Не микроссылка в углу: на входе их читают чаще,
 * чем кажется — большинство приходящих сюда людей заводили не сами себе
 * учётку и пароля никогда не имели.
 */
export const WaysIn = ({ title, ways }: { title: string; ways: Way[] }) => {
  const visible = ways.filter((way) => way.to || way.href);
  if (!visible.length) return null;

  const rowClass =
    "tw:-mx-2 tw:flex tw:h-9 tw:items-center tw:justify-between tw:gap-3 tw:rounded-lg tw:px-2 tw:text-sm tw:text-foreground tw:no-underline tw:transition-colors tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:outline-none";

  return (
    <div className="tw:mt-6 tw:border-t tw:border-border-soft tw:pt-4">
      <div className="tw:mb-1 tw:text-xs tw:font-semibold tw:tracking-wider tw:text-faint tw:uppercase">
        {title}
      </div>
      {visible.map((way) =>
        way.to ? (
          <Link key={way.label} to={way.to} className={rowClass}>
            <span>{way.label}</span>
            <RiArrowRightSLine className="tw:text-faint" aria-hidden />
          </Link>
        ) : (
          <a key={way.label} href={way.href} className={rowClass}>
            <span>{way.label}</span>
            <RiArrowRightSLine className="tw:text-faint" aria-hidden />
          </a>
        ),
      )}
    </div>
  );
};
