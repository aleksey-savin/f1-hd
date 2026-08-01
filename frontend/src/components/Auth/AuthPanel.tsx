import type { ReactNode } from "react";
import { Link } from "react-router";
import { RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

// Части листа пред-авторизационных экранов. Лежат вместе, потому что делят
// одни отступы и врозь не используются (тот же приём, что в app/Panel).

/** Единственный «лист» на экране: форма или итоговое сообщение. */
export const AuthPanel = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-6 lg:p-8">
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
    <h1 className="mb-0 text-2xl font-bold tracking-tight">{title}</h1>
    {lede && <p className="mt-2 mb-0 text-sm text-muted-foreground">{lede}</p>}
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
      "mb-4 flex size-10 items-center justify-center rounded-xl",
      tone === "success"
        ? "bg-primary/15 text-accent-text"
        : "bg-warning/15 text-warning",
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
    "-mx-2 flex h-9 items-center justify-between gap-3 rounded-lg px-2 text-sm text-foreground no-underline transition-colors hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50 outline-none";

  return (
    <div className="mt-6 border-t border-border-soft pt-4">
      <div className="mb-1 text-xs font-semibold tracking-wider text-faint uppercase">
        {title}
      </div>
      {visible.map((way) =>
        way.to ? (
          <Link key={way.label} to={way.to} className={rowClass}>
            <span>{way.label}</span>
            <RiArrowRightSLine className="text-faint" aria-hidden />
          </Link>
        ) : (
          <a key={way.label} href={way.href} className={rowClass}>
            <span>{way.label}</span>
            <RiArrowRightSLine className="text-faint" aria-hidden />
          </a>
        ),
      )}
    </div>
  );
};
