import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PersonalWork } from "../../types/employeesReport";

import { formatDayMonthTime } from "../../util/format-date";
import {
  WORK_CLASSES,
  WORK_CLASS_LABEL,
  financeStatusMeta,
  formatMinutes,
} from "./work-format";

// Мобильный вид списка работ: дата и длительность крупно, заявка и статус —
// метой. Таблица со скроллом в кармане не читается.
const PAGE = 10;

const PersonalWorksCards = ({ works }: { works: PersonalWork[] }) => {
  const [shown, setShown] = useState(PAGE);

  return (
    <div className="tw:px-3.5">
      {works.slice(0, shown).map((work) => {
        const status = financeStatusMeta(work.financesStatus);
        const muted = status.key === "preview" || status.key === "none";
        const classColor =
          WORK_CLASSES.find((item) => item.key === work.workClass)?.color ??
          "var(--faint)";
        return (
          <div
            key={work._id}
            className="tw:flex tw:flex-col tw:gap-1 tw:border-t tw:border-border-soft tw:py-3 tw:first:border-t-0"
          >
            <div className="tw:flex tw:items-baseline tw:gap-2">
              <span className="tw:text-xs tw:text-faint tw:tabular-nums">
                {formatDayMonthTime(work.startedAt)}
              </span>
              <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-muted-foreground">
                <span
                  aria-hidden
                  className="tw:size-2 tw:flex-none tw:rounded-xs"
                  style={{ background: classColor }}
                />
                {WORK_CLASS_LABEL[work.workClass]}
              </span>
              <span className="tw:ms-auto tw:font-semibold tw:tabular-nums">
                {formatMinutes(work.durationMinutes)}
              </span>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-sm">
              {work.tickets.map((ticket) => (
                <Link
                  key={ticket._id}
                  to={`/tickets/${ticket.num}`}
                  target="_blank"
                  rel="noreferrer"
                  className="tw:font-semibold tw:text-accent-text tw:no-underline tw:tabular-nums"
                >
                  №{ticket.num}
                </Link>
              ))}
              <span className="tw:line-clamp-2 tw:text-muted-foreground">
                {work.description || "без описания"}
              </span>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:text-xs">
              <span className="tw:text-faint">{work.company?.alias ?? "—"}</span>
              <span
                className={cn(
                  "tw:inline-flex tw:items-center tw:gap-1.5",
                  muted ? "tw:text-muted-foreground" : "tw:text-accent-text",
                )}
              >
                <span
                  aria-hidden
                  className="tw:size-1.5 tw:flex-none tw:rounded-full"
                  style={{ background: status.color, opacity: muted ? 0.5 : 1 }}
                />
                {status.label}
              </span>
              {work.overtime.roundedMinutes > 0 && (
                <span className="tw:text-warning tw:tabular-nums">
                  переработка {formatMinutes(work.overtime.roundedMinutes)}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {shown < works.length && (
        <div className="tw:border-t tw:border-border-soft tw:py-2">
          <Button
            variant="ghost"
            size="sm"
            className="tw:text-accent-text"
            onClick={() => setShown((current) => current + PAGE)}
          >
            Показать ещё {Math.min(PAGE, works.length - shown)}
          </Button>
        </div>
      )}
    </div>
  );
};

export default PersonalWorksCards;
